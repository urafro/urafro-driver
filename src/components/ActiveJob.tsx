import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { ApiError, getPodPhotoUrl, type DriverDelivery, type FailureReason } from '../lib/api';
import { watchLocation, type Coords } from '../lib/location';
import { metersBetween } from '../lib/geo';
import { money, placeLabel } from '../lib/format';
import { runStops } from '../lib/run';
import { mapsUrl, telUrl } from '../lib/links';
import { colors, FONT, iconSize, PILL, radius, shadow, space } from '../theme';
import { animateNext } from '../lib/motion';
import { Stepper, Text, Transition, useToast } from './ui';
import RouteMap from './RouteMap';
import CourierMessages from './CourierMessages';

export type LifecycleAction = 'picked_up' | 'in_transit' | 'delivered' | 'failed';
export interface ActionExtra {
  reason?: FailureReason;
  codCollectedMinor?: number;
  note?: string;
  /** At-door delivery code read out by the customer (verified handover). */
  podPin?: string;
  /** Claimed PoD method — set to 'photo' once a delivery photo has been uploaded. */
  method?: string;
}

// The actions available from each status (mirrors the platform state machine).
// "Can't complete" exists in EVERY live state — a driver stuck after pickup
// (unreachable customer, refused cash) must always have an exit (ADR-002 A.2).
const ACTIONS: Record<string, { label: string; to: LifecycleAction; danger?: boolean }[]> = {
  assigned: [
    { label: "I've picked up", to: 'picked_up' },
    { label: "Can't complete", to: 'failed', danger: true },
  ],
  picked_up: [
    { label: 'On my way', to: 'in_transit' },
    { label: 'Delivered', to: 'delivered' },
    { label: "Can't complete", to: 'failed', danger: true },
  ],
  in_transit: [
    { label: 'Delivered', to: 'delivered' },
    { label: "Can't complete", to: 'failed', danger: true },
  ],
};

const FAILURE_REASONS: { value: FailureReason; label: string; sub: string }[] = [
  { value: 'customer_unreachable', label: 'Customer unreachable', sub: "No answer after calling — we'll let the merchant know" },
  { value: 'wrong_address', label: 'Wrong address', sub: "The pin or landmark doesn't match" },
  { value: 'customer_refused', label: 'Customer refused the order', sub: 'They turned the package away' },
  { value: 'cash_refused', label: "Couldn't collect the cash", sub: 'COD amount not paid' },
  { value: 'vehicle_problem', label: 'Vehicle problem', sub: 'Breakdown, puncture, accident' },
  { value: 'other', label: 'Something else', sub: 'Tell ops on WhatsApp afterwards' },
];

// D6 (2026-08-08): the one-tap customer messages now live in CourierMessages, which
// leads with the platform-sent SMS templates and keeps the WhatsApp quick-replies as
// the labelled fallback. The statuses that surface it: server-side the templates are
// allowed in every active status, but on the PICKUP leg "arriving now" would mean
// arriving at the MERCHANT, and a wrong text to a customer is worse than one the
// courier waits a few minutes to send. So it appears after pickup, exactly where the
// customer-facing quick-replies already lived.
const CAN_MESSAGE_CUSTOMER = new Set(['picked_up', 'in_transit']);

// The 4-segment progress stepper (Claimed / Picked up / On the way / Delivered).
const STEPS = ['Claimed', 'Picked up', 'On the way', 'Delivered'];
const STEP_DONE: Record<string, number> = {
  assigned: 1,
  picked_up: 2,
  in_transit: 3,
  delivered: 4,
};

