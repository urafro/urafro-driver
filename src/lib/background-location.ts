import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { listOffers, updateLocation } from './api';
import { loadSession, loadActiveJob } from './session';
import { maybeNotifyNewOffers } from './notifications';
import { money } from './format';
import { colors } from '../theme';

// Background location for a driver on shift. expo-location delivers fixes (in the
// foreground AND background) to this TaskManager task, which posts them to the
// platform. The task runs headless — no React context — so it reads the token from
// the secure store itself. NOTE: background-location tasks DO NOT run in Expo Go;
// this requires a development/EAS build to actually execute — which is how it was
// device-verified (EAS preview build on a real Samsung: fixes kept streaming with
// the screen locked and the driver moving). The app degrades to foreground-only
// location when the background permission is denied.

export const LOCATION_TASK = 'urafro-driver-location';

// Registered at module load (imported by HomeScreen, which the app entry imports),
// so the task exists before the OS ever delivers a background fix.
// Offers are only checked every so often from the headless task — a fix can arrive every
// 15s and the check costs a network round-trip. 15s on the 3G-primary baseline (eased from
// 20s); kept at the fix cadence (not lower) because this path is battery-bound, not latency-bound.
const OFFERS_CHECK_MIN_MS = 15_000;
let lastOffersCheckMs = 0;

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

  // Screen-locked offer alerts (the no-Firebase path): RN pauses JS timers when
  // the app is backgrounded, so the HomeScreen poll can't notify a pocketed
  // phone — but THIS task is the proven screen-locked execution path. Honest
  // limit: stationary devices get fixes throttled on some OEMs, so this is
  // reliable while moving and best-effort while parked; true Doze-proof delivery
  // is the remote-push path (Firebase step). Skipped mid-job (no offers then).
  const now = Date.now();
  if (now - lastOffersCheckMs < OFFERS_CHECK_MIN_MS) return;
  lastOffersCheckMs = now;
  try {
    if (await loadActiveJob()) return; // on a job — server returns no offers anyway
    const { data: offers } = await listOffers(session.token);
    await maybeNotifyNewOffers(offers ?? [], money);
  } catch {
    // advisory — never let an offers/notification failure break location reporting
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
    // MUST be 0: a non-zero distanceInterval makes Android's fused provider
    // suppress callbacks until the device has MOVED that far — a parked driver
    // produced no fixes at all, so (a) the offers check in this task never ran
    // (no notifications while stationary + backgrounded, on-device finding
    // 2026-06-10) and (b) their heartbeat went silent until the server's
    // ghost-supply sweep wrongly took them off shift. On shift = a time-driven
    // heartbeat every 15s regardless of movement; the battery cost while online
    // is the price of being reachable, same as every courier app.
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'urAfro Driver — on shift',
      notificationBody: 'Sharing your location to receive and run deliveries.',
      notificationColor: colors.notificationAccent,
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
