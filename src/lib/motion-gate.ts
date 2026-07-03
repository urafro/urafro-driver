// Pure motion-gate logic for B1 (no GPS/native imports → unit-testable and usable
// with any speed source). `useIsStopped` is the hook that feeds this from GPS.
//
// Hysteresis: enter "moving" quickly (safety-forward) but only leave it once
// clearly slow, so a car idling at a light doesn't flap the gate. An UNKNOWN speed
// (GPS often returns null/noise) HOLDS the previous state; the initial state is
// "stopped" so the interactive card stays reachable when we simply don't know —
// and the offer alert is non-blocking regardless, so a wrong guess is never unsafe.
export const MOVING_ENTER = 2.5; // m/s ≈ 9 km/h — confidently moving
export const MOVING_EXIT = 1.0; // m/s ≈ 3.6 km/h — confidently stopped

export function deriveMoving(speed: number | null | undefined, prev: boolean): boolean {
  if (speed == null || !Number.isFinite(speed) || speed < 0) return prev; // unknown → hold
  if (speed >= MOVING_ENTER) return true;
  if (speed <= MOVING_EXIT) return false;
  return prev; // inside the hysteresis band — hold last state
}
