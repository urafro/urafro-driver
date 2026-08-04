import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  ApiError,
  claimDelivery,
  appendDelivery,
  grabDelivery,
  declineOffer,
  resetOffer,
  getBoard,
  type BoardJob,
  getDelivery,
  getActiveLegs,
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
import { currentStopLeg } from '../lib/run';
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
import { money, placeLabel, secondsUntil } from '../lib/format';
import {
  enqueueAction,
  flushActions,
  archiveExpired,
  loadQueue,
  saveQueue,
  shouldRetry,
  type QueuedAction,
} from '../lib/queue';
import { useSession } from '../state/session';
import { useActiveJob } from '../state/activeJob';
import { REALTIME_ENABLED, connectDriverStream } from '../lib/realtime';
import { colors, shadow, typography, space, radius } from '../theme';
import { animateNext } from '../lib/motion';
import { haptics } from '../lib/haptics';
import OffersList from '../components/OffersList';
import BoardList from '../components/BoardList';
import ActiveJob, { type LifecycleAction, type ActionExtra } from '../components/ActiveJob';
import ShiftStatus from '../components/ShiftStatus';
import { OfferAlert, Text, type OfferAlertData } from '../components/ui';
import { assignmentErrorCopy } from '../lib/assignment-errors';
import { isBlockedFromJobs, verificationBannerCopy } from '../lib/verification';
import { useIsStopped } from '../hooks/useIsStopped';
import { useConnectivity } from '../hooks/useConnectivity';

// Foreground offers+location poll (runs only while online and not on a job). 5s on the
// 3G-primary baseline (tightened from 8s) so offers surface faster; remote push is the
// primary accelerant, so this is the backstop. Floored above sub-second for battery/EDGE.
const POLL_MS = 5000;
// C5: when the live socket is healthy (C4), the poll drops to a slow backstop —
// the socket delivers offers in ~real time, so 5s polling is wasted battery/data.
// Safe by construction: any socket drop/staleness flips socketHealthy false and the
// poll snaps back to POLL_MS, so a dead socket never leaves the driver on the slow
// cadence. Battery budget for this is what C5 measures on-device.
const SLOW_POLL_MS = 20000;
const FLUSH_MS = 12000;

