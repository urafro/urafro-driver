import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { registerPushToken } from './api';

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
export async function notifyNewOffer(body: string): Promise<void> {
  try {
    await ensureNotificationChannel();
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await Notifications.scheduleNotificationAsync({
      content: { title: 'New delivery offer', body, sound: 'default' },
      trigger: Platform.OS === 'android' ? { channelId: OFFERS_CHANNEL } : null,
    });
  } catch {
    // notifications are advisory — never let them break the shift loop
  }
}
