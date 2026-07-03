// Motion engine — the ONE place layout transitions are configured, so no screen
// hand-rolls an animation. Built on RN's built-in LayoutAnimation (zero new dep,
// near-free on low-end Android). Policy: routine, high-frequency steps use `light`
// so a 20-stop run never accumulates friction; a new offer entering earns `loud`.
import { LayoutAnimation, Platform, UIManager, type LayoutAnimationConfig } from 'react-native';
import { duration } from '../theme';
import { prefersReducedMotion } from './reduce-motion';

// Old-arch Android needs LayoutAnimation opted in; no-op on new arch / iOS.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type Intensity = 'light' | 'base' | 'loud';

const PRESETS: Record<Intensity, LayoutAnimationConfig> = {
  // Routine steps: a quick opacity cross-fade. Cheapest possible; reads as "this
  // changed" without a heavy move.
  light: {
    duration: duration.instant,
    create: { type: 'easeInEaseOut', property: 'opacity' },
    update: { type: 'easeInEaseOut' },
    delete: { type: 'easeInEaseOut', property: 'opacity' },
  },
  // Default: scale + fade for card/section swaps (stepper advance, list settle).
  base: {
    duration: duration.base,
    create: { type: 'easeInEaseOut', property: 'scaleXY' },
    update: { type: 'easeInEaseOut' },
    delete: { type: 'easeInEaseOut', property: 'opacity' },
  },
  // Loud: a springy entrance reserved for a new offer arriving on screen.
  loud: {
    duration: duration.slow,
    create: { type: 'spring', property: 'scaleXY', springDamping: 0.7 },
    update: { type: 'spring', springDamping: 0.7 },
    delete: { type: 'easeInEaseOut', property: 'opacity' },
  },
};

// Call IMMEDIATELY before a setState that changes layout (list insert/remove,
// stepper advance, card swap) — the very next render then animates instead of
// popping. This is what makes "no silent screen change" (B3) cheap and universal.
// Under "reduce motion" the change still happens — just instantly, no animation.
export function animateNext(intensity: Intensity = 'base') {
  if (prefersReducedMotion()) return;
  LayoutAnimation.configureNext(PRESETS[intensity]);
}
