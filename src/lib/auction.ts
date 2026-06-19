// Customer-named auction (ADR-036) — the driver-side bid maths. Pure + unit-tested; the
// OfferCard renders off these so the prices a courier sees (and counters with) are correct.

/**
 * The driver's NET share of a gross fare (minor units), derived from the offer's OWN split — the
 * server already computed `driver_fee_minor` from `fee_minor`, so the ratio is the live driver
 * share without the app needing the platform's bps. Lets an auction show real earnings (a share of
 * the customer's price) rather than the cost-estimate cut. Null when there's no positive fee to
 * anchor the ratio (then the UI shows gross only — never a wrong number).
 */
export function driverNetMinor(
  grossMinor: number,
  feeMinor: number | null | undefined,
  driverFeeMinor: number | null | undefined,
): number | null {
  if (feeMinor == null || feeMinor <= 0 || driverFeeMinor == null) return null;
  return Math.round(grossMinor * (driverFeeMinor / feeMinor));
}

/** Parse a dollars string the driver typed into minor units (cents), or null if it isn't a
 *  positive amount (empty / non-numeric / ≤ 0). */
export function parseCounterMinor(text: string): number | null {
  const n = Number.parseFloat(text);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** Whether a counter (minor units) is acceptable: positive and within the fraud-guard ceiling.
 *  A null ceiling (missing on the offer) doesn't block — the server re-enforces it anyway. */
export function isCounterWithinCeiling(counterMinor: number | null, ceilingMinor: number | null | undefined): boolean {
  if (counterMinor == null || counterMinor <= 0) return false;
  return ceilingMinor == null || counterMinor <= ceilingMinor;
}
