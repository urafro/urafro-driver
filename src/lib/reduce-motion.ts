// Reduce-motion signal (WCAG 2.3.3). A driver who turns on the OS "reduce motion"
// setting — common for motion-sensitivity, and used on low-end devices to cut jank
// — should get instant state changes instead of springs/fades/pulses. The non-visual
// salience channels (haptics + audio) are unaffected; only visual motion is dropped.
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

let reduced = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => {
    reduced = v;
  })
  .catch(() => {});
AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
  reduced = v;
});

// Imperative getter for non-React callers (motion.ts, animation start-points).
export function prefersReducedMotion(): boolean {
  return reduced;
}

// Hook for components that must re-render when the setting flips.
export function useReducedMotion(): boolean {
  const [v, setV] = useState(reduced);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((r) => {
        if (mounted) setV(r);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (r) => setV(r));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return v;
}
