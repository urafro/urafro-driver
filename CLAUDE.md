# urAfro Driver — project instructions

You are my technical co-founder. **Current stage: ADR-002 Phases A + B app
batches SHIPPED and largely device-proven.** Timeline: core loop verified
on-device 2026-06-09 (real Samsung — OTP login → claim → lifecycle → background
GPS screen-locked + moving); Phase A batch (PR #12) shipped 2026-06-10 —
notifications (MAX-importance `offers` channel, Expo push-token registration +
local-notify fallback), mid-run abort w/ 6-reason picker, delivered confirm (COD
cash + received-by note, riding the offline queue), driver's-cut display,
earnings card, job-snapshot resilience, background-permission interstitial,
ops-WhatsApp button. **FCM push is LIVE and device-verified 2026-06-10**
(killed-app + locked-phone offer notifications; Firebase project
`urafro-driver`, google-services via secret EAS file env, FCM-V1 key uploaded
by the founder). **Phase B app batch (PR #19, 2026-06-10): tab navigation
(🛵 Shift / 🗂️ Jobs / 👤 Profile — Shift stays mounted, hidden via
`display:'none'`, because its polls/listeners are the shift heartbeat), job
history, profile editing + money block, offer decline ("Pass").** **At-door PIN
entry (PR #20, 2026-06-10):** the delivered confirm now leads with the 4-digit
delivery code (match → verified `otp` PoD server-side; wrong code keeps the
panel open with honest copy; subdued manual fallback; the code rides the offline
queue with a manual-fallback replay so a rejected code never strands a
delivery) — closing the gap on-device testing caught (completions were silently
booking `manual`). **On-device verification still pending for: the Phase B
surfaces (tabs/history/profile/decline) and PIN entry (#20 APK).** The build
mandate is **urafro-next ADR-002: a complete delivery system, not
pilot-minimum.** Core loop underneath: login → go
online → poll/push offers → claim → run the job to delivered/failed. This is an Expo + TypeScript app — the supply-side
**driver client** for the **urAfro Next** delivery platform (separate repo
`urafro/urafro-next`; placement rationale in urafro `ADR-029`). The platform's
server side is **live in production** (`https://urafro-next.fly.dev`) with the full
`/v1/driver/*` API and phone-OTP onboarding working end-to-end. What exists here: a
**contract-bound typed API client** (`src/lib/api.ts` over generated types), secure
token storage (`src/lib/session.ts`), a session-gated root, the **OTP login flow**
(`src/screens/LoginScreen.tsx`), and the **shift controller** (`src/screens/HomeScreen.tsx`)
— online/offline + a foreground location/offer poll, the offers list
(`src/components/OffersList.tsx`), claim, and the **active-job lifecycle**
(`src/components/ActiveJob.tsx`: picked_up → in_transit → delivered + failed; PoD =
at-door 4-digit code → verified `otp`, with a manual fallback). **2G offline resilience is done** — lifecycle actions
that fail transiently are persisted (`src/lib/queue.ts`) and a background flush
retries them until they land (retry on network/5xx, drop on 4xx), with a
"waiting to sync" indicator. **Background GPS is built** (`src/lib/background-location.ts`
— an expo-task-manager headless task streams fixes foreground + background; starts
on go-online, stops on go-offline; foreground poll defers to it when active) —
**device-verified 2026-06-09/10** (EAS preview builds on a real Samsung; Expo Go is
a dead end for SDK 56 — background tasks don't run there). Navigation is the
hand-rolled tab switcher in `App.tsx` (no nav lib, deliberate). **Next: on-device
pass of the Phase B surfaces + PIN entry; then photo PoD capture and jest-expo
component tests.**
**Unit tests:** vitest covers the pure logic (`toE164`, formatters, queue retry
policy, api client, link builders); component/screen tests still TODO. My background is as an amateur
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
Android, **intermittent 2G-grade networks** (offline tolerance is mandatory),
informal addressing (a GPS pin + landmark is authoritative). The hardest part of
this app is **reliable background GPS on low-end Android** (ADR-001 risk).

## Stack

- **Expo (managed) + React Native + TypeScript** · Android-first · EAS Build for device/store later
- **expo-secure-store** for the bearer token (OS keystore, never plain storage)
- **A thin fetch client** (`src/lib/api.ts`) — no SDK; mirrors the backend's ethos
- **Contract-first:** API types are **generated** from `urafro-next/openapi/v1.yaml`, vendored here as `contract/v1.yaml`

## Commands

```bash
npm start            # expo dev server (scan QR with Expo Go, or run a simulator)
npm run android      # build/run on Android
npm run typecheck    # tsc --noEmit
npm run gen:types    # regenerate src/types/api.gen.ts from contract/v1.yaml
```

## Layout

```
App.tsx                 app root (placeholder until login lands)
src/config.ts           API base URL (EXPO_PUBLIC_API_BASE override)
src/lib/api.ts          typed /v1/driver/* client
src/lib/session.ts      secure token + driver-id storage
src/types/api.gen.ts    GENERATED from the OpenAPI contract — do not hand-edit
contract/v1.yaml        vendored copy of urafro-next's /v1 contract
```

## Guardrails

- **Contract is the source of truth.** Don't hand-edit `src/types/api.gen.ts`; when
  the platform's `/v1` contract changes, re-vendor `contract/v1.yaml` and run
  `npm run gen:types`. Never invent endpoints the platform doesn't expose.
- **Branch → PR → CI → merge.** No direct pushes to `main`. CI runs typecheck.
- **Never commit secrets.** No API keys/tokens in the repo; runtime config via
  `EXPO_PUBLIC_*` (note: those are **inlined into the build**, so never put a real
  secret there — only the public API base).
- **Respect the constraints:** keep the bundle light, make every network action
  offline-tolerant (optimistic + retry), and treat background location as the
  highest-risk surface.
- **Verify before claiming done:** typecheck (and, once present, run on a device)
  before reporting success.
