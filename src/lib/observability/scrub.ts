// PII scrubber for anything Sentry is about to send off a courier's handset.
//
// This app is the most PII-dense surface in the estate. On any given delivery the
// device is holding the recipient's phone number and name, the pickup/dropoff
// addresses and landmarks, a live GPS fix, the at-door 4-digit code, a cash figure,
// a proof-of-delivery photo and a bearer token that IS the driver's session. None of
// that has any business leaving the phone to answer "why did the app crash".
//
// `sendDefaultPii: false` is already set at init (see `sentry.ts`), but that only
// stops the SDK harvesting PII on purpose. It does nothing about PII that lands in an
// error message, a console breadcrumb, a network breadcrumb URL or an `extra` bag.
// This app logs `${e.message}` in several places, so that path is real, not
// theoretical.
//
// Two hooks, because they cover different escape routes:
//   · `scrubBeforeSend` runs on every JS error event.
//   · `scrubBeforeBreadcrumb` runs when each breadcrumb is RECORDED. That one matters
//     more than it looks: breadcrumbs are mirrored onto the NATIVE scope, and a hard
//     native crash is assembled and sent by the native layer on the next launch, so
//     it never passes through the JS `beforeSend`. Scrubbing at record time is the
//     only place that reaches those.
//
// Redaction works two ways: by KEY NAME in structured data, and by VALUE PATTERN in
// free text. Pure and dependency-free (the Sentry import is types-only) so it runs
// identically on device and under vitest.
//
// Known limits, stated rather than papered over: a bare personal name in a field
// called `name` is not caught (too broad to key-match, no reliable value pattern:
// the same call the core app made); a lone coordinate outside a lat/lng-named field
// is not caught (any 4-decimal number would match, including distances and money);
// and an opaque bearer token pasted into a message WITHOUT the "Bearer " prefix has
// no pattern to match on. The high-sensitivity set is covered: phones, coordinates,
// the at-door code, tokens, addresses, payout refs and presigned URLs.

import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';

const REDACTED = '[redacted]';
const MAX_DEPTH = 8;

// Key-name match, SUBSTRING (case-insensitive). Every entry is specific enough that
// substring matching cannot swallow a field we actually want.
const SENSITIVE_KEY_PARTS = [
  'phone', 'email', 'address', 'landmark', 'instruction',
  'password', 'passwd', 'secret', 'token', 'authorization', 'cookie', 'apikey', 'api_key',
  'otp', 'pod_pin', 'podpin',
  'latitude', 'longitude', 'coord', 'geohash',
  'contact', 'recipient', 'received_by', 'receivedby',
  'customer_name', 'customername', 'display_name', 'displayname',
  'account_ref', 'accountref', 'holder_name', 'holdername',
  'ip_address', 'ipaddress',
] as const;

// Key-name match, EXACT (case-insensitive). These are too short or too common to
// substring-match: 'code' as a substring would redact `status_code`, which is the
// single most useful field on a network breadcrumb; 'pin' as a substring would redact
// anything containing "spin". Matching them exactly keeps the debugging value and
// still catches the real carriers: the OTP arrives as `code`, the at-door code as
// `pin`, the door-step handover text as `note`.
const SENSITIVE_KEY_EXACT = new Set([
  'lat', 'lng', 'lon', 'geo',
  'pin', 'code', 'note', 'plate', 'username',
]);

