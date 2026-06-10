import { Alert, Linking, Platform } from 'react-native';
import * as Battery from 'expo-battery';
import * as IntentLauncher from 'expo-intent-launcher';
import * as SecureStore from 'expo-secure-store';

const BG_HINT_KEY = 'bg_perm_hint_shown';

// Must match app.json android.package — changing it breaks the install lineage
// anyway, so a constant beats pulling in expo-application for one string.
const ANDROID_PACKAGE = 'com.urafro.driver';

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
 * Is the OS still allowed to pause this app in the background? Aggressive OEM
 * skins — notably Samsung One UI — use battery optimization to freeze
 * backgrounded apps, which can kill the location foreground service and the
 * offer checks mid-shift (the ADR-001 risk). False on iOS and on detection
 * failure (never nag on a guess).
 */
export async function isBatteryOptimizationOn(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return await Battery.isBatteryOptimizationEnabledAsync();
  } catch {
    return false;
  }
}

/**
 * Fire Android's direct "ignore battery optimizations?" dialog for this app
 * (needs REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in the manifest — fine for our
 * sideloaded/EAS-internal distribution; revisit if this ever ships to Play,
 * whose policy restricts the direct dialog). Some OEM builds block the intent —
 * fall back to the app's settings page so the driver always lands somewhere
 * actionable.
 */
export async function requestBatteryExemption(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      { data: `package:${ANDROID_PACKAGE}` },
    );
  } catch {
    Alert.alert(
      'Open battery settings',
      'Set urAfro Driver’s battery usage to "Unrestricted" so deliveries keep coming while your phone is in your pocket.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => void Linking.openSettings() },
      ],
    );
  }
}
