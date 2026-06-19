import { describe, expect, it } from 'vitest';
import { driverNetMinor, parseCounterMinor, isCounterWithinCeiling } from '../src/lib/auction';

// Driver-side auction bid maths (ADR-036). These drive the prices a courier sees + counters with,
// so they're the one part of the counter UI worth pinning precisely.
describe('driverNetMinor', () => {
  it('applies the offer-derived driver share to a gross fare', () => {
    // server split: driver gets 80% of fee_minor (400 of 500) → 80% of any gross
    expect(driverNetMinor(1000, 500, 400)).toBe(800); // 80% of $10.00
    expect(driverNetMinor(300, 500, 400)).toBe(240); // 80% of the $3.00 opening
  });

  it('rounds to the nearest minor unit', () => {
    expect(driverNetMinor(333, 500, 400)).toBe(266); // 333 * 0.8 = 266.4 → 266
  });

  it('returns null (show gross only) when no positive fee anchors the ratio', () => {
    expect(driverNetMinor(1000, 0, 400)).toBeNull();
    expect(driverNetMinor(1000, null, 400)).toBeNull();
    expect(driverNetMinor(1000, 500, null)).toBeNull();
    expect(driverNetMinor(1000, undefined, undefined)).toBeNull();
  });
});

describe('parseCounterMinor', () => {
  it('parses a positive dollars string to minor units', () => {
    expect(parseCounterMinor('8.50')).toBe(850);
    expect(parseCounterMinor('8')).toBe(800);
    expect(parseCounterMinor('0.99')).toBe(99);
    expect(parseCounterMinor('12.345')).toBe(1235); // rounds (1234.5 → 1235)
  });

  it('returns null for empty / non-numeric / non-positive input', () => {
    expect(parseCounterMinor('')).toBeNull();
    expect(parseCounterMinor('abc')).toBeNull();
    expect(parseCounterMinor('0')).toBeNull();
    expect(parseCounterMinor('-5')).toBeNull();
  });
});

describe('isCounterWithinCeiling', () => {
  it('accepts a positive counter at or below the ceiling', () => {
    expect(isCounterWithinCeiling(800, 5000)).toBe(true);
    expect(isCounterWithinCeiling(5000, 5000)).toBe(true); // exactly the ceiling
  });

  it('rejects above the ceiling, or a null/zero counter', () => {
    expect(isCounterWithinCeiling(5001, 5000)).toBe(false);
    expect(isCounterWithinCeiling(null, 5000)).toBe(false);
    expect(isCounterWithinCeiling(0, 5000)).toBe(false);
  });

  it('a missing ceiling does not block (the server re-enforces it)', () => {
    expect(isCounterWithinCeiling(999999, null)).toBe(true);
    expect(isCounterWithinCeiling(800, undefined)).toBe(true);
  });
});
