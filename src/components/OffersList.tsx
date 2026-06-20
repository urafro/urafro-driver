import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { Offer } from '../lib/api';
import { driverNetMinor, parseCounterMinor } from '../lib/auction';
import { money, placeLabel, placeLabelDetailed, pickupDistanceLabel, tripLabel, secondsUntil } from '../lib/format';
import { colors, shadow, PILL } from '../theme';

// Live list of nearby job offers. A FIXED-PRICE job leads with the driver's payout and is CLAIMED
// (instant assign). An AUCTION job (ADR-036, customer-named price) leads with what the customer
// offered and is BID on — ACCEPT their price, or COUNTER your own (≤ the 10× ceiling); the job is
// assigned later when the customer / auto-clear accepts a bid, so a bid shows "offer sent" rather
// than opening the active-job screen.
export default function OffersList({
  offers,
  onClaim,
  onBid,
  onDecline,
  actingId,
  bidSentIds,
}: {
  offers: Offer[];
  onClaim: (id: string) => void;
  onBid: (id: string, type: 'accept' | 'counter', priceMinor?: number) => void;
  onDecline: (id: string) => void;
  actingId: string | null;
  bidSentIds: ReadonlySet<string>;
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
      {offers.map((offer) =>
        offer.id ? (
          <OfferCard
            key={offer.id}
            offer={offer}
            now={now}
            onClaim={onClaim}
            onBid={onBid}
            onDecline={onDecline}
            acting={actingId != null}
            actingThis={actingId === offer.id}
            bidSent={bidSentIds.has(offer.id)}
          />
        ) : null,
      )}
    </View>
  );
}

