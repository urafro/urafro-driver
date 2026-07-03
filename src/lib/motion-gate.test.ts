import { describe, it, expect } from 'vitest';
import { deriveMoving, MOVING_ENTER, MOVING_EXIT } from './motion-gate';

// B1 motion gate: the accept/counter/pass card is enabled only when the vehicle is
// stopped. The tricky parts are (a) hysteresis so an idling car doesn't flap, and
// (b) unknown/noisy GPS speed HOLDING the last state rather than guessing.
describe('deriveMoving', () => {
  it('flips to moving above the enter threshold', () => {
    expect(deriveMoving(MOVING_ENTER, false)).toBe(true);
    expect(deriveMoving(10, false)).toBe(true);
  });

  it('flips to stopped at or below the exit threshold', () => {
    expect(deriveMoving(MOVING_EXIT, true)).toBe(false);
    expect(deriveMoving(0, true)).toBe(false);
  });

  it('holds the previous state inside the hysteresis band', () => {
    const band = (MOVING_ENTER + MOVING_EXIT) / 2;
    expect(deriveMoving(band, true)).toBe(true);
    expect(deriveMoving(band, false)).toBe(false);
  });

  it('holds the previous state when speed is unknown or invalid', () => {
    for (const bad of [null, undefined, NaN, Infinity, -1]) {
      expect(deriveMoving(bad, true)).toBe(true);
      expect(deriveMoving(bad, false)).toBe(false);
    }
  });

  it('does not chatter idling at a light: brief crawl below exit stays stopped', () => {
    // stopped -> tiny GPS creep (0.4 m/s) -> still below EXIT -> remains stopped
    expect(deriveMoving(0.4, false)).toBe(false);
  });
});
