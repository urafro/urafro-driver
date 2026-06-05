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

## Contract sync

API types are **generated** from the platform's OpenAPI contract — never hand-edited.
When the `/v1` contract changes, re-vendor it and regenerate:

```bash
cp ../urafro-next/openapi/v1.yaml contract/v1.yaml
npm run gen:types
```

## Status

Foundation (Phase 6.1): scaffold + typed API client + secure token storage + CI.
Next: OTP login + the "shift" home screen (Phase 6.2).
