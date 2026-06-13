import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Offer } from '../lib/api';
import { money, placeLabel, placeLabelDetailed, pickupDistanceLabel, tripLabel, secondsUntil } from '../lib/format';
import { colors, shadow, PILL } from '../theme';

// Live list of nearby job offers. Each card leads with the driver's payout (the
// number that decides the job), then the dropoff landmark, the pickup zone, any
// cash to collect, and a live expiry countdown that turns amber in the last minute.
export default function OffersList({
  offers,
  onClaim,
  onDecline,
  claimingId,
}: {
  offers: Offer[];
  onClaim: (id: string) => void;
  onDecline: (id: string) => void;
  claimingId: string | null;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (offers.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>You're online — offers appear here</Text>
        <Text style={styles.emptyBody}>Stay near busy areas like the CBD or Mbare Musika.</Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {offers.map((offer) => {
        const id = offer.id;
        if (!id) return null;
        const expires = secondsUntil(offer.offer_expires_at, now);
        const urgent = expires < 60;
        const claiming = claimingId === id;
        // The driver's cut (ADR-002 A.3) — never quote more than they earn.
        // fee_minor fallback only covers a stale server payload.
        const payout = money(offer.driver_fee_minor ?? offer.fee_minor);
        // Dropoff leads the card; show the landmark AND address when both exist.
        const drop = placeLabelDetailed(offer.dropoff);
        // Two different straight-line measurements (driver→pickup vs pickup→dropoff)
        // shown together so "At pickup · 1.1 km trip" reads coherently.
        const meta = [pickupDistanceLabel(offer.pickup_distance_km), tripLabel(offer.trip_km)]
          .filter(Boolean)
          .join(' · ');
        return (
          <View key={id} style={styles.card}>
            {/* Header: payout big, countdown pill (amber under 60s) */}
            <View style={styles.headerRow}>
              <View style={styles.payoutWrap}>
                <Text style={styles.payout}>{payout}</Text>
                <Text style={styles.payoutCaption}>you earn</Text>
              </View>
              <View style={[styles.timerPill, urgent && styles.timerPillUrgent]}>
                <Text style={[styles.timerText, urgent && styles.timerTextUrgent]}>{expires}s</Text>
              </View>
            </View>

            {/* Dropoff leads — the driver's main decision; landmark over address,
                with the address as a supporting line when both exist. */}
            <Text style={styles.dropoff} numberOfLines={2}>{drop.primary}</Text>
            {drop.secondary ? (
              <Text style={styles.dropoffSub} numberOfLines={1}>{drop.secondary}</Text>
            ) : null}
            <Text style={styles.pickup} numberOfLines={1}>Pickup · {placeLabel(offer.pickup)}</Text>
            {meta ? <Text style={styles.trip}>{meta}</Text> : null}

            {offer.collect_minor ? (
              <View style={styles.codRow}>
                <View style={styles.codChip}>
                  <Text style={styles.codText}>Collect {money(offer.collect_minor)} cash</Text>
                </View>
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                style={[styles.accept, claimingId != null && styles.disabled]}
                onPress={() => onClaim(id)}
                disabled={claimingId != null}
              >
                <Text style={styles.acceptText}>{claiming ? 'Claiming…' : `Accept — ${payout}`}</Text>
              </Pressable>
              {/* Decline (ADR-002 B): the job is never re-offered to this driver. */}
              <Pressable
                style={[styles.pass, claimingId != null && styles.disabled]}
                onPress={() => onDecline(id)}
                disabled={claimingId != null}
              >
                <Text style={styles.passText}>Pass</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 24, gap: 16 },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 24,
    marginTop: 28,
    alignItems: 'center',
    ...shadow.card,
  },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: colors.textFaint, fontSize: 15, marginTop: 6, textAlign: 'center' },

  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, ...shadow.card },

  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  payoutWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexShrink: 1 },
  payout: { color: colors.textPrimary, fontSize: 24, fontWeight: '700' },
  payoutCaption: { color: colors.textMuted, fontSize: 14 },

  timerPill: {
    borderRadius: PILL,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceAlt,
    minHeight: 32,
    justifyContent: 'center',
  },
  timerPillUrgent: { backgroundColor: colors.batteryBg },
  timerText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  timerTextUrgent: { color: colors.warning },

  dropoff: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 10, lineHeight: 22 },
  dropoffSub: { color: colors.textFaint, fontSize: 13, marginTop: 1 },
  pickup: { color: colors.textMuted, fontSize: 15, marginTop: 4 },
  trip: { color: colors.textFaint, fontSize: 14, marginTop: 2 },

  codRow: { marginTop: 10, flexDirection: 'row' },
  codChip: {
    backgroundColor: colors.batteryBg,
    borderRadius: PILL,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  codText: { color: colors.cod, fontSize: 14, fontWeight: '700' },

  actions: { marginTop: 16, gap: 8 },
  accept: {
    backgroundColor: colors.btnPrimaryBg,
    borderRadius: PILL,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  acceptText: { color: colors.btnPrimaryText, fontSize: 16, fontWeight: '700' },
  pass: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: PILL,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  passText: { color: colors.textMuted, fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
