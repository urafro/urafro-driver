import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { updateLocation } from './api';
import { loadSession } from './session';

// Background location for a driver on shift. expo-location delivers fixes (in the
// foreground AND background) to this TaskManager task, which posts them to the
// platform. The task runs headless — no React context — so it reads the token from
// the secure store itself. NOTE: background-location tasks DO NOT run in Expo Go;
// this requires a development/EAS build to actually execute (built to spec, pending
// on-device verification). The app degrades to foreground-only location when the
// background permission is denied.

export const LOCATION_TASK = 'urafro-driver-location';

// Registered at module load (imported by HomeScreen, which the app entry imports),
// so the task exists before the OS ever delivers a background fix.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const last = locations[locations.length - 1];
  if (!last) return;
  const session = await loadSession();
  if (!session) return;
  try {
    await updateLocation(session.token, last.coords.latitude, last.coords.longitude);
  } catch {
    // dropped — the next fix supersedes it (location is fire-and-forget by design)
  }
});

/** Request "allow all the time" + start streaming fixes. Returns false if the
 *  background permission isn't granted (caller falls back to foreground location). */
export async function startBackgroundLocation(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return false;

  if (await isBackgroundActive()) return true;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 15_000,
    distanceInterval: 50,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'urAfro Driver — on shift',
      notificationBody: 'Sharing your location to receive and run deliveries.',
      notificationColor: '#22c55e',
    },
  });
  return true;
}

export async function stopBackgroundLocation(): Promise<void> {
  if (await isBackgroundActive()) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

export function isBackgroundActive(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
}
