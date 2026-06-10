import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Offer } from '../lib/api';
import { money, placeLabel, secondsUntil } from '../lib/format';

// Live list of nearby job offers. Each card shows the destination (the driver's
// main decision), pickup, fee + any cash to collect, and a live expiry countdown.
export default function OffersList({
  offers,
  onClaim,
  claimingId,
}: {
  offers: Offer[];
  onClaim: (id: string) => void;
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
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 24, gap: 12 },
  empty: { color: '#64748b', fontSize: 15, marginTop: 28, textAlign: 'center' },
  card: { backgroundColor: '#1e293b', borderRadius: 12, padding: 16 },
  dropoff: { color: '#fff', fontSize: 17, fontWeight: '600' },
  pickup: { color: '#94a3b8', fontSize: 14, marginTop: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  fee: { color: '#22d3ee', fontSize: 15, fontWeight: '600' },
  cod: { color: '#fbbf24', fontSize: 14 },
  expiry: { color: '#64748b', fontSize: 13, marginLeft: 'auto' },
  accept: { backgroundColor: '#22c55e', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  disabled: { opacity: 0.6 },
  acceptText: { color: '#0f172a', fontSize: 16, fontWeight: '700' },
});
