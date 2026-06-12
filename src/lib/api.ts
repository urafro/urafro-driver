import { API_V1 } from '../config';
import type { components } from '../types/api.gen';

// Typed client for the urAfro Next /v1/driver/* API. Response shapes come straight
// from the platform's OpenAPI contract (src/types/api.gen.ts, regenerated via
// `npm run gen:types`), so the client can never drift from the server. A plain
// fetch wrapper — no SDK — mirroring the backend's own ethos.

type Schemas = components['schemas'];
export type Delivery = Schemas['Delivery'];
export type Offer = Schemas['Offer'];
export type DriverState = Schemas['DriverState'];
// The assigned driver's view of a delivery — includes the pickup/dropoff contacts.
export type DriverDelivery = Schemas['DriverDelivery'];

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

async function request<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${API_V1}${path}`, {
    ...rest,
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

export function getDelivery(token: string, id: string): Promise<DriverDelivery> {
  return request(`/driver/deliveries/${id}`, { method: 'GET', token });
}

export function claimDelivery(token: string, id: string): Promise<DriverDelivery> {
  return request(`/driver/deliveries/${id}/claim`, { method: 'POST', token });
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

export type FailureReason =
  | 'customer_unreachable'
  | 'wrong_address'
  | 'customer_refused'
  | 'cash_refused'
  | 'vehicle_problem'
  | 'other';

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
/** A past job: the public delivery shape + the driver's cut (NO contacts). */
export type HistoryItem = Delivery & { driver_fee_minor?: number | null };

export function listMyDeliveries(token: string): Promise<{ data: HistoryItem[] }> {
  return request('/driver/deliveries', { method: 'GET', token });
}

export function declineOffer(token: string, id: string): Promise<void> {
  return request(`/driver/offers/${id}/decline`, { method: 'POST', token });
}

// ── Earnings + push (ADR-002 A.1/A.4) ────────────────────────────────────────
export interface Earnings {
  payable_minor: number;
  today_minor: number;
  today_deliveries: number;
  cod_owed_minor: number;
  currency: string;
}

export function getEarnings(token: string): Promise<Earnings> {
  return request('/driver/earnings', { method: 'GET', token });
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
