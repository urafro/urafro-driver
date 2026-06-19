import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  ApiError,
  claimDelivery,
  declineOffer,
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
  submitBid,
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
import {
  isBatteryOptimizationOn,
  maybeExplainBackgroundPermission,
  requestBatteryExemption,
} from '../lib/battery';
import {
  registerForPush,
  maybeNotifyNewOffers,
  markOffersSeen,
  onNotificationReceived,
  onNotificationResponse,
  notificationsEnabled,
  type PushData,
} from '../lib/notifications';
import { saveActiveJob, loadActiveJob, clearActiveJob } from '../lib/session';
import { money, placeLabel } from '../lib/format';
import {
  enqueueAction,
  flushActions,
  loadQueue,
  saveQueue,
  shouldRetry,
  type QueuedAction,
} from '../lib/queue';
import { useSession } from '../state/session';
import { useActiveJob } from '../state/activeJob';
import { colors, shadow, PILL } from '../theme';
import OffersList from '../components/OffersList';
import ActiveJob, { type LifecycleAction, type ActionExtra } from '../components/ActiveJob';
import ShiftStatus from '../components/ShiftStatus';

const POLL_MS = 8000;
const FLUSH_MS = 12000;

// The shift controller: offline → go online (needs location) → online (poll offers)
// → claim → on a job. Lifecycle actions are 2G-resilient: a transient failure
// queues the action and a background flush retries it until it lands (and then
// reconciles the on-screen job). Location pings + offer polls degrade softly.
export default function HomeScreen({ focused }: { focused: boolean }) {
  const { session } = useSession();
  const token = session?.token ?? '';
  const { setActive } = useActiveJob();

  const [online, setOnline] = useState(false);
  // null = not fetched yet (show "Checking for offers…"); [] = fetched, none nearby.
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [job, setJob] = useState<DriverDelivery | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [bgActive, setBgActive] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  // Auction offers this driver has bid on (ADR-036) — the card shows "offer sent" instead of the
  // accept/counter buttons. Local-only: a bid doesn't assign the job (the customer/auto-clear does
  // later), so until then the offer still lists; this stops a re-bid and clarifies the state.
  const [bidSentIds, setBidSentIds] = useState<ReadonlySet<string>>(new Set());
  // Debounce the resume handler against Samsung's flurry of AppState 'active' transitions.
  const lastResumeRef = useRef(0);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  // The payday moment: set on a confirmed delivery so the loop ends on the
  // number, not a silent return to the offers list.
  const [completed, setCompleted] = useState<{ earnedMinor: number | null; codMinor: number } | null>(
    null,
  );
  // Go-offline asks first, showing the shift's tally — the motivating end-of-day
  // total + a COD hand-in reminder before the driver clocks out.
  const [confirmingOffline, setConfirmingOffline] = useState(false);

  // Latest job, readable from inside the (token-scoped) flush interval.
  const jobRef = useRef<DriverDelivery | null>(null);
  jobRef.current = job;

  // Register this device for offer push as soon as we have a session. Degrades
  // silently (permission denied / pre-Firebase Android) — the local-notification
  // path in the offers poll still fires.
  useEffect(() => {
    if (token) void registerForPush(token);
  }, [token]);

  // Reconcile the shift with SERVER truth, and HEAL it. Fixes, in order found
  // on-device: (1) the UI booted to "Offline" even when the server had the driver
  // available; (2) a swiped-away app killed the GPS stream while the shift stayed
  // live — restarting it keeps the heartbeat flowing; (3) the inverse lie: a
  // MINIMIZED app whose heartbeat died gets swept off shift server-side, but on
  // resume the stale UI still said "Online" with un-claimable offers (the
  // confusing 409). Truth now syncs on every foreground return, both directions.
  const reconcileShift = useCallback(async () => {
    const p = await getProfile(token);
    const onShift = p.status === 'available' || p.status === 'busy';
    setOnline(onShift);
    if (onShift) {
      const alreadyStreaming = await isBackgroundActive();
      setBgActive(alreadyStreaming || (await startBackgroundLocation()));
      // An immediate liveness ping: resuming IS proof of life — refresh
      // lastSeenAt instantly so a near-stale shift survives the reopen.
      const loc = await getCurrentLocation();
      if (loc) await updateLocation(token, loc.lat, loc.lng);
    } else {
      setBgActive(false);
    }
  }, [token]);

  // Fetch offers NOW — called eagerly on open/resume (so a notification tap paints
  // the offer fast instead of waiting for the poll, which is itself gated behind
  // reconcileShift flipping `online`) AND from the poll tick. Skipped on a job (the
  // offers list is hidden then, and we mustn't fire offer notifications mid-delivery).
  const loadOffers = useCallback(
    async (silent = false, retries = 0, reason = 'poll'): Promise<void> => {
      if (!token || jobRef.current) return;
      try {
        const { data } = await listOffers(token);
        const fresh = data ?? [];
        setOffers(fresh);
        // `silent` = refreshed because a push already notified the driver — just sync
        // the seen-set so the next poll doesn't fire a DUPLICATE local notification.
        if (silent) markOffersSeen(fresh);
        else void maybeNotifyNewOffers(fresh, money);
        // Diagnostic (offer-latency investigation): shows in `adb logcat` which trigger
        // fetched and how many offers it saw — to confirm a push/resume refetch actually
        // fires + succeeds on a real device. Cheap; remove once the latency is confirmed.
        console.log(`[offers] ${reason}: loaded ${fresh.length}`);
      } catch (e) {
        console.log(`[offers] ${reason}: load failed (retries left ${retries}): ${(e as Error)?.message ?? e}`);
        // An event-driven refetch (push / resume / focus) that failed on flaky 2G must NOT wait
        // for the online-gated 8s poll — the offer the driver was just notified about would lag.
        // Retry quickly a few times; the poll remains the final backstop. (Poll/mount pass 0.)
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, 700));
          return loadOffers(silent, retries - 1, reason);
        }
      }
    },
    [token],
  );

  // Fetch + open a job the driver just WON via a bid (ADR-036). The auction accept is async with
  // no claim-style response, so the 'assigned' push (carrying the deliveryId) is how the app learns;
  // we fetch the delivery and surface it. Best-effort — the active-job poll then keeps it fresh.
  const openAssignedJob = useCallback(
    async (deliveryId: string) => {
      try {
        const d = await getDelivery(token, deliveryId);
        if (d.status === 'assigned' || d.status === 'picked_up' || d.status === 'in_transit') {
          setJob(d);
          setOnline(true);
          setBgActive(await startBackgroundLocation());
        }
      } catch {
        // best-effort — the active-job poll / reconcile picks it up
      }
    },
    [token],
  );

  // Route a push (received in FOREGROUND or TAPPED from the tray): a bid-accepted push opens the
  // won job; anything else (a new offer) refreshes the offers list instantly rather than waiting
  // for the 8s poll. Both paths reach here so a backgrounded win surfaces on tap, not only a
  // foregrounded one. Offer refresh is SILENT (the push already notified the driver).
  const onPush = useCallback(
    (data: PushData) => {
      // Diagnostic: confirms a push reached the JS layer (foreground-receive or tap) + its type,
      // so the next device test shows whether a foregrounded offer push fires at all (the latency
      // log had only 'resume' loads — i.e. the app was backgrounded). Cheap; remove once confirmed.
      console.log(`[push] received type=${data.type ?? 'none'}`);
      if (data.type === 'assigned' && typeof data.deliveryId === 'string') {
        void openAssignedJob(data.deliveryId);
      } else {
        void loadOffers(true, 4, 'push');
      }
    },
    [openAssignedJob, loadOffers],
  );

  useEffect(() => {
    if (!token) return;
    const received = onNotificationReceived(onPush);
    const tapped = onNotificationResponse(onPush);
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [token, onPush]);

  // The Shift screen stays MOUNTED (hidden) while the driver browses other tabs, so
  // an offer that lands meanwhile is only picked up by the next poll tick — switching
  // back can show a stale/empty list until then. Refresh the instant Shift is focused
  // (silent — any arriving offer was already notified) so it's current on arrival.
  useEffect(() => {
    if (focused) void loadOffers(true, 2, 'focus');
  }, [focused, loadOffers]);

  // Battery-saver risk (ADR-001): true while the OS may freeze the app in the
  // background. Re-checked on resume so the banner clears the moment the driver
  // actually grants the exemption (a one-shot prompt can't know that).
  const [batteryRisk, setBatteryRisk] = useState(false);
  const refreshBatteryRisk = useCallback(() => {
    void isBatteryOptimizationOn().then(setBatteryRisk).catch(() => {});
  }, []);

  // Notification permission — if denied, NO alert path fires (remote push AND both
  // local fallbacks gate on the grant), so the driver would only ever see offers by
  // staring at the list. Surface a banner; re-checked on resume so it clears once
  // they grant it in settings.
  const [notifBlocked, setNotifBlocked] = useState(false);
  const refreshNotifPermission = useCallback(() => {
    void notificationsEnabled()
      .then((ok) => setNotifBlocked(!ok))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!token) return;
    void reconcileShift().catch(() => {
      // non-critical — the driver can always toggle manually
    });
    void loadOffers(false, 4, 'mount'); // race the offers fetch against reconcile — don't wait for it
    refreshBatteryRisk();
    refreshNotifPermission();
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      // Samsung emits a flurry of 'active' transitions (AOD / lock-screen / shade), which fired the
      // resume reconcile+refetch ~40× in 5s — a 2G network storm that ALSO delayed `online` flipping
      // (40 competing getProfile calls), and the offers list is gated behind `online`, so it delayed
      // the very card the driver was waiting for. Debounce to one resume per 2s.
      const now = Date.now();
      if (now - lastResumeRef.current < 2000) return;
      lastResumeRef.current = now;
      void reconcileShift().catch(() => {});
      void loadOffers(false, 4, 'resume');
      refreshBatteryRisk();
      refreshNotifPermission();
    });
    return () => sub.remove();
  }, [token, reconcileShift, loadOffers, refreshBatteryRisk, refreshNotifPermission]);

  // Persist the active delivery SNAPSHOT whenever it changes, so a relaunch renders
  // it instantly even in a dead zone. Skip the first run (job is null on mount) —
  // otherwise it would wipe the snapshot before the resume effect has read it.
  const didJobMount = useRef(false);
  useEffect(() => {
    if (!didJobMount.current) {
      didJobMount.current = true;
      return;
    }
    if (job?.id) {
      void saveActiveJob(JSON.stringify(job));
      // Mirror to the cross-tab beacon so Jobs/Profile can show the return chip.
      setActive({ id: job.id, label: placeLabel(job.dropoff) });
    } else {
      void clearActiveJob();
      setActive(null);
    }
  }, [job, setActive]);

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
    let ticks = 0;
    // ALWAYS ping location from the foreground poll — the background stream does NOT
    // tick while stationary (Samsung suppresses same-position fixes at the system
    // level), so without this a driver staring at the open app could go heartbeat-
    // stale and be swept off shift. Cheap: last-known fix first.
    async function pingLocation() {
      try {
        const loc = await getCurrentLocation();
        if (loc && !cancelled) await updateLocation(token, loc.lat, loc.lng);
      } catch {
        // transient — the next tick retries
      }
    }
    // Offers and the liveness ping run CONCURRENTLY so neither blocks the other — a
    // slow 2G location lock no longer delays the offers fetch (the open-from-push lag
    // was offers running as the third serial round-trip, behind getProfile + this ping).
    async function tick() {
      ticks += 1;
      const ops: Promise<unknown>[] = [loadOffers(), pingLocation()];
      // Every ~40s, re-read shift status from the server. If repeated location pings
      // failed and the driver was swept offline (heartbeat stale), reconcileShift
      // flips `online` false so they see "off shift" + the Go-online button instead
      // of staring at a silently-dead empty list believing they're available.
      if (ticks % 5 === 0) ops.push(reconcileShift().catch(() => {}));
      await Promise.all(ops);
    }
    void tick();
    const interval = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [online, job, token, bgActive, loadOffers, reconcileShift]);

  const performAction = useCallback(
    async (a: QueuedAction): Promise<void> => {
      if (a.action === 'picked_up') await markPickedUp(token, a.deliveryId);
      else if (a.action === 'in_transit') await markInTransit(token, a.deliveryId);
      else if (a.action === 'delivered') {
        try {
          await markDelivered(token, a.deliveryId, {
            method: a.method ?? 'manual',
            note: a.note,
            cod_collected_minor: a.codCollectedMinor,
            ...(a.podPin ? { pod_pin: a.podPin } : {}),
          });
        } catch (e) {
          // A queued at-door code can be rejected on replay (mistyped offline, or
          // the attempt window burned). The driver is long gone — complete it
          // manually rather than dropping the action and leaving the job open.
          if (a.podPin && e instanceof ApiError && e.status === 400) {
            await markDelivered(token, a.deliveryId, {
              method: 'manual',
              note: a.note,
              cod_collected_minor: a.codCollectedMinor,
            });
          } else throw e;
        }
      } else await markFailed(token, a.deliveryId, a.reason as FailureReason | undefined);
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
    setOffers(null); // show "Checking for offers…" until the first poll lands
    // Open the offers UI IMMEDIATELY (optimistic) — otherwise a push that lands during
    // the (possibly multi-second) go-online round-trip is fetched by the notification
    // listener but stays HIDDEN behind the `online` render gate until getCurrentLocation
    // + goOnline resolve. That's the "first offer lags, later ones are instant" bug:
    // the very first offer (driver already available server-side) arrives mid-transition
    // and only appears once online flips. Reverted below if going online fails.
    setOnline(true);
    let confirmedOnline = false;
    try {
      // Permission is the only hard requirement to go online — a fix is not. A slow/
      // cold GPS lock (getCurrentLocation → null) must NOT block going on shift; the
      // background stream supplies position shortly after.
      if (!(await ensureForegroundPermission())) {
        setOnline(false);
        setError('Location permission is needed to receive offers.');
        return;
      }
      const loc = await getCurrentLocation();
      const state = await goOnline(token, loc ?? undefined);
      confirmedOnline = state.status !== 'offline';
      setOnline(confirmedOnline);
      // One-time explainer BEFORE the background prompt: Android 11+ can't grant
      // "Allow all the time" in-app, so without context drivers silently lose
      // background GPS.
      await maybeExplainBackgroundPermission();
      // Best-effort background streaming; falls back to the foreground poll if the
      // "allow all the time" permission is denied.
      setBgActive(await startBackgroundLocation());
      // The battery-saver banner (below) takes over from here: it shows while the
      // OS can still freeze the app, and clears itself once the exemption is real.
      refreshBatteryRisk();
    } catch {
      // Only drop the optimistic online if go-online itself didn't land — a failure in
      // the best-effort background-location setup AFTER goOnline succeeded must not flip
      // a genuinely-online driver back to offline (reconcileShift would re-correct, but
      // the flash is wrong). reconcileShift on next resume is the backstop either way.
      if (!confirmedOnline) setOnline(false);
      setError('Could not go online — try again.');
    } finally {
      setBusy(false);
      setLocating(false);
    }
  }, [token, refreshBatteryRisk]);

  const goOfflineNow = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await goOffline(token);
      await stopBackgroundLocation();
      setOnline(false);
      setBgActive(false);
      setOffers(null);
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
        setOffers(null);
      } catch (e) {
        // Friendly copy by failure class. Keep the technical detail in the log so a
        // future on-device issue stays visible via `adb logcat` (a diagnostic build is
        // exactly how we caught the bodyless-POST 400).
        console.warn('claim failed:', e instanceof ApiError ? `${e.status} ${e.message}` : e);
        if (e instanceof ApiError && e.status === 409) {
          // The server distinguishes three 409s — so should the driver. The
          // "not available" case means the sweep took them off shift while the
          // app was backgrounded: say so, and resync the toggle to the truth.
          if (e.message.includes('not available')) {
            setError("You're off shift — go online again to receive and claim jobs.");
            void reconcileShift().catch(() => {});
          } else if (e.message.includes('no active offer')) {
            setError('That offer expired — the next one will pop up here.');
          } else {
            setError('That job was just taken — try another.');
          }
        } else if (e instanceof ApiError) {
          setError('Could not claim that job — please try again.');
        } else {
          setError('No connection — check your signal and try again.');
        }
      } finally {
        setClaimingId(null);
      }
    },
    [token, reconcileShift],
  );

  // Bid on a customer-named auction (ADR-036): ACCEPT the customer's price or COUNTER your own.
  // Unlike claim, a bid does NOT assign the job — it's sealed; the customer / auto-clear accepts a
  // bid later, at which point the active-job reconcile surfaces the job. So on success we mark the
  // offer "sent" (no navigation) and refresh; the offer keeps listing until it clears or expires.
  const bid = useCallback(
    async (id: string, type: 'accept' | 'counter', priceMinor?: number) => {
      setClaimingId(id);
      setError(null);
      try {
        await submitBid(token, id, { type, price_minor: priceMinor });
        setBidSentIds((prev) => new Set(prev).add(id));
        void loadOffers(true, 0, 'post-bid'); // sync the list (the offer stays until it clears)
      } catch (e) {
        console.warn('bid failed:', e instanceof ApiError ? `${e.status} ${e.message}` : e);
        if (e instanceof ApiError && e.status === 409) {
          if (e.message.includes('ceiling')) {
            setError('That price is too high — offer less and try again.');
          } else if (e.message.includes('not available') || e.message.includes('no active offer') || e.message.includes('offer')) {
            setError('That offer is no longer available — the next one will pop up here.');
          } else {
            setError('That job is no longer open — try another.');
          }
        } else if (e instanceof ApiError) {
          setError('Could not send your offer — please try again.');
        } else {
          setError('No connection — check your signal and try again.');
        }
      } finally {
        setClaimingId(null);
      }
    },
    [token, loadOffers],
  );

  // Decline (ADR-002 B): optimistic removal — the server marks it `declined` and
  // never re-offers it to this driver. Best-effort: on a network failure the poll
  // re-lists it (already in the seen-set, so no duplicate notification).
  const decline = useCallback(
    async (id: string) => {
      setOffers((prev) => (prev ?? []).filter((o) => o.id !== id));
      try {
        await declineOffer(token, id);
      } catch {
        // The optimistic removal didn't land — restore the list now (silently) rather
        // than leaving a wanted offer hidden until the next 8s poll.
        void loadOffers(true);
      }
    },
    [token, loadOffers],
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
        podPin: extra?.podPin,
        method: extra?.method,
      };
      setBusy(true);
      setError(null);
      try {
        let updated: DriverDelivery;
        if (to === 'picked_up') updated = await markPickedUp(token, id);
        else if (to === 'in_transit') updated = await markInTransit(token, id);
        else if (to === 'delivered')
          updated = await markDelivered(token, id, {
            method: extra?.method ?? 'manual',
            note: extra?.note,
            cod_collected_minor: extra?.codCollectedMinor,
            ...(extra?.podPin ? { pod_pin: extra.podPin } : {}),
          });
        else updated = await markFailed(token, id, extra?.reason);
        // A confirmed delivery earns the payday screen (the earnings effect below
        // refetches today's running total as soon as the job clears).
        if (to === 'delivered') {
          setCompleted({
            earnedMinor: job?.driver_fee_minor ?? null,
            codMinor: extra?.codCollectedMinor ?? 0,
          });
        }
        setJob(to === 'delivered' || to === 'failed' ? null : updated);
      } catch (e) {
        if (shouldRetry(e)) {
          const q = await enqueueAction(queued);
          setPending(q.length);
          setError('No signal — saved. It’ll sync automatically when you’re back online.');
        } else if (extra?.podPin && e instanceof ApiError && e.status === 400) {
          // Wrong at-door code vs the burned attempt cap are different situations
          // with different ways forward — match the server's two distinct 400s.
          // The deliver panel stays open with the typed code either way.
          setError(
            e.message.includes('too many PIN attempts')
              ? 'Too many code tries — tap “No code? Complete without it” to finish this delivery.'
              : 'That code didn’t match — ask the customer to re-check their receipt.',
          );
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
      {/* Battery-saver warning (ADR-001): visible whenever the shift is live and
          the OS can still freeze the app in the background — including mid-job,
          where a frozen app means dead GPS + missed cancellations. Clears itself
          on resume once the exemption is actually granted. */}
      {!completed && online && batteryRisk ? (
        <Pressable style={styles.batteryBanner} onPress={() => void requestBatteryExemption()}>
          <View style={styles.iconRow}>
            <Feather name="alert-triangle" size={16} color={colors.batteryTitle} />
            <Text style={styles.batteryTitle}>Battery saver can interrupt your shift</Text>
          </View>
          <Text style={styles.batteryBody}>
            Your phone may pause this app in your pocket — stopping offers and delivery tracking.
            Tap to allow unrestricted battery use.
          </Text>
        </Pressable>
      ) : null}
      {/* Notifications off → no alert path fires (push + both local fallbacks gate on
          the grant); the driver would only see offers by watching the list. */}
      {!completed && online && notifBlocked ? (
        <Pressable style={styles.batteryBanner} onPress={() => void Linking.openSettings()}>
          <View style={styles.iconRow}>
            <Feather name="bell-off" size={16} color={colors.batteryTitle} />
            <Text style={styles.batteryTitle}>Turn on notifications to get offers</Text>
          </View>
          <Text style={styles.batteryBody}>
            Notifications are off, so you won&apos;t be alerted to new deliveries. Tap to open
            settings and allow them.
          </Text>
        </Pressable>
      ) : null}
      {completed ? (
        <View style={styles.completeCard}>
          <View style={styles.completeCheck}>
            <Feather name="check" size={40} color={colors.btnPrimaryText} />
          </View>
          <Text style={styles.completeTitle}>Delivered!</Text>
          <Text style={styles.completeEarnLabel}>You earned</Text>
          <Text style={styles.completeEarn}>{money(completed.earnedMinor)}</Text>
          {earnings ? (
            <Text style={styles.completeToday}>
              Today: {money(earnings.today_minor)} · {earnings.today_deliveries} deliver
              {earnings.today_deliveries === 1 ? 'y' : 'ies'}
            </Text>
          ) : null}
          {completed.codMinor > 0 ? (
            <Text style={styles.completeCod}>
              You’re holding {money(completed.codMinor)} cash — hand it to ops at the end of your
              shift. It’s separate from your earnings.
            </Text>
          ) : null}
          <Pressable
            style={styles.completeBtn}
            onPress={() => {
              setCompleted(null);
              void loadOffers(true); // an offer may have landed while the payday card was up
            }}
          >
            <Text style={styles.completeBtnText}>Back to offers</Text>
          </Pressable>
        </View>
      ) : job ? (
        <>
          <Text style={styles.title}>Active delivery</Text>
          {/* With a job on screen every error comes from the driver's own lifecycle
              tap, so it renders INSIDE the card next to what they touched (layer-1
              action feedback) — not at the bottom of the scroll where the keyboard
              hides it. */}
          <ActiveJob job={job} token={token} onAction={act} busy={busy} actionError={error} />
          {/* Availability stays visible but locked mid-delivery — going offline on a
              job isn't allowed, and hiding the control read as "where did it go?". */}
          <View style={[styles.toggle, styles.offBtn, styles.busy, styles.toggleRow]}>
            <Feather name="lock" size={18} color={colors.btnPrimaryText} />
            <Text style={styles.toggleText}>Go offline — after this delivery</Text>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.title}>Your shift</Text>
          <ShiftStatus online={online} />
          {earnings ? (
            <View style={styles.earnCard}>
              <Text style={styles.earnHeroLabel}>Today&apos;s earnings</Text>
              <Text style={styles.earnHero}>{money(earnings.today_minor)}</Text>
              <Text style={styles.earnHeroSub}>
                {earnings.today_deliveries} deliver{earnings.today_deliveries === 1 ? 'y' : 'ies'}
              </Text>
              <View style={styles.earnRow}>
                <Feather name="credit-card" size={18} color={colors.textFaint} />
                <Text style={styles.earnRowLabel}>Owed to you</Text>
                <Text style={styles.earnRowValue}>{money(earnings.payable_minor)}</Text>
              </View>
              {earnings.cod_owed_minor > 0 ? (
                <View style={styles.codCallout}>
                  <Feather name="dollar-sign" size={20} color={colors.codText} />
                  <View style={styles.codBody}>
                    <Text style={styles.codTitle}>Cash to hand in</Text>
                    <Text style={styles.codSub}>Hand to ops at end of shift</Text>
                  </View>
                  <Text style={styles.codValue}>{money(earnings.cod_owed_minor)}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {confirmingOffline ? (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>End your shift?</Text>
              <Text style={styles.summaryBig}>{money(earnings?.today_minor ?? 0)}</Text>
              <Text style={styles.summarySub}>
                {earnings?.today_deliveries ?? 0} deliver
                {(earnings?.today_deliveries ?? 0) === 1 ? 'y' : 'ies'} today
              </Text>
              {earnings && earnings.cod_owed_minor > 0 ? (
                <Text style={styles.summaryCod}>
                  Remember to hand in {money(earnings.cod_owed_minor)} cash to ops.
                </Text>
              ) : null}
              <Pressable
                style={[styles.toggle, styles.offBtn, busy && styles.busy]}
                disabled={busy}
                onPress={() => {
                  void goOfflineNow().finally(() => setConfirmingOffline(false));
                }}
              >
                {busy ? (
                  <ActivityIndicator color={colors.btnPrimaryText} />
                ) : (
                  <Text style={styles.toggleText}>End shift</Text>
                )}
              </Pressable>
              <Pressable
                style={styles.stayBtn}
                disabled={busy}
                onPress={() => setConfirmingOffline(false)}
              >
                <Text style={styles.stayText}>Stay online</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable
                style={[styles.toggle, online ? styles.offBtn : styles.onBtn, busy && styles.busy]}
                onPress={online ? () => setConfirmingOffline(true) : goOnlineNow}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color={colors.btnPrimaryText} />
                ) : (
                  <Text style={styles.toggleText}>
                    {locating ? 'Getting location…' : online ? 'Go offline' : 'Go online'}
                  </Text>
                )}
              </Pressable>
              {online ? (
                offers === null ? (
                  <View style={styles.checkingCard}>
                    <ActivityIndicator color={colors.textFaint} />
                    <Text style={styles.checkingText}>Checking for offers…</Text>
                  </View>
                ) : (
                  <OffersList
                    offers={offers}
                    onClaim={claim}
                    onBid={bid}
                    onDecline={decline}
                    actingId={claimingId}
                    bidSentIds={bidSentIds}
                  />
                )
              ) : null}
            </>
          )}
        </>
      )}

      {!completed && online && bgActive ? (
        <View style={styles.bgRow}>
          <Feather name="map-pin" size={14} color={colors.textFaint} />
          <Text style={styles.bg}>Sharing your location while on shift</Text>
        </View>
      ) : null}
      {!completed && pending > 0 ? (
        <View style={styles.syncingRow}>
          <Feather name="clock" size={16} color={colors.warning} />
          <Text style={styles.syncing}>
            {pending} action{pending > 1 ? 's' : ''} waiting to sync…
          </Text>
        </View>
      ) : null}
      {/* Shift-level errors only (go online/offline, claim) — action errors during
          a job render inside the ActiveJob card instead. */}
      {!completed && !job && error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, paddingTop: 72, flexGrow: 1 },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: '700' },
  earnCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    ...shadow.card,
  },
  earnHeroLabel: { color: colors.textFaint, fontSize: 12 },
  earnHero: { color: colors.money, fontSize: 30, fontWeight: '700', marginTop: 2, letterSpacing: -0.5 },
  earnHeroSub: { color: colors.textFaint, fontSize: 13, marginTop: 1 },
  earnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  earnRowLabel: { color: colors.textSecondary, fontSize: 14 },
  earnRowValue: { color: colors.money, fontSize: 16, fontWeight: '700', marginLeft: 'auto' },
  codCallout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.codBg,
    borderRadius: 8,
    padding: 12,
    marginTop: 14,
  },
  codBody: { flex: 1 },
  codTitle: { color: colors.codText, fontSize: 14, fontWeight: '700' },
  codSub: { color: colors.codText, fontSize: 12, marginTop: 1 },
  codValue: { color: colors.codText, fontSize: 16, fontWeight: '700' },
  toggle: { borderRadius: PILL, paddingVertical: 18, alignItems: 'center', marginTop: 20 },
  onBtn: { backgroundColor: colors.btnPrimaryBg },
  offBtn: { backgroundColor: colors.btnSecondaryBg },
  busy: { opacity: 0.6 },
  toggleText: { color: colors.btnPrimaryText, fontSize: 18, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', gap: 8 },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bgRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  bg: { color: colors.textFaint, fontSize: 13 },
  syncingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  syncing: { color: colors.warning, fontSize: 13 },
  error: { color: colors.danger, fontSize: 14, marginTop: 16 },
  checkingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 24,
    marginTop: 28,
    ...shadow.card,
  },
  checkingText: { color: colors.textFaint, fontSize: 15 },
  batteryBanner: {
    backgroundColor: colors.batteryBg,
    borderColor: colors.batteryBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  batteryTitle: { color: colors.batteryTitle, fontSize: 15, fontWeight: '700' },
  batteryBody: { color: colors.batteryBody, fontSize: 13, marginTop: 4, lineHeight: 18 },
  // Payday moment (the loop's most motivating screen — previously silent).
  completeCard: { alignItems: 'center', paddingTop: 24, gap: 8 },
  completeCheck: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.btnPrimaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  completeTitle: { color: colors.textPrimary, fontSize: 24, fontWeight: '700' },
  completeEarnLabel: { color: colors.textFaint, fontSize: 14, marginTop: 8 },
  completeEarn: { color: colors.money, fontSize: 32, fontWeight: '700' },
  completeToday: { color: colors.textSecondary, fontSize: 15, marginTop: 4 },
  completeCod: {
    color: colors.cod,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 8,
  },
  completeBtn: {
    backgroundColor: colors.btnPrimaryBg,
    borderRadius: PILL,
    paddingVertical: 16,
    paddingHorizontal: 40,
    alignItems: 'center',
    marginTop: 28,
    alignSelf: 'stretch',
  },
  completeBtnText: { color: colors.btnPrimaryText, fontSize: 16, fontWeight: '700' },
  // End-of-shift summary confirm.
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    marginTop: 20,
    alignItems: 'stretch',
    ...shadow.card,
  },
  summaryTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  summaryBig: { color: colors.money, fontSize: 32, fontWeight: '700', marginTop: 10, textAlign: 'center' },
  summarySub: { color: colors.textFaint, fontSize: 14, marginTop: 2, textAlign: 'center' },
  summaryCod: { color: colors.cod, fontSize: 14, textAlign: 'center', marginTop: 12, lineHeight: 20 },
  stayBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  stayText: { color: colors.textFaint, fontSize: 14 },
});
