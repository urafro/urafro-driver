export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in metres between two points (Haversine). Pure — no
 *  expo/native deps — so it's unit-testable and reusable. The active-job map uses it
 *  to throttle re-routes: only redraw the dot + re-fetch the route once the driver
 *  has actually moved, not on GPS jitter while stationary. */
export function metersBetween(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
