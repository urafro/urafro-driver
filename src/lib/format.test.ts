import { describe, it, expect } from 'vitest';
import {
  money,
  placeLabel,
  placeLabelDetailed,
  notifyPlace,
  pickupDistanceLabel,
  tripLabel,
  secondsUntil,
  podMethodLabel,
  dayLabel,
  timeLabel,
} from './format';

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

describe('placeLabelDetailed', () => {
  it('shows landmark primary + address secondary when both exist', () => {
    expect(
      placeLabelDetailed({ lat: -17.8, lng: 31.0, source: 'map_pin', landmark: 'Blue gate', address_text: '14 Rd' }),
    ).toEqual({ primary: 'Blue gate', secondary: '14 Rd' });
  });

  it('promotes the address to primary when there is no landmark', () => {
    expect(placeLabelDetailed({ lat: -17.8, lng: 31.0, source: 'map_pin', address_text: '14 Avondale Rd' })).toEqual({
      primary: '14 Avondale Rd',
      secondary: null,
    });
  });

  it('falls back to coordinates, then unknown', () => {
    expect(placeLabelDetailed({ lat: -17.8312, lng: 31.0456, source: 'map_pin' })).toEqual({
      primary: '-17.8312, 31.0456',
      secondary: null,
    });
    expect(placeLabelDetailed(undefined)).toEqual({ primary: 'Unknown location', secondary: null });
  });
});

describe('notifyPlace', () => {
  it('returns landmark or address only, never coordinates', () => {
    expect(notifyPlace({ landmark: 'Blue gate', address_text: '14 Rd' })).toBe('Blue gate');
    expect(notifyPlace({ address_text: '14 Avondale Rd' })).toBe('14 Avondale Rd');
    expect(notifyPlace({})).toBeNull();
    expect(notifyPlace(undefined)).toBeNull();
  });
});

describe('pickupDistanceLabel', () => {
  it('says "At pickup" when the driver is essentially there', () => {
    expect(pickupDistanceLabel(0)).toBe('At pickup');
    expect(pickupDistanceLabel(0.04)).toBe('At pickup');
  });

  it('shows the distance otherwise, and omits when unknown', () => {
    expect(pickupDistanceLabel(0.1)).toBe('0.1 km to pickup');
    expect(pickupDistanceLabel(2)).toBe('2 km to pickup');
    expect(pickupDistanceLabel(null)).toBeNull();
    expect(pickupDistanceLabel(undefined)).toBeNull();
  });
});

describe('tripLabel', () => {
  it('labels the trip distance, or omits when unknown', () => {
    expect(tripLabel(1.1)).toBe('1.1 km trip');
    expect(tripLabel(null)).toBeNull();
    expect(tripLabel(undefined)).toBeNull();
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

describe('podMethodLabel', () => {
  it('maps each handover method to a driver-readable label', () => {
    expect(podMethodLabel('otp')).toBe('Confirmed by code');
    expect(podMethodLabel('manual')).toBe('Completed manually');
    expect(podMethodLabel('photo')).toBe('Photo proof');
    expect(podMethodLabel('signature')).toBe('Signature');
  });

  it('omits (null) for unknown / missing methods', () => {
    expect(podMethodLabel(null)).toBeNull();
    expect(podMethodLabel(undefined)).toBeNull();
    expect(podMethodLabel('weird')).toBeNull();
  });
});

describe('dayLabel', () => {
  // Midday timestamps so a ±24h shift is unambiguously a different calendar day in
  // any reasonable timezone the test runner might use.
  const noon = Date.parse('2026-06-13T12:00:00Z');
  it('labels the same calendar day as Today and the prior day as Yesterday', () => {
    expect(dayLabel(new Date(noon).toISOString(), noon)).toBe('Today');
    expect(dayLabel(new Date(noon - 86_400_000).toISOString(), noon)).toBe('Yesterday');
  });

  it('falls back to a dated label for older days, and "" for no timestamp', () => {
    expect(dayLabel(new Date(noon - 5 * 86_400_000).toISOString(), noon)).not.toMatch(/Today|Yesterday/);
    expect(dayLabel(null, noon)).toBe('');
  });
});

describe('timeLabel', () => {
  it('formats a timestamp as local clock time (12h or 24h locale)', () => {
    expect(timeLabel('2026-06-13T14:30:00Z')).toMatch(/\d{1,2}[:.]30/); // 2:30 / 14:30 / 16:30 (TZ)
  });

  it('returns "" for a missing timestamp', () => {
    expect(timeLabel(null)).toBe('');
    expect(timeLabel(undefined)).toBe('');
  });
});