// The driver's current job: who/where to head to next (with one-tap Navigate +
// Call), the other stop for context, and the next lifecycle step(s).
export default function ActiveJob({
  job,
  run,
  token,
  onAction,
  busy,
  actionError,
}: {
  job: DriverDelivery;
  /** #66 (batching): every in-flight leg of the driver's run (primary-first), or null
   *  when batching is off / a run of one. `job` is the leg being worked (run[0]); this
   *  drives the multi-stop run strip. Only rendered when there is more than one leg. */
  run?: DriverDelivery[] | null;
  /** Driver bearer token — needed to mint the PoD-photo upload URL directly. */
  token: string;
  onAction: (to: LifecycleAction, extra?: ActionExtra) => void;
  busy: boolean;
  /** Result of the driver's last lifecycle tap (layer-1 action feedback) —
   *  rendered adjacent to the control: under the code field in the deliver
   *  panel, else above the action buttons. */
  actionError?: string | null;
}) {
  const status = job.status ?? 'assigned';
  const actions = ACTIONS[status] ?? [];
  // #66: the run is "batched" only with more than one in-flight leg. One leg (or none)
  // ⇒ the plain single-job screen (parity), so cap=1 renders exactly as before.
  const runLegs = run && run.length > 1 ? run : null;
  // The ordered remaining route for the strip: every pickup, then every drop. The first
  // is the stop being worked now (== `job`, chosen by currentStopLeg on the HomeScreen).
  const stops = runLegs ? runStops(runLegs) : null;

  const toast = useToast();

  // Two-step confirms: "Can't complete" needs a reason; "Delivered" captures the
  // at-door delivery code (verified handover) + PoD note + (on COD jobs) the cash
  // actually collected.
  const [panel, setPanel] = useState<'fail' | 'deliver' | null>(null);
  const [note, setNote] = useState('');
  const [codInput, setCodInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  // Photo-PoD capture is a separate async (camera + R2 upload) BEFORE the delivered
  // call, so it owns its own busy/error state distinct from the lifecycle `busy` prop.
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // #66 (batching): when a pooled run advances to the NEXT leg (job id changes), reset the
  // deliver/fail panel + its inputs. Otherwise the previous stop's open panel and typed
  // code carry over — seen on-device: a stale PoD PIN pre-filled the next drop's panel.
  // No-op on the single-job flow (job.id is stable for the life of one delivery).
  useEffect(() => {
    setPanel(null);
    setNote('');
    setCodInput('');
    setPinInput('');
    setPhotoError(null);
  }, [job.id]);

  // B2 per-action acknowledgment: confirm what just happened (felt + seen) when the
  // SAME worked leg advances FORWARD. Keyed on both id and status in one ref, so a
  // pooled-run leg-advance (job.id change) never fires a stale ack regardless of effect
  // ordering, and each ack is gated on its genuine predecessor. Delivered is not acked
  // here — the leg unmounts and HomeScreen shows the payday / next-stop state.
  const advanceRef = useRef({ id: job.id, status });
  useEffect(() => {
    const prev = advanceRef.current;
    advanceRef.current = { id: job.id, status };
    if (prev.id !== job.id || prev.status === status) return;
    if (status === 'picked_up' && prev.status === 'assigned') toast.success('Order collected — head to the customer');
    else if (status === 'in_transit' && prev.status === 'picked_up') toast.info('On the way to the customer');
  }, [job.id, status, toast]);

  // The driver's own position for the route map. Watched HERE (this screen only shows
  // on shift, so location permission is granted) rather than threaded from HomeScreen,
  // keeping the map self-contained. A live stream — not a one-shot fetch — so the dot
  // appears the moment GPS locks (the old getCurrentLocation gave up after 8s and
  // returned null indoors, leaving the map dot-less) and then follows the driver. Only
  // re-render (→ re-fetch the OSRM route) once they've actually moved >50m; GPS jitter
  // while stationary would otherwise hammer the route API on 2G.
  const [driverLoc, setDriverLoc] = useState<Coords | null>(null);
  useEffect(() => {
    let active = true;
    let unsub: (() => void) | undefined;
    void watchLocation((c) => {
      setDriverLoc((prev) => (prev && metersBetween(prev, c) < 50 ? prev : c));
    }).then((u) => {
      if (active) unsub = u;
      else u(); // unmounted before subscribe resolved
    });
    return () => {
      active = false;
      unsub?.();
    };
  }, []);

  const codDue = job.collect_minor ?? 0;
  const startAction = (to: LifecycleAction) => {
    if (to === 'failed') {
      animateNext('base');
      setPanel('fail');
    } else if (to === 'delivered') {
      setCodInput(codDue > 0 ? (codDue / 100).toFixed(2) : '');
      setPinInput('');
      animateNext('base');
      setPanel('deliver');
    } else {
      onAction(to);
    }
  };
  const closePanel = () => {
    animateNext('base');
    setPanel(null);
  };
  // The deliver panel deliberately STAYS OPEN here: on success the whole card
  // unmounts (the job clears), and on a wrong-code 400 the driver needs the form
  // (with their typed code) still in front of them to retry.
  // The note + COD captured in the panel — shared by every completion path
  // (code / photo / manual).
  const buildExtra = (): ActionExtra => {
    const extra: ActionExtra = {};
    if (note.trim()) extra.note = note.trim().slice(0, 500);
    if (codDue > 0) {
      // Parse dollars → minor units; an unparseable edit falls back to the full
      // amount due (the server's own default) rather than silently booking 0.
      const parsed = Math.round(Number.parseFloat(codInput.replace(',', '.')) * 100);
      extra.codCollectedMinor = Number.isFinite(parsed) && parsed >= 0 ? parsed : codDue;
    }
    return extra;
  };
  const confirmDelivered = (withPin: boolean) => {
    const extra = buildExtra();
    if (withPin) extra.podPin = pinInput;
    onAction('delivered', extra);
  };
  // Photo proof: snap a picture, upload it straight to private storage, then complete
  // with method='photo' (NO pin — the photo is the proof, so the server stamps the
  // photo key rather than upgrading to 'otp'). Capture+upload need a live connection,
  // so this path never rides the offline queue; on failure we keep the panel open.
  const takePhoto = async () => {
    const id = job.id;
    if (!id) return;
    setPhotoError(null);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setPhotoError('Allow camera access to add a delivery photo.');
        return;
      }
      const shot = await ImagePicker.launchCameraAsync({ quality: 0.5 }); // compress for 2G
      if (shot.canceled || shot.assets.length === 0) return;
      setUploading(true);
      const presign = await getPodPhotoUrl(token, id); // 503 if storage off
      // Native binary PUT (OkHttp/NSURLSession) — a JS fetch(uri).blob() PUT drops the
      // body on Android, so uploadAsync with BINARY_CONTENT is the robust route.
      const put = await FileSystem.uploadAsync(presign.upload.url, shot.assets[0].uri, {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      });
      if (put.status < 200 || put.status >= 300) throw new Error(`upload ${put.status}`);
      onAction('delivered', { ...buildExtra(), method: 'photo' });
    } catch (e) {
      setPhotoError(
        e instanceof ApiError && e.status === 503
          ? 'Photo proof isn’t enabled yet — use the code or complete without it.'
          : 'Couldn’t upload the photo — check your connection and try again.',
      );
    } finally {
      setUploading(false);
    }
  };
  const pinReady = /^\d{4}$/.test(pinInput);
  const blocked = busy || uploading;

  // Before pickup the driver heads to the merchant; after, to the customer.
  const goingToPickup = status === 'assigned';
  const target = goingToPickup
    ? { label: 'merchant', geo: job.pickup, contact: job.pickup_contact }
    : { label: 'customer', geo: job.dropoff, contact: job.dropoff_contact };

  const navigate = () => {
    if (target.geo?.lat != null && target.geo?.lng != null) {
      void Linking.openURL(mapsUrl(target.geo.lat, target.geo.lng));
    }
  };
  const call = () => {
    if (target.contact?.phone) void Linking.openURL(telUrl(target.contact.phone));
  };

  const stepsDone = STEP_DONE[status] ?? 1;
  const hasGeo = target.geo?.lat != null && target.geo?.lng != null;

  return (
    <View style={styles.container}>
      {/* B2 progress — for a SINGLE job the shared numeric stepper ("Step X of 4"
          with an animated fill). In a pooled run the per-leg lifecycle would reset
          per stop (confusing), so the stop-by-stop run strip below is the indicator. */}
      {stops ? null : (
        <Stepper
          current={stepsDone}
          total={4}
          label="Step"
          sublabel={goingToPickup ? `Heading to ${placeLabel(job.pickup)}` : 'At the customer'}
          steps={STEPS.map((s) => ({ key: s, label: s }))}
        />
      )}

      {/* #66 (batching): the stop-by-stop run strip — every stop in the pooled run, the
          one being worked highlighted "Now". Advances automatically: a completed leg
          drops out on the next run refresh and the next becomes current. Falls back to
          the F4 single-leg banner when only this leg is known (batch_id, no run list). */}
      {stops ? (
        <View style={styles.runStrip}>
          <View style={styles.runHead}>
            <Feather name="layers" size={iconSize.sm} color={colors.textMuted} aria-hidden />
            <Text variant="bodyStrong" color="textPrimary">
              Pooled run · {runLegs?.length} orders · {stops.length} stops
            </Text>
          </View>
          {stops.map((stop, i) => {
            const current = i === 0; // the first remaining stop is the one being worked
            const isPickup = stop.type === 'pickup';
            const label = placeLabel(isPickup ? stop.leg.pickup : stop.leg.dropoff);
            return (
              <View
                key={`${stop.leg.id as string}-${stop.type}`}
                style={[styles.runLeg, current && styles.runLegCurrent]}
              >
                <View style={[styles.runDot, current && styles.runDotCurrent]}>
                  <Feather
                    name={isPickup ? 'package' : 'flag'}
                    size={14}
                    color={current ? colors.btnPrimaryText : colors.textMuted}
                    aria-hidden
                  />
                </View>
                <Text
                  variant="callout"
                  color={current ? 'textPrimary' : 'textMuted'}
                  style={styles.runLegText}
                  numberOfLines={1}
                >
                  {isPickup ? 'Pick up' : 'Deliver'} · {label}
                </Text>
                {current ? (
                  <Text variant="micro" color="tabActive">
                    Now
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : job.batch_id ? (
        <View style={styles.runBanner}>
          <Feather name="layers" size={iconSize.sm} color={colors.textMuted} aria-hidden />
          <Text variant="bodyStrong" color="textPrimary">
            Pooled run · stop {job.batch_sequence ?? 1}
          </Text>
        </View>
      ) : null}

      {/* Primary leg-aware contact card. Wrapped in Transition so the merchant→customer
          swap after pickup is a visible cross-fade, not a silent re-render (B3). */}
      <Transition trigger={goingToPickup ? 'pickup' : 'deliver'} intensity="light">
        <View style={styles.card}>
          <Text variant="label" color="tabActive" style={styles.eyebrow}>
            {goingToPickup ? 'Pick up from' : 'Deliver to'}
          </Text>
          <Text variant="title" color="textPrimary" style={styles.place}>
            {placeLabel(target.geo)}
          </Text>

          <View style={styles.divider} />

          {target.contact?.name ? (
            <Text variant="subheading" color="textPrimary">
              {target.contact.name} · {target.label}
            </Text>
          ) : (
            <Text variant="subheading" color="textPrimary">
              The {target.label}
            </Text>
          )}
          {target.contact?.phone ? (
            <Text variant="body" color="textMuted" style={styles.contactPhone}>
              {target.contact.phone}
            </Text>
          ) : null}

          <View style={styles.actionRow}>
            {target.contact?.phone ? (
              <Pressable style={[styles.legBtn, styles.legBtnPrimary]} onPress={call}>
                <View style={styles.legBtnInner}>
                  <Feather name="phone" size={iconSize.sm} color={colors.surface} />
                  <Text variant="bodyStrong" color="surface">
                    Call {target.label}
                  </Text>
                </View>
              </Pressable>
            ) : null}
            {hasGeo ? (
              <Pressable style={[styles.legBtn, styles.legBtnGhost]} onPress={navigate}>
                <View style={styles.legBtnInner}>
                  <Feather name="navigation" size={iconSize.sm} color={colors.textPrimary} />
                  <Text variant="bodyStrong" color="textPrimary">
                    Navigate
                  </Text>
                </View>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Transition>

      {/* D6: the customer-coordination card — four fixed templates the PLATFORM texts
          the recipient (so the courier's number stays off the routine messages), with
          the WhatsApp quick-replies kept below as the labelled fallback. Keyed on the
          job so a pooled run's next leg starts with a clean send state instead of
          inheriting the previous customer's "Sent" chips. */}
      {CAN_MESSAGE_CUSTOMER.has(status) && job.id != null ? (
        <CourierMessages
          key={job.id}
          jobId={job.id}
          token={token}
          collectMinor={codDue}
          phone={target.contact?.phone ?? undefined}
        />
      ) : null}

      {/* Active-job map (Option B): the driver's live position relative to the
          current stop (merchant before pickup, customer after) on a Leaflet/OSM map.
          Kept OUTSIDE the Transition so a leg swap doesn't reload OSM tiles. */}
      {hasGeo && target.geo ? (
        <RouteMap from={driverLoc} to={{ lat: target.geo.lat, lng: target.geo.lng }} label={placeLabel(target.geo)} />
      ) : null}

      {/* Secondary "then deliver to" card — only on the pickup leg */}
      {goingToPickup ? (
        <View style={styles.card}>
          <Text variant="label" color="textFaint" style={styles.eyebrow}>
            Then deliver to
          </Text>
          <Text variant="subheading" color="textPrimary" style={styles.place2}>
            {placeLabel(job.dropoff)}
          </Text>
        </View>
      ) : null}

      {/* Earn / collect card */}
      <View style={styles.card}>
        <View style={styles.moneyRow}>
          {/* The driver's CUT, never the platform fee — quoting money they don't
              earn is a trust breach (ADR-002 A.3). */}
          <Text variant="body" color="textPrimary" style={styles.moneyLabel}>
            You earn
          </Text>
          <Text variant="title" color="textPrimary">
            {money(job.driver_fee_minor ?? null)}
          </Text>
        </View>
        {job.collect_minor ? (
          <View style={[styles.moneyRow, styles.moneyRowSpaced]}>
            <Text variant="body" color="textPrimary" style={styles.moneyLabel}>
              Collect from customer
            </Text>
            <Text variant="label" color="cod" style={styles.collectBadge}>
              {money(job.collect_minor)} cash
            </Text>
          </View>
        ) : null}
        {!goingToPickup ? (
          <Text variant="body" color="textMuted" style={styles.codeHint}>
            At the door: ask for the 4-digit code on the customer&apos;s receipt.
          </Text>
        ) : null}
      </View>

      {panel === 'fail' ? (
        <View style={styles.panel}>
          <Text variant="title" color="textPrimary">
            Why can&apos;t this be completed?
          </Text>
          {/* HONEST COPY: this used to promise "won't count against you when the
              reason checks out". Nothing on the platform vets a reason — no code
              path reads failure_reason to decide anything about the driver — so
              that was a fairness mechanic the app was inventing. State only what
              the platform actually does: the reason is persisted on the delivery
              and rides the `delivery.failed` webhook to the merchant, which is
              what ops works from. Claims about consequences to the DRIVER stay
              off this panel in both directions: a failure DOES already move the
              driver's completion_rate (the Profile tab renders it as "% completed"),
              and this app cannot be force-updated, so any promise made here outlives
              the flag flip that would falsify it. */}
          <Text variant="body" color="textFaint">
            The merchant is told and can send the job out again. The reason you pick goes on the record, and it&apos;s
            what ops uses to sort out what happened.
          </Text>
          {FAILURE_REASONS.map((r) => (
            <Pressable
              key={r.value}
              style={styles.reasonBtn}
              disabled={busy}
              onPress={() => {
                setPanel(null);
                onAction('failed', { reason: r.value });
              }}
            >
              <Text variant="subheading" color="textPrimary">
                {r.label}
              </Text>
              <Text variant="callout" color="textFaint" style={styles.reasonSub}>
                {r.sub}
              </Text>
            </Pressable>
          ))}
          <Pressable style={styles.panelCancel} onPress={closePanel}>
            <Text variant="bodyStrong" color="textFaint">
              Cancel — keep delivering
            </Text>
          </Pressable>
        </View>
      ) : panel === 'deliver' ? (
        <View style={styles.panel}>
          <Text variant="title" color="textPrimary">
            Delivery code
          </Text>
          <Text variant="callout" color="textMuted" style={styles.fieldLabel}>
            Ask the customer for the 4-digit code on their receipt.
          </Text>
          <TextInput
            style={[styles.input, styles.pinInput]}
            value={pinInput}
            onChangeText={(t) => setPinInput(t.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="••••"
            placeholderTextColor={colors.placeholder}
          />
          {/* Wrong-code / cap feedback lands HERE, next to the field — not at the
              bottom of the scroll where the keyboard hides it. */}
          {actionError ? (
            <Text variant="bodyStrong" color="danger">
              {actionError}
            </Text>
          ) : null}
          {codDue > 0 ? (
            <>
              <Text variant="callout" color="textMuted" style={styles.fieldLabel}>
                Cash collected (due {money(codDue)})
              </Text>
              <TextInput
                style={styles.input}
                value={codInput}
                onChangeText={setCodInput}
                keyboardType="decimal-pad"
                placeholder={(codDue / 100).toFixed(2)}
                placeholderTextColor={colors.placeholder}
              />
            </>
          ) : null}
          <Text variant="callout" color="textMuted" style={styles.fieldLabel}>
            Received by / note (optional)
          </Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Left with Tariro at the gate"
            placeholderTextColor={colors.placeholder}
            maxLength={500}
          />
          <Pressable
            style={[styles.btn, styles.primary, (blocked || !pinReady) && styles.busyOpacity]}
            disabled={blocked || !pinReady}
            onPress={() => confirmDelivered(true)}
          >
            {busy ? (
              <ActivityIndicator color={colors.btnPrimaryText} />
            ) : (
              <Text variant="subheading" color="btnPrimaryText">
                Confirm delivered
              </Text>
            )}
          </Pressable>
          {/* Photo proof — an alternative to the code: snap a picture of the handover,
              which completes the delivery (method='photo'). The merchant can view it. */}
          <Text variant="callout" color="textFaint" style={styles.orHint}>
            or, no code?
          </Text>
          <Pressable style={[styles.btn, styles.photoBtn, blocked && styles.busyOpacity]} disabled={blocked} onPress={takePhoto}>
            {uploading ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <View style={styles.photoBtnInner}>
                <Feather name="camera" size={iconSize.md} color={colors.textPrimary} />
                <Text variant="subheading" color="textPrimary">
                  Take delivery photo
                </Text>
              </View>
            )}
          </Pressable>
          {photoError ? (
            <Text variant="bodyStrong" color="danger">
              {photoError}
            </Text>
          ) : null}
          {/* Manual fallback — no code and no photo (older receipt, phone dead).
              Books the same completion, just unverified ('manual'). */}
          <Pressable style={styles.panelCancel} disabled={blocked} onPress={() => confirmDelivered(false)}>
            <Text variant="bodyStrong" color="textFaint">
              Complete without proof
            </Text>
          </Pressable>
          <Pressable style={styles.panelCancel} disabled={uploading} onPress={closePanel}>
            <Text variant="bodyStrong" color="textFaint">
              Cancel
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.actions}>
          {actionError ? (
            <Text variant="bodyStrong" color="danger">
              {actionError}
            </Text>
          ) : null}
          {actions.map((a) => (
            <Pressable
              key={a.to}
              style={[styles.btn, a.danger ? styles.danger : styles.primary, busy && styles.busyOpacity]}
              onPress={() => startAction(a.to)}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={a.danger ? colors.danger : colors.btnPrimaryText} />
              ) : (
                <Text variant="subheading" color={a.danger ? 'danger' : 'btnPrimaryText'}>
                  {a.label}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.lg },

  // #66 pooled-run stop strip.
  runStrip: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    gap: space.sm,
  },
  runBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  runHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  runLeg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
  runLegCurrent: { backgroundColor: colors.surface },
  runDot: {
    width: 26,
    height: 26,
    borderRadius: PILL,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  runDotCurrent: { backgroundColor: colors.tabActive },
  runLegText: { flex: 1 },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    ...shadow.card,
  },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 1 },
  place: { marginTop: space.xs },
  place2: { marginTop: space.xs },

  divider: { height: 1, backgroundColor: colors.surfaceAlt, marginVertical: space.lg },

  contactPhone: { marginTop: 2 },

  actionRow: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  legBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: PILL,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  legBtnPrimary: { backgroundColor: colors.tabActive },
  legBtnGhost: { borderWidth: 1, borderColor: colors.textPrimary },
  legBtnInner: { flexDirection: 'row', alignItems: 'center', gap: space.xs },

  // Earn / collect
  moneyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  moneyRowSpaced: { marginTop: space.sm },
  moneyLabel: { flex: 1 },
  collectBadge: {
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    backgroundColor: colors.batteryBg,
    borderRadius: PILL,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  codeHint: { marginTop: space.sm },

  // Panels
  panel: { gap: space.md },
  reasonBtn: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    minHeight: 48,
    justifyContent: 'center',
    ...shadow.card,
  },
  reasonSub: { marginTop: 2 },
  panelCancel: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingVertical: space.sm },
  fieldLabel: { marginTop: space.xs },
  pinInput: { fontFamily: FONT, fontSize: 24, fontWeight: '700', letterSpacing: 12, textAlign: 'center' },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontFamily: FONT,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },

  // Buttons
  actions: { gap: space.sm },
  btn: { minHeight: 48, borderRadius: PILL, alignItems: 'center', justifyContent: 'center', paddingVertical: space.md },
  primary: { backgroundColor: colors.btnPrimaryBg },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.dangerBorder },
  orHint: { textAlign: 'center', marginTop: 2 },
  // Photo-proof button: a ghost (bordered) button so it reads as the alternative
  // path, not competing with the gold primary "Confirm delivered".
  photoBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.textPrimary },
  photoBtnInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  busyOpacity: { opacity: 0.6 },
});
