import { describe, it, expect } from 'vitest';
import { toE164 } from './phone';

describe('toE164', () => {
  it('passes through a valid +E.164 number', () => {
    expect(toE164('+263772749678')).toBe('+263772749678');
  });

  it('converts a local 0-prefixed number to E.164 (Zimbabwe default)', () => {
    expect(toE164('0772749678')).toBe('+263772749678');
  });

  it('prepends the country code to a bare local number', () => {
    expect(toE164('772749678')).toBe('+263772749678');
  });

  it('handles a country-prefixed number without +', () => {
    expect(toE164('263772749678')).toBe('+263772749678');
  });

  it('handles the 00 international prefix', () => {
    expect(toE164('00263772749678')).toBe('+263772749678');
  });

  it('strips spaces, dashes and parens', () => {
    expect(toE164('+263 77 274 9678')).toBe('+263772749678');
    expect(toE164('077-274-9678')).toBe('+263772749678');
  });

  it('allows other-country numbers entered with +', () => {
    expect(toE164('+14155550123')).toBe('+14155550123');
  });

  it('rejects too-short / junk / empty input', () => {
    expect(toE164('+263')).toBeNull();
    expect(toE164('abc')).toBeNull();
    expect(toE164('')).toBeNull();
  });

  it('respects a different default country', () => {
    expect(toE164('0712345678', '254')).toBe('+254712345678'); // Kenya
  });
});
