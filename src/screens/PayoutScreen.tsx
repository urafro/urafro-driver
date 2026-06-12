import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { getProfile, type Earnings } from '../lib/api';
import { money } from '../lib/format';
import { waUrl } from '../lib/links';
import { OPS_WHATSAPP } from '../config';
import { colors, shadow, PILL } from '../theme';

// Cash-out screen — the prototype's Payout flow (#12), built HONEST.
//
// There is no payout endpoint yet (Phase C). So nothing here fakes a money
// movement: the prototype's "Payout requested · lands in 24h · you'll get an SMS"
// success screen is deliberately NOT reproduced, because tapping it would submit
// nothing while telling the driver their cash is on the way. Instead this shows
// exactly what automated EcoCash cash-out WILL look like — with the one-tap button
// visibly locked as a Phase-C preview — and surfaces the path that genuinely works
// today: message ops, who pay the balance out by hand during the pilot.
export default function PayoutScreen({
  token,
  earnings,
  onBack,
}: {
  token: string;
  earnings: Earnings | null;
  onBack: () => void;
}) {
  const payable = earnings?.payable_minor ?? 0;
  // Distinguish a genuine zero balance from "not loaded / fetch failed" (null) —
  // only the former gets the "nothing to cash out" empty state; an unknown balance
  // still shows the informational screen with a dash for the amount.
  const nothingToCashOut = earnings != null && payable <= 0;
  // The destination is the driver's own login number (payouts only ever go to
  // their own EcoCash line). Fetch it for display; fall through gracefully.
  const [phone, setPhone] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void getProfile(token)
      .then((p) => {
        if (!cancelled) setPhone(p.phone);
      })
      .catch(() => {
        // non-critical — falls back to "your login number"
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const opsMessage =
    `Hi urAfro — I'd like to cash out my driver balance${payable > 0 ? ` of ${money(payable)}` : ''}` +
    ` to my EcoCash${phone ? ` (${phone})` : ''}.`;
  const messageOps = () => {
    if (OPS_WHATSAPP) void Linking.openURL(waUrl(OPS_WHATSAPP, opsMessage));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable style={styles.back} onPress={onBack} hitSlop={8}>
        <Feather name="chevron-left" size={20} strokeWidth={1.5} color={colors.textMuted} />
        <Text style={styles.backText}>Earnings</Text>
      </Pressable>

      <View style={styles.titleRow}>
        <Text style={styles.title}>Cash out</Text>
        <View style={styles.previewPill}>
          <Text style={styles.previewPillText}>Phase C preview</Text>
        </View>
      </View>

      {nothingToCashOut ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Nothing to cash out yet</Text>
          <Text style={styles.muted}>
            Your earnings land here after ops checks each day&apos;s deliveries. Complete a few
            jobs and your balance will show up ready to pay out.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Available to cash out</Text>
            <Text style={styles.hero}>{money(earnings?.payable_minor ?? null)}</Text>
            <Text style={styles.muted}>Your full balance · no payout fee during the pilot</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.rowHead}>
              <Feather name="smartphone" size={18} strokeWidth={1.5} color={colors.tabActive} />
              <Text style={styles.cardLabel}>Goes to your EcoCash</Text>
            </View>
            <Text style={styles.destValue}>{phone ?? 'Your login number'}</Text>
            <Text style={styles.muted}>
              Payouts always go to your own login number. On a different EcoCash line? Message ops
              and they&apos;ll sort it.
            </Text>
          </View>

          {/* The future one-tap button — shown, but visibly NOT live. */}
          <View style={styles.previewButton}>
            <Feather name="lock" size={18} strokeWidth={1.5} color={colors.textFaint} />
            <Text style={styles.previewButtonText}>Cash out to EcoCash</Text>
          </View>
          <Text style={styles.previewNote}>
            One-tap automated EcoCash cash-out isn&apos;t live yet — it arrives with Phase C.
          </Text>

          <View style={styles.howCard}>
            <Text style={styles.howTitle}>How payouts work right now</Text>
            <Text style={styles.muted}>
              During the pilot the urAfro team pays your balance out by hand — usually within a day
              of you asking. Message ops to arrange yours and they&apos;ll send it to your EcoCash.
            </Text>
          </View>

          {OPS_WHATSAPP ? (
            <Pressable style={styles.opsButton} onPress={messageOps}>
              <Feather name="message-circle" size={18} strokeWidth={1.5} color={colors.btnPrimaryText} />
              <Text style={styles.opsButtonText}>Message ops to arrange a payout</Text>
            </Pressable>
          ) : (
            <Text style={styles.previewNote}>
              The urAfro team reaches out to arrange payouts during the pilot.
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, paddingTop: 64, paddingBottom: 40 },

  back: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  backText: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: '700' },
  previewPill: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: PILL,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  previewPillText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },

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
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardLabel: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  destValue: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', marginTop: 8 },

  previewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surfaceAlt,
    borderRadius: PILL,
    minHeight: 48,
    paddingVertical: 14,
    marginTop: 20,
  },
  previewButtonText: { color: colors.textFaint, fontSize: 16, fontWeight: '700' },
  previewNote: { color: colors.textFaint, fontSize: 13, marginTop: 8, lineHeight: 19, textAlign: 'center' },

  howCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    ...shadow.card,
  },
  howTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },

  opsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.btnPrimaryBg,
    borderRadius: PILL,
    minHeight: 48,
    paddingVertical: 14,
    marginTop: 16,
  },
  opsButtonText: { color: colors.btnPrimaryText, fontSize: 16, fontWeight: '700' },
});
