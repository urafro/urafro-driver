// One defensive parse for Sentry's tracesSampleRate. Ported from the core app's
// `src/lib/observability/trace-sample-rate.ts` so both clients read a rate the same way.
//
// It exists because the obvious inline form is wrong in two ways that both fail
// SILENTLY, which is the worst failure mode for an observability setting: you only
// discover it when you go looking for a trace that was never sampled.
//
//   Number(process.env.X ?? 0)
//     · X set but BLANK does not trigger `??`, because '' is neither null nor
//       undefined. That is exactly what Expo inlines for an EXPO_PUBLIC_* var that
//       was declared and later cleared, and the shape of an `X=` line in a .env file.
//     · X mistyped ("10%", "0,5", a stray quote) yields NaN, and Sentry then treats
//       the rate as unset/invalid rather than as the intended value.
//
// So: treat blank as absent, reject anything not finite, and clamp into Sentry's
// valid 0..1 range. The documented default is then true for unset, blank AND
// malformed values, which is the whole point.
//
// Number() rather than parseFloat() on purpose: parseFloat('0.5oops') === 0.5, which
// silently accepts a typo'd value instead of falling back to the default. A sampling
// rate should be exactly what was written or the documented default, never a prefix
// of what was written.
//
// Pure and dependency-free so it is unit-testable without pulling in the native SDK.
// Callers pass the env value in rather than reading it here, because only a literal
// `process.env.EXPO_PUBLIC_…` reference is inlined into the app bundle at build time.
// A dynamic read inside this module would be undefined on device.

/** Traced share of transactions when nothing usable is configured.
 *
 *  ZERO, deliberately, and it is the driver app's default for the same reason the
 *  platform runs 0: traces bill per span, and this client rides a 3G-primary,
 *  sometimes-EDGE network on low-end Android where every extra envelope costs the
 *  driver's own data. Crashes are the signal we are buying; latency traces are not.
 *  Override per build with EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE if a latency
 *  question ever comes up. */
export const DEFAULT_TRACES_SAMPLE_RATE = 0;

export function parseSampleRate(
  raw: string | undefined | null,
  fallback: number = DEFAULT_TRACES_SAMPLE_RATE,
): number {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), 1);
}
