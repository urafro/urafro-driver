// Read-only view of the offline-queue depth for app chrome (the OfflineBanner).
// Seeds from the persisted queue on mount — so a cold start that still holds actions
// from a previous dead-zone session shows them immediately — then tracks every
// enqueue/flush via the queue's own pub/sub. No polling.
import { useEffect, useState } from 'react';
import { loadQueue, subscribeQueueCount } from '../lib/queue';

export function useQueuedCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    // Subscribe first (fires with the current in-memory count), then reconcile with
    // what's actually on disk in case nothing has been saved yet this launch.
    const unsub = subscribeQueueCount(setCount);
    void loadQueue().then((q) => {
      if (alive) setCount(q.length);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);
  return count;
}
