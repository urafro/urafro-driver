# urAfro Driver

Android-first **driver app** for the [urAfro Next](https://github.com/urafro/urafro-next)
crowdsourced last-mile delivery platform. Built with **Expo + React Native + TypeScript**.

A driver uses it to: log in by phone (OTP) → go online + stream location → see
nearby job offers → claim one → run it through `picked_up → in_transit → delivered`
with proof of delivery. It is a **pure client** of the platform's `/v1/driver/*`
API — all delivery logic lives server-side in urafro-next.

> Placement rationale: urafro `ADR-029`. Platform architecture: urafro-next `ADR-001`.

## Develop

```bash
npm install
npm start            # Expo dev server — scan the QR with Expo Go, or run a simulator
npm run android      # build/run on Android
npm run typecheck    # tsc --noEmit
```

The API base defaults to the live platform (`https://urafro-next.fly.dev`); override
with `EXPO_PUBLIC_API_BASE` for local/staging.

## Crash reporting (Sentry): built, off until a DSN is set

`@sentry/react-native` is wired in (`src/lib/observability/`, initialised as the first
import in `index.ts`) and is **completely inert without a DSN**: no init, no native
SDK start, no handlers, no disk cache, no network. Every build made before the steps
below behaves exactly as it did before Sentry existed.

**PII posture (not optional on a courier app).** `sendDefaultPii` is false, screenshots
and view hierarchy are off, and `src/lib/observability/scrub.ts` strips bearer tokens,
phone numbers, coordinates, the at-door code, addresses, payout refs, presigned-URL
signatures and the device name out of both events **and** breadcrumbs before anything
leaves the handset. Breadcrumbs get their own hook on purpose: they are mirrored to the
native scope, and a native crash is sent by the native layer on next launch without
passing through `beforeSend`. Tracing, session replay and profiling are all **off**,
because this client runs on the driver's own 3G data on low-end Android. They are off
by the option being ABSENT, not set to 0: the SDK loads the replay and profiling
integrations whenever the KEY is present, whatever its value.

**To turn it on (founder, EAS side):**

1. Create a Sentry project (platform: React Native) and copy its **DSN**.
2. Add it as an EAS environment variable named `EXPO_PUBLIC_SENTRY_DSN`, for the
   `preview` and `production` environments, with **plain text** visibility (`eas env:create`,
   or the project's Environment Variables page). A DSN is public by design and is inlined
   into the bundle, so it must NOT be a secret-visibility variable: the build could not
   read it.
3. **Run a new EAS build.** This is a native change: an over-the-air update cannot
   deliver it, and the currently installed APKs will never report anything.
4. Force a crash on the test device to confirm the pipe (`Sentry.nativeCrash()` from a
   dev build, or just make the app throw) and check the issue lands in Sentry.

**Optional, later: readable stack traces.** Builds currently set
`SENTRY_DISABLE_AUTO_UPLOAD=true` in `eas.json`, which skips source-map and debug-symbol
upload so the build needs **no Sentry credentials at all**. Without it, JS stack traces
arrive minified. To enable symbolication: set `organization` and `project` on the
`@sentry/react-native/expo` plugin in `app.json`, add `SENTRY_AUTH_TOKEN` as an EAS
**secret**, and remove the two `SENTRY_DISABLE_AUTO_UPLOAD` lines from `eas.json`. Never
commit an auth token.

**Other build-time knobs** (all optional, all `EXPO_PUBLIC_*`, all inlined at build
time): `EXPO_PUBLIC_SENTRY_ENVIRONMENT` (defaults to `development`/`production`) and
`EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (defaults to `0` = no tracing at all; any value
above 0 switches on the app-start, frames, stall and time-to-display instrumentation
too, which costs battery and data).

## Contract sync

API types are **generated** from the platform's OpenAPI contract — never hand-edited.
When the `/v1` contract changes, re-vendor it and regenerate:

```bash
cp ../urafro-next/openapi/v1.yaml contract/v1.yaml
npm run gen:types
```

## Status

**Device-verified and running the full loop on real Android hardware.** OTP login →
go online + background GPS (streams foreground and screen-locked) → offers (FCM push
+ poll) → claim → `picked_up → in_transit → delivered` with at-door PIN and photo
proof-of-delivery, plus an offline/EDGE action queue, earnings + Jobs history,
profile editing, offer decline, and a battery-optimisation guard. It is a **pure
client** of urafro-next's `/v1/driver/*` API — the platform owns all delivery logic.
See **[`CLAUDE.md`](CLAUDE.md)** for the always-current build stage.

Part of the cross-repo **Gophr-parity fusion** roadmap (plan in
`urafro-next/docs/gophr-parity/`; board:
https://github.com/orgs/urafro/projects/1). Because this app ships via EAS and
**cannot be force-updated**, the platform's `/v1` contract only ever changes
backward-compatibly — see `urafro-next/docs/contract-change-protocol.md`.
