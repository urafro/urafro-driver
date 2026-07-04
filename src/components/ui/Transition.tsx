// Content-swap transition — wrap a region whose content changes and pass the
// identity of that content as `trigger`. When `trigger` changes, the old content
// cross-fades out and the new fades in, so a swap is never a silent pop (B3).
//
// Policy: `light` (default) is a fast opacity fade for routine, high-frequency
// steps so a 20-stop run never accumulates friction; `loud` is slower with a
// visible scale-up, reserved for a heavier arrival (matches the motion.ts "loud"
// intent). Built on RN Animated (native driver, no dep). Honours reduce-motion.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import { duration } from '../../theme';
import { useReducedMotion } from '../../lib/reduce-motion';

export type TransitionIntensity = 'light' | 'loud';
const OUT: Record<TransitionIntensity, number> = { light: duration.instant, loud: duration.fast };
const IN: Record<TransitionIntensity, number> = { light: duration.fast, loud: duration.slow };
const SCALE_FROM: Record<TransitionIntensity, number> = { light: 1, loud: 0.9 };

export type TransitionProps = {
  trigger: string | number;
  intensity?: TransitionIntensity;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function Transition({ trigger, intensity = 'light', children, style }: TransitionProps) {
  const anim = useRef(new Animated.Value(1)).current;
  const [shown, setShown] = useState<ReactNode>(children);
  // Keep the freshest children without re-triggering the effect on every render —
  // the swap always renders the LATEST children, only `trigger` drives the animation.
  const childrenRef = useRef<ReactNode>(children);
  childrenRef.current = children;
  const first = useRef(true);
  const mounted = useRef(true);
  const reduce = useReducedMotion();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      anim.stopAnimation();
    };
  }, [anim]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduce) {
      setShown(childrenRef.current); // snap, no motion
      anim.setValue(1);
      return;
    }
    Animated.timing(anim, { toValue: 0, duration: OUT[intensity], useNativeDriver: true }).start(({ finished }) => {
      if (!finished || !mounted.current) return;
      setShown(childrenRef.current);
      Animated.timing(anim, { toValue: 1, duration: IN[intensity], useNativeDriver: true }).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const transform =
    intensity === 'loud'
      ? [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [SCALE_FROM.loud, 1] }) }]
      : [];

  return <Animated.View style={[{ opacity: anim, transform }, style]}>{shown}</Animated.View>;
}

export default Transition;
