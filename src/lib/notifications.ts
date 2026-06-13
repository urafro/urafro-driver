import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { registerPushToken } from './api';
import { notifyPlace } from './format';

// Driver notifications (ADR-002 Phase A.1, app half).
//
// Two delivery paths, deliberately redundant:
//  1. REMOTE push (Expo → FCM): the server wakes the phone on offer-create /
//     cancel even in Doze. On Android this only delivers once the founder's
//     one-time Firebase/FCM-V1 EAS credential step is done — until then
//     getExpoPushTokenAsync throws and we degrade gracefully to (2).
//  2. LOCAL notification fired from the offers poll: works TODAY with no
//     Firebase, covering the screen-locked-but-process-alive case (the on-shift
//     location foreground service keeps the process up).
// The offers list stays the source of truth — notifications only wake humans.

export const OFFERS_CHANNEL = 'offers'; // must match the server's channelId

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Create the high-importance offers channel (Android requires it for sound). */
export async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(OFFERS_CHANNEL, {
    name: 'Delivery offers',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/**
 * Ask notification permission (Android 13+ shows a real prompt) and register
 * this device's Expo push token with the platform. Safe to call repeatedly;
 * every failure degrades silently to the local-notification path.
 */
export async function registerForPush(token: string): Promise<boolean> {
  try {
    await ensureNotificationChannel();
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return false;
    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    // Throws on Android until the FCM credential is configured in EAS — expected
    // pre-Firebase; the local path still notifies.
    const expoToken = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    await registerPushToken(token, expoToken.data, Platform.OS === 'ios' ? 'ios' : 'android');
    return true;
  } catch {
    return false;
  }
}

/** Fire a local offer notification (the no-Firebase fallback path). */
export async function notifyNewOffer(title: string, body: string): Promise<void> {
  try {
    await ensureNotificationChannel();
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: 'default' },
      trigger: Platform.OS === 'android' ? { channelId: OFFERS_CHANNEL } : null,
    });
  } catch {
    // notifications are advisory — never let them break the shift loop
  }
}

/** Fire `onReceive` whenever a notification arrives while the app is in the
 *  FOREGROUND (e.g. a new-offer push). Lets the offers list refresh the instant a
 *  push lands instead of waiting for the next poll tick. Returns a subscription. */
export function onNotificationReceived(onReceive: () => void): { remove: () => void } {
  return Notifications.addNotificationReceivedListener(() => onReceive());
}

/** Whether the OS notification permission is currently granted. Used to surface a
 *  "turn on notifications" banner — without it, ALL alert paths are silent and the
 *  driver only sees offers by staring at the list. */
export async function notificationsEnabled(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return true; // unknown → don't nag
  }
}

/** Fire `onTap` when the driver TAPS a notification (warm via a listener, and cold via
 *  the launch response), so opening from a push lands them on offers. Returns a
 *  subscription; also resolves any cold-start tap once. */
export function onNotificationResponse(onTap: () => void): { remove: () => void } {
  void Notifications.getLastNotificationResponseAsync()
    .then((r) => {
      if (r) onTap();
    })
    .catch(() => {});
  return Notifications.addNotificationResponseReceivedListener(() => onTap());
}

// ── Shared new-offer detection ────────────────────────────────────────────────
// ONE seen-set serving BOTH callers — the foreground offers poll and the headless
// background-location task (RN pauses JS timers when backgrounded, so the
// foreground poll alone never notifies a pocketed phone; the location task is the
// proven screen-locked execution path). Module state lives exactly as long as the
// process — the same lifetime either caller has. A re-offered (expired→refreshed)
// job re-notifies by design: it's a fresh claim window.

interface OfferLike {
  id?: string;
  driver_fee_minor?: number | null;
  fee_minor?: number | null;
  dropoff?: { landmark?: string | null; address_text?: string | null } | null;
  trip_km?: number | null;
}

const seenOfferIds = new Set<string>();

/** Detect genuinely-new offers, notify once for the first, remember the rest. */
export async function maybeNotifyNewOffers(
  offers: OfferLike[],
  formatMoney: (minor: number | null | undefined) => string,
): Promise<void> {
  const firstNew = offers.find((o) => o.id && !seenOfferIds.has(o.id));
  seenOfferIds.clear();
  for (const o of offers) if (o.id) seenOfferIds.add(o.id);
  if (!firstNew) return;
  // Title carries the payout (visible even when the banner is collapsed); body says
  // WHERE the job goes — landmark, or the address when there's no landmark — plus
  // the trip distance, so the driver can judge it without opening the app.
  const earn = firstNew.driver_fee_minor ?? firstNew.fee_minor;
  const title = earn != null ? `New delivery · ${formatMoney(earn)}` : 'New delivery offer';
  const dest = notifyPlace(firstNew.dropoff);
  const trip = firstNew.trip_km != null ? `${firstNew.trip_km} km` : null;
  const detail = [dest ? `To: ${dest}` : null, trip].filter(Boolean).join(' · ');
  const body = detail ? `${detail} · expires soon` : 'Expires soon — open to claim.';
  await notifyNewOffer(title, body);
}

/** Record the current offers as already-seen WITHOUT notifying — used when the list
 *  is refreshed in response to a push the driver already received, so the next poll
 *  doesn't fire a duplicate local notification for the same offer. */
export function markOffersSeen(offers: OfferLike[]): void {
  seenOfferIds.clear();
  for (const o of offers) if (o.id) seenOfferIds.add(o.id);
}
