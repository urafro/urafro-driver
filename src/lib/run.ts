import type { DriverDelivery } from './api';

// #66 (batching): a driver carrying a POOLED run works it as a sequence of STOPS, not one
// whole delivery at a time. The correct batched route is "collect everything, then deliver
// everything": every PICKUP first (so the driver grabs all the parcels on the way out),
// then every DROPOFF. So the remaining plan for a set of in-flight legs is:
//   [ pickup of each leg still `assigned` ]  ++  [ dropoff of every in-flight leg ]
// A leg that's still `assigned` appears TWICE (its pickup now, its dropoff later); a leg
// already `picked_up`/`in_transit` only needs its dropoff. Within each phase we keep the
// leg order the server gives us (listActiveLegs sorts by batch_sequence, primary first),
// so a 2-leg run runs pickup A → pickup B → deliver A → deliver B.
//
// The server imposes NO ordering (each leg's lifecycle is independent), so this plan is
// purely the driver-app's route for the run; completed stops drop out as legs transition.

export type RunStopType = 'pickup' | 'dropoff';
export type RunStop = { leg: DriverDelivery; type: RunStopType };

/** The ordered list of REMAINING stops for the in-flight legs — all pickups, then all drops. */
export function runStops(legs: DriverDelivery[]): RunStop[] {
  const pickups = legs
    .filter((l) => l.status === 'assigned')
    .map((leg): RunStop => ({ leg, type: 'pickup' }));
  const dropoffs = legs.map((leg): RunStop => ({ leg, type: 'dropoff' }));
  return [...pickups, ...dropoffs];
}

/**
 * The leg the driver should work NOW — the first remaining stop's leg (a pickup if any
 * parcel is still uncollected, else the next delivery). null when nothing is in flight
 * (the run is complete). For a run of one this is just that single leg, unchanged — so the
 * single-job flow is untouched.
 */
export function currentStopLeg(legs: DriverDelivery[]): DriverDelivery | null {
  return runStops(legs)[0]?.leg ?? null;
}
