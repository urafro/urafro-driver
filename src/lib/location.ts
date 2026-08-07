import * as Location from 'expo-location';

export interface Coords {
  lat: number;
  lng: number;
}

// The FOREGROUND half of location. The background half is shipped and lives in
// `background-location.ts` (an expo-task-manager task started on go-online, which
// keeps streaming fixes while the app is backgrounded or the screen is locked).
//
// The two run TOGETHER: the shift poll does NOT defer to the background task while it
// is streaming. HomeScreen calls getCurrentLocation on every tick even then, because
// the background stream stops ticking on a stationary phone (Samsung suppresses
// same-position fixes at the system level) and the driver would go heartbeat-stale
// and be swept off shift while staring at the open app. That invariant is
// load-bearing: see the "ALWAYS ping location" comment on the poll in
// `src/screens/HomeScreen.tsx` before changing anything here.
//
// Permission is requested on first use (ensureForegroundPermission / watchLocation;
// getCurrentLocation only CHECKS it — see its own note); null is returned if denied
// or unavailable so callers degrade gracefully (the driver just won't get offers).
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
  // CHECK permission, don't RE-REQUEST it: every caller (go-online, the shift poll,
  // reconcileShift) has already ensured it via ensureForegroundPermission(). A second
  // requestForegroundPermissionsAsync() can surface/hang on a duplicate OS dialog on
  // some Android devices — which latched the "Go online" spinner. getForegroundPermissions
  // never blocks; a revoked-mid-shift permission → null → the "waiting for location" banner.
  const { status } = await Location.getForegroundPermissionsAsync();
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
