import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ApiError,
  claimDelivery,
  getDelivery,
  getEarnings,
  getProfile,
  goOffline,
  goOnline,
  listOffers,
  markDelivered,
  markFailed,
  markInTransit,
  markPickedUp,
  updateLocation,
  type DriverDelivery,
  type Earnings,
  type FailureReason,
  type Offer,
} from '../lib/api';
import { getCurrentLocation, ensureForegroundPermission } from '../lib/location';
import {
  isBackgroundActive,
  startBackgroundLocation,
  stopBackgroundLocation,
} from '../lib/background-location';
import { maybePromptBatteryExemption, maybeExplainBackgroundPermission } from '../lib/battery';
import { registerForPush, maybeNotifyNewOffers } from '../lib/notifications';
import { saveActiveJob, loadActiveJob, clearActiveJob } from '../lib/session';
import { money } from '../lib/format';
import { waUrl } from '../lib/links';
import { OPS_WHATSAPP } from '../config';
import {
  enqueueAction,
  flushActions,
  loadQueue,
  saveQueue,
  shouldRetry,
  type QueuedAction,
} from '../lib/queue';
import { useSession } from '../state/session';
import OffersList from '../components/OffersList';
import ActiveJob, { type LifecycleAction, type ActionExtra } from '../components/ActiveJob';

const POLL_MS = 8000;
const FLUSH_MS = 12000;

