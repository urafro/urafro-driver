import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  claimDelivery,
  getDelivery,
  goOffline,
  goOnline,
  listOffers,
  markDelivered,
  markFailed,
  markInTransit,
  markPickedUp,
  updateLocation,
  type Delivery,
  type Offer,
} from '../lib/api';
import { getCurrentLocation } from '../lib/location';
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
import ActiveJob, { type LifecycleAction } from '../components/ActiveJob';

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
  const [job, setJob] = useState<Delivery | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Latest job, readable from inside the (token-scoped) flush interval.
  const jobRef = useRef<Delivery | null>(null);
  jobRef.current = job;

  // While online and free, refresh location + offers on an interval.
  useEffect(() => {
    if (!online || job) return;
    let cancelled = false;
    async function tick() {
      try {
        const loc = await getCurrentLocation();
        if (loc && !cancelled) await updateLocation(token, loc.lat, loc.lng);
        const { data } = await listOffers(token);
        if (!cancelled) setOffers(data);
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
  }, [online, job, token]);

  const performAction = useCallback(
    async (a: QueuedAction): Promise<void> => {
      if (a.action === 'picked_up') await markPickedUp(token, a.deliveryId);
      else if (a.action === 'in_transit') await markInTransit(token, a.deliveryId);
      else if (a.action === 'delivered') await markDelivered(token, a.deliveryId, { method: 'manual' });
      else await markFailed(token, a.deliveryId);
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
        } catch {
          if (!cancelled) setJob(null); // no longer ours
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
      const loc = await getCurrentLocation();
      if (!loc) {
        setError('Location permission is needed to receive offers.');
        return;
      }
      const state = await goOnline(token, loc);
      setOnline(state.status !== 'offline');
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
      setOnline(false);
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
      } catch {
        setError('That job was just taken — try another.');
      } finally {
        setClaimingId(null);
      }
    },
    [token],
  );

  const act = useCallback(
    async (to: LifecycleAction) => {
      const id = job?.id;
      if (!id) return;
      const queued: QueuedAction = { id: `${id}:${to}`, deliveryId: id, action: to, createdAt: Date.now() };
      setBusy(true);
      setError(null);
      try {
        let updated: Delivery;
        if (to === 'picked_up') updated = await markPickedUp(token, id);
        else if (to === 'in_transit') updated = await markInTransit(token, id);
        else if (to === 'delivered') updated = await markDelivered(token, id, { method: 'manual' });
        else updated = await markFailed(token, id);
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

      {pending > 0 ? (
        <Text style={styles.syncing}>
          ⏳ {pending} action{pending > 1 ? 's' : ''} waiting to sync…
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Text style={styles.meta}>Driver {session?.driverId.slice(0, 8)}…</Text>
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
  toggle: { borderRadius: 12, paddingVertical: 18, alignItems: 'center', marginTop: 20 },
  onBtn: { backgroundColor: '#22c55e' },
  offBtn: { backgroundColor: '#f59e0b' },
  busy: { opacity: 0.6 },
  toggleText: { color: '#0f172a', fontSize: 18, fontWeight: '700' },
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
