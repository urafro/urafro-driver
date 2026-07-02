import { describe, it, expect } from 'vitest';
import type { DriverDelivery } from './api';
import { runStops, currentStopLeg } from './run';

// #66 (batching) — the pooled-run route: collect every parcel, then deliver every parcel,
// never dropping a leg. A leg still `assigned` needs a pickup then a drop; a `picked_up`
// one just a drop. Pickups come before drops; within a phase, leg order is preserved.

function leg(id: string, status: DriverDelivery['status'], seq: number | null = null): DriverDelivery {
  return {
    id,
    status,
    pickup: { lat: -17.82, lng: 31.05 },
    dropoff: { lat: -17.83, lng: 31.06 },
    batch_sequence: seq,
  } as DriverDelivery;
}
const ids = (legs: DriverDelivery[]) => runStops(legs).map((s) => `${s.type}:${s.leg.id}`);

describe('runStops / currentStopLeg (pooled-run sequencing)', () => {
  it('two fresh legs → pick up BOTH, then deliver both (in order)', () => {
    const legs = [leg('A', 'assigned', null), leg('B', 'assigned', 2)];
    expect(ids(legs)).toEqual(['pickup:A', 'pickup:B', 'dropoff:A', 'dropoff:B']);
    expect(currentStopLeg(legs)?.id).toBe('A'); // first stop = pick up A
  });

  it('after A is picked up, the next stop is B’s PICKUP — not A’s delivery', () => {
    const legs = [leg('A', 'picked_up', null), leg('B', 'assigned', 2)];
    expect(ids(legs)).toEqual(['pickup:B', 'dropoff:A', 'dropoff:B']);
    expect(currentStopLeg(legs)?.id).toBe('B'); // collect B before delivering anything
  });

  it('once everything is collected, deliver in order', () => {
    const legs = [leg('A', 'picked_up', null), leg('B', 'picked_up', 2)];
    expect(ids(legs)).toEqual(['dropoff:A', 'dropoff:B']);
    expect(currentStopLeg(legs)?.id).toBe('A');
  });

  it('in_transit counts as a pending dropoff (not a pickup)', () => {
    const legs = [leg('A', 'in_transit', null), leg('B', 'picked_up', 2)];
    expect(ids(legs)).toEqual(['dropoff:A', 'dropoff:B']);
  });

  it('the full walk never drops a leg: pickup A → pickup B → deliver A → deliver B', () => {
    // start: both assigned
    let legs = [leg('A', 'assigned'), leg('B', 'assigned', 2)];
    expect(currentStopLeg(legs)?.id).toBe('A'); // 1) pick up A
    // A picked up
    legs = [leg('A', 'picked_up'), leg('B', 'assigned', 2)];
    expect(currentStopLeg(legs)?.id).toBe('B'); // 2) pick up B
    // both picked up
    legs = [leg('A', 'picked_up'), leg('B', 'picked_up', 2)];
    expect(currentStopLeg(legs)?.id).toBe('A'); // 3) deliver A
    // A delivered → drops out of the in-flight set
    legs = [leg('B', 'picked_up', 2)];
    expect(currentStopLeg(legs)?.id).toBe('B'); // 4) deliver B
    // B delivered → run empty
    expect(currentStopLeg([])).toBeNull();
  });

  it('run of one is unchanged (single-job parity)', () => {
    expect(ids([leg('A', 'assigned')])).toEqual(['pickup:A', 'dropoff:A']);
    expect(currentStopLeg([leg('A', 'assigned')])?.id).toBe('A');
    expect(currentStopLeg([leg('A', 'picked_up')])?.id).toBe('A');
    expect(currentStopLeg([])).toBeNull();
  });
});
