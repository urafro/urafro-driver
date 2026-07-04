import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { getProfile, type Earnings } from '../lib/api';
import { money } from '../lib/format';
import { waUrl } from '../lib/links';
import { OPS_WHATSAPP } from '../config';
import { colors, shadow, typography, space, radius } from '../theme';
import { Text } from '../components/ui';
import { haptics } from '../lib/haptics';
import PayoutMethods from '../components/PayoutMethods';

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
    if (!OPS_WHATSAPP) return;
    haptics.tap(); // light ack — the tap is handing off to WhatsApp
    void Linking.openURL(waUrl(OPS_WHATSAPP, opsMessage));
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
            Your earnings land here after ops checks each day&apos;s deliveries. Add where you want
            to be paid below now, so it&apos;s ready the moment your first balance lands.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Available to cash out</Text>
            <Text style={styles.hero}>{money(earnings?.payable_minor ?? null)}</Text>
            <Text style={styles.muted}>Your full balance · no payout fee during the pilot</Text>
          </View>

          {/* The future one-tap button — shown, but visibly NOT live. */}
          <View style={styles.previewButton}>
            <Feather name="lock" size={18} strokeWidth={1.5} color={colors.textFaint} />
            <Text style={styles.previewButtonText}>Cash out to EcoCash</Text>
          </View>
          <Text style={styles.previewNote}>
            One-tap automated EcoCash cash-out isn&apos;t live yet — it arrives with Phase C.
          </Text>
        </>
      )}

      {/* Payout-method management (ADR-003 P2) — ALWAYS available, so a driver can
          set up where to be paid BEFORE their first balance, not only after. */}
      <PayoutMethods token={token} />

      <View style={styles.howCard}>
        <Text style={styles.howTitle}>How payouts work right now</Text>
        <Text style={styles.muted}>
          During the pilot the urAfro team pays your balance out by hand — usually within a day of
          you asking. Message ops to arrange yours and they&apos;ll send it to the method above.
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
    </ScrollView>
  );
}

// Text styles from the shared type scale (typography.*); spacing/radii from tokens.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.xxl, paddingTop: 64, paddingBottom: 40 },

  back: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 32 },
  backText: { ...typography.callout, fontWeight: '700', color: colors.textMuted },

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  title: { ...typography.display, color: colors.textPrimary },
  previewPill: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  previewPillText: { ...typography.caption, fontWeight: '700', color: colors.textMuted },

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
  cardLabel: { ...typography.subheading, fontWeight: '700', color: colors.textPrimary },

  previewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    minHeight: 48,
    paddingVertical: 14,
    marginTop: space.xl,
  },
  previewButtonText: { ...typography.subheading, fontWeight: '700', color: colors.textFaint },
  previewNote: { ...typography.caption, fontSize: 13, lineHeight: 19, color: colors.textFaint, marginTop: space.sm, textAlign: 'center' },

  howCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.lg,
    marginTop: space.xl,
    ...shadow.card,
  },
  howTitle: { ...typography.subheading, fontWeight: '700', color: colors.textPrimary },

  opsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.btnPrimaryBg,
    borderRadius: radius.pill,
    minHeight: 48,
    paddingVertical: 14,
    marginTop: space.lg,
  },
  opsButtonText: { ...typography.subheading, fontWeight: '700', color: colors.btnPrimaryText },
});
