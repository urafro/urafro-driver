import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { DriverDelivery, FailureReason } from '../lib/api';
import { getCurrentLocation, type Coords } from '../lib/location';
import { money, placeLabel } from '../lib/format';
import { mapsUrl, telUrl, waUrl } from '../lib/links';
import { colors, shadow, PILL } from '../theme';
import RouteMap from './RouteMap';

export type LifecycleAction = 'picked_up' | 'in_transit' | 'delivered' | 'failed';
export interface ActionExtra {
  reason?: FailureReason;
  codCollectedMinor?: number;
  note?: string;
  /** At-door delivery code read out by the customer (verified handover). */
  podPin?: string;
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

// One-tap messages for the customer on the way to the door — the driver
// shouldn't be typing on a moped. WhatsApp is the channel in this market.
const QUICK_REPLIES = ["I'm outside", '5 minutes away', "Can't find you — call me?"];

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
  onAction,
  busy,
  actionError,
}: {
  job: DriverDelivery;
  onAction: (to: LifecycleAction, extra?: ActionExtra) => void;
  busy: boolean;
  /** Result of the driver's last lifecycle tap (layer-1 action feedback) —
   *  rendered adjacent to the control: under the code field in the deliver
   *  panel, else above the action buttons. */
  actionError?: string | null;
}) {
  const status = job.status ?? 'assigned';
  const actions = ACTIONS[status] ?? [];

  // Two-step confirms: "Can't complete" needs a reason; "Delivered" captures the
  // at-door delivery code (verified handover) + PoD note + (on COD jobs) the cash
  // actually collected.
  const [panel, setPanel] = useState<'fail' | 'deliver' | null>(null);
  const [note, setNote] = useState('');
  const [codInput, setCodInput] = useState('');
  const [pinInput, setPinInput] = useState('');

  // The driver's own position for the route map. Fetched HERE (this screen only shows
  // on shift, so location permission is granted) rather than threaded from HomeScreen,
  // keeping the map self-contained. Refreshed every 20s so the dot tracks movement.
  const [driverLoc, setDriverLoc] = useState<Coords | null>(null);
  useEffect(() => {
    let cancelled = false;
    const fetchLoc = async () => {
      const loc = await getCurrentLocation();
      if (loc && !cancelled) setDriverLoc(loc);
    };
    void fetchLoc();
    const id = setInterval(() => void fetchLoc(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const codDue = job.collect_minor ?? 0;
  const startAction = (to: LifecycleAction) => {
    if (to === 'failed') {
      setPanel('fail');
    } else if (to === 'delivered') {
      setCodInput(codDue > 0 ? (codDue / 100).toFixed(2) : '');
      setPinInput('');
      setPanel('deliver');
    } else {
      onAction(to);
    }
  };
  // The deliver panel deliberately STAYS OPEN here: on success the whole card
  // unmounts (the job clears), and on a wrong-code 400 the driver needs the form
  // (with their typed code) still in front of them to retry.
  const confirmDelivered = (withPin: boolean) => {
    const extra: ActionExtra = {};
    if (withPin) extra.podPin = pinInput;
    if (note.trim()) extra.note = note.trim().slice(0, 500);
    if (codDue > 0) {
      // Parse dollars → minor units; an unparseable edit falls back to the full
      // amount due (the server's own default) rather than silently booking 0.
      const parsed = Math.round(Number.parseFloat(codInput.replace(',', '.')) * 100);
      extra.codCollectedMinor = Number.isFinite(parsed) && parsed >= 0 ? parsed : codDue;
    }
    onAction('delivered', extra);
  };
  const pinReady = /^\d{4}$/.test(pinInput);

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
  // Quick-replies only make sense heading to the customer (the dropoff leg) and
  // only when we have their number.
  const customerPhone = !goingToPickup ? target.contact?.phone : undefined;

  const stepsDone = STEP_DONE[status] ?? 1;
  const hasGeo = target.geo?.lat != null && target.geo?.lng != null;

  return (
    <View style={styles.container}>
      {/* 4-segment progress stepper */}
      <View style={styles.stepper}>
        {STEPS.map((s, i) => {
          const isDone = i < stepsDone;
          const isCurrent = i === stepsDone;
          return (
            <View key={s} style={styles.step}>
              <View
                style={[
                  styles.stepBar,
                  isDone && styles.stepBarDone,
                  isCurrent && styles.stepBarCurrent,
                ]}
              />
              <Text
                style={[styles.stepLabel, (isDone || isCurrent) && styles.stepLabelActive]}
                numberOfLines={1}
              >
                {s}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Primary leg-aware contact card */}
      <View style={styles.card}>
        <Text style={styles.eyebrow}>{goingToPickup ? 'Pick up from' : 'Deliver to'}</Text>
        <Text style={styles.place}>{placeLabel(target.geo)}</Text>

        <View style={styles.divider} />

        {target.contact?.name ? (
          <Text style={styles.contactName}>
            {target.contact.name} · {target.label}
          </Text>
        ) : (
          <Text style={styles.contactName}>The {target.label}</Text>
        )}
        {target.contact?.phone ? (
          <Text style={styles.contactPhone}>{target.contact.phone}</Text>
        ) : null}

        <View style={styles.actionRow}>
          {target.contact?.phone ? (
            <Pressable style={[styles.legBtn, styles.legBtnPrimary]} onPress={call}>
              <View style={styles.legBtnInner}>
                <Feather name="phone" size={16} color={colors.surface} />
                <Text style={[styles.legBtnText, styles.legBtnTextPrimary]}>Call {target.label}</Text>
              </View>
            </Pressable>
          ) : null}
          {hasGeo ? (
            <Pressable style={[styles.legBtn, styles.legBtnGhost]} onPress={navigate}>
              <View style={styles.legBtnInner}>
                <Feather name="navigation" size={16} color={colors.textPrimary} />
                <Text style={styles.legBtnText}>Navigate</Text>
              </View>
            </Pressable>
          ) : null}
        </View>

        {customerPhone ? (
          <View style={styles.waRow}>
            {QUICK_REPLIES.map((m) => (
              <Pressable
                key={m}
                style={styles.waChip}
                onPress={() => void Linking.openURL(waUrl(customerPhone, m))}
              >
                <View style={styles.waChipInner}>
                  <Feather name="message-circle" size={16} color={colors.textPrimary} />
                  <Text style={styles.waChipText}>{m}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {/* Active-job map (Option B): the driver's live position relative to the
          current stop (merchant before pickup, customer after) on a Leaflet/OSM map. */}
      {hasGeo && target.geo ? (
        <RouteMap
          from={driverLoc}
          to={{ lat: target.geo.lat, lng: target.geo.lng }}
          label={placeLabel(target.geo)}
        />
      ) : null}

      {/* Secondary "then deliver to" card — only on the pickup leg */}
      {goingToPickup ? (
        <View style={styles.card}>
          <Text style={styles.eyebrowMuted}>Then deliver to</Text>
          <Text style={styles.place2}>{placeLabel(job.dropoff)}</Text>
        </View>
      ) : null}

      {/* Earn / collect card */}
      <View style={styles.card}>
        <View style={styles.moneyRow}>
          {/* The driver's CUT, never the platform fee — quoting money they don't
              earn is a trust breach (ADR-002 A.3). */}
          <Text style={styles.moneyLabel}>You earn</Text>
          <Text style={styles.moneyValue}>{money(job.driver_fee_minor ?? null)}</Text>
        </View>
        {job.collect_minor ? (
          <View style={[styles.moneyRow, styles.moneyRowSpaced]}>
            <Text style={styles.moneyLabel}>Collect from customer</Text>
            <Text style={styles.collectBadge}>{money(job.collect_minor)} cash</Text>
          </View>
        ) : null}
        {!goingToPickup ? (
          <Text style={styles.codeHint}>At the door: ask for the 4-digit code on the customer&apos;s receipt.</Text>
        ) : null}
      </View>

      {panel === 'fail' ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Why can&apos;t this be completed?</Text>
          <Text style={styles.panelSub}>
            The merchant is told and the job is offered to another driver. This won&apos;t count against you when the
            reason checks out.
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
              <Text style={styles.reasonText}>{r.label}</Text>
              <Text style={styles.reasonSub}>{r.sub}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.panelCancel} onPress={() => setPanel(null)}>
            <Text style={styles.panelCancelText}>Cancel — keep delivering</Text>
          </Pressable>
        </View>
      ) : panel === 'deliver' ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Delivery code</Text>
          <Text style={styles.fieldLabel}>Ask the customer for the 4-digit code on their receipt.</Text>
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
          {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
          {codDue > 0 ? (
            <>
              <Text style={styles.fieldLabel}>Cash collected (due {money(codDue)})</Text>
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
          <Text style={styles.fieldLabel}>Received by / note (optional)</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Left with Tariro at the gate"
            placeholderTextColor={colors.placeholder}
            maxLength={500}
          />
          <Pressable
            style={[styles.btn, styles.primary, (busy || !pinReady) && styles.busy]}
            disabled={busy || !pinReady}
            onPress={() => confirmDelivered(true)}
          >
            {busy ? <ActivityIndicator color={colors.btnPrimaryText} /> : <Text style={styles.btnText}>Confirm delivered</Text>}
          </Pressable>
          {/* Manual fallback — the customer may not have the code (older receipt,
              phone dead). Books the same completion, just unverified ('manual'). */}
          <Pressable style={styles.panelCancel} disabled={busy} onPress={() => confirmDelivered(false)}>
            <Text style={styles.panelCancelText}>No code? Complete without it</Text>
          </Pressable>
          <Pressable style={styles.panelCancel} onPress={() => setPanel(null)}>
            <Text style={styles.panelCancelText}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.actions}>
          {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
          {actions.map((a) => (
            <Pressable
              key={a.to}
              style={[styles.btn, a.danger ? styles.danger : styles.primary, busy && styles.busy]}
              onPress={() => startAction(a.to)}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={a.danger ? colors.danger : colors.btnPrimaryText} />
              ) : (
                <Text style={[styles.btnText, a.danger && styles.dangerText]}>{a.label}</Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 16 },

  // Stepper
  stepper: { flexDirection: 'row', gap: 8 },
  step: { flex: 1, alignItems: 'center' },
  stepBar: {
    height: 6,
    width: '100%',
    borderRadius: PILL,
    marginBottom: 6,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  stepBarDone: { backgroundColor: colors.tabActive },
  stepBarCurrent: { borderColor: colors.tabActive },
  stepLabel: { fontSize: 12, color: colors.textFaint, textAlign: 'center' },
  stepLabelActive: { color: colors.tabActive, fontWeight: '700' },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    ...shadow.card,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.tabActive,
  },
  eyebrowMuted: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  place: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', lineHeight: 27, marginTop: 4 },
  place2: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', lineHeight: 22, marginTop: 4 },

  divider: { height: 1, backgroundColor: colors.surfaceAlt, marginVertical: 16 },

  contactName: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  contactPhone: { color: colors.textMuted, fontSize: 16, marginTop: 2 },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  legBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: PILL,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  legBtnPrimary: { backgroundColor: colors.tabActive },
  legBtnGhost: { borderWidth: 1, borderColor: colors.textPrimary },
  legBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legBtnText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  legBtnTextPrimary: { color: colors.surface },

  waRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  waChip: {
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderRadius: PILL,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  waChipInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  waChipText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },

  // Earn / collect
  moneyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  moneyRowSpaced: { marginTop: 8 },
  moneyLabel: { flex: 1, fontSize: 16, color: colors.textPrimary },
  moneyValue: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  collectBadge: {
    color: colors.cod,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    backgroundColor: colors.batteryBg,
    borderRadius: PILL,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  codeHint: { color: colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 8 },

  // Panels
  panel: { gap: 12 },
  panelTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  panelSub: { color: colors.textFaint, fontSize: 16, lineHeight: 23 },
  reasonBtn: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 48,
    justifyContent: 'center',
    ...shadow.card,
  },
  reasonText: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  reasonSub: { color: colors.textFaint, fontSize: 14, lineHeight: 20, marginTop: 2 },
  panelCancel: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingVertical: 10 },
  panelCancelText: { color: colors.textFaint, fontSize: 15 },
  fieldLabel: { color: colors.textMuted, fontSize: 15, marginTop: 4 },
  actionError: { color: colors.danger, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  pinInput: { fontSize: 24, fontWeight: '700', letterSpacing: 12, textAlign: 'center' },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  // Buttons
  actions: { gap: 10 },
  btn: { minHeight: 48, borderRadius: PILL, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  primary: { backgroundColor: colors.btnPrimaryBg },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.dangerBorder },
  busy: { opacity: 0.6 },
  btnText: { color: colors.btnPrimaryText, fontSize: 16, fontWeight: '700' },
  dangerText: { color: colors.danger },
});
