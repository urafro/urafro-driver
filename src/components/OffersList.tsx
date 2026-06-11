import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Offer } from '../lib/api';
import { money, placeLabel, secondsUntil } from '../lib/format';
import { colors, shadow, PILL } from '../theme';

// Live list of nearby job offers. Each card shows the destination (the driver's
// main decision), pickup, fee + any cash to collect, and a live expiry countdown.
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
    return <Text style={styles.empty}>No offers right now — staying online…</Text>;
  }

  return (
    <View style={styles.list}>
      {offers.map((offer) => {
        const id = offer.id;
        if (!id) return null;
        const expires = secondsUntil(offer.offer_expires_at, now);
        const claiming = claimingId === id;
        return (
          <View key={id} style={styles.card}>
            <Text style={styles.dropoff}>→ {placeLabel(offer.dropoff)}</Text>
            <Text style={styles.pickup}>Pickup · {placeLabel(offer.pickup)}</Text>
            <View style={styles.metaRow}>
              {/* The driver's cut (ADR-002 A.3) — never quote more than they earn.
                  fee_minor fallback only covers a stale server payload. */}
              <Text style={styles.fee}>Earn {money(offer.driver_fee_minor ?? offer.fee_minor)}</Text>
              {offer.collect_minor ? (
                <Text style={styles.cod}>Collect {money(offer.collect_minor)}</Text>
              ) : null}
              <Text style={styles.expiry}>{expires}s</Text>
            </View>
            <Pressable
              style={[styles.accept, claimingId != null && styles.disabled]}
              onPress={() => onClaim(id)}
              disabled={claimingId != null}
            >
              <Text style={styles.acceptText}>{claiming ? 'Claiming…' : 'Accept'}</Text>
            </Pressable>
            {/* Decline (ADR-002 B): the job is never re-offered to this driver. */}
            <Pressable style={styles.pass} onPress={() => onDecline(id)} disabled={claimingId != null}>
              <Text style={styles.passText}>Pass</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 24, gap: 12 },
  empty: { color: colors.textFaint, fontSize: 15, marginTop: 28, textAlign: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, ...shadow.card },
  dropoff: { color: colors.textPrimary, fontSize: 17, fontWeight: '600' },
  pickup: { color: colors.textMuted, fontSize: 14, marginTop: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  fee: { color: colors.money, fontSize: 15, fontWeight: '600' },
  cod: { color: colors.cod, fontSize: 14 },
  expiry: { color: colors.textFaint, fontSize: 13, marginLeft: 'auto' },
  accept: { backgroundColor: colors.btnPrimaryBg, borderRadius: PILL, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  disabled: { opacity: 0.6 },
  acceptText: { color: colors.btnPrimaryText, fontSize: 16, fontWeight: '700' },
  pass: { alignItems: 'center', paddingVertical: 8, marginTop: 2 },
  passText: { color: colors.textFaint, fontSize: 13 },
});
