import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { getEarnings, type Earnings } from '../lib/api';
import { money } from '../lib/format';
import { useSession } from '../state/session';
import { colors, shadow, PILL } from '../theme';
import PayoutScreen from './PayoutScreen';

// A dedicated earnings view (the prototype's Earnings tab). The numbers are the
// real GET /driver/earnings; the 7-day bars are illustrative — there's no
// earnings-history endpoint yet, so they're seeded relative to today's real
// total and labelled as a sample (not invented money the ledger doesn't have).
export default function EarningsScreen() {
  const { session } = useSession();
  const token = session?.token ?? '';
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  // Cash-out lives under the Earnings tab (no nav lib — the prototype groups it
  // here too); a local toggle swaps the dedicated Payout screen in and out.
  const [showPayout, setShowPayout] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void getEarnings(token)
      .then(e => {
        if (!cancelled) setEarnings(e);
      })
      .catch(() => {
        // non-critical — the screen renders dashes until it loads
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const todayMinor = earnings?.today_minor ?? 0;
  // Sample week ending on today's real total (no history endpoint — see label).
  const week = [
    { d: 'F', minor: 980 },
    { d: 'Sa', minor: 1240 },
    { d: 'Su', minor: 1620 },
    { d: 'M', minor: 860 },
    { d: 'Tu', minor: 1890 },
    { d: 'W', minor: 1130 },
    { d: 'Th', minor: todayMinor, today: true },
  ];
  const max = Math.max(1, ...week.map(w => w.minor));

  if (showPayout) {
    return <PayoutScreen token={token} earnings={earnings} onBack={() => setShowPayout(false)} />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Earnings</Text>
      <Text style={styles.subtitle}>All amounts in USD</Text>

      <View style={styles.card}>
        <Text style={styles.eyebrow}>Available</Text>
        <Text style={styles.hero}>{money(earnings?.payable_minor ?? null)}</Text>
        <Text style={styles.muted}>Owed to you, all time · paid out to your EcoCash</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardLabel}>Today</Text>
          <Text style={styles.cardValue}>{money(todayMinor)}</Text>
        </View>
        <Text style={styles.muted}>
          {earnings?.today_deliveries ?? 0} deliver
          {(earnings?.today_deliveries ?? 0) === 1 ? 'y' : 'ies'} · added to your balance after
          ops checks the day
        </Text>
      </View>

      {earnings && earnings.cod_owed_minor > 0 ? (
        <View style={[styles.card, styles.codCard]}>
          <Text style={styles.codTitle}>Cash to hand in: {money(earnings.cod_owed_minor)}</Text>
          <Text style={styles.muted}>
            COD cash you collected for merchants — hand it to ops at shift end. Separate from
            your earnings.
          </Text>
        </View>
      ) : null}

      {/* Illustrative weekly chart. There is no earnings-history endpoint yet, so the
          prior days are NOT real — to stay honest we show NO dollar figures on them
          and badge the card SAMPLE; only the day letters + relative bars hint at the
          shape of the real chart to come. */}
      <View style={styles.card}>
        <View style={styles.chartHead}>
          <Text style={styles.cardLabel}>Last 7 days</Text>
          <View style={styles.sampleBadge}>
            <Text style={styles.sampleBadgeText}>SAMPLE</Text>
          </View>
        </View>
        <View style={styles.chart}>
          {week.map(w => (
            <View key={w.d} style={styles.barCol}>
              <View
                style={[
                  styles.bar,
                  { height: Math.max(6, (w.minor / max) * 96) },
                  w.today ? styles.barToday : styles.barOther,
                ]}
              />
              <Text style={[styles.barDay, w.today && styles.barDayToday]}>{w.d}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.sampleNote}>
          An example of how your week will look — real daily earnings appear here once history
          tracking lands.
        </Text>
      </View>

      <Pressable style={styles.payoutCard} onPress={() => setShowPayout(true)}>
        <View style={styles.payoutText}>
          <Text style={styles.eyebrow}>Cash out to EcoCash</Text>
          <Text style={styles.muted}>
            See your balance, where it&apos;s paid, and how payouts work during the pilot.
          </Text>
        </View>
        <Feather name="chevron-right" size={22} color={colors.textFaint} />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, paddingTop: 72, paddingBottom: 32 },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: '700' },
  subtitle: { color: colors.textFaint, fontSize: 14, marginTop: 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    ...shadow.card,
  },
  eyebrow: {
    color: colors.tabActive,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  hero: { color: colors.money, fontSize: 32, fontWeight: '700', marginTop: 4 },
  muted: { color: colors.textFaint, fontSize: 14, marginTop: 6, lineHeight: 20 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cardLabel: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  cardValue: { color: colors.money, fontSize: 20, fontWeight: '700' },
  codCard: { backgroundColor: colors.batteryBg },
  codTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  chartHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sampleBadge: { backgroundColor: colors.surfaceAlt, borderRadius: PILL, paddingHorizontal: 10, paddingVertical: 3 },
  sampleBadgeText: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 120, marginTop: 16 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barValue: { color: colors.textFaint, fontSize: 11 },
  barValueToday: { color: colors.textPrimary, fontWeight: '700' },
  bar: { width: '100%', borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  barToday: { backgroundColor: colors.tabActive },
  barOther: { backgroundColor: colors.btnPrimaryBg },
  barDay: { color: colors.textFaint, fontSize: 11 },
  barDayToday: { color: colors.tabActive, fontWeight: '700' },
  sampleNote: { color: colors.textFaint, fontSize: 12, marginTop: 12 },
  payoutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    ...shadow.card,
  },
  payoutText: { flex: 1 },
});
