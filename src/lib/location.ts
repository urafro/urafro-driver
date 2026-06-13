import * as Location from 'expo-location';

export interface Coords {
  lat: number;
  lng: number;
}

// Foreground location only — background GPS (the hard part on low-end Android) is a
// later phase. Requests permission on first use; returns null if denied or
// unavailable so callers degrade gracefully (the driver just won't get offers).
/** Request foreground location permission. Separated from getCurrentLocation so the
 *  caller can distinguish "permission denied" (block) from "no fix yet" (proceed —
 *  the background stream will supply a position). */
export async function ensureForegroundPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

/**
 * Subscribe to the foreground position stream for the active-job map. The dot now
 * appears as soon as GPS locks and then follows the driver — the old one-shot
 * getCurrentLocation gave up after its 8s cap and returned null indoors, so the
 * dot frequently never rendered at all. Seeds instantly from the last known fix so
 * the map isn't blank during the cold lock. distanceInterval:0 (time-driven) is
 * deliberate (same lesson as the shift heartbeat): a non-zero smallestDisplacement
 * suppresses the first callback until the driver moves. Returns an unsubscribe;
 * a no-op unsubscribe if permission is denied.
 */
export async function watchLocation(onChange: (c: Coords) => void): Promise<() => void> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return () => {};
  try {
    const known = await Location.getLastKnownPositionAsync();
    if (known) onChange({ lat: known.coords.latitude, lng: known.coords.longitude });
  } catch {
    // no last-known fix — the stream supplies one once GPS locks
  }
  const sub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, timeInterval: 5_000, distanceInterval: 0 },
    (pos) => onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
  );
  return () => sub.remove();
}

export async function getCurrentLocation(): Promise<Coords | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  // Prefer the last known fix (instant) so going online isn't blocked on a cold GPS
  // lock — which can take 10s+ indoors and made the toggle feel hung / unresponsive.
  try {
    const known = await Location.getLastKnownPositionAsync();
    if (known) return { lat: known.coords.latitude, lng: known.coords.longitude };
  } catch {
    // fall through to an active fix
  }
  // Active fix, but capped at 8s so the UI never stalls — the background stream
  // refines the position right after we're online.
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    return pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : null;
  } catch {
    return null;
  }
}
