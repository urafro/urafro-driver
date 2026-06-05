import { describe, it, expect } from 'vitest';
import { money, placeLabel, secondsUntil } from './format';

describe('money', () => {
  it('formats minor units (cents) as dollars', () => {
    expect(money(2000)).toBe('$20.00');
    expect(money(150)).toBe('$1.50');
    expect(money(0)).toBe('$0.00');
  });

  it('shows a dash for null / undefined', () => {
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
  });
});

describe('placeLabel', () => {
  it('prefers landmark, then address text, then coordinates', () => {
    expect(
      placeLabel({ lat: -17.8, lng: 31.0, source: 'map_pin', landmark: 'Blue gate', address_text: '14 Rd' }),
    ).toBe('Blue gate');
    expect(placeLabel({ lat: -17.8, lng: 31.0, source: 'map_pin', address_text: '14 Avondale Rd' })).toBe(
      '14 Avondale Rd',
    );
    expect(placeLabel({ lat: -17.8312, lng: 31.0456, source: 'map_pin' })).toBe('-17.8312, 31.0456');
  });

  it('handles a missing location', () => {
    expect(placeLabel(undefined)).toBe('Unknown location');
  });
});

describe('secondsUntil', () => {
  it('counts whole seconds until a future time, clamped at 0', () => {
    const now = 1_000_000;
    expect(secondsUntil(new Date(now + 30_000).toISOString(), now)).toBe(30);
    expect(secondsUntil(new Date(now - 5_000).toISOString(), now)).toBe(0);
  });

  it('returns 0 for a missing timestamp', () => {
    expect(secondsUntil(undefined, Date.now())).toBe(0);
  });
});
