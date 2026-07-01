import RNEventSource from 'react-native-sse';
import { API_BASE } from '../config';

// C4 rollout flag. Off (default) → no socket is opened; the app runs exactly as
// before on FCM push + the poll. On → a live socket nudges an immediate offer
// re-fetch. Kept additive so an old EAS build without this code keeps working.
export const REALTIME_ENABLED = process.env.EXPO_PUBLIC_REALTIME_ENABLED === 'true';

// The slice of the EventSource surface we use — lets tests inject a fake without
// pulling in React Native globals (XMLHttpRequest etc.).
export interface StreamLike {
  addEventListener(type: 'open' | 'message' | 'error', listener: (event: { data?: string | null }) => void): void;
  close(): void;
}
export type StreamFactory = (url: string, token: string) => StreamLike;

const defaultFactory: StreamFactory = (url, token) =>
  new RNEventSource(url, { headers: { Authorization: `Bearer ${token}` } }) as unknown as StreamLike;

// C1 sends a heartbeat every ~25s; treat 60s of total silence as a dead socket.
const HEARTBEAT_TIMEOUT_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;

interface ConnectOpts {
  token: string;
  /** Fired on an `offer.new` frame — the caller re-fetches offers (poll stays the floor). */
  onOffer: () => void;
  /** Fired on connect (true) and on drop/stale (false) — the caller can react (e.g. UI). */
  onHealth?: (healthy: boolean) => void;
  factory?: StreamFactory;
  baseUrl?: string;
}

/**
 * C4: the driver's live connection over the push+poll floor. Subscribes to the
 * driver's OWN channel (`/v1/driver/stream`, authed by the bearer token) and nudges
 * an offer re-fetch the instant `offer.new` arrives. The socket ONLY accelerates —
 * the caller keeps FCM push + the poll as the correctness floor, so a dropped
 * socket (or an old build) never misses an offer. Any frame (incl. a heartbeat)
 * proves liveness; 60s of silence, an error, or a close triggers a capped
 * exponential-backoff reconnect. Returns a disconnect function.
 */
export function connectDriverStream({
  token,
  onOffer,
  onHealth,
  factory = defaultFactory,
  baseUrl = API_BASE,
}: ConnectOpts): () => void {
  let stream: StreamLike | null = null;
  let closed = false;
  let attempt = 0;
  let staleTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const url = `${baseUrl.replace(/\/+$/, '')}/v1/driver/stream`;

  const clearStale = (): void => {
    if (staleTimer) {
      clearTimeout(staleTimer);
      staleTimer = null;
    }
  };
  const armStale = (): void => {
    clearStale();
    staleTimer = setTimeout(() => {
      onHealth?.(false);
      reconnect();
    }, HEARTBEAT_TIMEOUT_MS);
  };

  const reconnect = (): void => {
    if (closed) return;
    clearStale();
    stream?.close();
    stream = null;
    attempt += 1;
    const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
    reconnectTimer = setTimeout(() => {
      if (!closed) open();
    }, delay);
  };

  const open = (): void => {
    stream = factory(url, token);
    stream.addEventListener('open', () => {
      attempt = 0;
      onHealth?.(true);
      armStale();
    });
    stream.addEventListener('message', (event) => {
      armStale(); // any frame (incl. heartbeat) proves the socket is alive
      try {
        const evt = JSON.parse(event.data ?? '{}') as { type?: string };
        if (evt.type === 'offer.new') onOffer();
        // 'connected' / 'heartbeat' just keep the socket warm.
      } catch {
        // ignore a malformed frame
      }
    });
    stream.addEventListener('error', () => {
      onHealth?.(false);
      reconnect();
    });
  };

  open();

  return () => {
    closed = true;
    clearStale();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    stream?.close();
    stream = null;
  };
}
