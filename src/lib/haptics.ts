// Haptic feedback engine (expo-haptics). Semantic, not raw buzzes: each call maps
// to a meaning (tap / success / warning / error / new-offer) so the whole app
// speaks one tactile language. EVERY call is best-effort and NEVER throws — a
// device with no vibrator, or a denied capability, must not break a lifecycle
// action. On low-end Androids that only expose coarse vibration, expo-haptics
// degrades to a basic buzz automatically.
import * as Haptics from 'expo-haptics';
import { HAPTICS_ENABLED } from '../config';

let enabled = HAPTICS_ENABLED;

// Runtime mute (Phase-2 driver setting). Build-time default from config.
export function setHapticsEnabled(v: boolean) {
  enabled = v;
}

async function safe(fn: () => Promise<unknown>) {
  if (!enabled) return;
  try {
    await fn();
  } catch {
    // haptics are advisory — swallow (no vibrator / unsupported / denied)
  }
}

export const haptics = {
  // Light selection tick — routine step advance, toggle.
  tap: () => safe(() => Haptics.selectionAsync()),
  // Positive completion — order collected/delivered, saved.
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  // Attention, non-fatal — pending sync, retry queued.
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  // Failure — action rejected, hard error.
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  // A distinct heavy double-pulse reserved for a NEW OFFER — deliberately unlike
  // any routine ack so the driver feels "offer" without looking (B1's tactile half).
  offer: () =>
    safe(async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await new Promise((r) => setTimeout(r, 140));
      if (!enabled) return; // honour a runtime mute toggled during the pulse gap
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }),
};
