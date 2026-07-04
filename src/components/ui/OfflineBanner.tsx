// Authoritative offline / queued banner. Before the connectivity signal existed,
// offline could only be inferred from a failed fetch, so nothing could honestly
// tell the driver "you're offline — your taps are saved and will send." This is
// that honest, non-blocking status line. It animates its own height so it never
// pops content (B3) and collapses to zero when there is nothing to say.
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, iconSize, space } from '../../theme';
import Text from './Text';
import { useConnectivity } from '../../hooks/useConnectivity';
import { useReducedMotion } from '../../lib/reduce-motion';

const BANNER_H = 30;

export type OfflineBannerProps = { queued?: number };

// `queued` = count of actions waiting in the offline queue (fed in Phase 2). The
// banner shows when offline OR when there is pending work to sync.
export function OfflineBanner({ queued = 0 }: OfflineBannerProps) {
  const { online, cellularGeneration } = useConnectivity();
  const reduce = useReducedMotion();
  const show = !online || queued > 0;
  const anim = useRef(new Animated.Value(show ? 1 : 0)).current;

  // Height (not transform) so the banner PUSHES content down rather than covering
  // it — a deliberate non-native-driver choice: connectivity flips are infrequent
  // (not per-frame), so the layout-thread cost is acceptable for correct push chrome.
  useEffect(() => {
    if (reduce) {
      anim.setValue(show ? 1 : 0);
      return;
    }
    Animated.timing(anim, { toValue: show ? 1 : 0, duration: 240, useNativeDriver: false }).start();
  }, [show, anim, reduce]);

  const offline = !online;
  // Any generation below 4g reads as "slow" (covers 2g/3g plus netinfo's 'slow-2g').
  const slow = cellularGeneration != null && cellularGeneration !== '4g' && cellularGeneration !== '5g';
  // The online branch fires whenever there's queued work AND a link — which includes
  // a transient 5xx that queued a tap while the driver never actually went offline. So
  // it says "Syncing…", not "Back online…" (which would wrongly assert a reconnect).
  const message = offline
    ? queued > 0
      ? `Offline — ${queued} action${queued > 1 ? 's' : ''} saved, will send when you reconnect`
      : 'Offline — your taps are saved and will send when you reconnect'
    : `Syncing ${queued} action${queued > 1 ? 's' : ''}${slow ? ' (slow link)' : ''}…`;

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      // When collapsed the row stays mounted for the exit animation, so keep its
      // (now false/stale) status out of the a11y tree until it is actually shown.
      accessibilityElementsHidden={!show}
      importantForAccessibility={show ? 'auto' : 'no-hide-descendants'}
      pointerEvents={show ? 'auto' : 'none'}
      style={[
        styles.wrap,
        {
          height: anim.interpolate({ inputRange: [0, 1], outputRange: [0, BANNER_H] }),
          opacity: anim,
          backgroundColor: offline ? colors.batteryBg : colors.successBg,
        },
      ]}
    >
      <View style={styles.row}>
        <Feather
          name={offline ? 'wifi-off' : 'refresh-cw'}
          size={iconSize.sm}
          color={offline ? colors.warning : colors.success}
        />
        <Text variant="caption" color="textSecondary" numberOfLines={1} style={styles.msg}>
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, height: BANNER_H },
  msg: { flex: 1 },
});

export default OfflineBanner;
