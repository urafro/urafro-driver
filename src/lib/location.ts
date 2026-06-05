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
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}
