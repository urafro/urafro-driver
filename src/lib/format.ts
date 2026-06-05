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

// Whole seconds remaining until an ISO timestamp, clamped at 0.
export function secondsUntil(iso: string | undefined, nowMs: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((new Date(iso).getTime() - nowMs) / 1000));
}