// The shift controller: offline → go online (needs location) → online (poll offers)
// → claim → on a job. Lifecycle actions are 2G-resilient: a transient failure
// queues the action and a background flush retries it until it lands (and then
// reconciles the on-screen job). Location pings + offer polls degrade softly.
export default function HomeScreen() {
  const { session, signOut } = useSession();
  const token = session?.token ?? '';

  const [online, setOnline] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [job, setJob] = useState<DriverDelivery | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [bgActive, setBgActive] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);

  // Latest job, readable from inside the (token-scoped) flush interval.
  const jobRef = useRef<DriverDelivery | null>(null);
  jobRef.current = job;

  // Register this device for offer push as soon as we have a session. Degrades
  // silently (permission denied / pre-Firebase Android) — the local-notification
  // path in the offers poll still fires.
  useEffect(() => {
    if (token) void registerForPush(token);
  }, [token]);

  // Reconcile the shift with SERVER truth on launch, and HEAL it. Two real-world
  // failure modes this fixes: (1) the UI used to boot to "Offline" even when the
  // server still had the driver available — closing the app LOOKED like going off
  // shift; (2) a swiped-away app can kill the GPS foreground service while the
  // shift is still live server-side — restarting the stream here keeps the
  // heartbeat flowing so the ghost-supply sweep doesn't take them off shift.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const p = await getProfile(token);
        if (cancelled) return;
        if (p.status === 'available' || p.status === 'busy') {
          setOnline(true);
          const alreadyStreaming = await isBackgroundActive();
          if (cancelled) return;
          setBgActive(alreadyStreaming || (await startBackgroundLocation()));
        }
      } catch {
        // non-critical — the driver can always toggle manually
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Persist the active delivery SNAPSHOT whenever it changes, so a relaunch renders
  // it instantly even in a dead zone. Skip the first run (job is null on mount) —
  // otherwise it would wipe the snapshot before the resume effect has read it.
  const didJobMount = useRef(false);
  useEffect(() => {
    if (!didJobMount.current) {
      didJobMount.current = true;
      return;
    }
    if (job?.id) void saveActiveJob(JSON.stringify(job));
    else void clearActiveJob();
  }, [job]);

  // On launch, resume an in-flight delivery from the cached snapshot IMMEDIATELY —
  // the OS may have killed the app mid-run (common on low-end Android), possibly in
  // a dead zone where a server fetch can't happen. The active-job poll below then
  // refreshes/clears it against the server once connectivity allows.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      const raw = await loadActiveJob();
      if (cancelled || !raw) return;
      try {
        const snapshot = JSON.parse(raw) as DriverDelivery;
        const s = snapshot.status;
        if (snapshot.id && (s === 'assigned' || s === 'picked_up' || s === 'in_transit')) {
          setJob(snapshot);
          setOnline(true);
          setBgActive(await startBackgroundLocation());
        } else {
          await clearActiveJob();
        }
      } catch {
        await clearActiveJob(); // unparseable snapshot — drop it
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // While on a job, poll it: catches a tenant cancellation mid-run (the push is
  // advisory; this is the load-bearing path), refreshes a resumed snapshot, and —
  // because network errors KEEP the cached job — survives dead zones.
  useEffect(() => {
    const id = job?.id;
    if (!token || !id) return;
    let cancelled = false;
    async function check() {
      try {
        const fresh = await getDelivery(token, id as string);
        if (cancelled) return;
        const s = fresh.status;
        if (s === 'assigned' || s === 'picked_up' || s === 'in_transit') {
          setJob(fresh);
        } else {
          setJob(null);
          await clearActiveJob();
          if (s === 'cancelled' || s === 'unassigned') {
            setError('That delivery was cancelled — no further action needed.');
          }
        }
      } catch (e) {
        if (!cancelled && e instanceof ApiError && (e.status === 404 || e.status === 403)) {
          setJob(null); // no longer ours
          await clearActiveJob();
        }
        // network/5xx: keep the cached job and retry next tick
      }
    }
    const interval = setInterval(() => void check(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token, job?.id]);

  // Earnings summary (ADR-002 A.4): refresh whenever we're on the shift screen.
  useEffect(() => {
    if (!token || job) return;
    let cancelled = false;
    void getEarnings(token)
      .then((e) => {
        if (!cancelled) setEarnings(e);
      })
      .catch(() => {
        // non-critical — stale/absent earnings never block the shift loop
      });
    return () => {
      cancelled = true;
    };
  }, [token, job]);

  // While online and free, refresh location + offers on an interval. Genuinely
  // NEW offers fire a local notification via the SHARED dedupe in notifications.ts
  // — the same set the background-location task uses, so a pocketed-then-opened
  // phone never gets double-notified. (RN pauses JS timers in the background, so
  // THIS poll only covers the app-open case; the location task covers
  // screen-locked, and remote push covers everything once Firebase is wired.)
  useEffect(() => {
    if (!online || job) return;
    let cancelled = false;
    async function tick() {
      try {
        // When the background stream is running it reports location; only the
        // foreground-only fallback (bg permission denied) pings location here.
        if (!bgActive) {
          const loc = await getCurrentLocation();
          if (loc && !cancelled) await updateLocation(token, loc.lat, loc.lng);
        }
        const { data } = await listOffers(token);
        if (cancelled) return;
        const fresh = data ?? [];
        setOffers(fresh);
        void maybeNotifyNewOffers(fresh, money);
      } catch {
        // transient (network) — the next tick retries
      }
    }
    void tick();
    const interval = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [online, job, token, bgActive]);

  const performAction = useCallback(
    async (a: QueuedAction): Promise<void> => {
      if (a.action === 'picked_up') await markPickedUp(token, a.deliveryId);
      else if (a.action === 'in_transit') await markInTransit(token, a.deliveryId);
      else if (a.action === 'delivered')
        await markDelivered(token, a.deliveryId, {
          method: 'manual',
          note: a.note,
          cod_collected_minor: a.codCollectedMinor,
        });
      else await markFailed(token, a.deliveryId, a.reason as FailureReason | undefined);
    },
    [token],
  );

  // Drain the pending-action queue on an interval; reconcile the active job when
  // one of its actions finally syncs.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function flush() {
      const queue = await loadQueue();
      if (queue.length === 0) {
        if (!cancelled) setPending(0);
        return;
      }
      const remaining = await flushActions(queue, performAction);
      await saveQueue(remaining);
      if (cancelled) return;
      setPending(remaining.length);

      const id = jobRef.current?.id;
      const synced =
        id != null && queue.some((a) => a.deliveryId === id) && !remaining.some((a) => a.deliveryId === id);
      if (synced && id) {
        try {
          const fresh = await getDelivery(token, id);
          if (!cancelled) setJob(fresh.status === 'delivered' || fresh.status === 'failed' ? null : fresh);
        } catch (e) {
          // Clear only when the server SAYS it's not ours — a network blip here
          // must not wipe a live job (+ its snapshot); the active-job poll retries.
          if (!cancelled && e instanceof ApiError && (e.status === 404 || e.status === 403)) {
            setJob(null);
          }
        }
      }
    }
    void flush();
    const interval = setInterval(() => void flush(), FLUSH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token, performAction]);

  const goOnlineNow = useCallback(async () => {
    setBusy(true);
    setLocating(true);
    setError(null);
    try {
      // Permission is the only hard requirement to go online — a fix is not. A slow/
      // cold GPS lock (getCurrentLocation → null) must NOT block going on shift; the
      // background stream supplies position shortly after.
      if (!(await ensureForegroundPermission())) {
        setError('Location permission is needed to receive offers.');
        return;
      }
      const loc = await getCurrentLocation();
      const state = await goOnline(token, loc ?? undefined);
      setOnline(state.status !== 'offline');
      // One-time explainer BEFORE the background prompt: Android 11+ can't grant
      // "Allow all the time" in-app, so without context drivers silently lose
      // background GPS.
      await maybeExplainBackgroundPermission();
      // Best-effort background streaming; falls back to the foreground poll if the
      // "allow all the time" permission is denied.
      setBgActive(await startBackgroundLocation());
      // One-time nudge to exclude the app from battery optimization — OEM skins
      // (Samsung) pause backgrounded apps and can kill the location service mid-run.
      void maybePromptBatteryExemption();
    } catch {
      setError('Could not go online — try again.');
    } finally {
      setBusy(false);
      setLocating(false);
    }
  }, [token]);

  const goOfflineNow = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await goOffline(token);
      await stopBackgroundLocation();
      setOnline(false);
      setBgActive(false);
      setOffers([]);
    } catch {
      setError('Could not go offline — try again.');
    } finally {
      setBusy(false);
    }
  }, [token]);

  const claim = useCallback(
    async (id: string) => {
      setClaimingId(id);
      setError(null);
      try {
        const delivery = await claimDelivery(token, id);
        setJob(delivery);
        setOffers([]);
      } catch (e) {
        // Friendly copy by failure class. Keep the technical detail in the log so a
        // future on-device issue stays visible via `adb logcat` (a diagnostic build is
        // exactly how we caught the bodyless-POST 400).
        console.warn('claim failed:', e instanceof ApiError ? `${e.status} ${e.message}` : e);
        if (e instanceof ApiError && e.status === 409) {
          setError('That job was just taken — try another.');
        } else if (e instanceof ApiError) {
          setError('Could not claim that job — please try again.');
        } else {
          setError('No connection — check your signal and try again.');
        }
      } finally {
        setClaimingId(null);
      }
    },
    [token],
  );

  const act = useCallback(
    async (to: LifecycleAction, extra?: ActionExtra) => {
      const id = job?.id;
      if (!id) return;
      // The payload rides the offline queue too, so a dead-zone tap loses nothing.
      const queued: QueuedAction = {
        id: `${id}:${to}`,
        deliveryId: id,
        action: to,
        createdAt: Date.now(),
        reason: extra?.reason,
        codCollectedMinor: extra?.codCollectedMinor,
        note: extra?.note,
      };
      setBusy(true);
      setError(null);
      try {
        let updated: DriverDelivery;
        if (to === 'picked_up') updated = await markPickedUp(token, id);
        else if (to === 'in_transit') updated = await markInTransit(token, id);
        else if (to === 'delivered')
          updated = await markDelivered(token, id, {
            method: 'manual',
            note: extra?.note,
            cod_collected_minor: extra?.codCollectedMinor,
          });
        else updated = await markFailed(token, id, extra?.reason);
        setJob(to === 'delivered' || to === 'failed' ? null : updated);
      } catch (e) {
        if (shouldRetry(e)) {
          const q = await enqueueAction(queued);
          setPending(q.length);
          setError('No signal — saved. It’ll sync automatically when you’re back online.');
        } else {
          setError('Could not update the job — try again.');
        }
      } finally {
        setBusy(false);
      }
    },
    [job, token],
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {job ? (
        <>
          <Text style={styles.title}>Active delivery</Text>
          <ActiveJob job={job} onAction={act} busy={busy} />
        </>
      ) : (
        <>
          <Text style={styles.title}>Your shift</Text>
          <Text style={styles.status}>{online ? '🟢  Online' : '⚪  Offline'}</Text>
          {earnings ? (
            <View style={styles.earnCard}>
              <View style={styles.earnCol}>
                <Text style={styles.earnValue}>{money(earnings.today_minor)}</Text>
                <Text style={styles.earnLabel}>
                  today · {earnings.today_deliveries} deliver{earnings.today_deliveries === 1 ? 'y' : 'ies'}
                </Text>
              </View>
              <View style={styles.earnCol}>
                <Text style={styles.earnValue}>{money(earnings.payable_minor)}</Text>
                <Text style={styles.earnLabel}>owed to you</Text>
              </View>
              {earnings.cod_owed_minor > 0 ? (
                <View style={styles.earnCol}>
                  <Text style={[styles.earnValue, styles.earnCod]}>{money(earnings.cod_owed_minor)}</Text>
                  <Text style={styles.earnLabel}>cash to hand in</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <Pressable
            style={[styles.toggle, online ? styles.offBtn : styles.onBtn, busy && styles.busy]}
            onPress={online ? goOfflineNow : goOnlineNow}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.toggleText}>
                {locating ? 'Getting location…' : online ? 'Go offline' : 'Go online'}
              </Text>
            )}
          </Pressable>
          {online ? <OffersList offers={offers} onClaim={claim} claimingId={claimingId} /> : null}
        </>
      )}

      {online && bgActive ? (
        <Text style={styles.bg}>📍  Sharing your location in the background</Text>
      ) : null}
      {pending > 0 ? (
        <Text style={styles.syncing}>
          ⏳ {pending} action{pending > 1 ? 's' : ''} waiting to sync…
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Text style={styles.meta}>Driver {session?.driverId.slice(0, 8)}…</Text>
        {OPS_WHATSAPP ? (
          <Pressable onPress={() => void Linking.openURL(waUrl(OPS_WHATSAPP))}>
            <Text style={styles.link}>Contact ops</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={signOut}>
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 24, paddingTop: 72, flexGrow: 1 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
  status: { color: '#cbd5e1', fontSize: 18, marginTop: 20 },
  earnCard: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    gap: 18,
  },
  earnCol: { flex: 1 },
  earnValue: { color: '#22d3ee', fontSize: 20, fontWeight: '700' },
  earnCod: { color: '#fbbf24' },
  earnLabel: { color: '#64748b', fontSize: 12, marginTop: 2 },
  toggle: { borderRadius: 12, paddingVertical: 18, alignItems: 'center', marginTop: 20 },
  onBtn: { backgroundColor: '#22c55e' },
  offBtn: { backgroundColor: '#f59e0b' },
  busy: { opacity: 0.6 },
  toggleText: { color: '#0f172a', fontSize: 18, fontWeight: '700' },
  bg: { color: '#86efac', fontSize: 13, marginTop: 16 },
  syncing: { color: '#fbbf24', fontSize: 13, marginTop: 16 },
  error: { color: '#fca5a5', fontSize: 14, marginTop: 16 },
  footer: {
    marginTop: 'auto',
    paddingTop: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  meta: { color: '#64748b', fontSize: 13 },
  link: { color: '#94a3b8', fontSize: 14 },
});
