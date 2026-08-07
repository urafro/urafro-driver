// Sentry init for the driver app. MUST be the first import in `index.ts`: the SDK
// installs the global JS error handler and hands the DSN to the native crash handler
// at init time, so initialising it late silently loses everything that fails before.
//
// Until now this app had NO crash or error reporting at all. That was accepted for the
// ops panel (one operator, one screen, errors visible where they happen) and is NOT
// acceptable here: when a courier's app dies mid-delivery, on a phone we do not own,
// carrying someone's cash and someone else's parcel, nobody finds out. The driver
// silently stops getting offers, or the delivery never closes, and the first signal is
// a merchant complaint hours later. This closes that.
//
// INERT WITHOUT A DSN, exactly like the platform's `src/instrument.ts`: no
// EXPO_PUBLIC_SENTRY_DSN means no init, no native SDK start, no handlers, no disk
// cache and no network. Local dev, CI, the jest/vitest runs and every EAS build made
// before the founder sets the DSN behave as they did before this file existed.
//
// The guard is resolved at BUILD time, not runtime: Expo inlines EXPO_PUBLIC_* into
// the bundle, so with no DSN `dsn` folds to a constant empty string and the minifier
// drops this whole `init` call. Verified by diffing two Android exports: the options
// object below is present in the bundle built WITH a DSN and absent from the one built
// without. What does NOT disappear is the SDK's own module graph (Metro has no
// tree-shaking), so the bundle is ~0.5KB smaller, not megabytes. The cost that
// actually matters on a low-end handset is skipped entirely: starting the native SDK,
// installing global handlers, opening the offline envelope cache.

import * as Sentry from '@sentry/react-native';

import { parseSampleRate } from './sample-rate';
import { scrubBeforeBreadcrumb, scrubBeforeSend } from './scrub';

// Expo inlines EXPO_PUBLIC_* at build time, so these are build-time decisions, not
// runtime ones. Trimmed because a declared-but-cleared variable inlines as '', which
// is falsy, but is NOT caught by a `??` default.
const dsn = (process.env.EXPO_PUBLIC_SENTRY_DSN ?? '').trim();

// Traces off by default (see sample-rate.ts for why), env-overridable per build.
const tracesSampleRate = parseSampleRate(process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE);

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      (process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? '').trim() ||
      (__DEV__ ? 'development' : 'production'),

    // ── PII: send none of it ──────────────────────────────────────────────────
    // Stops the SDK attaching PII on purpose (device name, IP, request bodies);
    // `scrub.ts` then strips the PII that leaks in by accident, on both the event
    // path and the breadcrumb path. Breadcrumbs need their own hook because they are
    // mirrored to the native scope, and a native crash is sent by the native layer
    // on next launch without ever passing through `beforeSend`.
    sendDefaultPii: false,
    beforeSend: scrubBeforeSend,
    beforeBreadcrumb: scrubBeforeBreadcrumb,
    // A screenshot or view hierarchy of the active-run screen is a picture of the
    // customer's name, phone, address and the cash owed. Both default to false; both
    // are pinned here so a future default flip cannot quietly turn them on. (These
    // two ARE safe to state explicitly, because the SDK gates their integrations on
    // the value being truthy, not on the key being present. See the note below for
    // the three options where that is not true.)
    attachScreenshot: false,
    attachViewHierarchy: false,
    // Would attach failed request/response detail, i.e. delivery payloads. Off.
    enableCaptureFailedRequests: false,
    // Touch tracing turns every tap into a breadcrumb carrying the element's label.
    // On this app those labels are the customer's name and address.
    enableUserInteractionTracing: false,

    // ── Cost: this rides a 3G-primary network on the driver's own data ─────────
    // Tracing, profiling and session replay are all OFF, and they are off by being
    // ABSENT rather than by being set to 0.
    //
    // That is not a style choice, it is the SDK's actual contract: in
    // `integrations/default.ts` the replay and profiling integrations are gated on
    // `typeof options.replaysSessionSampleRate === 'number'` and
    // `typeof options.profilesSampleRate === 'number'`, i.e. on the KEY BEING
    // PRESENT, not on its value. Writing the obvious `replaysSessionSampleRate: 0,
    // profilesSampleRate: 0` to mean "off" therefore LOADS mobile replay and Hermes
    // profiling, both of which reach into native, on the low-end Android we are
    // trying to keep light. `tracesSampleRate` behaves the same way, so it is only
    // passed when a build actually asks for tracing; the app-start, frames, stall
    // and time-to-display integrations all hang off that same key.
    //
    // What stays on is the part we are buying: native + JS crash capture, and
    // release health (one small envelope per foreground) so "did this build start
    // crashing" is answerable at all.
    ...(tracesSampleRate > 0 ? { tracesSampleRate } : {}),
    // 100 breadcrumbs on a poll-every-few-seconds app is mostly identical fetches.
    maxBreadcrumbs: 50,
    // Envelopes made offline are cached and flushed when signal returns, the whole
    // point on a network that degrades to EDGE. Default cap (30) is left alone.
  });
}

export { Sentry };
