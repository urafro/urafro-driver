import { describe, it, expect } from 'vitest';
import { telUrl, mapsUrl } from './links';

describe('telUrl', () => {
  it('strips formatting, keeps digits and a leading +', () => {
    expect(telUrl('+263 77 274 9678')).toBe('tel:+263772749678');
    expect(telUrl('(077) 274-9678')).toBe('tel:0772749678');
  });
});

describe('mapsUrl', () => {
  it('builds a Google Maps directions link to the coordinates', () => {
    expect(mapsUrl(-17.8312, 31.0456)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=-17.8312,31.0456',
    );
  });
});
