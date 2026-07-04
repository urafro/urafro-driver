import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { listMyDeliveries, type HistoryItem } from '../lib/api';
import { dayLabel, money, placeLabel, timeLabel } from '../lib/format';
import { isActiveJob, REASON_LABEL, statusMeta } from '../lib/jobs';
import { useSession } from '../state/session';
import { colors, shadow, typography, space, radius } from '../theme';
import { Text, Skeleton } from '../components/ui';
import { animateNext } from '../lib/motion';
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
      animateNext('base'); // B3: the skeleton settles into the list instead of popping
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
    animateNext('base'); // B3: the list cross-fades to the skeleton, not a silent pop
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
          // Skeleton job cards over a slow 3G link — structure, not a dead spinner.
          <View style={styles.skeletonList}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.card}>
                <Skeleton width={92} height={20} rounded={radius.pill} />
                <Skeleton width="70%" height={16} style={styles.skelGapMd} />
                <Skeleton width="45%" height={12} style={styles.skelGapSm} />
              </View>
            ))}
          </View>
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

// Text styles from the shared type scale (typography.*); spacing/radii from tokens.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingTop: 72, paddingBottom: space.xxxl, gap: space.sm },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.title, fontSize: 24, lineHeight: 30, color: colors.textPrimary },
  earningsLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  earningsLinkText: { ...typography.body, fontWeight: '700', color: colors.textMuted },

  filters: { flexDirection: 'row', gap: space.sm, marginTop: space.xs, marginBottom: space.xs },
  chip: {
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 14, // non-grid literal, kept exact
    backgroundColor: colors.surfaceAlt,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.tabActive },
  chipText: { ...typography.callout, fontWeight: '700', color: colors.textMuted },
  chipTextOn: { color: colors.badgeText },

  empty: { ...typography.body, color: colors.textFaint, marginTop: space.xxl, textAlign: 'center' },

  skeletonList: { gap: space.sm },
  skelGapMd: { marginTop: space.md },
  skelGapSm: { marginTop: space.sm },

  dayHeading: {
    ...typography.label,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.textFaint,
    marginTop: space.md,
    marginBottom: 2,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    ...shadow.card,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: space.xs,
    paddingHorizontal: 10,
    backgroundColor: colors.surfaceAlt,
  },
  badgeText: { ...typography.caption, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  time: { ...typography.caption, color: colors.textFaint, marginLeft: space.sm },

  dropoff: { ...typography.subheading, fontWeight: '700', color: colors.textPrimary, marginTop: space.sm },
  from: { ...typography.callout, color: colors.textMuted, marginTop: 2 },

  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  earn: { ...typography.subheading, fontWeight: '700', color: colors.money },
  reason: { ...typography.subheading, fontWeight: '700', color: colors.danger },
  cancelledNote: { ...typography.subheading, fontWeight: '400', color: colors.textMuted },
  chev: { marginLeft: 'auto' },

  resumeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  resume: { ...typography.body, fontWeight: '700', color: colors.tabActive },

  codBadge: { borderRadius: radius.pill, paddingVertical: space.xs, paddingHorizontal: 10, backgroundColor: colors.batteryBg },
  codBadgeText: { ...typography.caption, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: colors.cod },

  loadMore: {
    minHeight: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    marginTop: space.md,
  },
  loadMoreText: { ...typography.body, fontWeight: '700', color: colors.textMuted },

  error: { ...typography.callout, color: colors.danger, marginTop: space.lg, textAlign: 'center' },
});
