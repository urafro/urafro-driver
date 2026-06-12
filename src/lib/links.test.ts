import { describe, it, expect } from 'vitest';
import { telUrl, mapsUrl, waUrl } from './links';

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

describe('waUrl', () => {
  it('strips formatting to a bare wa.me link', () => {
    expect(waUrl('+263 77 274 9678')).toBe('https://wa.me/263772749678');
  });
  it('appends a url-encoded prefilled message when given one', () => {
    expect(waUrl('+263772749678', "I'm outside")).toBe(
      "https://wa.me/263772749678?text=I'm%20outside",
    );
  });
});
