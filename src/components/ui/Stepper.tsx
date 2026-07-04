// Persistent run stepper (B2). Answers the driver's two constant questions at a
// glance: "where am I in this run?" ("Stop 2 of 5") and "how far to the end?"
// (the animated fill). Works for a single job's lifecycle phases OR a multi-stop
// pooled run — the pooled run must NOT hide progress exactly when it is most
// complex, which is what the old app did.
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors, duration, radius, space } from '../../theme';
import Text from './Text';
import { useReducedMotion } from '../../lib/reduce-motion';

export type StepperProps = {
  /** 1-based position of the current step (0 = not started, total = finished). */
  current: number;
  total: number;
  /** Noun for the counter — "Stop", "Step". Renders "Stop 2 of 5". */
  label?: string;
  /** Optional line under the counter — e.g. the current action ("Pick up from Kwik Mart"). */
  sublabel?: string;
  /** Optional per-segment labels (phase mode, e.g. Claimed / Picked up / …). */
  steps?: { key: string; label: string }[];
};

const TRACK_H = 8;

export function Stepper({ current, total, label = 'Step', sublabel, steps }: StepperProps) {
  const safeTotal = Math.max(1, total);
  const clamped = Math.max(0, Math.min(current, safeTotal));
  const pct = clamped / safeTotal;
  // scaleX (0..1) is native-driver-eligible, so the advance runs off the JS thread
  // and stays smooth even while a 3G callback or re-render is busy — unlike an
  // animated width, which would jank on the exact high-frequency action B2 must keep light.
  const sx = useRef(new Animated.Value(pct)).current;
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) {
      sx.setValue(pct);
      return;
    }
    Animated.timing(sx, { toValue: pct, duration: duration.base, useNativeDriver: true }).start();
  }, [pct, sx, reduce]);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: safeTotal, now: clamped, text: `${label} ${clamped} of ${safeTotal}` }}
    >
      <View style={styles.head}>
        <Text variant="label" color="textMuted">
          {label} {clamped} of {safeTotal}
        </Text>
        {sublabel ? (
          <Text variant="caption" color="textFaint" numberOfLines={1} style={styles.sublabel}>
            {sublabel}
          </Text>
        ) : null}
      </View>

      <View style={styles.track}>
        <Animated.View style={[styles.fill, { transform: [{ scaleX: sx }] }]} />
        {/* discrete segment ticks so it also reads as "X of Y", not just a bar */}
        {safeTotal > 1 &&
          Array.from({ length: safeTotal - 1 }).map((_, i) => (
            <View key={i} style={[styles.tick, { left: `${((i + 1) / safeTotal) * 100}%` }]} />
          ))}
      </View>

      {steps ? (
        <View style={styles.labels}>
          {steps.map((s, i) => (
            <Text
              key={s.key}
              variant="micro"
              color={i < clamped ? 'textSecondary' : 'textFaint'}
              numberOfLines={1}
              style={styles.stepLabel}
            >
              {s.label}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm, marginBottom: space.sm },
  sublabel: { flexShrink: 1, textAlign: 'right' },
  track: {
    height: TRACK_H,
    borderRadius: radius.sm,
    backgroundColor: colors.hairline,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '100%',
    backgroundColor: colors.success,
    borderRadius: radius.sm,
    transformOrigin: 'left',
  },
  tick: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.surface },
  labels: { flexDirection: 'row', marginTop: space.xs },
  stepLabel: { flex: 1, textAlign: 'center' },
});

export default Stepper;
