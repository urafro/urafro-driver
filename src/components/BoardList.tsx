import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { BoardJob } from '../lib/api';
import { money } from '../lib/format';
import { colors, shadow, PILL } from '../theme';

// H2 — the open job board ("Available" tab), phase 1: a BROWSE view of nearby demand.
// Coarse cards (the driver's cut / distance / COD y/n) — NO address/contact (revealed
// only on claim) and NO countdown (a board job isn't a time-boxed offer). This is
// read-only for now: grabbing an un-offered board job needs a server self-assign path
// that re-checks COD + capacity under the claim lock (a money-path slice, tracked
// separately). Until then the board tells a driver WHERE the work is so they stay
// online / reposition; a job that fits them is still pushed to the Offers tab.
export default function BoardList({ board }: { board: BoardJob[] | null }) {
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
  return (
    <View style={styles.list}>
      <Text style={styles.caption}>Nearby demand — jobs that fit you arrive on the Offers tab.</Text>
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
  checkingCard: { marginTop: 24, alignItems: 'center', gap: 12, padding: 24 },
  checkingText: { color: colors.textFaint, fontSize: 15, fontWeight: '600' },
  emptyCard: { marginTop: 24, backgroundColor: colors.surface, borderRadius: 20, padding: 24, gap: 8, ...shadow.card },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  emptyBody: { color: colors.textMuted, fontSize: 15, fontWeight: '500' },
});
