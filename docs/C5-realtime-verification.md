# C5 — Realtime resilience & battery verification (device gate)

Epic C's close-out gate (#53). C1–C4 shipped the live socket + the poll-slowdown;
C5 is the **on-device measurement** that decides whether the socket earns its keep.
This is founder/device work — it can't be closed from CI.

## What ships in code (C1–C5, all flag-gated `EXPO_PUBLIC_REALTIME_ENABLED`)
- **C4** (`src/lib/realtime.ts`, `HomeScreen`): a `react-native-sse` connection to
  `/v1/driver/stream`; `offer.new` → immediate `loadOffers`. Push + poll stay the
  floor; the dedupe (`seenOfferIds`) prevents triple-notify.
- **C5** (`HomeScreen`): while the socket is **healthy**, the offer poll drops from
  `POLL_MS` (5s) to `SLOW_POLL_MS` (20s). Any drop/60s-staleness flips
  `socketHealthy` false → the poll snaps back to 5s. This is the battery mechanism;
  without it C4 is battery-negative (persistent socket + unchanged poll).

## Run the matrix (real Samsung, EAS build — NOT Expo Go; the background-location
## + socket behaviour differs in Go)
Build with `EXPO_PUBLIC_REALTIME_ENABLED=true` against prod (`urafro-next`, which
must also have `REALTIME_ENABLED=true` on Fly). Go online; have ops create test
deliveries.

| # | Scenario | Expected | Pass criteria |
|---|----------|----------|---------------|
| 1 | **Happy path** — good WiFi/4G, offer created | Offer banner appears within ~1–2s (socket), before the 20s poll | Socket beats poll; no duplicate notification |
| 2 | **Flaky network** — toggle airplane mode on/off repeatedly for a shift | Socket reconnects (capped backoff); poll snaps to 5s while down | **Zero missed offers** across the shift |
| 3 | **Socket forcibly dead** — block the SSE host (or kill the stream) but keep data | No offer arrives via socket; poll (5s) + FCM push still deliver every offer | **Zero missed offers** on push+poll alone |
| 4 | **Backgrounded** — app in background for 10+ min, offer created | FCM push wakes the driver (socket may be suspended) | Push delivers; on resume the socket reconnects |
| 5 | **Battery** — full shift (e.g. 3–4h online) with socket ON vs a control shift socket OFF (flag off) | — | Socket-on draw within an agreed budget of socket-off (target: **no worse**, ideally better thanks to the 20s poll) |

## The decision C5 records
1. **Battery**: is socket-on (with the 20s slow-poll) within budget vs pure push+poll?
   If the slow-poll doesn't recoup the socket's cost, either widen `SLOW_POLL_MS`
   or ship C4/C5 disabled until supply density justifies it.
2. **Fill-rate**: does the 20s backstop poll (while socket healthy) ever cost an
   offer that 5s would have caught? (Scenario 2/3 — must be zero.)
3. **Verdict**: keep the flag on for the pilot, or hold it off. Doze-proof <10s
   latency still needs FCM regardless — **the socket is an accelerant, not a
   replacement for push**. Document that conclusion here; don't let it read as a
   regression of the push floor.

## Run results
**2026-07-02 · EAS preview build (flag on) · Samsung SM-G998U (Galaxy S21 Ultra), Android 14 · prod urafro-next (Fly v66, REALTIME_ENABLED=true).**

- **Scenario 1 (happy path) — ✅ PASS.** A single real offer, delivered by all three paths; the **socket won**:
  - `09:43:35.051  [offers] socket: loaded 1`  ← socket delivered first
  - `09:43:35.132  [offers] push:   loaded 1`  ← FCM push, +81 ms
  - `09:43:37.282  [offers] poll:   loaded 1`  ← poll caught up, +2.2 s
  So `matching.offer()` → broadcast `driver:{id}` → the phone's socket → `loadOffers('socket')` works end-to-end, ~2.2 s ahead of the poll.
- **No triple-notify — ✅ PASS.** The socket loaded the offer first; the later push/poll fetches found it already in `seenOfferIds`, so only one local notification fired.
- **Floor intact — ✅ PASS.** Push and poll delivered the same offer redundantly — the socket is additive, not a replacement.
- **C5 poll-slowdown — ✅ PASS.** With the socket healthy the poll dropped 5 s → **20 s** and held it exactly (six ticks 09:47:52 / 09:48:12 / 09:48:32 / 09:48:52 / 09:49:12 / 09:49:32).
- **Scenario 2 (flaky reconnect):** not explicitly toggled this run; the capped-backoff + 60 s-staleness reconnect is unit-covered (`realtime.test.ts`).
- **Scenario 5 (battery, socket-on vs off over a shift): DROPPED as a gate (2026-07-02 co-founder decision).** No consumer blocks on the number, and the risk points the *other* way: the device-verified poll-slowdown removes **3 of every 4** HTTP polls (5 s → 20 s), each of which spins the radio, while the socket adds only a light ~25 s heartbeat — so a healthy shift should be battery **neutral-or-better**, not worse. The remedy if a real driver ever reports drain is a one-line config change (widen `SLOW_POLL_MS`, `HomeScreen.tsx:81`) or flags off — a cheap, reversible knob, not an architecture change. So the number is captured **in-pilot** from real shifts when realtime launches, not as a pre-launch measurement. (Issue #53 closed on this basis; the optional unplugged `batterystats` A/B — `adb tcpip 5555` over WiFi then unplug — remains available if a drain complaint ever warrants it.)

**Verdict:** the socket + poll-slowdown + push/poll floor all work on real hardware — **functionally green**. Realtime's **resting state is OFF** (server `REALTIME_ENABLED` unset to its clean default 2026-07-02; both client flags off), because realtime is additive over the durable push+poll+FCM floor and its marginal value is low at thin supply. A **user-facing launch is a deliberate, staged step** — flip server `REALTIME_ENABLED` + a realtime-enabled EAS driver build to **1–2 trusted drivers first** (the floor backstops, so the worst case is offers arriving un-accelerated) + the merchant `NEXT_PUBLIC_REALTIME_ENABLED` — reading battery + the Scenario-2/3/4 resilience in-situ, then widening. Trigger it when the driver **data-cost / faster-offer** win is worth the attention, **not** on any owed measurement. Before a high-fanout rollout, lower `REALTIME_MAX_CONNECTIONS` from the optimistic 1000 default (512 MB shared-cpu-1x box).
