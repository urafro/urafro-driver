// Motion gate for B1: the accept/counter/pass card must not demand tapping while
// the vehicle is MOVING. This hook turns GPS speed into an is-moving signal using
// the pure `deriveMoving` policy (see lib/motion-gate for the safety model).
import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { deriveMoving } from '../lib/motion-gate';

export type MotionState = { moving: boolean; speed: number | null };

// If speed stays UNKNOWN this long while we currently believe "moving", decay to
// "stopped" (reachable). Without this, a sustained GPS drop mid-drive (tunnel / weak
// fix on a low-end Android) would latch the gate closed and strip the driver's
// ability to act on an offer they can see — being reachable-when-uncertain is the
// documented safe default (the alert itself is non-blocking regardless).
const STALE_UNKNOWN_MS = 8000;

// `active` gates the GPS watch so it costs nothing until the offer alert needs it.
// Pass `speedSource` (m/s) to reuse the app's existing location stream instead of
// opening a second watch — when provided, no independent GPS subscription is made.
export function useIsStopped(active: boolean, speedSource?: number | null): MotionState {
  const [state, setState] = useState<MotionState>({ moving: false, speed: null });
  const movingRef = useRef(false);
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStale = () => {
    if (staleTimer.current) {
      clearTimeout(staleTimer.current);
      staleTimer.current = null;
    }
  };

  // Only re-render when the gate actually FLIPS (the sole thing consumers read) —
  // raw speed jitter at rest must not churn the flagship offer card.
  const emit = (moving: boolean, speed: number | null) =>
    setState((prev) => (prev.moving === moving ? prev : { moving, speed }));

  const apply = (speed: number | null | undefined) => {
    const known = speed != null && Number.isFinite(speed) && speed >= 0;
    if (known) {
      clearStale();
      const next = deriveMoving(speed, movingRef.current);
      movingRef.current = next;
      emit(next, speed as number);
      return;
    }
    // Unknown reading → hold, but arm the watchdog if we currently think we're moving.
    if (movingRef.current && !staleTimer.current) {
      staleTimer.current = setTimeout(() => {
        staleTimer.current = null;
        movingRef.current = false;
        emit(false, null);
      }, STALE_UNKNOWN_MS);
    }
  };

  // Injected-speed path — no extra GPS.
  useEffect(() => {
    if (speedSource === undefined) return;
    apply(speedSource);
    return clearStale;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speedSource]);

  // Self-watch path — only when active AND no injected source.
  useEffect(() => {
    if (!active || speedSource !== undefined) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const s = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 3000, distanceInterval: 10 },
          (pos) => apply(pos.coords.speed),
        );
        // The effect may have been torn down while the native watch was starting —
        // remove the just-created subscription rather than leaking a live GPS watch.
        if (cancelled) {
          s.remove();
          return;
        }
        sub = s;
      } catch {
        // motion signal is advisory — the alert is non-blocking regardless
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
      clearStale();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, speedSource]);

  return state;
}
