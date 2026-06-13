import type { components } from '../types/api.gen';

type Geo = components['schemas']['GeoLocation'];

// API money amounts are minor units (USD cents).
export function money(minor: number | null | undefined): string {
  if (minor == null) return '—';
  return `$${(minor / 100).toFixed(2)}`;
}

// A human label for a stop: landmark first (critical in informal areas), then the
// free-text address, falling back to coordinates.
export function placeLabel(geo: Geo | undefined): string {
  if (!geo) return 'Unknown location';
  return geo.landmark || geo.address_text || `${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`;
}

// Like placeLabel, but split for surfaces with room to show BOTH the landmark and
// the address: the landmark leads with the free-text address as a supporting second
// line. No landmark → the address takes the primary line; neither → coordinates.
// Used on the offer card (and the active-job screen) so a missing landmark still
// surfaces the real address instead of hiding it.
export function placeLabelDetailed(geo: Geo | undefined): { primary: string; secondary: string | null } {
  if (geo?.landmark && geo.address_text) {
    return { primary: geo.landmark, secondary: geo.address_text };
  }
  return { primary: placeLabel(geo), secondary: null };
}

// A short destination label for a push notification: landmark or address only —
// coordinates / "unknown" are noise in a notification, so return null to omit it.
export function notifyPlace(
  geo: { landmark?: string | null; address_text?: string | null } | null | undefined,
): string | null {
  return geo?.landmark || geo?.address_text || null;
}

// Distance from the driver to the pickup, phrased for the offer card. A value that
// rounds to ~0 means the driver is essentially AT the pickup — literal "~0 km away"
// reads as broken — so say "At pickup". null (position unknown) omits it.
export function pickupDistanceLabel(km: number | null | undefined): string | null {
  if (km == null) return null;
  if (km < 0.1) return 'At pickup';
  return `${km} km to pickup`;
}

// The straight-line pickup→dropoff distance, or null to omit.
export function tripLabel(km: number | null | undefined): string | null {
  return km == null ? null : `${km} km trip`;
}

// Whole seconds remaining until an ISO timestamp, clamped at 0.
export function secondsUntil(iso: string | undefined, nowMs: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((new Date(iso).getTime() - nowMs) / 1000));
}
