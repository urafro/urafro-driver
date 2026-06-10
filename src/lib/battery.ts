import { Alert, Linking, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const SHOWN_KEY = 'battery_hint_shown';
const BG_HINT_KEY = 'bg_perm_hint_shown';

/**
 * One-time interstitial BEFORE the background-location permission flow: Android
 * 11+ can't grant "Allow all the time" from the in-app dialog, so without context
 * drivers pick "While using" and silently lose background GPS. Resolves when
 * dismissed so the caller can sequence the real prompt after it.
 */
export async function maybeExplainBackgroundPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if (await SecureStore.getItemAsync(BG_HINT_KEY)) return;
    await SecureStore.setItemAsync(BG_HINT_KEY, '1');
  } catch {
    return;
  }
  await new Promise<void>((resolve) => {
    Alert.alert(
      'Location while on shift',
      'Next, set location to "Allow all the time" so you keep receiving deliveries while your phone is locked. If you only see "While using the app", you can change it any time in Settings.',
      [{ text: 'Got it', onPress: () => resolve() }],
      { cancelable: false },
    );
  });
}

/**
 * One-time nudge (Android only) to exclude the app from battery optimization.
 * Aggressive OEM skins — notably Samsung One UI — pause backgrounded apps, which can
 * kill the location foreground service mid-delivery (the ADR-001 risk). We can't
 * reliably toggle the exemption programmatically across OEMs, so we explain it and
 * deep-link to the app's settings. Shown at most once per install (flag in SecureStore).
 */
export async function maybePromptBatteryExemption(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if (await SecureStore.getItemAsync(SHOWN_KEY)) return;
    await SecureStore.setItemAsync(SHOWN_KEY, '1');
  } catch {
    return; // storage unavailable — skip the nudge rather than risk re-prompting
  }
  Alert.alert(
    'Keep tracking reliable',
    'Some phones pause apps in the background to save battery, which can stop sharing your location during a delivery. For reliable tracking, set urAfro Driver’s battery usage to "Unrestricted".',
    [
      { text: 'Later', style: 'cancel' },
      { text: 'Open settings', onPress: () => void Linking.openSettings() },
    ],
  );
}
