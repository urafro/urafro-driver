import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import OffersList from '../src/components/OffersList';
import type { Offer } from '../src/lib/api';
import { render, pressableWithText, press, unmount } from './helpers/rtr';

// K2 · smoke test for the offer/claim surface. A fixed-price offer leads with the
// driver's payout and a claim button that instant-assigns; an expired offer must
// disable it. (The auction/counter path is exercised by tests/auction.test.ts.)

function fixedOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'off-1',
    offer_expires_at: new Date(Date.now() + 300_000).toISOString(),
    fee_minor: 500,
    driver_fee_minor: 400, // $4.00 payout
    ...overrides,
  } as Offer;
}

function renderList(offer: Offer, onClaim = jest.fn()) {
  const r = render(
    <OffersList
      offers={[offer]}
      onClaim={onClaim}
      onBid={jest.fn()}
      onDecline={jest.fn()}
      actingId={null}
      bidSentIds={new Set<string>()}
    />,
  );
  return { r, onClaim };
}

describe('OffersList (component)', () => {
  // The card runs a 1s countdown interval; fake timers keep it from firing on real
  // time and leaking work past teardown. Fixtures use relative times off Date.now(),
  // so a frozen clock is fine.
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('claim button fires onClaim with the offer id', () => {
    const { r, onClaim } = renderList(fixedOffer());
    const accept = pressableWithText(r.root, 'Accept');
    expect(accept.props.disabled).toBe(false);
    press(accept);
    expect(onClaim).toHaveBeenCalledWith('off-1');
    unmount(r);
  });

  it('an expired offer shows "Expired" and disables the claim', () => {
    // `disabled` is what stops a real tap (the raw onPress isn't guarded), so assert the
    // prop rather than firing onPress directly (which would bypass `disabled`).
    const { r } = renderList(fixedOffer({ offer_expires_at: new Date(Date.now() - 1_000).toISOString() }));
    const btn = pressableWithText(r.root, 'Expired');
    expect(btn.props.disabled).toBe(true);
    unmount(r);
  });
});
