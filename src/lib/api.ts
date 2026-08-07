import { API_V1 } from '../config';
import type { components, paths } from '../types/api.gen';

// Typed client for the urAfro Next /v1/driver/* API. Response shapes come straight
// from the platform's OpenAPI contract (src/types/api.gen.ts, regenerated via
// `npm run gen:types`), so the client can never drift from the server. A plain
// fetch wrapper — no SDK — mirroring the backend's own ethos.
//
// EVERY exported wire type below is DERIVED from the generated types — never
// hand-written, even when the contract has no named component for it (use a
// `paths[...]` lookup instead, as BoardJob and HistoryItem do).
//
// This rule exists because hand-written mirrors DID drift, silently: `Earnings`
// omitted `referral_earned_minor` for its whole life, so referral credit could
// never appear in the app. CI could not catch it — the "Contract types in sync"
// gate only regenerates api.gen.ts and never checked that hand-written types
// agreed with it. A derived alias makes the compiler the gate.

type Schemas = components['schemas'];
export type Delivery = Schemas['Delivery'];
export type Offer = Schemas['Offer'];
export type DriverState = Schemas['DriverState'];
// The assigned driver's view of a delivery — includes the pickup/dropoff contacts.
export type DriverDelivery = Schemas['DriverDelivery'];
// A courier's sealed bid on a customer-named auction (ADR-036).
export type DeliveryBid = Schemas['DeliveryBid'];

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Global handler for an authenticated 401 (a revoked/expired driver token — admin
// revoke-driver, or a stale token after a reinstall). Lets the session layer drop to
// the login screen instead of the app wedging on Home with every action silently
// failing. Registered by SessionProvider; null in tests/at startup.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

// Abort a request that hangs on a dead/stalled socket so callers (the offers poll, the
// action queue) actually fail-and-retry instead of stalling forever — a real failure mode
// on the low-end target, where a hung fetch left the offers list frozen with no retry. 10s
// on the 3G-primary baseline (tightened from 12s for faster fail-retry); still generous
// enough to ride an EDGE/2G dropout without false aborts.
const REQUEST_TIMEOUT_MS = 10000;

async function request<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_V1}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        // Only declare a JSON body when there actually IS one. React Native's Android
        // fetch puts a stray NUL byte on a bodyless POST; with Content-Type:
        // application/json the server's body-parser then rejects it with a 400
        // ("Unexpected token … is not valid JSON") BEFORE the handler runs — which
        // broke every bodyless POST (claim, picked_up, in_transit, failed).
        ...(rest.body != null ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    // An authenticated 401 = the token is dead. Trigger a global sign-out (the call
    // still throws below so the caller's own error handling runs too). Guarded on
    // `token` so a pre-auth 401 (e.g. wrong OTP at login) never logs anyone out.
    if (res.status === 401 && token) onUnauthorized?.();
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      // ignore — body may be empty
    }
    throw new ApiError(res.status, `${res.status} ${path}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── Onboarding (pre-auth, no token) ──────────────────────────────────────────
export function requestOtp(phone: string): Promise<{ status: string }> {
  return request('/driver/auth/request-otp', { method: 'POST', body: JSON.stringify({ phone }) });
}

export function verifyOtp(phone: string, code: string): Promise<{ token: string; driver_id: string }> {
  return request('/driver/auth/verify-otp', { method: 'POST', body: JSON.stringify({ phone, code }) });
}

// ── Driver session (bearer token) ────────────────────────────────────────────
export function goOnline(token: string, loc?: { lat: number; lng: number }): Promise<DriverState> {
  return request('/driver/online', { method: 'POST', token, body: JSON.stringify(loc ?? {}) });
}

export function goOffline(token: string): Promise<DriverState> {
  return request('/driver/offline', { method: 'POST', token });
}

export function updateLocation(token: string, lat: number, lng: number): Promise<void> {
  return request('/driver/location', { method: 'POST', token, body: JSON.stringify({ lat, lng }) });
}

export function listOffers(token: string): Promise<{ data: Offer[] }> {
  return request('/driver/offers', { method: 'GET', token });
}

// H2: the open job board — COARSE pending jobs a verified driver could grab (distance,
// the driver's cut, COD y/n; NO address/contact pre-claim). Full detail is revealed only
// on claim (reuses claimDelivery). Empty when the board flag is off / the driver's
// unverified.
//
// DERIVED from the contract's inline board item, not hand-written — see the note at the
// top of this file about why every one of these is now a lookup.
export type BoardJob = NonNullable<
  paths['/driver/board']['get']['responses'][200]['content']['application/json']['data']
>[number];
export function getBoard(token: string): Promise<{ data: BoardJob[] }> {
  return request('/driver/board', { method: 'GET', token });
}

export function getDelivery(token: string, id: string): Promise<DriverDelivery> {
  return request(`/driver/deliveries/${id}`, { method: 'GET', token });
}

// #66 (batching): the driver's whole active RUN — every in-flight leg, primary-first
// (the /claim leg, then /append legs by sequence). One leg at MAX_CONCURRENT_JOBS=1
// (parity with getDelivery). The run-aware active screen shows all stops.
export async function getActiveLegs(token: string): Promise<DriverDelivery[]> {
  const { data } = await request<{ data: DriverDelivery[] }>('/driver/deliveries/active', { method: 'GET', token });
  return data;
}

export function claimDelivery(token: string, id: string): Promise<DriverDelivery> {
  return request(`/driver/deliveries/${id}/claim`, { method: 'POST', token });
}

// F2/F4 (batching): claim a compatible job to ADD to the current run (the driver is
// already busy). Routed to /append, which bounds the concurrent-job limit and re-checks
// the combined COD under lock. 409 if at the limit / over the cap / on an auction.
export function appendDelivery(token: string, id: string): Promise<DriverDelivery> {
  return request(`/driver/deliveries/${id}/append`, { method: 'POST', token });
}

// board grab (issue 170): claim a pending job straight off the open board — one the driver
// was NOT offered. Re-checks verification + capacity + the COD cap under lock. 409 if the
// board's closed / the job's gone or an auction / the driver's ineligible.
export function grabDelivery(token: string, id: string): Promise<DriverDelivery> {
  return request(`/driver/deliveries/${id}/grab`, { method: 'POST', token });
}

// Bid on a customer-named auction (ADR-036): ACCEPT the customer's opening price, or COUNTER with
// the courier's own price (rejected by the server above the delivery's 10× ceiling). Sealed — the
// courier sees only their own bid. Unlike claim, this does NOT assign the job; the buyer/auto-clear
// accepts a bid later, at which point the driver is assigned and the job surfaces via the active-job
// reconcile. Returns the submitted bid.
export function submitBid(
  token: string,
  id: string,
  input: { type: 'accept' | 'counter'; price_minor?: number },
): Promise<DeliveryBid> {
  const body =
    input.type === 'counter' ? { type: 'counter', price_minor: input.price_minor } : { type: 'accept' };
  return request(`/driver/deliveries/${id}/bid`, { method: 'POST', token, body: JSON.stringify(body) });
}

export function markPickedUp(token: string, id: string): Promise<DriverDelivery> {
  return request(`/driver/deliveries/${id}/picked_up`, { method: 'POST', token });
}

export function markInTransit(token: string, id: string): Promise<DriverDelivery> {
  return request(`/driver/deliveries/${id}/in_transit`, { method: 'POST', token });
}

export function markDelivered(
  token: string,
  id: string,
  // pod_pin = the at-door code the customer reads out; a match upgrades the PoD
  // method to 'otp' server-side (overriding `method`), a mismatch rejects (400).
  pod?: { method?: string; note?: string; cod_collected_minor?: number; pod_pin?: string },
): Promise<DriverDelivery> {
  return request(`/driver/deliveries/${id}/delivered`, {
    method: 'POST',
    token,
    body: JSON.stringify(pod ?? {}),
  });
}

/** Presigned PUT to upload a proof-of-delivery photo for an active job (ADR-041/R11).
 *  The driver PUTs the bytes to `upload.url`, then marks delivered with method='photo'
 *  (the server stamps the deterministic key). 503 when photo storage is unconfigured. */
export type PodPhotoUpload = Schemas['PresignedUpload'];
export function getPodPhotoUrl(token: string, id: string): Promise<PodPhotoUpload> {
  return request(`/driver/deliveries/${id}/pod-photo-url`, { method: 'POST', token });
}

export type FailureReason = Schemas['FailureReason'];

export function markFailed(token: string, id: string, reason?: FailureReason): Promise<DriverDelivery> {
  return request(`/driver/deliveries/${id}/failed`, {
    method: 'POST',
    token,
    // No body when no reason — keeps the bodyless-POST path (and older servers) valid.
    ...(reason ? { body: JSON.stringify({ reason }) } : {}),
  });
}

// ── Profile + vehicle (ADR-003 P0) ────────────────────────────────────────────
// Types come straight from the regenerated contract so the client can't drift.
// (cod_cap_minor is the collateral-backed cap; cod_outstanding_minor/headroom are
// the C8 fields — all now in the re-vendored contract, no augmentation needed.)
export type DriverProfile = Schemas['DriverProfile'];
export type DriverVehicle = Schemas['DriverVehicle'];
export type VehicleType = DriverVehicle['type'];

export function getProfile(token: string): Promise<DriverProfile> {
  return request('/driver/profile', { method: 'GET', token });
}

/** Driver-editable profile fields (name/display name/language/emergency contact);
 *  the structured vehicle is set via putVehicle. */
export function updateProfile(
  token: string,
  patch: {
    name?: string;
    display_name?: string;
    preferred_language?: string;
    emergency_contact_name?: string;
    emergency_contact_phone?: string;
  },
): Promise<void> {
  return request('/driver/profile', { method: 'PATCH', token, body: JSON.stringify(patch) });
}

export function getVehicle(token: string): Promise<{ data: DriverVehicle | null }> {
  return request('/driver/vehicles', { method: 'GET', token });
}

// ── Verification documents (ADR-003 P1) ───────────────────────────────────────
export type DriverRequirement = Schemas['DriverRequirement'];
export type PresignedUpload = Schemas['PresignedUpload'];
export type FileRequirementType =
  | 'identity_id'
  | 'profile_photo'
  | 'drivers_licence'
  | 'vehicle_registration';

export function getDocuments(token: string): Promise<{ data: DriverRequirement[] }> {
  return request('/driver/documents', { method: 'GET', token });
}

/** Begin a document submission — returns a presigned PUT URL (503 if storage off). */
export function getUploadUrl(token: string, type: FileRequirementType): Promise<PresignedUpload> {
  return request(`/driver/documents/${type}/upload-url`, { method: 'POST', token });
}

export function confirmDocument(token: string, documentId: string): Promise<void> {
  return request('/driver/documents/confirm', {
    method: 'POST',
    token,
    body: JSON.stringify({ document_id: documentId }),
  });
}

export function acceptTerms(token: string, version: string): Promise<void> {
  return request('/driver/documents/terms', {
    method: 'POST',
    token,
    body: JSON.stringify({ version }),
  });
}

// ── Payout methods (ADR-003 P2) ───────────────────────────────────────────────
export type PayoutMethod = Schemas['PayoutMethod'];

export function getPayoutMethods(token: string): Promise<{ data: PayoutMethod[] }> {
  return request('/driver/payout-methods', { method: 'GET', token });
}

/** Add a payout method (account ref is encrypted server-side; 503 if payouts off). */
export function addPayoutMethod(
  token: string,
  body: { kind: 'ecocash' | 'bank'; account_ref: string; holder_name: string; bank_name?: string },
): Promise<PayoutMethod> {
  return request('/driver/payout-methods', { method: 'POST', token, body: JSON.stringify(body) });
}

export function setDefaultPayoutMethod(token: string, id: string): Promise<void> {
  return request(`/driver/payout-methods/${id}/default`, { method: 'POST', token });
}

// ── Availability schedule (ADR-003 P4) ────────────────────────────────────────
export type ScheduleWindow = Schemas['ScheduleWindow'];

export function getSchedule(token: string): Promise<{ data: ScheduleWindow[] }> {
  return request('/driver/schedule', { method: 'GET', token });
}

export function setSchedule(token: string, windows: ScheduleWindow[]): Promise<void> {
  return request('/driver/schedule', { method: 'PUT', token, body: JSON.stringify({ windows }) });
}

/** Upsert the driver's active vehicle (one active per driver, server-enforced). */
export function putVehicle(
  token: string,
  vehicle: {
    type: VehicleType;
    make?: string;
    model?: string;
    colour?: string;
    plate?: string;
    year?: number;
    capacity_kg?: number;
  },
): Promise<DriverVehicle> {
  return request('/driver/vehicles', { method: 'PUT', token, body: JSON.stringify(vehicle) });
}

// ── History + decline (ADR-002 B) ─────────────────────────────────────────────
export type PodMethod = NonNullable<Schemas['ProofOfDelivery']['method']>;

/** A past job (the Jobs tab): the public delivery shape + the driver's cut + the
 *  per-job facts that make it a real work record — how it was confirmed, when it
 *  completed, and the cash actually collected. NO contacts (stale customer PII). */
export type HistoryItem =
  paths['/driver/deliveries']['get']['responses'][200]['content']['application/json']['data'][number];

/** A page of job history. Pass `opts.before` = the previous page's `next_before`
 *  (opaque cursor) to load older jobs; `next_before` is null when there are none. */
export function listMyDeliveries(
  token: string,
  opts: { limit?: number; before?: string; status?: string } = {},
): Promise<{ data: HistoryItem[]; next_before: string | null }> {
  const qs = new URLSearchParams();
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.before) qs.set('before', opts.before);
  if (opts.status) qs.set('status', opts.status);
  const q = qs.toString();
  return request(`/driver/deliveries${q ? `?${q}` : ''}`, { method: 'GET', token });
}

export function declineOffer(token: string, id: string): Promise<void> {
  return request(`/driver/offers/${id}/decline`, { method: 'POST', token });
}

// H4: reset (extend) this driver's own live offer countdown once. Returns the new
// expiry so the card's countdown jumps forward. 409 if it can't be reset (already
// used, lapsed, claimed) — the caller treats that as "reset spent" and hides the button.
export function resetOffer(token: string, id: string): Promise<{ offer_expires_at: string }> {
  return request(`/driver/offers/${id}/reset`, { method: 'POST', token });
}

// ── Earnings + push (ADR-002 A.1/A.4) ────────────────────────────────────────
// Was hand-written, and had silently DRIFTED: it omitted `referral_earned_minor`,
// which the contract marks required and the server has always returned. The screen
// therefore could not show referral credit at all. Derived from the contract now, so
// the compiler catches the next one.
export type Earnings =
  paths['/driver/earnings']['get']['responses'][200]['content']['application/json'];

export function getEarnings(token: string): Promise<Earnings> {
  return request('/driver/earnings', { method: 'GET', token });
}

/** Per-day earnings behind the weekly chart — one bucket per day, OLDEST FIRST,
 *  ending on today, with quiet days returned as zeros. Also derived from the
 *  contract; `EarningsDay` is an index INTO that derived type, not a re-spelling. */
export type EarningsHistory =
  paths['/driver/earnings/history']['get']['responses'][200]['content']['application/json'];
export type EarningsDay = EarningsHistory['days'][number];

/** `days` is clamped server-side (1..31); omit it to take the server's default of 7. */
export function getEarningsHistory(token: string, days?: number): Promise<EarningsHistory> {
  return request(`/driver/earnings/history${days != null ? `?days=${days}` : ''}`, {
    method: 'GET',
    token,
  });
}

export function registerPushToken(
  token: string,
  pushToken: string,
  platform: 'android' | 'ios',
): Promise<void> {
  return request('/driver/push-token', {
    method: 'POST',
    token,
    body: JSON.stringify({ token: pushToken, platform }),
  });
}

export function removePushToken(token: string, pushToken: string): Promise<void> {
  return request('/driver/push-token', {
    method: 'DELETE',
    token,
    body: JSON.stringify({ token: pushToken }),
  });
}
