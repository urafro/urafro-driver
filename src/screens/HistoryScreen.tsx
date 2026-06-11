import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { listMyDeliveries, type HistoryItem } from '../lib/api';
import { money, placeLabel } from '../lib/format';
import { useSession } from '../state/session';
import { colors, shadow } from '../theme';

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
      <Text style={styles.title}>Your jobs</Text>
      {items == null ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : items.length === 0 ? (
        <Text style={styles.empty}>No jobs yet — they'll show up here after your first run.</Text>
      ) : (
        items.map((d) => {
          const meta = STATUS_META[d.status ?? ''] ?? { label: d.status ?? '?', color: colors.textMuted };
          return (
            <View key={d.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={[styles.status, { color: meta.color }]}>{meta.label}</Text>
                <Text style={styles.date}>
                  {d.updated_at ? new Date(d.updated_at).toLocaleString() : ''}
                </Text>
              </View>
              <Text style={styles.dropoff}>→ {placeLabel(d.dropoff)}</Text>
              <View style={styles.row}>
                {d.status === 'delivered' ? (
                  <Text style={styles.earn}>Earned {money(d.driver_fee_minor)}</Text>
                ) : d.status === 'failed' && d.failure_reason ? (
                  <Text style={styles.reason}>{REASON_LABEL[d.failure_reason] ?? d.failure_reason}</Text>
                ) : (
                  <View />
                )}
                {d.collect_minor ? <Text style={styles.cod}>COD {money(d.collect_minor)}</Text> : null}
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
  content: { padding: 24, paddingTop: 72, paddingBottom: 32 },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: '700', marginBottom: 16 },
  empty: { color: colors.textFaint, fontSize: 15, marginTop: 24, textAlign: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, marginBottom: 12, ...shadow.card },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  status: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  date: { color: colors.textFaint, fontSize: 12 },
  dropoff: { color: colors.textPrimary, fontSize: 16, marginTop: 8 },
  earn: { color: colors.money, fontSize: 14, fontWeight: '600', marginTop: 8 },
  reason: { color: colors.danger, fontSize: 13, marginTop: 8 },
  cod: { color: colors.cod, fontSize: 13, marginTop: 8 },
  error: { color: colors.danger, fontSize: 14, marginTop: 16, textAlign: 'center' },
});
