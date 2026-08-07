import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  getEarnings,
  getEarningsHistory,
  type Earnings,
  type EarningsHistory,
} from '../lib/api';
import { money } from '../lib/format';
import { useSession } from '../state/session';
import { colors, shadow, typography, space, radius } from '../theme';
import { Text } from '../components/ui';
import { animateNext } from '../lib/motion';
import EarningsChart, { EARNINGS_HISTORY_DAYS } from '../components/EarningsChart';
import PayoutScreen from './PayoutScreen';

// A dedicated earnings view (the prototype's Earnings tab). Every figure here is
// real ledger money: the summary comes from GET /driver/earnings and the weekly
// bars from GET /driver/earnings/history. The bars used to be hardcoded sample
// data badged SAMPLE because no history endpoint existed (#50/#68) — the badge and
// the invented numbers are gone with it.

export default function EarningsScreen() {
  const { session } = useSession();
  const token = session?.token ?? '';
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [history, setHistory] = useState<EarningsHistory | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  // Bumped by the chart's Try again — re-runs the load effect without a remount.
  const [reloadKey, setReloadKey] = useState(0);
  // Cash-out lives under the Earnings tab (no nav lib — the prototype groups it
  // here too); a local toggle swaps the dedicated Payout screen in and out.
  const [showPayout, setShowPayout] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setHistoryFailed(false);
    // One round trip each, in parallel: on a 3G uplink the two reads cost about what
    // one did. allSettled, not all — a failed chart must not blank the live balance
    // above it, and a failed summary must not blank the chart.
    void Promise.allSettled([
      getEarnings(token),
      getEarningsHistory(token, EARNINGS_HISTORY_DAYS),
    ]).then(([summary, week]) => {
      if (cancelled) return;
      if (summary.status === 'fulfilled') setEarnings(summary.value);
      if (week.status === 'fulfilled') {
        animateNext('base'); // the skeleton settles into the bars instead of popping
        setHistory(week.value);
      } else {
        setHistoryFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, reloadKey]);

  const retryHistory = useCallback(() => {
    animateNext('base');
    setHistoryFailed(false);
    setReloadKey(k => k + 1);
  }, []);

  const todayMinor = earnings?.today_minor ?? 0;

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

      {/* Referral credit. The server has always sent this, but the hand-written
          Earnings type omitted the field, so it was invisible until 2026-08-01.
          Stays hidden at zero — which is also the state while the reward is dark
          (REFERRAL_REWARD_MINOR=0), so switching the reward on reveals it. */}
      {earnings && earnings.referral_earned_minor > 0 ? (
        <View style={styles.card}>
          <Text style={styles.codTitle}>
            Referral credit: {money(earnings.referral_earned_minor)}
          </Text>
          <Text style={styles.muted}>
            Earned from drivers you referred. Paid out with your earnings.
          </Text>
        </View>
      ) : null}

      {/* The real weekly chart, straight off the payout ledger — loading, empty and
          failed states all handled inside (see EarningsChart). It is deliberately a
          separate read from the summary above, so a failed chart never blanks the
          driver's live balance. */}
      <EarningsChart history={history} failed={historyFailed} onRetry={retryHistory} />

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
