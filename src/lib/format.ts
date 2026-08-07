import type { components } from '../types/api.gen';

type Geo = components['schemas']['GeoLocation'];

// API money amounts are minor units (USD cents). A negative amount (a correction or
// clawback on the earnings ledger) leads with the sign — "-$2.50", never "$-2.50",
// which reads as a rendering bug on a money screen rather than as money taken off.
export function money(minor: number | null | undefined): string {
  if (minor == null) return '—';
  const sign = minor < 0 ? '-' : '';
  return `${sign}$${(Math.abs(minor) / 100).toFixed(2)}`;
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

// ── Jobs tab (history) formatting ─────────────────────────────────────────────

// How a delivery's handover was confirmed, for the job record. null → omit the row.
export function podMethodLabel(method: string | null | undefined): string | null {
  switch (method) {
    case 'otp':
      return 'Confirmed by code';
    case 'manual':
      return 'Completed manually';
    case 'photo':
      return 'Photo proof';
    case 'signature':
      return 'Signature';
    default:
      return null;
  }
}

// Short clock time for a job row, e.g. "2:14 PM" (device locale + timezone). '' if absent.
export function timeLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// A day heading for grouping jobs: "Today" / "Yesterday" / "Fri 13 Jun", in the
// device's local calendar. `nowMs` is injectable for deterministic tests.
export function dayLabel(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (sameLocalDay(d, new Date(nowMs))) return 'Today';
  if (sameLocalDay(d, new Date(nowMs - 86_400_000))) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

// ── Earnings chart ────────────────────────────────────────────────────────────

const WEEKDAY_TAGS = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'];

// The bar label for one day of the earnings chart, from the server's YYYY-MM-DD
// calendar date. Parsed as LOCAL date PARTS on purpose: `new Date('2026-06-10')`
// reads a bare date as UTC midnight, which slides the weekday by one anywhere west
// of Greenwich — a bar labelled with the wrong day is worse than no label. '' if the
// date is unparseable, so a malformed row loses its tag rather than the whole chart.
export function weekdayTag(date: string | null | undefined): string {
  const [y, m, d] = (date ?? '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return WEEKDAY_TAGS[new Date(y, m - 1, d).getDay()];
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
