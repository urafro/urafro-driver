// Loading placeholder — the 3G-market answer to blocking spinners. A gentle
// opacity pulse (native-driver, cheap on low-end Android) that occupies the space
// the real content will fill, so a slow link shows structure, not dead time.
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, space } from '../../theme';
import { useReducedMotion } from '../../lib/reduce-motion';

export type SkeletonProps = {
  width?: DimensionValue;
  height?: number;
  rounded?: number;
  style?: StyleProp<ViewStyle>;
};

export function Skeleton({ width = '100%', height = 14, rounded = radius.sm, style }: SkeletonProps) {
  const pulse = useRef(new Animated.Value(0.45)).current;
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) {
      pulse.setValue(0.7); // static placeholder tone, no pulsing
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: rounded, backgroundColor: colors.hairline, opacity: pulse }, style]}
    />
  );
}

export type SkeletonTextProps = { lines?: number; style?: StyleProp<ViewStyle> };

// A few stacked lines for text blocks; the last line is shorter for realism. Announces
// "Loading" politely (skeletons show no spinner, so a screen-reader user otherwise gets
// no cue that content is on the way over a slow link).
export function SkeletonText({ lines = 3, style }: SkeletonTextProps) {
  return (
    <View
      style={[styles.block, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      accessibilityLiveRegion="polite"
    >
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
});

export default Skeleton;