// The shift controller: offline → go online (needs location) → online (poll offers)
// → claim → on a job. Lifecycle actions are 2G-resilient: a transient failure
// queues the action and a background flush retries it until it lands (and then
// reconciles the on-screen job). Location pings + offer polls degrade softly.
export default function HomeScreen({
  focused,
  onProfileStale,
}: {
  focused: boolean;
  // Ask App's Root to re-decide routing (it re-fetches the profile). Called when this
  // screen learns the driver is no longer `verified` AND holds no in-flight job — Root
  // then renders Onboarding, which owns the per-state explanation. Optional so the
  // screen still stands alone in tests.
  onProfileStale?: () => void | Promise<void>;
}) {
  const { session } = useSession();
  const token = session?.token ?? '';
  const { setActive } = useActiveJob();

  const [online, setOnline] = useState(false);
  // null = not fetched yet (show "Checking for offers…"); [] = fetched, none nearby.
  const [offers, setOffers] = useState<Offer[] | null>(null);
  // Did the last offers fetch fail? Distinguishes a genuine "loading" (offers null,
  // no error) from a "can't reach the server, still retrying" — so the poll failing on
  // flaky data never leaves an eternal "Checking for offers…" spinner with no explanation.
  const [offersError, setOffersError] = useState(false);
  const [job, setJob] = useState<DriverDelivery | null>(null);
  // #66 (batching): does the platform allow concurrent runs (profile.max_concurrent_jobs>1)?
  // Default false ⇒ every batch path below is dormant and the app behaves byte-for-byte as a
  // single-job app (never polls offers while busy, never routes to /append, no run strip).
  const [canBatch, setCanBatch] = useState(false);
  // COD eligibility (C8): the driver's collateral-backed cash cap. 0 = can't carry cash
  // (unvalued vehicle → no collateral), so cash-collecting offers are filtered out server-side
  // while PREPAID offers still flow. null = not yet known (never flash the banner pre-load).
  const [codCap, setCodCap] = useState<number | null>(null);
  // Verification that lapsed WHILE in the tabbed app. Non-null ⇒ the platform will refuse
  // this driver new jobs. Mid-run it renders the banner; once they're clear the effect
  // below hands routing back to Root, which sends them to Onboarding.
  const [lapsedStatus, setLapsedStatus] = useState<string | null>(null);
  // Bumped by every reconcile that SEES a lapse. Without it the hand-back fires exactly
  // once: `lapsedStatus` re-sets to an identical string (React bails), `job` stays null
  // because the server refuses every claim, and `onProfileStale` is stable — so one
  // failed re-fetch on a 2G dropout froze all three deps and silently restored the old
  // "stuck in the tabbed app until restart" bug. This re-arms it each tick.
  const [staleSeq, setStaleSeq] = useState(0);
  // Located liveness: have we successfully sent a location ping THIS shift? The platform
  // only offers deliveries to drivers with a non-null last_lat, and going online does NOT
  // block on a GPS fix — so an online driver whose phone hasn't produced a fix (indoors /
  // location off / cold GPS) is silently un-dispatchable. false while online ⇒ show the
  // "waiting for your location" banner. Set true on any successful foreground ping.
  const [located, setLocated] = useState(false);
  // #66: the driver's whole in-flight RUN (all legs, primary-first) when batching is on.
  // `job` stays the leg being worked (runLegs[0]); this drives the multi-stop run strip.
  const [runLegs, setRunLegs] = useState<DriverDelivery[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [bgActive, setBgActive] = useState(false);
  // C5: is the C4 live socket currently healthy? Drives the poll cadence below.
  const [socketHealthy, setSocketHealthy] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  // #66 (batching) B1: mid-run appendable offers the driver dismissed from the OfferAlert
  // banner, so it advances to the next on-route offer instead of re-buzzing the same one.
  const [dismissedAppendIds, setDismissedAppendIds] = useState<Set<string>>(() => new Set());
  // Auction offers this driver has bid on (ADR-036) — the card shows "offer sent" instead of the
  // accept/counter buttons. Local-only: a bid doesn't assign the job (the customer/auto-clear does
  // later), so until then the offer still lists; this stops a re-bid and clarifies the state.
  const [bidSentIds, setBidSentIds] = useState<ReadonlySet<string>>(new Set());
  // H4: offers whose one-time countdown reset has been spent (locally). Hides the
  // "Need more time?" button after use so a driver can't tap it twice (the server
  // enforces once-only too, but this keeps the UI honest between polls).
  const [resetOfferIds, setResetOfferIds] = useState<ReadonlySet<string>>(new Set());
  // H2: the "Offers | Available" segmented view. 'offers' = the pushed offers list;
  // 'available' = the pulled open-board (a manual browse, not a poll). null board = not
  // yet loaded for this session.
  const [boardTab, setBoardTab] = useState<'offers' | 'available'>('offers');
  const [board, setBoard] = useState<BoardJob[] | null>(null);
  // Debounce the resume handler against Samsung's flurry of AppState 'active' transitions.
  const lastResumeRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  // The payday moment: set on a confirmed delivery so the loop ends on the
  // number, not a silent return to the offers list.
  const [completed, setCompleted] = useState<{ earnedMinor: number | null; codMinor: number } | null>(
    null,
  );
  // #66 (batching): a pooled run pays out per leg, but the driver should see ONE payday at
  // the end of the whole run, not after every drop. Accumulate the run's takings here and
  // show the total when the last leg lands. Reset when a fresh run starts / completes.
  const runEarnedRef = useRef(0);
  const runCodRef = useRef(0);
  // Go-offline asks first, showing the shift's tally — the motivating end-of-day
  // total + a COD hand-in reminder before the driver clocks out.
  const [confirmingOffline, setConfirmingOffline] = useState(false);

  // Latest job, readable from inside the (token-scoped) flush interval.
  const jobRef = useRef<DriverDelivery | null>(null);
  jobRef.current = job;
  // Same trick, for the flush closure: its effect deps are [token, performAction], so a
  // bare `canBatch` captured there would be the mount-time value for the life of the
  // screen — and canBatch flips from a SERVER field (max_concurrent_jobs), not a release.
  const canBatchRef = useRef(false);
  canBatchRef.current = canBatch;

  // Connectivity signal (Phase 2.4): when the link returns, drain the offline queue
  // IMMEDIATELY rather than waiting out the 12s flush interval — the whole reason the
  // netinfo hook exists. The app-chrome OfflineBanner (App.tsx) shows the status.
  const { online: netOnline } = useConnectivity();
  // Points at the latest flush closure so the reconnect effect can trigger it without
  // taking on the token/performAction deps that scope the flush interval below.
  const flushRef = useRef<() => void>(() => {});
  // Re-entrancy guard: interval + reconnect + mount can all call flush(); two drains
  // racing the same queue would re-perform a lifecycle action (the server 409s the
  // duplicate, but don't send it). One drain at a time. Shared across effect instances
  // on purpose — preventing cross-instance concurrency matters more than the one case
  // it costs: a re-login WHILE a drain is in flight skips the new instance's immediate
  // mount drain, which the next 12s interval tick then performs (bounded, self-healing).
  const flushingRef = useRef(false);

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
    // #66 (batching): the platform capability gate. >1 unlocks the batch paths; at the
    // default 1 (or an old server that omits it) canBatch stays false — fully inert.
    setCanBatch((p.max_concurrent_jobs ?? 1) > 1);
    // Track COD eligibility for the "cash jobs locked" banner below (reconcileShift is the
    // profile choke point — runs on mount, focus/resume, and every 5th shift tick).
    setCodCap(p.cod_cap_minor ?? null);

    // Verification that lapsed mid-session. This profile fetch already carried the answer
    // and used to discard it, so a driver suspended (or bounced to in_review by their own
    // document re-upload) stayed in the tabbed app being refused on every claim until the
    // app was restarted — App.tsx only decides routing on mount.
    //
    // RECORD ONLY. The route-or-warn decision belongs to the effect below, which reads
    // settled state; deciding it inline here would race the active-job restore (an async
    // storage read on mount). If this fetch won that race, a driver who IS mid-run would
    // look job-less and get bounced out of a live delivery.
    if (isBlockedFromJobs(p.verification_status)) {
      setLapsedStatus(p.verification_status ?? 'unverified');
      setStaleSeq((n) => n + 1); // re-arm the hand-back even if the status string is unchanged
    } else {
      setLapsedStatus(null);
    }
    if (onShift) {
      const alreadyStreaming = await isBackgroundActive();
      setBgActive(alreadyStreaming || (await startBackgroundLocation()));
      // An immediate liveness ping: resuming IS proof of life — refresh
      // lastSeenAt instantly so a near-stale shift survives the reopen.
      const loc = await getCurrentLocation();
      if (loc) {
        await updateLocation(token, loc.lat, loc.lng);
        setLocated(true); // the platform now has a position for us → dispatchable
      }
    } else {
      setBgActive(false);
      setLocated(false);
    }
  }, [token]);

  // Hand routing back to App's Root once a lapsed driver is genuinely clear of their run.
  // Keyed on `job` (settled React state), so it fires whenever the run ends — including
  // when the storage restore lands after the profile fetch, and when they finish the
  // delivery they were mid-way through. While `job` is non-null they keep working and see
  // the banner instead: urafro-next does not re-check verification on the lifecycle
  // transitions, so the server expects them to finish, and Onboarding has no job UI.
  useEffect(() => {
    // `job` null means "the delivery just ended", not "the driver is clear" — `completed`
    // is set in the SAME commit as setJob(null) and holds the payday + COD-to-hand-in
    // figures. In a batch that total is the only time the whole run's cash is shown.
    // Unmounting over it would take it with us; "Back to offers" clears `completed` and
    // re-fires this at a moment the driver has acknowledged.
    if (!lapsedStatus || job || completed) return;
    void (async () => {
      // Wind the shift DOWN before handing routing back. Onboarding has no shift UI, and
      // goOfflineNow (the End-shift button on this screen) is the app's ONLY caller of
      // stopBackgroundLocation — unmount without this and the phone keeps streaming 15s
      // GPS fixes behind a false "on shift" notification, unstoppable short of a
      // reinstall. Not hypothetical: ops suspend/ban forces status='offline' server-side,
      // but the DOCUMENT-driven recompute does not, so a driver whose licence lapses is
      // still `available` and still streaming at the moment we route them out.
      await goOffline(token).catch(() => {}); // best-effort: a dead network must not block teardown
      // RE-VALIDATE after the await. On a cold start the active-job restore is an async
      // storage read racing this effect: reconcileShift can set lapsedStatus before the
      // snapshot lands, so we may have entered the teardown believing the driver was
      // clear and had a live delivery appear underneath us during a multi-second
      // goOffline on 2G. Bail rather than kill the GPS on a run in progress.
      if (jobRef.current) return;
      await stopBackgroundLocation().catch(() => {});
      setOnline(false);
      setBgActive(false);
      // NB: the snapshot is NOT cleared here. The persist effect owns that key and has
      // already cleared it — `job` went null in an earlier commit, and this effect only
      // runs once `completed` is dismissed, later still. Clearing here would be a no-op
      // in the normal flow and, in the mount window above, would delete a LIVE job's
      // crash-recovery snapshot. One writer.
      await onProfileStale?.();
    })();
  }, [lapsedStatus, job, completed, staleSeq, token, onProfileStale]);

  // Fetch offers NOW — called eagerly on open/resume (so a notification tap paints
  // the offer fast instead of waiting for the poll, which is itself gated behind
  // reconcileShift flipping `online`) AND from the poll tick. Normally skipped on a job
  // (the offers list is hidden then). #66 (batching): when batching is on, a busy driver
  // KEEPS fetching so the on-route batch offers surface in the "On your route" section —
  // but we still suppress offer NOTIFICATIONS mid-delivery (populate the list silently).
  const loadOffers = useCallback(
    async (silent = false, retries = 0, reason = 'poll'): Promise<void> => {
      if (!token || (jobRef.current && !canBatch)) return;
      try {
        const { data } = await listOffers(token);
        const fresh = data ?? [];
        setOffers(fresh);
        setOffersError(false); // a successful fetch clears any "can't reach the server" state
        // `silent` = refreshed because a push already notified the driver — just sync
        // the seen-set so the next poll doesn't fire a DUPLICATE local notification.
        // On a job (batch mode) also stay silent — don't buzz mid-run.
        if (silent || jobRef.current) markOffersSeen(fresh);
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
        setOffersError(true); // gave up this round → the empty-state shows "retrying", not a stuck spinner
      }
    },
    [token, canBatch],
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
        // #66 (batching): refresh the whole run — a completed leg drops out, an appended
        // leg joins, and the worked leg (runLegs[0]) stays fresh. Empty ⇒ the run is done.
        // At cap=1 canBatch is false ⇒ the single-leg getDelivery path below, unchanged.
        if (canBatch) {
          const legs = await getActiveLegs(token);
          if (cancelled) return;
          const cur = currentStopLeg(legs); // the next stop (pickups first, then dropoffs)
          if (cur) {
            setRunLegs(legs);
            setJob(cur);
          } else {
            setRunLegs(null);
            setJob(null);
            await clearActiveJob();
          }
          return;
        }
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
  }, [token, job?.id, canBatch]);

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
    // #66 (batching): normally the poll stops once on a job. When batching is on, a busy
    // driver keeps polling so the on-route batch offers the server fans them (to ADD via
    // /append) actually surface. At cap=1 canBatch is false ⇒ byte-for-byte the old gate.
    if (!online || (job && !canBatch)) return;
    let cancelled = false;
    let ticks = 0;
    // ALWAYS ping location from the foreground poll — the background stream does NOT
    // tick while stationary (Samsung suppresses same-position fixes at the system
    // level), so without this a driver staring at the open app could go heartbeat-
    // stale and be swept off shift. Cheap: last-known fix first.
    async function pingLocation() {
      try {
        const loc = await getCurrentLocation();
        if (loc && !cancelled) {
          await updateLocation(token, loc.lat, loc.lng);
          if (!cancelled) setLocated(true); // clears the "waiting for your location" banner
        }
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
    // C5: slow the poll to a backstop while the live socket is healthy; snap back
    // to the fast cadence the moment it drops (socketHealthy flips false).
    const interval = setInterval(() => void tick(), socketHealthy ? SLOW_POLL_MS : POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [online, job, canBatch, token, bgActive, socketHealthy, loadOffers, reconcileShift]);

  // C4: live offer socket over the push+poll floor. Only while on shift + waiting
  // for work (online, no active job). On `offer.new` it re-fetches offers at once
  // (silent:false → maybeNotifyNewOffers, deduped by seenOfferIds so a socket +
  // poll + push can't triple-notify). The 5s poll above stays the floor — a dropped
  // or disabled socket never costs an offer. Flag-gated: off = no socket at all.
  useEffect(() => {
    if (!REALTIME_ENABLED || !token || !online || job) {
      setSocketHealthy(false);
      return;
    }
    const disconnect = connectDriverStream({
      token,
      onOffer: () => void loadOffers(false, 4, 'socket'),
      // C5: socket health drives the poll cadence (slow when up, fast when down).
      onHealth: setSocketHealthy,
    });
    return () => {
      setSocketHealthy(false);
      disconnect();
    };
  }, [token, online, job, loadOffers]);

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
      if (flushingRef.current) return; // a drain is already in flight
      flushingRef.current = true;
      try {
        const queue = await loadQueue();
        if (queue.length === 0) return; // count already 0 in the queue store
        // Read the job id and the queued payload BEFORE draining: flushActions can take
        // many seconds on 2G (each action can burn the 10s request timeout), and the
        // independent 15s active-job poll can null the job in that window — after which
        // we would skip the reconcile and the payday card entirely.
        const id = jobRef.current?.id;
        const deliveredQueued = id != null ? queue.find((a) => a.deliveryId === id && a.action === 'delivered') : undefined;
        const remaining = await flushActions(queue, performAction, (expired) => {
          // Audit R12: a bounded queue must never let a money-bearing action vanish
          // silently — 24h unsynced means something is genuinely wrong, and the
          // driver (not the retry loop) has to close it out with ops. The payload
          // (COD amount, PoD note) is archived for that conversation.
          void archiveExpired(expired);
          console.warn('queued action expired unsynced:', expired.id, expired.action);
          if (!cancelled) {
            setError(
              expired.action === 'delivered'
                ? "A saved delivery confirmation couldn't sync — message ops so your cash and pay are recorded."
                : "A saved update couldn't sync — message ops to close it out.",
            );
          }
        });
        await saveQueue(remaining); // publishes the new depth to the OfflineBanner
        if (cancelled) return;

        const synced =
          id != null && queue.some((a) => a.deliveryId === id) && !remaining.some((a) => a.deliveryId === id);
        if (synced && id) {
          try {
            const fresh = await getDelivery(token, id);
            if (!cancelled) {
              // A delivery completed OFFLINE reaches this point instead of act()'s
              // success path, which is where `completed` (the payday + cash-to-hand-in
              // card) is normally set. Without this the card never appeared for an
              // offline drop at all, and — since the verification hand-back waits on
              // `completed` — a lapsed driver would be moved to Onboarding the instant a
              // background flush landed, with the COD figure shown nowhere.
              // SINGLE-LEG ONLY. act()'s batch branch banks each leg into
              // runEarnedRef/runCodRef and pays out once the whole run ends; this path
              // knows about one delivery id. Showing it during a batch would quote one
              // leg's cash as the run's total (driver holding $80, card saying $50) and
              // render "Delivered!" mid-run. Inert at the pilot's cap=1, but that cap is
              // a server flag flip away — exactly the latent-bug-on-an-un-updatable-build
              // shape this app cannot afford. The run-aware version belongs with Epic F.
              if (fresh.status === 'delivered' && !canBatchRef.current) {
                setCompleted({
                  earnedMinor: fresh.driver_fee_minor ?? jobRef.current?.driver_fee_minor ?? null,
                  codMinor: deliveredQueued?.codCollectedMinor ?? 0,
                });
              }
              setJob(fresh.status === 'delivered' || fresh.status === 'failed' ? null : fresh);
            }
          } catch (e) {
            // Clear only when the server SAYS it's not ours — a network blip here
            // must not wipe a live job (+ its snapshot); the active-job poll retries.
            if (!cancelled && e instanceof ApiError && (e.status === 404 || e.status === 403)) {
              setJob(null);
            }
          }
        }
      } finally {
        flushingRef.current = false;
      }
    }
    flushRef.current = () => void flush();
    void flush();
    const interval = setInterval(() => void flush(), FLUSH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token, performAction]);

  // Reconnect → flush now. `netOnline` flips false→true the moment the link returns;
  // don't make a queued "Delivered" wait out the interval. No-op with no token (flushRef
  // stays the default) or an empty queue (flush early-returns).
  useEffect(() => {
    if (netOnline) flushRef.current();
  }, [netOnline]);

  const goOnlineNow = useCallback(async () => {
    setBusy(true);
    setLocating(true);
    setError(null);
    setOffers(null); // show "Checking for offers…" until the first poll lands
    setOffersError(false); // fresh shift → don't flash a stale "can't reach the server"
    setLocated(false); // re-prove location this shift (banner shows until the first ping lands)
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
      setLocating(false); // GPS phase done → the button flips from "Getting location…" to the POST spinner
      const state = await goOnline(token, loc ?? undefined);
      confirmedOnline = state.status !== 'offline';
      setOnline(confirmedOnline);
      // go-online already sent our position → seed `located` so the banner never flashes
      // when we had a fix; a cold-GPS null leaves it false and the banner shows until a ping lands.
      if (confirmedOnline && loc) setLocated(true);
    } catch {
      // go-online itself (permission → getCurrentLocation → the goOnline POST) failed —
      // drop the optimistic online and surface it. The advisory background-permission tail
      // moved OUT of this try (below), so a hung explainer/Settings dialog can no longer
      // reach this catch or set a misleading "could not go online".
      if (!confirmedOnline) setOnline(false);
      setError('Could not go online — try again.');
      return;
    } finally {
      // #84: `busy` ends with the go-online round-trip, NOT the (possibly dialog-blocked)
      // advisory tail. An unresolved background-permission Alert used to latch busy here
      // and lock every lifecycle button on a first-run device.
      setBusy(false);
      setLocating(false);
    }

    // Advisory tail — runs AFTER busy is released, best-effort. These awaited dialogs (the
    // one-time "Allow all the time" explainer — Android 11+ can't grant it in-app — plus
    // the background-permission Settings round-trip) can hang indefinitely on a first-run
    // device; out here a hang no longer bricks the controls. A driver who's online works
    // fine without background streaming (the foreground poll covers offers), and the
    // battery-saver banner clears itself once the exemption is real.
    try {
      await maybeExplainBackgroundPermission();
      setBgActive(await startBackgroundLocation());
      refreshBatteryRisk();
    } catch {
      // background streaming is best-effort — never surface or block on it
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
      setLocated(false);
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
        if (canBatch) {
          setRunLegs([delivery]); // #66: a fresh run of one; the poll keeps it current
          runEarnedRef.current = 0; // fresh run — reset the payday accumulator
          runCodRef.current = 0;
          setDismissedAppendIds(new Set()); // fresh run — dismissed append offers don't carry over
        }
        setOffers(null);
      } catch (e) {
        // Friendly copy by failure class. Keep the technical detail in the log so a
        // future on-device issue stays visible via `adb logcat` (a diagnostic build is
        // exactly how we caught the bodyless-POST 400).
        console.warn('claim failed:', e instanceof ApiError ? `${e.status} ${e.message}` : e);
        // Audit R12 — ambiguous-claim recovery: on 3G the claim often LANDS while the
        // response is lost, and every failure class here can be self-caused by that
        // ("just taken" = taken by US; "not available" = WE just went busy; network =
        // the lost response itself). Before telling the driver to move on — which used
        // to strand them staring at an empty offers list while the merchant's job sat
        // assigned — ask the server who owns the job. Best-effort: a failed check
        // falls through to the normal error copy.
        try {
          const legs = await getActiveLegs(token);
          const mine = currentStopLeg(legs);
          if (mine) {
            setJob(mine);
            if (canBatch) {
              setRunLegs(legs);
              runEarnedRef.current = 0;
              runCodRef.current = 0;
              setDismissedAppendIds(new Set());
            }
            setOffers(null);
            setError(null);
            return;
          }
        } catch {
          // recovery probe failed — fall through to the ordinary error handling
        }
        // One shared classifier across claim/append/grab (lib/assignment-errors). claim
        // used to branch on only two of the server's 409s, so verification, vehicle
        // capacity and the cash cap all landed on "just taken" — the driver kept tapping
        // other jobs, failing every time, never told why. `off_shift` also means the
        // sweep took them off shift while backgrounded, so resync the toggle to truth.
        const { reason, message } = assignmentErrorCopy(e, 'claim');
        setError(message);
        if (reason === 'off_shift' || reason === 'unverified') void reconcileShift().catch(() => {});
      } finally {
        setClaimingId(null);
      }
    },
    [token, canBatch, reconcileShift],
  );

  // #66 (batching): pull the driver's whole active RUN. Keeps runLegs fresh and points
  // `job` at the leg being worked (the first in-flight one). Empty ⇒ the run is done.
  const refreshRun = useCallback(async () => {
    const legs = await getActiveLegs(token);
    const cur = currentStopLeg(legs); // pickups first, then dropoffs — the stop to work now
    if (cur) {
      setRunLegs(legs);
      setJob(cur);
    } else {
      setJob(null);
      setRunLegs(null);
      await clearActiveJob();
    }
  }, [token]);

  // #66 (batching): ADD an on-route batch offer to the current run via /append (the
  // driver stays on their current leg; the run grows by one). Only ever reached for an
  // `appendable` offer, which the server marks only when batching is on. A 409 says why
  // it can't join (run full / won't fit the vehicle / over the combined cash limit).
  const append = useCallback(
    async (id: string) => {
      setClaimingId(id);
      setError(null);
      try {
        await appendDelivery(token, id);
        await refreshRun(); // the new leg joins; keep working the current one
        void loadOffers(true); // drop the accepted offer from the list
      } catch (e) {
        console.warn('append failed:', e instanceof ApiError ? `${e.status} ${e.message}` : e);
        const { reason, message } = assignmentErrorCopy(e, 'append');
        setError(message);
        if (reason === 'off_shift' || reason === 'unverified') void reconcileShift().catch(() => {});
      } finally {
        setClaimingId(null);
      }
    },
    [token, refreshRun, loadOffers, reconcileShift],
  );

  // board grab (issue 170): claim an un-offered job straight off the Available board. On success
  // the job takes over the screen (like claim); a 409 tells the driver why (board closed /
  // gone / over their cash-or-vehicle limit). Reuses claimingId for the acting state.
  const grab = useCallback(
    async (id: string) => {
      setClaimingId(id);
      setError(null);
      try {
        const delivery = await grabDelivery(token, id);
        setJob(delivery);
        if (canBatch) {
          setRunLegs([delivery]); // #66: a fresh run of one
          runEarnedRef.current = 0; // fresh run — reset the payday accumulator
          runCodRef.current = 0;
          setDismissedAppendIds(new Set()); // fresh run — dismissed append offers don't carry over
        }
        setOffers(null);
      } catch (e) {
        console.warn('grab failed:', e instanceof ApiError ? `${e.status} ${e.message}` : e);
        // grab used to fold "not verified" in with "off shift" and tell the driver to go
        // online — which cannot fix lapsed paperwork. The classifier keeps them apart.
        const { reason, message } = assignmentErrorCopy(e, 'grab');
        setError(message);
        if (reason === 'off_shift' || reason === 'unverified') void reconcileShift().catch(() => {});
      } finally {
        setClaimingId(null);
      }
    },
    [token, canBatch, reconcileShift],
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

  // H4: reset (extend) this offer's countdown once. Optimistically hide the button,
  // then on success jump the local countdown to the new expiry. A 409 means the reset
  // is genuinely spent (already used / lapsed / claimed) — keep it hidden. Any OTHER
  // failure (flaky 3G, 5xx) likely didn't apply, so restore the button to allow a
  // retry; the server enforces once-only, so a retry that actually landed just 409s.
  const resetTimer = useCallback(
    async (id: string) => {
      setResetOfferIds((prev) => new Set(prev).add(id));
      try {
        const { offer_expires_at } = await resetOffer(token, id);
        setOffers((prev) =>
          (prev ?? []).map((o) => (o.id === id ? { ...o, offer_expires_at } : o)),
        );
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) {
          setResetOfferIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
      }
    },
    [token],
  );

  // H2: pull the open board on demand (a manual browse — NOT a background poll, so it
  // adds no battery/data cost). Best-effort; on failure fall back to an empty board.
  const loadBoard = useCallback(async () => {
    try {
      const { data } = await getBoard(token);
      setBoard(data);
    } catch (e) {
      console.warn('board load failed:', e instanceof ApiError ? `${e.status}` : e);
      setBoard((prev) => prev ?? []);
    }
  }, [token]);

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
        // #66 (batching): in a POOLED run every lifecycle tap advances the run to its next
        // STOP, not just this leg — a picked-up parcel means "head to the next pickup", a
        // delivered one means "head to the next drop", and the run only ENDS (payday) once
        // nothing's left in flight. A run of one behaves exactly like a single job.
        if (canBatch) {
          if (to === 'delivered') {
            // bank this leg's takings toward the single end-of-run payday
            runEarnedRef.current += job?.driver_fee_minor ?? 0;
            runCodRef.current += extra?.codCollectedMinor ?? 0;
          }
          const legs = await getActiveLegs(token); // authoritative post-transition run
          const next = currentStopLeg(legs);
          if (next) {
            setRunLegs(legs);
            setJob(next); // advance — no payday until the run is done
          } else {
            setCompleted({ earnedMinor: runEarnedRef.current || null, codMinor: runCodRef.current });
            runEarnedRef.current = 0;
            runCodRef.current = 0;
            setRunLegs(null);
            setJob(null);
            await clearActiveJob();
          }
        } else {
          // Single-leg path — byte-for-byte the original: payday on delivery, clear on end.
          if (to === 'delivered') {
            setCompleted({
              earnedMinor: job?.driver_fee_minor ?? null,
              codMinor: extra?.codCollectedMinor ?? 0,
            });
          }
          setJob(to === 'delivered' || to === 'failed' ? null : updated);
        }
      } catch (e) {
        if (shouldRetry(e)) {
          await enqueueAction(queued); // publishes the new depth to the OfflineBanner
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
    [job, token, canBatch],
  );

  // #66 (batching) B1: a mid-run on-route offer the driver can ADD to the current run.
  // Surfaced as a non-blocking, haptic+chime OfferAlert banner (the OS notification is
  // suppressed while on a job) whose "Add to run" is gated behind the vehicle being
  // STOPPED — so it never competes with the road. Advances past dismissed ones.
  const appendOffer =
    job && canBatch && offers
      ? // fixed-price appends ONLY — an auction (opening_price_minor set) that's also
        // flagged appendable must fall through to the bid flow, never "Add to run" (mirrors
        // OffersList's `!isAuction && appendable` gate).
        (offers.find((o) => o.appendable && o.opening_price_minor == null && o.id && !dismissedAppendIds.has(o.id)) ??
        null)
      : null;
  // Watch GPS speed only while a mid-run offer is actually showing (else no extra watch).
  const appendMotion = useIsStopped(appendOffer != null);
  const appendAlert: OfferAlertData | null =
    appendOffer && appendOffer.id
      ? {
          id: appendOffer.id,
          title: 'Add on your route',
          fareMinor: appendOffer.driver_fee_minor ?? appendOffer.fee_minor ?? 0,
          codMinor: appendOffer.collect_minor ?? null,
          distanceKm: appendOffer.trip_km ?? null,
          expiresInSec: appendOffer.offer_expires_at ? secondsUntil(appendOffer.offer_expires_at, Date.now()) : null,
        }
      : null;

  // B2: the payday moment gets the shared success haptic the instant it appears —
  // the loop's most motivating screen was previously silent (no tactile confirmation).
  useEffect(() => {
    if (completed) haptics.success();
  }, [completed]);

  // B3: animate the top-level state swaps (offline↔online↔job↔payday) so a mode
  // change is never a silent pop. Driven from ONE render-phase choke point rather
  // than the ~15 setJob/setOnline call sites, so every path that flips the mode —
  // claim, grab, realtime reconcile, rehydrate, payday — gets the transition, and
  // (unlike <Transition>, which would freeze live offers/earnings under a mode) the
  // content keeps updating. animateNext only schedules the NEXT native layout commit
  // — the one this render produces — so it must run here, before the tree is returned.
  const mode = completed ? 'payday' : job ? 'job' : online ? 'online' : 'offline';
  const prevMode = useRef(mode);
  if (prevMode.current !== mode) {
    animateNext(mode === 'payday' ? 'loud' : 'base');
    prevMode.current = mode;
  }

  return (
    <View style={styles.rootWrap}>
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
      {/* Location liveness: online but the platform has no position for us yet, so NO offers
          can reach us (matching requires a non-null last_lat). Actionable — tap to open
          settings (turn location on / set it to precise). Clears on the first successful ping. */}
      {!completed && online && !located ? (
        <Pressable style={styles.batteryBanner} onPress={() => void Linking.openSettings()}>
          <View style={styles.iconRow}>
            <Feather name="map-pin" size={16} color={colors.batteryTitle} />
            <Text style={styles.batteryTitle}>Waiting for your location</Text>
          </View>
          <Text style={styles.batteryBody}>
            Offers can&apos;t reach you until your phone shares its GPS location. Make sure location is
            on and precise, and you&apos;re in an open area — tap to open settings.
          </Text>
        </Pressable>
      ) : null}
      {/* Verification lapsed MID-RUN. Only ever rendered while a leg is in flight — a
          clear driver is routed to Onboarding instead (reconcileShift → onProfileStale),
          which owns the full per-state screen. This is the only place they learn what
          happened, so it leads with the delivery they still owe. */}
      {job && lapsedStatus && verificationBannerCopy(lapsedStatus) ? (
        <View style={styles.codBanner}>
          <View style={styles.iconRow}>
            <Feather name="alert-triangle" size={16} color={colors.codText} />
            <Text style={styles.codBannerTitle}>{verificationBannerCopy(lapsedStatus)!.title}</Text>
          </View>
          <Text style={styles.codBannerBody}>{verificationBannerCopy(lapsedStatus)!.body}</Text>
        </View>
      ) : null}
      {/* COD-locked explainer (C8): the driver's cash cap is $0 (an unvalued vehicle → no
          collateral), so cash-collecting offers are filtered out server-side. INFORMATIONAL —
          prepaid offers still flow, so this must NOT read as "the feed is empty". The detail
          (no vehicle vs awaiting valuation) lives on the Profile tab. */}
      {!completed && online && codCap === 0 ? (
        <View style={styles.codBanner}>
          <View style={styles.iconRow}>
            <Feather name="lock" size={16} color={colors.codText} />
            <Text style={styles.codBannerTitle}>Cash jobs are locked</Text>
          </View>
          <Text style={styles.codBannerBody}>
            Ops need to value your vehicle before you can carry cash. You&apos;ll still get prepaid
            offers in the meantime — see Profile to set up cash-on-delivery.
          </Text>
        </View>
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
          <ActiveJob job={job} run={runLegs} token={token} onAction={act} busy={busy} actionError={error} />
          {/* #66 (batching) B1: an on-route job the driver can ADD to this run is surfaced
              as the OfferAlert banner below (haptic + chime + motion-gated), NOT a passive
              inline list — see the appendOffer wiring above the return. */}
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
                onPress={() => {
                  animateNext('base');
                  setConfirmingOffline(false);
                }}
              >
                <Text style={styles.stayText}>Stay online</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable
                style={[styles.toggle, online ? styles.offBtn : styles.onBtn, busy && styles.busy]}
                onPress={
                  online
                    ? () => {
                        animateNext('base');
                        setConfirmingOffline(true);
                      }
                    : goOnlineNow
                }
                disabled={busy}
              >
                {busy ? (
                  // During go-online the GPS lock can take several seconds (cold/indoor);
                  // say so instead of a bare spinner that reads as a hang. Falls to a plain
                  // spinner for the short POST phase once located (locating cleared above).
                  locating ? (
                    <Text style={styles.toggleText}>Getting location…</Text>
                  ) : (
                    <ActivityIndicator color={colors.btnPrimaryText} />
                  )
                ) : (
                  <Text style={styles.toggleText}>{online ? 'Go offline' : 'Go online'}</Text>
                )}
              </Pressable>
              {online ? (
                <>
                  {/* H2: Offers (pushed) vs Available (the pulled open board). A segmented
                      view inside Home — NOT a 5th top-level tab, so the shift heartbeat
                      poll keeps running. */}
                  <View style={styles.segment}>
                    <Pressable
                      style={[styles.segmentBtn, boardTab === 'offers' && styles.segmentBtnActive]}
                      onPress={() => setBoardTab('offers')}
                    >
                      <Text style={[styles.segmentText, boardTab === 'offers' && styles.segmentTextActive]}>Offers</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.segmentBtn, boardTab === 'available' && styles.segmentBtnActive]}
                      onPress={() => {
                        setBoardTab('available');
                        setBoard(null);
                        void loadBoard();
                      }}
                    >
                      <Text style={[styles.segmentText, boardTab === 'available' && styles.segmentTextActive]}>Available</Text>
                    </Pressable>
                  </View>
                  {boardTab === 'offers' ? (
                    offers === null ? (
                      <View style={styles.checkingCard}>
                        <ActivityIndicator color={colors.textFaint} />
                        <Text style={styles.checkingText}>
                          {offersError ? 'Can’t reach the server — retrying…' : 'Checking for offers…'}
                        </Text>
                      </View>
                    ) : (
                      <OffersList
                        offers={offers}
                        onClaim={claim}
                        onAppend={append}
                        onBid={bid}
                        onDecline={decline}
                        onReset={resetTimer}
                        resetOfferIds={resetOfferIds}
                        actingId={claimingId}
                        bidSentIds={bidSentIds}
                      />
                    )
                  ) : (
                    <BoardList board={board} onGrab={grab} grabbingId={claimingId} />
                  )}
                </>
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
      {/* Queued-sync status is no longer an inline row here — the app-chrome
          OfflineBanner (App.tsx) owns "offline / N actions saved" on every tab (B4). */}
      {/* Shift-level errors only (go online/offline, claim) — action errors during
          a job render inside the ActiveJob card instead. */}
      {!completed && !job && error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      {/* #66 (batching) B1: mid-run "add to your run" offer — a non-blocking banner that
          buzzes + chimes on arrival (the OS notification is suppressed mid-job) and gates
          the "Add to run" action behind the vehicle being stopped. Overlays the scroll. */}
      <OfferAlert
        offer={appendAlert}
        moving={appendMotion.moving}
        busy={appendOffer != null && claimingId === appendOffer.id}
        onAppend={() => {
          if (!claimingId && appendOffer?.id) void append(appendOffer.id);
        }}
        onDismiss={() => {
          if (appendOffer?.id) setDismissedAppendIds((s) => new Set(s).add(appendOffer.id as string));
        }}
      />
    </View>
  );
}

// Every text style is built from the shared type scale (`typography.*`) so the
// screen speaks one type language (B4) — and because each variant carries its own
// lineHeight, the big money numbers render correctly through the <Text> primitive
// instead of clipping. Spacing/radii come from the `space`/`radius` tokens.
const styles = StyleSheet.create({
  rootWrap: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.xxl, paddingTop: 72, flexGrow: 1 },
  title: { ...typography.display, color: colors.textPrimary },
  earnCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.lg,
    marginTop: space.lg,
    ...shadow.card,
  },
  earnHeroLabel: { ...typography.caption, color: colors.textFaint },
  earnHero: { ...typography.display, fontSize: 30, lineHeight: 36, color: colors.money, marginTop: 2, letterSpacing: -0.5 },
  earnHeroSub: { ...typography.caption, fontSize: 13, lineHeight: 18, color: colors.textFaint, marginTop: 1 },
  earnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  earnRowLabel: { ...typography.callout, color: colors.textSecondary },
  earnRowValue: { ...typography.subheading, fontWeight: '700', color: colors.money, marginLeft: 'auto' },
  codCallout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.codBg,
    borderRadius: radius.sm,
    padding: space.md,
    marginTop: 14,
  },
  codBody: { flex: 1 },
  codTitle: { ...typography.callout, fontWeight: '700', color: colors.codText },
  codSub: { ...typography.caption, color: colors.codText, marginTop: 1 },
  codValue: { ...typography.subheading, fontWeight: '700', color: colors.codText },
  toggle: { borderRadius: radius.pill, paddingVertical: 18, alignItems: 'center', marginTop: space.xl },
  onBtn: { backgroundColor: colors.btnPrimaryBg },
  offBtn: { backgroundColor: colors.btnSecondaryBg },
  busy: { opacity: 0.6 },
  toggleText: { ...typography.heading, color: colors.btnPrimaryText },
  toggleRow: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bgRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.lg },
  bg: { ...typography.caption, fontSize: 13, lineHeight: 18, color: colors.textFaint },
  error: { ...typography.callout, color: colors.danger, marginTop: space.lg },
  checkingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.xxl,
    marginTop: 28,
    ...shadow.card,
  },
  checkingText: { ...typography.body, color: colors.textFaint },
  // H2 segmented Offers | Available control.
  segment: {
    flexDirection: 'row',
    marginTop: space.xxl,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    padding: space.xs,
    gap: space.xs,
  },
  segmentBtn: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  segmentBtnActive: { backgroundColor: colors.surface, ...shadow.card },
  segmentText: { ...typography.body, fontWeight: '700', color: colors.textMuted },
  segmentTextActive: { color: colors.textPrimary },
  batteryBanner: {
    backgroundColor: colors.batteryBg,
    borderColor: colors.batteryBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: space.lg,
  },
  batteryTitle: { ...typography.body, fontWeight: '700', color: colors.batteryTitle },
  batteryBody: { ...typography.caption, fontSize: 13, lineHeight: 18, color: colors.batteryBody, marginTop: space.xs },
  codBanner: { backgroundColor: colors.codBg, borderRadius: radius.md, padding: 14, marginBottom: space.lg },
  codBannerTitle: { ...typography.body, fontWeight: '700', color: colors.codText },
  codBannerBody: { ...typography.caption, fontSize: 13, lineHeight: 18, color: colors.codText, marginTop: space.xs },
  // Payday moment (the loop's most motivating screen — previously silent).
  completeCard: { alignItems: 'center', paddingTop: space.xxl, gap: space.sm },
  completeCheck: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.btnPrimaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  completeTitle: { ...typography.title, fontSize: 24, lineHeight: 30, color: colors.textPrimary },
  completeEarnLabel: { ...typography.callout, color: colors.textFaint, marginTop: space.sm },
  completeEarn: { ...typography.display, fontSize: 32, lineHeight: 38, color: colors.money },
  completeToday: { ...typography.body, color: colors.textSecondary, marginTop: space.xs },
  completeCod: {
    ...typography.callout,
    color: colors.cod,
    textAlign: 'center',
    marginTop: space.md,
    paddingHorizontal: space.sm,
  },
  completeBtn: {
    backgroundColor: colors.btnPrimaryBg,
    borderRadius: radius.pill,
    paddingVertical: space.lg,
    paddingHorizontal: 40,
    alignItems: 'center',
    marginTop: 28,
    alignSelf: 'stretch',
  },
  completeBtnText: { ...typography.subheading, fontWeight: '700', color: colors.btnPrimaryText },
  // End-of-shift summary confirm.
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.xl,
    marginTop: space.xl,
    alignItems: 'stretch',
    ...shadow.card,
  },
  summaryTitle: { ...typography.heading, color: colors.textPrimary, textAlign: 'center' },
  summaryBig: { ...typography.display, fontSize: 32, lineHeight: 38, color: colors.money, marginTop: 10, textAlign: 'center' },
  summarySub: { ...typography.callout, color: colors.textFaint, marginTop: 2, textAlign: 'center' },
  summaryCod: { ...typography.callout, color: colors.cod, textAlign: 'center', marginTop: space.md },
  stayBtn: { alignItems: 'center', paddingVertical: 14, marginTop: space.xs },
  stayText: { ...typography.callout, color: colors.textFaint },
});
