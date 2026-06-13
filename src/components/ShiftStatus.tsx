import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, shadow } from '../theme';

// The shift status badge (replaces the old 12px status dot). An icon sits in a
// tinted disc; ONLINE it broadcasts a pulsing halo — a fading, expanding ring that
// reads as "live, listening for offers". The pulse runs ONLY while online and uses
// the native driver (scale + opacity off the JS thread), so it stays smooth on the
// low-end Android we target and animates nothing once the driver clocks off.
export default function ShiftStatus({ online }: { online: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!online) return;
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1900,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0);
    };
  }, [online, pulse]);

  return (
    <View style={styles.card}>
      <View style={styles.badgeWrap}>
        {online ? (
          <Animated.View
            style={[
              styles.halo,
              {
                opacity: pulse.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.34, 0, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
              },
            ]}
          />
        ) : null}
        <View style={[styles.badge, online ? styles.badgeOn : styles.badgeOff]}>
          <Feather
            name={online ? 'radio' : 'power'}
            size={22}
            color={online ? colors.success : colors.textFaint}
          />
        </View>
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{online ? "You're online" : "You're off shift"}</Text>
        <Text style={styles.msg}>
          {online ? 'Receiving offers near you' : 'Go online to start receiving offers'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    ...shadow.card,
  },
  badgeWrap: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.success,
  },
  badge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  badgeOn: { backgroundColor: colors.successBg },
  badgeOff: { backgroundColor: colors.surfaceAlt },
  body: { flex: 1 },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' },
  msg: { color: colors.textFaint, fontSize: 14, marginTop: 2, lineHeight: 20 },
});
