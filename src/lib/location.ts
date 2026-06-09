import * as Location from 'expo-location';

export interface Coords {
  lat: number;
  lng: number;
}

// Foreground location only — background GPS (the hard part on low-end Android) is a
// later phase. Requests permission on first use; returns null if denied or
// unavailable so callers degrade gracefully (the driver just won't get offers).
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
