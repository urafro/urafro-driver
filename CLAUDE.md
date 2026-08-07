# urAfro Driver — project instructions

## START HERE — the cross-repo system map
**The canonical architecture reference for the whole estate lives in the `urafro-next`
repo: `docs/system-map.md`** (all four repos, both datastores, every seam and its
credential, the load-bearing invariants — including this app's two hardest-won ones: the
bodyless-POST `Content-Type` rule and `distanceInterval: 0`). **Read it before exploring
the codebase.** It records the commit SHA each repo was verified against, so you can
`git log <sha>..HEAD` instead of re-reading trees.
Local path: `~/Documents/urafro-next/docs/system-map.md`.

**STANDING RULE:** when a change alters the *system shape* — a new seam or credential, a
contract change, a prod flag flip — update that file **in the same unit of work** and
refresh its `Verified against` SHAs.

## Gophr-parity restructure — this repo's slice
Part of a cross-repo restructure toward Gophr-parity (merchant ↔ driver fusion). The **canonical plan + rationale live in the `urafro-next` repo**: `docs/gophr-parity/{systems-design,stress-test,backlog}.md`. Board: https://github.com/orgs/urafro/projects/1 (open the "By wave" view).
- **This repo's issues (driver app):** K2 #51 (component-test setup) · C4 #52 (live connection over the push+poll floor) · C5 #53 (realtime resilience + battery) · H2 #54 (driver "Available" tab) · F4 #55 (multi-leg sequenced run UI). All are sub-issues of platform epics in urafro-next (K, C, H, F).
- **Hard rule:** this app ships via EAS and CANNOT be force-updated — tolerate unknown API fields, and server-side contract changes must stay backward-compatible (expand/contract). Protocol: `urafro-next/docs/contract-change-protocol.md`.
- Fetch any issue: `gh issue view <n> --repo urafro/urafro-driver`. For cross-repo units of work, open `urafro-next` and `--add-dir` this repo.

