import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The real EventSource pulls in React Native globals (XMLHttpRequest). We never
// instantiate it — the tests inject a fake factory — so stub the module so vitest
// can load realtime.ts in node.
vi.mock('react-native-sse', () => ({ default: class {} }));

import { connectDriverStream, type StreamLike } from './realtime';

type Listener = (event: { data?: string | null }) => void;

class FakeStream implements StreamLike {
  listeners: Record<string, Listener[]> = {};
  closed = false;
  addEventListener(type: 'open' | 'message' | 'error', cb: Listener): void {
    (this.listeners[type] ??= []).push(cb);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: 'open' | 'message' | 'error', data?: string): void {
    for (const cb of this.listeners[type] ?? []) cb({ data });
  }
}

function setup() {
  const streams: FakeStream[] = [];
  const factory = (): StreamLike => {
    const s = new FakeStream();
    streams.push(s);
    return s;
  };
  return { streams, factory };
}

const opts = (over: Partial<Parameters<typeof connectDriverStream>[0]>) => ({
  token: 't',
  onOffer: () => {},
  baseUrl: 'http://x',
  ...over,
});

describe('connectDriverStream (C4 driver socket)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('re-fetches on offer.new only, not on heartbeat/connected', () => {
    const onOffer = vi.fn();
    const { streams, factory } = setup();
    const disconnect = connectDriverStream(opts({ onOffer, factory }));
    const s = streams[0]!;

    s.emit('open');
    s.emit('message', JSON.stringify({ type: 'connected' }));
    s.emit('message', JSON.stringify({ type: 'heartbeat' }));
    expect(onOffer).not.toHaveBeenCalled();

    s.emit('message', JSON.stringify({ type: 'offer.new', payload: { delivery_id: 'd1' } }));
    expect(onOffer).toHaveBeenCalledTimes(1);
    disconnect();
  });

  it('ignores a malformed frame without throwing', () => {
    const onOffer = vi.fn();
    const { streams, factory } = setup();
    const disconnect = connectDriverStream(opts({ onOffer, factory }));
    expect(() => streams[0]!.emit('message', 'not json')).not.toThrow();
    expect(onOffer).not.toHaveBeenCalled();
    disconnect();
  });

  it('reports health and reconnects after an error (capped backoff)', () => {
    const onHealth = vi.fn();
    const { streams, factory } = setup();
    const disconnect = connectDriverStream(opts({ onHealth, factory }));

    streams[0]!.emit('open');
    expect(onHealth).toHaveBeenLastCalledWith(true);

    streams[0]!.emit('error');
    expect(onHealth).toHaveBeenLastCalledWith(false);
    expect(streams[0]!.closed).toBe(true);

    vi.advanceTimersByTime(30_000); // past the backoff → a fresh stream opens
    expect(streams.length).toBe(2);
    disconnect();
  });

  it('treats 60s of total silence as a dead socket → reconnect', () => {
    const onHealth = vi.fn();
    const { streams, factory } = setup();
    const disconnect = connectDriverStream(opts({ onHealth, factory }));

    streams[0]!.emit('open'); // arms the staleness timer
    vi.advanceTimersByTime(60_000); // no frame at all → stale
    expect(onHealth).toHaveBeenLastCalledWith(false);

    vi.advanceTimersByTime(30_000); // backoff → reconnect
    expect(streams.length).toBe(2);
    disconnect();
  });

  it('a heartbeat keeps the socket alive (resets the staleness timer)', () => {
    const onHealth = vi.fn();
    const { streams, factory } = setup();
    const disconnect = connectDriverStream(opts({ onHealth, factory }));

    streams[0]!.emit('open');
    vi.advanceTimersByTime(40_000);
    streams[0]!.emit('message', JSON.stringify({ type: 'heartbeat' })); // resets stale
    vi.advanceTimersByTime(40_000); // 80s total, but only 40s since the last frame
    // Not stale yet → still healthy, no reconnect.
    expect(onHealth).toHaveBeenLastCalledWith(true);
    expect(streams.length).toBe(1);
    disconnect();
  });

  it('disconnect() closes the stream and stops reconnecting', () => {
    const { streams, factory } = setup();
    const disconnect = connectDriverStream(opts({ factory }));
    streams[0]!.emit('open');

    disconnect();
    expect(streams[0]!.closed).toBe(true);

    streams[0]!.emit('error'); // must NOT schedule a reconnect after disconnect
    vi.advanceTimersByTime(60_000);
    expect(streams.length).toBe(1);
  });
});
