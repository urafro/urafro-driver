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
  /** Action payload (ADR-002 A.2/A.5): failure reason / COD amount / PoD note ride
   *  the queue so an offline tap loses none of its substance on replay. */
  reason?: string;
  codCollectedMinor?: number;
  note?: string;
}

const KEY = 'pending_actions';

// Retry only on TRANSIENT failures — a network error or a 5xx. A 4xx (including a
// 409 "already applied / illegal transition") is terminal: retrying can't make it
// succeed, so the action is dropped rather than looping forever.
export function shouldRetry(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500;
  return true; // network / unknown → transient
}

// Pure: perform each action, returning the ones that still need retrying. Takes the
// items as an argument (no storage), so the retry policy is unit-testable directly.
export async function flushActions(
  items: QueuedAction[],
  perform: (action: QueuedAction) => Promise<void>,
): Promise<QueuedAction[]> {
  const remaining: QueuedAction[] = [];
  for (const action of items) {
    try {
      await perform(action);
    } catch (error) {
      if (shouldRetry(error)) remaining.push(action);
    }
  }
  return remaining;
}

export async function loadQueue(): Promise<QueuedAction[]> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedAction[];
  } catch {
    return [];
  }
}

export async function saveQueue(items: QueuedAction[]): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(items));
}

// Add (or replace) a pending action, de-duped by id, and return the new queue.
export async function enqueueAction(action: QueuedAction): Promise<QueuedAction[]> {
  const queue = await loadQueue();
  const next = [...queue.filter((a) => a.id !== action.id), action];
  await saveQueue(next);
  return next;
}
