import { describe, it, expect, vi } from 'vitest';

// expo-secure-store is a native module — stub it with an in-memory store for node.
vi.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: vi.fn(async (k: string) => store[k] ?? null),
    setItemAsync: vi.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    deleteItemAsync: vi.fn(async (k: string) => {
      delete store[k];
    }),
  };
});

import {
  shouldRetry,
  flushActions,
  enqueueAction,
  loadQueue,
  saveQueue,
  subscribeQueueCount,
  type QueuedAction,
} from './queue';
import { ApiError } from './api';

const action = (id: string): QueuedAction => ({
  id,
  deliveryId: id,
  action: 'delivered',
  createdAt: 0,
});

describe('shouldRetry', () => {
  it('retries on network / unknown errors', () => {
    expect(shouldRetry(new Error('Network request failed'))).toBe(true);
  });

  it('retries on 5xx', () => {
    expect(shouldRetry(new ApiError(503, 'down'))).toBe(true);
  });

  it('drops on 4xx (409 already-applied / illegal transition, 404)', () => {
    expect(shouldRetry(new ApiError(409, 'conflict'))).toBe(false);
    expect(shouldRetry(new ApiError(404, 'gone'))).toBe(false);
  });
});

describe('flushActions', () => {
  it('keeps transient failures, drops successes and terminal failures', async () => {
    const performed: string[] = [];
    const remaining = await flushActions([action('a'), action('b'), action('c')], async (a) => {
      performed.push(a.id);
      if (a.id === 'b') throw new Error('network'); // transient → keep
      if (a.id === 'c') throw new ApiError(409, 'conflict'); // terminal → drop
      // 'a' succeeds
    });
    expect(performed).toEqual(['a', 'b', 'c']);
    expect(remaining.map((a) => a.id)).toEqual(['b']);
  });

  it('returns empty when everything succeeds', async () => {
    expect(await flushActions([action('a')], async () => {})).toEqual([]);
  });
});

describe('enqueueAction', () => {
  it('persists and de-dupes by id (latest wins)', async () => {
    await enqueueAction(action('x'));
    const q = await enqueueAction({ ...action('x'), createdAt: 99 });
    expect(q).toHaveLength(1);
    expect(q[0].createdAt).toBe(99);
    expect(await loadQueue()).toHaveLength(1);
  });
});

describe('subscribeQueueCount', () => {
  it('emits the current depth on subscribe, then every save; stops after unsubscribe', async () => {
    await saveQueue([]); // normalize the module count to 0 regardless of prior tests
    const seen: number[] = [];
    const unsub = subscribeQueueCount((n) => seen.push(n)); // fires immediately with 0
    await saveQueue([action('a'), action('b')]); // -> 2
    await saveQueue([action('a')]); // -> 1
    unsub();
    await saveQueue([]); // ignored: no longer subscribed
    expect(seen).toEqual([0, 2, 1]);
  });

  it('coalesces a save that does not change the depth', async () => {
    await saveQueue([action('a')]); // set depth 1
    const seen: number[] = [];
    const unsub = subscribeQueueCount((n) => seen.push(n)); // -> 1
    await saveQueue([action('b')]); // still depth 1 -> no emit
    unsub();
    expect(seen).toEqual([1]);
  });

  // Regression: a queue persisted by a PRIOR (dead-zone) session leaves the in-memory
  // count behind at cold start; loadQueue must reconcile it, else the drain-to-empty
  // saveQueue([]) coalesces (0 === stale-0) and strands the banner on a phantom count.
  it('reconciles the count from disk on load, so a drain-to-empty still emits 0', async () => {
    const SecureStore = await import('expo-secure-store');
    // Seed disk DIRECTLY (bypassing saveQueue), so the module count does not track it.
    await SecureStore.setItemAsync('pending_actions', JSON.stringify([action('a'), action('b')]));
    const seen: number[] = [];
    const unsub = subscribeQueueCount((n) => seen.push(n));
    await loadQueue(); // reconciles the cache with disk -> emits 2
    await saveQueue([]); // drains -> must emit 0 (would be coalesced without the reconcile)
    unsub();
    expect(seen).toContain(2);
    expect(seen[seen.length - 1]).toBe(0);
  });
});
