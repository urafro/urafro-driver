import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { BoardJob } from '../lib/api';
import { money } from '../lib/format';
import { colors, shadow, PILL } from '../theme';

// H2 + board grab (issue 170) — the open job board ("Available" tab). Coarse cards (the
// driver's cut / distance / COD y/n) — NO address/contact (revealed only on GRAB). Grab
// claims an un-offered board job via the server self-assign path (grabFromBoard re-checks
// verification + capacity + the COD cap under lock). A job that fits a driver is also
// still pushed to the Offers tab.
export default function BoardList({
  board,
  onGrab,
  grabbingId,
}: {
  board: BoardJob[] | null;
  onGrab: (id: string) => void;
  grabbingId: string | null;
}) {
  if (board === null) {
    return (
      <View style={styles.checkingCard}>
        <ActivityIndicator color={colors.textFaint} />
        <Text style={styles.checkingText}>Loading the board…</Text>
      </View>
    );
  }
  if (board.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>No open jobs right now</Text>
        <Text style={styles.emptyBody}>Switch back to Offers — jobs that fit you are pushed there.</Text>
      </View>
    );
  }
  const grabbing = grabbingId != null;
  return (
    <View style={styles.list}>
      <Text style={styles.caption}>Grab an open job, or wait — jobs that fit you also arrive on Offers.</Text>
      {board.map((job) => {
        const km = job.pickup_distance_km != null ? `${job.pickup_distance_km} km to pickup` : 'Distance unknown';
        return (
          <View key={job.delivery_id} style={styles.card}>
            <View style={styles.headRow}>
              <Text style={styles.payout}>{money(job.driver_fee_minor)}</Text>
              {job.cod ? (
                <View style={styles.codChip}>
                  <Text style={styles.codText}>Cash job</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.metaRow}>
              <Feather name="map-pin" size={14} color={colors.textMuted} />
              <Text style={styles.pickup}>{km}</Text>
            </View>
            <Pressable
              style={[styles.grab, grabbing && styles.disabled]}
              onPress={() => onGrab(job.delivery_id)}
              disabled={grabbing}
            >
              <Text style={styles.grabText}>
                {grabbingId === job.delivery_id ? 'Grabbing…' : `Grab — ${money(job.driver_fee_minor)}`}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 24, gap: 16 },
  caption: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, gap: 10, ...shadow.card },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  payout: { color: colors.textPrimary, fontSize: 26, fontWeight: '800' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pickup: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  codChip: { backgroundColor: colors.batteryBg, borderRadius: PILL, paddingHorizontal: 12, paddingVertical: 4 },
  codText: { color: colors.cod, fontSize: 13, fontWeight: '700' },
  grab: {
    marginTop: 4,
    backgroundColor: colors.btnPrimaryBg,
    borderRadius: PILL,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  grabText: { color: colors.btnPrimaryText, fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  checkingCard: { marginTop: 24, alignItems: 'center', gap: 12, padding: 24 },
  checkingText: { color: colors.textFaint, fontSize: 15, fontWeight: '600' },
  emptyCard: { marginTop: 24, backgroundColor: colors.surface, borderRadius: 20, padding: 24, gap: 8, ...shadow.card },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  emptyBody: { color: colors.textMuted, fontSize: 15, fontWeight: '500' },
});
