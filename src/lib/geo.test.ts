import { describe, it, expect } from 'vitest';
import { metersBetween } from './geo';

// Pure haversine guard — the active-job map uses metersBetween to decide whether the
// driver has moved enough (>50m) to re-render the dot + re-fetch the OSRM route.
describe('metersBetween', () => {
  it('is zero for the same point', () => {
    expect(metersBetween({ lat: -17.82, lng: 31.05 }, { lat: -17.82, lng: 31.05 })).toBe(0);
  });

  it('measures ~111m for 0.001° of latitude', () => {
    const d = metersBetween({ lat: -17.82, lng: 31.05 }, { lat: -17.821, lng: 31.05 });
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(118);
  });

  it('keeps small GPS jitter under the 50m re-route threshold', () => {
    // ~0.0002° ≈ 22m — below the gate, so a stationary driver doesn't re-route.
    const d = metersBetween({ lat: -17.82, lng: 31.05 }, { lat: -17.8202, lng: 31.0501 });
    expect(d).toBeLessThan(50);
  });
});
