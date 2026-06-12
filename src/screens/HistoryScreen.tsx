import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { listMyDeliveries, type HistoryItem } from '../lib/api';
import { money, placeLabel } from '../lib/format';
import { useSession } from '../state/session';
import { colors, PILL, shadow } from '../theme';

// Recent jobs (ADR-002 B): what a driver actually did and earned, newest first.
// Server-shaped: no customer contacts on past jobs (stale PII stays server-side).

const STATUS_META: Record<string, { label: string; color: string }> = {
  delivered: { label: 'Delivered', color: colors.success },
  failed: { label: 'Failed', color: colors.danger },
  cancelled: { label: 'Cancelled', color: colors.textMuted },
  assigned: { label: 'In progress', color: colors.info },
  picked_up: { label: 'In progress', color: colors.info },
  in_transit: { label: 'In progress', color: colors.info },
};

const REASON_LABEL: Record<string, string> = {
  customer_unreachable: 'Customer unreachable',
  wrong_address: 'Wrong address',
  customer_refused: 'Customer refused',
  cash_refused: "Couldn't collect cash",
  vehicle_problem: 'Vehicle problem',
  other: 'Other',
};

export default function HistoryScreen() {
  const { session } = useSession();
  const token = session?.token ?? '';
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const { data } = await listMyDeliveries(token);
      setItems(data ?? []);
    } catch {
      setError('Could not load your jobs — pull to retry.');
      setItems((prev) => prev ?? []);
    }
  }, [token]);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textPrimary} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Your jobs</Text>
        <Text style={styles.subtitle}>Last 20</Text>
      </View>

      {items == null ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : items.length === 0 ? (
        <Text style={styles.empty}>No jobs yet — they'll show up here after your first run.</Text>
      ) : (
        items.map((d) => {
          const meta = STATUS_META[d.status ?? ''] ?? { label: d.status ?? '?', color: colors.textMuted };
          return (
            <View key={d.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={[styles.badge, { borderColor: meta.color }]}>
                  <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                </View>
                <Text style={styles.date}>
                  {d.updated_at ? new Date(d.updated_at).toLocaleString() : ''}
                </Text>
              </View>

              <Text style={styles.dropoff}>{placeLabel(d.dropoff)}</Text>

              <View style={styles.metaRow}>
                {d.status === 'delivered' ? (
                  <Text style={styles.earn}>Earned {money(d.driver_fee_minor)}</Text>
                ) : d.status === 'failed' && d.failure_reason ? (
                  <Text style={styles.reason}>{REASON_LABEL[d.failure_reason] ?? d.failure_reason}</Text>
                ) : d.status === 'cancelled' ? (
                  <Text style={styles.cancelledNote}>Cancelled by merchant</Text>
                ) : null}
                {d.collect_minor ? (
                  <View style={styles.codBadge}>
                    <Text style={styles.codBadgeText}>COD {money(d.collect_minor)}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingTop: 72, paddingBottom: 32, gap: 8 },
  header: { marginBottom: 8 },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 14, marginTop: 2 },
  empty: { color: colors.textFaint, fontSize: 15, marginTop: 24, textAlign: 'center' },

  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, ...shadow.card },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: PILL,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: colors.surfaceAlt,
  },
  badgeText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },

  date: { color: colors.textFaint, fontSize: 12, marginLeft: 8, flexShrink: 1, textAlign: 'right' },

  dropoff: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', lineHeight: 22, marginTop: 8 },

  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  earn: { color: colors.money, fontSize: 16, fontWeight: '700' },
  reason: { color: colors.danger, fontSize: 16, fontWeight: '700' },
  cancelledNote: { color: colors.textMuted, fontSize: 16 },

  codBadge: {
    borderRadius: PILL,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: colors.batteryBg,
  },
  codBadgeText: { color: colors.cod, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },

  error: { color: colors.danger, fontSize: 14, marginTop: 16, textAlign: 'center' },
});
