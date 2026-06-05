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

import { shouldRetry, flushActions, enqueueAction, loadQueue, type QueuedAction } from './queue';
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
