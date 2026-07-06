import * as SecureStore from 'expo-secure-store';
import { ApiError } from './api';

// A persisted queue of the driver's pending lifecycle actions, so a tap made with
// no signal (e.g. "Delivered" in a dead zone) is never lost — it's stored and
// retried until it reaches the server. Location pings are fire-and-forget (the
// next one supersedes them), so only the must-land lifecycle actions are queued.

export type QueuedActionType = 'picked_up' | 'in_transit' | 'delivered' | 'failed';

export interface QueuedAction {
  id: string; // `${deliveryId}:${action}` — one pending entry per delivery+action
  deliveryId: string;
  action: QueuedActionType;
  createdAt: number;
  /** Transient-failure replays so far (audit R12): a permanently-5xx-ing action
   *  used to retry every 12s forever, across every launch. Bounded now. */
  attempts?: number;
  /** Action payload (ADR-002 A.2/A.5): failure reason / COD amount / PoD note ride
   *  the queue so an offline tap loses none of its substance on replay. */
  reason?: string;
  codCollectedMinor?: number;
  note?: string;
  /** At-door delivery code typed in front of the customer. Rides the replay for a
   *  verified handover; if the server rejects it then (400), the flusher completes
   *  manually instead — see performAction in HomeScreen. */
  podPin?: string;
  /** Claimed PoD method (e.g. 'photo' once the picture is uploaded). Rides the replay
   *  so a queued photo-delivery still stamps the photo key; defaults to 'manual'. */
  method?: string;
}

const KEY = 'pending_actions';

// Observable pending-count. The offline banner lives in the app chrome (every tab),
// but the flusher that mutates the queue lives on the Shift screen — so the count is
// published here, from the one write choke point (`saveQueue`), rather than lifting
// the flusher's React state up past three sibling screens. Listeners get the current
// value on subscribe and every change thereafter.
type QueueCountListener = (n: number) => void;
const countListeners = new Set<QueueCountListener>();
let currentCount = 0;

export function subscribeQueueCount(fn: QueueCountListener): () => void {
  countListeners.add(fn);
  fn(currentCount);
  return () => {
    countListeners.delete(fn);
  };
}

function publishQueueCount(n: number) {
  if (n === currentCount) return;
  currentCount = n;
  for (const fn of countListeners) fn(n);
}

// Retry only on TRANSIENT failures — a network error or a 5xx. A 4xx (including a
// 409 "already applied / illegal transition") is terminal: retrying can't make it
// succeed, so the action is dropped rather than looping forever.
export function shouldRetry(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500;
  return true; // network / unknown → transient
}

// Give-up bounds (audit R12): a permanently-failing action must eventually stop
// consuming the 12s flusher and SURFACE, not loop silently forever. AGE is the
// primary bound — 24h covers any realistic dead-zone + outage overlap (the
// physical event is long over by then). The attempt ceiling is ONLY a
// clock-skew backstop (a device whose clock made createdAt bogus-future would
// never age out): at the 12s flush cadence 7,500 attempts ≈ 25h of CONTINUOUS
// failure, deliberately just past the age cap — it must never be the bound
// that trips first on a healthy clock (review catch: an earlier draft's 40
// would have expired a money action after an 8-minute outage).
export const MAX_ACTION_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_ACTION_ATTEMPTS = 7_500;

export function isExpired(action: QueuedAction, now: number): boolean {
  return now - action.createdAt > MAX_ACTION_AGE_MS || (action.attempts ?? 0) >= MAX_ACTION_ATTEMPTS;
}

// Pure: perform each action, returning the ones that still need retrying. Takes the
// items as an argument (no storage), so the retry policy is unit-testable directly.
// Expired actions (see isExpired) are NOT attempted or retained — they're reported
// via onExpired so the UI can hand the driver to ops instead of silently looping.
export async function flushActions(
  items: QueuedAction[],
  perform: (action: QueuedAction) => Promise<void>,
  onExpired?: (action: QueuedAction) => void,
  now: number = Date.now(),
): Promise<QueuedAction[]> {
  const remaining: QueuedAction[] = [];
  for (const action of items) {
    if (isExpired(action, now)) {
      onExpired?.(action);
      continue;
    }
    try {
      await perform(action);
    } catch (error) {
      if (shouldRetry(error)) remaining.push({ ...action, attempts: (action.attempts ?? 0) + 1 });
    }
  }
  return remaining;
}

export async function loadQueue(): Promise<QueuedAction[]> {
  const raw = await SecureStore.getItemAsync(KEY);
  let items: QueuedAction[] = [];
  if (raw) {
    try {
      items = JSON.parse(raw) as QueuedAction[];
    } catch {
      items = []; // corrupt store → treat as empty
    }
  }
  // Reconcile the in-memory count with disk truth on EVERY read — not just writes.
  // At cold start `currentCount` is 0 but a prior dead-zone session may have left
  // actions on disk; without this, the drain-to-empty `saveQueue([])` would coalesce
  // (0 === stale-0) and strand the banner on a phantom "syncing N".
  publishQueueCount(items.length);
  return items;
}

export async function saveQueue(items: QueuedAction[]): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(items));
  publishQueueCount(items.length);
}

// Expired actions are ARCHIVED, not discarded (audit R12 review catch): a queued
// COD `delivered` carries the cash amount — if it can never sync, ops needs the
// payload to reconcile by hand, so it must survive the drop. Ring-buffered (last
// 20) in its own SecureStore key; read it out with loadExpiredArchive when
// walking a driver through an ops recovery.
const EXPIRED_KEY = 'expired_actions';
const EXPIRED_MAX = 20;

export async function archiveExpired(action: QueuedAction): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(EXPIRED_KEY);
    let items: QueuedAction[] = [];
    if (raw) {
      try {
        items = JSON.parse(raw) as QueuedAction[];
      } catch {
        items = [];
      }
    }
    items = [...items.filter((a) => a.id !== action.id), action].slice(-EXPIRED_MAX);
    await SecureStore.setItemAsync(EXPIRED_KEY, JSON.stringify(items));
  } catch {
    // archival is best-effort — never let it break the flush loop
  }
}

export async function loadExpiredArchive(): Promise<QueuedAction[]> {
  const raw = await SecureStore.getItemAsync(EXPIRED_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedAction[];
  } catch {
    return [];
  }
}

// Add (or replace) a pending action, de-duped by id, and return the new queue.
export async function enqueueAction(action: QueuedAction): Promise<QueuedAction[]> {
  const queue = await loadQueue();
  const next = [...queue.filter((a) => a.id !== action.id), action];
  await saveQueue(next);
  return next;
}
