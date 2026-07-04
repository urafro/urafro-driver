import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { getEarnings, type Earnings } from '../lib/api';
import { money } from '../lib/format';
import { useSession } from '../state/session';
import { colors, shadow, typography, space, radius } from '../theme';
import { Text } from '../components/ui';
import { animateNext } from '../lib/motion';
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
    return (
      <PayoutScreen
        token={token}
        earnings={earnings}
        onBack={() => {
          animateNext('base');
          setShowPayout(false);
        }}
      />
    );
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

      <Pressable
        style={styles.payoutCard}
        onPress={() => {
          animateNext('base');
          setShowPayout(true);
        }}
      >
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

// Text styles built from the shared type scale (typography.*); spacing/radii from
// the space/radius tokens. Variants carry their own lineHeight so the money heroes
// render correctly through the <Text> primitive.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.xxl, paddingTop: 72, paddingBottom: space.xxxl },
  title: { ...typography.display, color: colors.textPrimary },
  subtitle: { ...typography.callout, color: colors.textFaint, marginTop: 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.lg,
    marginTop: space.lg,
    ...shadow.card,
  },
  eyebrow: {
    ...typography.caption,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.tabActive,
  },
  hero: { ...typography.display, fontSize: 32, lineHeight: 38, color: colors.money, marginTop: space.xs },
  muted: { ...typography.callout, color: colors.textFaint, marginTop: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cardLabel: { ...typography.subheading, fontWeight: '700', color: colors.textPrimary },
  cardValue: { ...typography.heading, fontSize: 20, lineHeight: 26, color: colors.money },
  codCard: { backgroundColor: colors.batteryBg },
  codTitle: { ...typography.subheading, fontWeight: '700', color: colors.textPrimary },
  chartHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sampleBadge: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  sampleBadgeText: { ...typography.micro, letterSpacing: 0.6, color: colors.textMuted },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, height: 120, marginTop: space.lg },
  barCol: { flex: 1, alignItems: 'center', gap: space.xs },
  bar: { width: '100%', borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  barToday: { backgroundColor: colors.tabActive },
  barOther: { backgroundColor: colors.btnPrimaryBg },
  barDay: { ...typography.caption, fontSize: 11, lineHeight: 14, color: colors.textFaint },
  barDayToday: { color: colors.tabActive, fontWeight: '700' },
  sampleNote: { ...typography.caption, color: colors.textFaint, marginTop: space.md },
  payoutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.lg,
    marginTop: space.lg,
    ...shadow.card,
  },
  payoutText: { flex: 1 },
});