function OfferCard({
  offer,
  now,
  onClaim,
  onBid,
  onDecline,
  acting,
  actingThis,
  bidSent,
}: {
  offer: Offer;
  now: number;
  onClaim: (id: string) => void;
  onBid: (id: string, type: 'accept' | 'counter', priceMinor?: number) => void;
  onDecline: (id: string) => void;
  acting: boolean;
  actingThis: boolean;
  bidSent: boolean;
}) {
  const id = offer.id as string;
  const expires = secondsUntil(offer.offer_expires_at, now);
  const urgent = expires < 60;
  const expired = expires <= 0; // dead offer — server 409s a claim/bid; the next poll drops it
  const isAuction = offer.opening_price_minor != null;
  const opening = offer.opening_price_minor ?? 0;

  // The driver's NET share of a gross fare (auction shows real earnings, not the cost estimate);
  // null when no positive fee anchors the ratio (then we show gross only). See lib/auction.
  const netOf = (grossMinor: number): number | null =>
    driverNetMinor(grossMinor, offer.fee_minor, offer.driver_fee_minor);

  // Fixed-price payout = the driver's cut (fee_minor fallback covers a stale payload).
  const fixedPayout = money(offer.driver_fee_minor ?? offer.fee_minor);
  const openingNet = netOf(opening);

  const drop = placeLabelDetailed(offer.dropoff);
  const meta = [pickupDistanceLabel(offer.pickup_distance_km), tripLabel(offer.trip_km)].filter(Boolean).join(' · ');

  // Per-card counter state (an auction job lets the driver name their own fare). The courier
  // counters FREELY at any positive price — the CUSTOMER decides whether to accept (ADR-047). The
  // 10× technical ceiling is a fraud guard, NOT a price band (ADR-036), so it is never shown or
  // enforced client-side; the server silently rejects only an absurd typo.
  const [countering, setCountering] = useState(false);
  const [counterText, setCounterText] = useState('');
  const counterMinor = parseCounterMinor(counterText);
  const counterValid = counterMinor != null;
  const counterNet = counterMinor != null ? netOf(counterMinor) : null;

  return (
    <View style={styles.card}>
      {/* Header: the customer's offered price (auction) or the driver's payout (fixed). */}
      <View style={styles.headerRow}>
        <View style={styles.payoutWrap}>
          {isAuction ? (
            <View>
              <Text style={styles.offerLabel}>Customer offers</Text>
              <Text style={styles.payout}>{money(opening)}</Text>
              {openingNet != null ? <Text style={styles.netHint}>You earn ~{money(openingNet)}</Text> : null}
            </View>
          ) : (
            <Text style={styles.payout}>{fixedPayout}</Text>
          )}
        </View>
        <View style={[styles.timerPill, urgent && styles.timerPillUrgent]}>
          <Text style={[styles.timerText, urgent && styles.timerTextUrgent]}>{expires}s</Text>
        </View>
      </View>

      <Text style={styles.dropoff} numberOfLines={2}>{drop.primary}</Text>
      {drop.secondary ? <Text style={styles.dropoffSub} numberOfLines={1}>{drop.secondary}</Text> : null}
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
        {!isAuction ? (
          // Fixed-price: claim = instant assign.
          <Pressable
            style={[styles.accept, (acting || expired) && styles.disabled]}
            onPress={() => onClaim(id)}
            disabled={acting || expired}
          >
            <Text style={styles.acceptText}>{expired ? 'Expired' : actingThis ? 'Claiming…' : `Accept — ${fixedPayout}`}</Text>
          </Pressable>
        ) : bidSent ? (
          // Auction: this driver has bid — assigned later if the customer / auto-clear accepts it.
          <View style={styles.bidSent}>
            <Feather name="check" size={16} color={colors.textMuted} />
            <Text style={styles.bidSentText}>Offer sent — waiting for the customer</Text>
          </View>
        ) : countering ? (
          // Auction: name your own fare (≤ the ceiling).
          <View style={styles.counterBox}>
            <View style={styles.counterInputRow}>
              <Text style={styles.dollar}>$</Text>
              <TextInput
                style={styles.counterInput}
                value={counterText}
                onChangeText={setCounterText}
                keyboardType="decimal-pad"
                placeholder={(opening / 100).toFixed(2)}
                placeholderTextColor={colors.textFaint}
                autoFocus
              />
            </View>
            <Text style={styles.netHint}>Name your price — the customer chooses whether to accept.</Text>
            {counterValid && counterNet != null ? (
              <Text style={styles.netHint}>You earn ~{money(counterNet)}</Text>
            ) : null}
            <Pressable
              style={[styles.accept, (!counterValid || acting) && styles.disabled]}
              onPress={() => counterValid && counterMinor != null && onBid(id, 'counter', counterMinor)}
              disabled={!counterValid || acting}
            >
              <Text style={styles.acceptText}>{actingThis ? 'Sending…' : 'Send counter-offer'}</Text>
            </Pressable>
            <Pressable
              style={[styles.pass, acting && styles.disabled]}
              onPress={() => {
                setCountering(false);
                setCounterText('');
              }}
              disabled={acting}
            >
              <Text style={styles.passText}>Back</Text>
            </Pressable>
          </View>
        ) : (
          // Auction default: accept the customer's price, or open the counter input.
          <>
            <Pressable
              style={[styles.accept, (acting || expired) && styles.disabled]}
              onPress={() => onBid(id, 'accept')}
              disabled={acting || expired}
            >
              <Text style={styles.acceptText}>{expired ? 'Expired' : actingThis ? 'Sending…' : `Accept — ${money(opening)}`}</Text>
            </Pressable>
            <Pressable
              style={[styles.secondary, (acting || expired) && styles.disabled]}
              onPress={() => setCountering(true)}
              disabled={acting || expired}
            >
              <Text style={styles.secondaryText}>Offer my own price</Text>
            </Pressable>
          </>
        )}

        {/* Decline (ADR-002 B): the job is never re-offered to this driver. Hidden while
            countering (the "Back" button covers returning); shown in every other state. */}
        {!(isAuction && countering) ? (
          <Pressable style={[styles.pass, acting && styles.disabled]} onPress={() => onDecline(id)} disabled={acting}>
            <Text style={styles.passText}>Pass</Text>
          </Pressable>
        ) : null}
      </View>
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
  offerLabel: { color: colors.textFaint, fontSize: 13, fontWeight: '700' },
  netHint: { color: colors.textMuted, fontSize: 13, marginTop: 2 },

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
  secondary: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: PILL,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  secondaryText: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
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

  bidSent: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
  },
  bidSentText: { color: colors.textMuted, fontSize: 15, fontWeight: '700', textAlign: 'center' },

  counterBox: { gap: 8 },
  counterInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  dollar: { color: colors.textMuted, fontSize: 18, fontWeight: '700' },
  counterInput: { flex: 1, color: colors.textPrimary, fontSize: 18, fontWeight: '700', paddingVertical: 10 },
});
