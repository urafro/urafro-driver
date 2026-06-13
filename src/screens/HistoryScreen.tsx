import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { listMyDeliveries, type HistoryItem } from '../lib/api';
import { dayLabel, money, placeLabel, timeLabel } from '../lib/format';
import { isActiveJob, REASON_LABEL, statusMeta } from '../lib/jobs';
import { useSession } from '../state/session';
import { colors, PILL, shadow } from '../theme';
import JobDetail from '../components/JobDetail';

// The Jobs tab: the driver's run history — what they did, where, the outcome, and
// what they earned. The record / proof-of-work, NOT an action surface: a mid-flight
// job routes back to Shift to act; a finished one opens a read-only detail. Money
// totals live in Earnings (one source of truth) — here we show only per-run facts.

const PAGE = 20;
const FILTERS: { key: 'all' | 'delivered' | 'failed'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'failed', label: 'Failed' },
];

export default function HistoryScreen({
  onOpenShift,
  onOpenEarnings,
}: {
  onOpenShift: () => void;
  onOpenEarnings: () => void;
}) {
  const { session } = useSession();
  const token = session?.token ?? '';

  const [filter, setFilter] = useState<'all' | 'delivered' | 'failed'>('all');
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<HistoryItem | null>(null);

  const statusParam = filter === 'all' ? undefined : filter;

  // A monotonic request generation: every fresh load bumps it, and any response
  // (first page OR load-more) only applies if its generation is still current. This
  // drops a slow response from a filter the driver has since switched away from —
  // otherwise a late "all" page could overwrite or append onto the "delivered" view.
  const reqGen = useRef(0);

  const load = useCallback(async () => {
    const gen = ++reqGen.current;
    try {
      setError(null);
      const { data, next_before } = await listMyDeliveries(token, { limit: PAGE, status: statusParam });
      if (gen !== reqGen.current) return; // superseded by a newer filter/refresh
      setItems(data ?? []);
      setNextBefore(next_before);
    } catch {
      if (gen !== reqGen.current) return;
      setError('Could not load your jobs — pull to retry.');
      setItems((prev) => prev ?? []);
    }
  }, [token, statusParam]);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!nextBefore || loadingMore) return;
    const gen = reqGen.current; // tie this page to the load generation it extends
    setLoadingMore(true);
    try {
      const { data, next_before } = await listMyDeliveries(token, {
        limit: PAGE,
        before: nextBefore,
        status: statusParam,
      });
      if (gen !== reqGen.current) return; // a filter change/refresh superseded this page — drop it
      setItems((prev) => [...(prev ?? []), ...(data ?? [])]);
      setNextBefore(next_before);
    } catch {
      if (gen === reqGen.current) setError('Could not load more — try again.');
    } finally {
      setLoadingMore(false);
    }
  }, [token, nextBefore, loadingMore, statusParam]);

  const changeFilter = (f: 'all' | 'delivered' | 'failed') => {
    if (f === filter) return;
    setItems(null); // show the loading state while the new filter fetches
    setNextBefore(null);
    setFilter(f);
  };

  let lastDay = '';

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textPrimary} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Your jobs</Text>
          <Pressable style={styles.earningsLink} onPress={onOpenEarnings} hitSlop={6}>
            <Text style={styles.earningsLinkText}>Earnings</Text>
            <Feather name="chevron-right" size={16} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Filter chips */}
        <View style={styles.filters}>
          {FILTERS.map((f) => {
            const on = f.key === filter;
            return (
              <Pressable
                key={f.key}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => changeFilter(f.key)}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {items == null ? (
          <Text style={styles.empty}>Loading…</Text>
        ) : items.length === 0 ? (
          <Text style={styles.empty}>
            {filter === 'all'
              ? "No jobs yet — they'll show up here after your first run."
              : `No ${filter} jobs.`}
          </Text>
        ) : (
          items.map((d, i) => {
            const id = d.id ?? `row-${i}`;
            const meta = statusMeta(d.status);
            const active = isActiveJob(d.status);
            const when = d.delivered_at ?? d.updated_at;
            const day = dayLabel(when);
            const showDay = day !== lastDay;
            lastDay = day;
            const pickup = placeLabel(d.pickup);
            return (
              <Fragment key={id}>
                {showDay ? <Text style={styles.dayHeading}>{day}</Text> : null}
                <Pressable
                  style={styles.card}
                  onPress={() => (active ? onOpenShift() : setSelected(d))}
                >
                  <View style={styles.cardTop}>
                    <View style={[styles.badge, { borderColor: meta.color }]}>
                      <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                    <Text style={styles.time}>{timeLabel(when)}</Text>
                  </View>

                  <Text style={styles.dropoff} numberOfLines={1}>
                    {placeLabel(d.dropoff)}
                  </Text>
                  <Text style={styles.from} numberOfLines={1}>
                    from {pickup}
                    {d.trip_km != null ? ` · ${d.trip_km} km` : ''}
                  </Text>

                  {active ? (
                    <View style={styles.resumeRow}>
                      <Text style={styles.resume}>Tap to resume on Shift</Text>
                      <Feather name="arrow-right" size={16} color={colors.tabActive} />
                    </View>
                  ) : (
                    <View style={styles.metaRow}>
                      {d.status === 'delivered' ? (
                        <Text style={styles.earn}>Earned {money(d.driver_fee_minor)}</Text>
                      ) : d.status === 'failed' ? (
                        <Text style={styles.reason}>
                          {REASON_LABEL[d.failure_reason ?? ''] ?? d.failure_reason ?? 'Not completed'}
                        </Text>
                      ) : d.status === 'cancelled' ? (
                        <Text style={styles.cancelledNote}>Cancelled by merchant</Text>
                      ) : null}
                      {d.collect_minor ? (
                        <View style={styles.codBadge}>
                          <Text style={styles.codBadgeText}>COD {money(d.collect_minor)}</Text>
                        </View>
                      ) : null}
                      <Feather name="chevron-right" size={18} color={colors.textFaint} style={styles.chev} />
                    </View>
                  )}
                </Pressable>
              </Fragment>
            );
          })
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {nextBefore ? (
          <Pressable style={styles.loadMore} onPress={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? (
              <ActivityIndicator color={colors.textMuted} />
            ) : (
              <Text style={styles.loadMoreText}>Load older jobs</Text>
            )}
          </Pressable>
        ) : null}
      </ScrollView>

      {selected ? (
        <JobDetail item={selected} onClose={() => setSelected(null)} onOpenEarnings={onOpenEarnings} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingTop: 72, paddingBottom: 32, gap: 8 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '700' },
  earningsLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  earningsLinkText: { color: colors.textMuted, fontSize: 15, fontWeight: '700' },

  filters: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 4 },
  chip: {
    borderRadius: PILL,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: colors.surfaceAlt,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.tabActive },
  chipText: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: colors.badgeText },

  empty: { color: colors.textFaint, fontSize: 15, marginTop: 24, textAlign: 'center' },

  dayHeading: {
    color: colors.textFaint,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 2,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    ...shadow.card,
  },
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
  time: { color: colors.textFaint, fontSize: 12, marginLeft: 8 },

  dropoff: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', lineHeight: 22, marginTop: 8 },
  from: { color: colors.textMuted, fontSize: 14, marginTop: 2 },

  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  earn: { color: colors.money, fontSize: 16, fontWeight: '700' },
  reason: { color: colors.danger, fontSize: 16, fontWeight: '700' },
  cancelledNote: { color: colors.textMuted, fontSize: 16 },
  chev: { marginLeft: 'auto' },

  resumeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  resume: { color: colors.tabActive, fontSize: 15, fontWeight: '700' },

  codBadge: { borderRadius: PILL, paddingVertical: 4, paddingHorizontal: 10, backgroundColor: colors.batteryBg },
  codBadgeText: { color: colors.cod, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },

  loadMore: {
    minHeight: 48,
    borderRadius: PILL,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    marginTop: 12,
  },
  loadMoreText: { color: colors.textMuted, fontSize: 15, fontWeight: '700' },

  error: { color: colors.danger, fontSize: 14, marginTop: 16, textAlign: 'center' },
});