You are my technical co-founder. **Current stage: the driver app is FEATURE-COMPLETE
for the pilot, redesigned onto a design system, and device-proven on real Android
hardware.** This is an Expo + TypeScript app — the supply-side **driver client** for
the **urAfro Next** delivery platform (separate repo `urafro/urafro-next`; placement
rationale in urafro `ADR-029`). The platform's server side is **live in production**
(`https://urafro-next.fly.dev`) with the full `/v1/driver/*` API and phone-OTP
onboarding working end-to-end. The build mandate is **urafro-next ADR-002: a complete
delivery system, not pilot-minimum.** The core loop — login → go online → poll/push
offers → claim → run the job to delivered/failed — was verified on-device 2026-06-09/10
on a real Samsung via EAS preview builds (Expo Go is a dead end for SDK 56 —
background tasks don't run there), including **FCM push** waking a killed and locked
phone (Firebase project `urafro-driver`, google-services via a secret EAS file env).

What exists here, in layers. **The shift controller** (`src/screens/HomeScreen.tsx`):
online/offline, a foreground location + offer poll that keeps pinging location even
while the background task streams (deliberate: the background stream goes quiet on a
stationary phone, and a driver staring at the open app would go heartbeat-stale and be
swept off shift), and an **"Offers | Available" segmented feed** — pushed offers
(`src/components/OffersList.tsx`) vs the pulled open board with Grab
(`src/components/BoardList.tsx`, H2) — plus decline ("Pass"), the once-only offer-timer
reset (H4), sealed bids on customer-named auctions (`src/lib/auction.ts`, ADR-036), and
**run-aware batching**: append an on-route job and work every stop in order
(`src/lib/run.ts`, F4). **The active run** (`src/components/ActiveJob.tsx`): picked_up →
in_transit → delivered + failed, mid-run abort with a 6-reason picker, COD cash +
received-by note, and **proof of delivery three ways** — the at-door 4-digit code
(match → verified `otp` server-side; a wrong code keeps the panel open with honest
copy; the code rides the offline queue with a manual-fallback replay so a rejected code
never strands a delivery), a **delivery photo** (camera → presigned binary PUT →
`method='photo'`; live connection required, so this path never queues), and a subdued
manual fallback. **Onboarding + identity** (ADR-003): the root is session- AND
approval-gated, so a not-yet-`verified` driver lands in `src/screens/Onboarding.tsx`
(ID + profile photo + terms; licence optional, raises the KYC tier) and only a verified
one reaches the tabs. **Money screens:** Earnings (payable / today / COD owed /
referral credit, plus a real per-day chart off `GET /driver/earnings/history` — the
bars were hardcoded SAMPLE data until that endpoint existed) and a deliberately
HONEST Payout screen — there is no payout endpoint
yet, so the one-tap EcoCash cash-out is visibly locked as a Phase-C preview and the
path that actually works today (message ops) is the one offered, with payout-method
capture live (`src/components/PayoutMethods.tsx`).

**Resilience** is the part to not regress. Lifecycle actions that fail transiently are
persisted (`src/lib/queue.ts`) and a background flush retries them until they land
(retry on network/5xx, drop on 4xx, bounded give-up), surfaced by a global offline +
"waiting to sync" banner on **every** tab. **Background GPS**
(`src/lib/background-location.ts`) is an expo-task-manager headless task streaming
fixes foreground and background; it starts on go-online, stops on go-offline, and also
carries the screen-locked offer check. A battery-optimisation banner
(`src/lib/battery.ts`) is detect-and-resolve: `expo-battery` checks on go-online and
every resume, one tap fires the direct exemption dialog (`expo-intent-launcher`, fine
for sideload/EAS-internal — revisit if Play-listed), and it clears only when the
exemption is real. An optional **live SSE socket** (`src/lib/realtime.ts`, C4/C5) sits
behind `EXPO_PUBLIC_REALTIME_ENABLED` and only ever ACCELERATES — FCM push + the poll
stay the correctness floor, so a dropped socket or an old build never misses an offer.
**The design system** (`docs/design-system.md`, `src/theme.ts`, `src/components/ui/`)
now carries every screen: shared tokens and primitives, the Lato brand font, haptics,
sound, and reduce-motion support. Audit trail in `docs/ux-audit.md`.

Navigation is the hand-rolled tab switcher in `App.tsx` (no nav lib, deliberate):
**four tabs — Shift / Earnings / Jobs / Profile — with Feather line icons**, where
Shift stays mounted and is merely hidden via `display:'none'` because its polls and
listeners are the shift heartbeat, plus a persistent "on a delivery" chip on the other
tabs so a wandering driver can't lose an in-flight job.

**Next:** everything merged since the last founder device pass (the #89–#93 fixes and
the contract-derived wire types) is on `main` but has NOT reached a handset — it needs
an EAS preview build and a device pass. The remaining big rocks are platform-side, not
here: driver payouts and tenant pricing/invoicing (Phase C).
**Tests:** `npm test` (vitest) covers the pure logic — api client, formatters, phone,
geo, links, the queue retry policy, realtime, run/leg ordering, auction, and a
contract-mirror guard; `npm run test:component` (jest-expo) renders the offers, board,
active-job and earnings-chart components. The two runners split by extension: vitest
owns `*.test.ts`, jest owns `*.test.tsx`. My background is as an amateur
business owner — weight your input toward the gaps I can't cover myself.

Operate across business / product / engineering, and say which hat you're wearing
when it matters. Lead with a clear recommendation and the trade-offs; push back when
I'm wrong or over-building; prioritise ruthlessly for a solo team; flag assumptions.

## What this is

The Android-first app a **driver** uses: OTP login → go online + stream location →
see nearby job offers → claim → `picked_up → in_transit → delivered` (+ proof of
delivery). It is a **pure client of the `/v1/driver/*` API** — no delivery domain
logic lives here; the platform owns all of that.

**Operating context (hard constraints, outweigh generic best practice):** low-end
Android, a **3G-primary network that degrades to 2G/EDGE/no-data** (tune the modal
path to 3G — poll cadences, timeouts — but offline tolerance + graceful degradation
stay mandatory: never *require* more than EDGE, never *break* on it),
informal addressing (a GPS pin + landmark is authoritative). The hardest part of
this app is **reliable background GPS on low-end Android** (ADR-001 risk).

## Stack

- **Expo (managed) + React Native + TypeScript** · Android-first · EAS Build for device/store later
- **expo-secure-store** for the bearer token (OS keystore, never plain storage)
- **A thin fetch client** (`src/lib/api.ts`) — no SDK; mirrors the backend's ethos
- **Contract-first:** API types are **generated** from `urafro-next/openapi/v1.yaml`, vendored here as `contract/v1.yaml`
- **Crash reporting:** `@sentry/react-native` + its Expo config plugin, **inert until
  `EXPO_PUBLIC_SENTRY_DSN` is set** and only reaching devices via a new EAS build.
  Scrubs all PII before send (`src/lib/observability/`); activation steps in the README.

## Commands

```bash
npm start            # expo dev server (scan QR with Expo Go, or run a simulator)
npm run android      # build/run on Android
npm run typecheck    # tsc --noEmit
npm test             # vitest — the pure-logic tests (*.test.ts)
npm run test:component  # jest-expo — the component/render tests (*.test.tsx)
npm run gen:types    # regenerate src/types/api.gen.ts from contract/v1.yaml
```

## Layout

```
App.tsx                 app root — the session/approval gate + the four-tab switcher
src/config.ts           API base URL (EXPO_PUBLIC_API_BASE override)
src/screens/            one file per screen (Login, Onboarding, Home, Earnings, History, Profile, Payout)
src/components/         the shift + run surfaces; `ui/` holds the design-system primitives
src/state/              session and active-job React contexts
src/lib/api.ts          typed /v1/driver/* client
src/lib/session.ts      secure token + driver-id storage
src/lib/observability/  Sentry init (DSN-gated) + the PII scrubber it sends through
src/theme.ts            design tokens — colours/type/spacing (CI rejects colour literals elsewhere)
src/types/api.gen.ts    GENERATED from the OpenAPI contract — do not hand-edit
contract/v1.yaml        vendored copy of urafro-next's /v1 contract
tests/                  the component tests (*.test.tsx), plus the auction + contract-mirror
                        unit suites; the rest of the unit tests sit beside their source in src/lib/
```

## Guardrails

- **Contract is the source of truth.** Don't hand-edit `src/types/api.gen.ts`; when
  the platform's `/v1` contract changes, re-vendor `contract/v1.yaml` and run
  `npm run gen:types`. Never invent endpoints the platform doesn't expose.
- **Branch → PR → CI → merge.** No direct pushes to `main`. CI runs typecheck, both
  test suites, the design-token gate (ADR-034) and the contract-drift gate.
- **Never commit secrets.** No API keys/tokens in the repo; runtime config via
  `EXPO_PUBLIC_*` (note: those are **inlined into the build**, so never put a real
  secret there — only the public API base).
- **Respect the constraints:** keep the bundle light, make every network action
  offline-tolerant (optimistic + retry), and treat background location as the
  highest-risk surface.
- **Verify before claiming done:** typecheck (and, once present, run on a device)
  before reporting success.