// Value-pattern match for free text: messages, breadcrumb messages, string leaves.
// Order matters: the specific patterns run before the general ones.
const VALUE_PATTERNS: { re: RegExp; replacement: string }[] = [
  // The driver's session bearer. Leaking one hands over the account.
  { re: /\bBearer\s+[\w\-.~+/]+=*/gi, replacement: 'Bearer [redacted]' },
  // Expo push token: a device address, and enough to spam one driver's handset.
  { re: /ExponentPushToken\[[^\]]*\]/g, replacement: '[push-token]' },
  // Strip the QUERY STRING off any URL. The proof-of-delivery photo and the
  // verification documents upload to presigned URLs whose signature IS the write
  // capability, and those URLs travel in network breadcrumbs. The path survives, so
  // a breadcrumb still tells you WHICH endpoint failed; nothing here rides in a
  // query string that is worth the risk (the app sends only `?days=` and `?status=`).
  { re: /(https?:\/\/[^\s?]+)\?\S*/g, replacement: '$1?[redacted]' },
  // A decimal-degree coordinate PAIR, e.g. a fix logged as "-17.8252,31.0335".
  // Four decimals or more is roughly 10m, so this does not touch money or distances.
  { re: /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g, replacement: '[coords]' },
  // Zimbabwe mobile numbers: +263 7XXXXXXXX / 263 7XXXXXXXX / 07XXXXXXXX.
  { re: /(?:\+?263[\s-]?|0)7\d{8}/g, replacement: '[phone]' },
  // Any other E.164 number (a merchant contact, a support line).
  { re: /\+\d{9,15}/g, replacement: '[phone]' },
];

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SENSITIVE_KEY_EXACT.has(k)) return true;
  return SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}

export function scrubString(value: string): string {
  let out = value;
  for (const { re, replacement } of VALUE_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

// Recursively redact a structured value: sensitive KEYS are redacted wholesale, string
// leaves are pattern-scrubbed. Depth-limited and cycle-safe (a shared reference is not
// over-redacted, because each node is removed from `seen` on the way back up).
export function scrubData(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return REDACTED;

  const obj = value as object;
  if (seen.has(obj)) return REDACTED; // genuine cycle
  seen.add(obj);

  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((item) => scrubData(item, depth + 1, seen));
  } else {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : scrubData(val, depth + 1, seen);
    }
    result = out;
  }

  seen.delete(obj);
  return result;
}

/** Scrub one breadcrumb in place. Covers console logs, network breadcrumbs and
 *  anything added via `Sentry.addBreadcrumb`. */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  if (typeof crumb.message === 'string') crumb.message = scrubString(crumb.message);
  if (crumb.data) crumb.data = scrubData(crumb.data) as typeof crumb.data;
  return crumb;
}

/** Redact PII from every field of an error event that can carry it. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (typeof event.message === 'string') event.message = scrubString(event.message);
  if (event.logentry?.message) event.logentry.message = scrubString(event.logentry.message);
  if (typeof event.transaction === 'string') event.transaction = scrubString(event.transaction);

  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = scrubString(ex.value);
  }

  for (const crumb of event.breadcrumbs ?? []) scrubBreadcrumb(crumb);

  if (event.request) event.request = scrubData(event.request) as typeof event.request;
  if (event.extra) event.extra = scrubData(event.extra) as typeof event.extra;
  if (event.tags) event.tags = scrubData(event.tags) as typeof event.tags;

  if (event.contexts) {
    event.contexts = scrubData(event.contexts) as typeof event.contexts;
    // The device context carries the phone's own name, which on a personal handset is
    // usually the owner's name ("Tapiwa's A03"). The model, OS and memory figures are
    // the parts that help debug a low-end-Android crash; the name is not.
    if (event.contexts.device) delete event.contexts.device.name;
  }

  // Keep ONLY the installation id, which is what makes "how many devices hit this"
  // countable. Everything else on the user object (ip, email, username, geo) is either
  // PII or identifying, and none of it is set by this app on purpose.
  event.user = event.user?.id != null ? { id: event.user.id } : undefined;

  return event;
}

/** Sentry `beforeSend` hook. Fails CLOSED: if scrubbing unexpectedly throws, the event
 *  is dropped rather than risk shipping un-scrubbed PII. A courier app losing one crash
 *  report is a far cheaper mistake than a courier app leaking a customer's address. */
export function scrubBeforeSend(event: ErrorEvent): ErrorEvent | null {
  try {
    return scrubEvent(event);
  } catch {
    return null;
  }
}

/** Sentry `beforeBreadcrumb` hook. Same fail-closed posture: drop the breadcrumb. */
export function scrubBeforeBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  try {
    return scrubBreadcrumb(crumb);
  } catch {
    return null;
  }
}
