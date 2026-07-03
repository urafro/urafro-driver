# urafro-driver — Phase-0 UX Audit

**Scope:** Read-only audit of the Expo/React-Native courier app (SDK 56, RN 0.85). No app code changed. Findings synthesized from six read-only reader passes across `App.tsx`, all screens, the active-run/offer components, the network/lib layer, and the theme system.

**Target market:** Low-end Android, 3G-primary, intermittent connectivity, COD / mobile-money, informal addressing, used **one-handed, mid-route**.

**Scored against four target behaviors:**
- **B1** — New batch offer mid-run: non-blocking, haptics + audio + visible dismissible cue; interactive card gated behind vehicle-stopped.
- **B2** — Step progress & completion: persistent "Stop X of Y" stepper + per-action acknowledgment/success, then route to next.
- **B3** — No silent screen changes: visible, spatially-continuous transitions (loud for offers, light+fast for routine steps).
- **B4** — System-wide consistency: shared feedback/stepper/alert/transition components, no ad-hoc state change.

---

## 1. Executive summary

The app is **functionally complete and architecturally disciplined** — the auction mechanic (accept-at-seed / one sealed counter / pass) is correct, the offline action queue is a genuinely well-designed resilience core, optimistic UI is used on the hot paths, and the **color** token system is mature (role-named, WCAG-annotated, zero hex leakage). But it is, by construction, **feedback-poor and transition-poor**. There is exactly **one animation in the entire codebase** (the ShiftStatus online-pulse halo), **zero haptics**, **zero in-app audio**, **zero shared feedback layer**, and **every state change is a silent, instant conditional re-render**. All four target behaviors currently have essentially no supporting infrastructure at the navigation, feedback, or motion layers.

**Top gaps (highest leverage first):**

1. **No shared feedback/primitive layer (B4, root cause).** Spinners, loading text, save notes, steppers, busy-dimming, and success states are re-implemented ad-hoc across ~9–16 surfaces. This is what makes B1/B2/B3 individually unfixable — every fix would ship duplicated. *(`theme.ts` exports only colors/shadow/PILL; no `components/ui` dir.)*
2. **Mid-run batch offer has zero active salience (B1).** It renders silently inline in an "On your route" section; notifications are suppressed mid-job, the background notify path early-returns on an active job, and the SSE socket is torn down while on a job. No badge, banner, buzz, or sound. *(`HomeScreen.tsx:203, 1030-1046`; `background-location.ts:50`.)*
3. **Every screen/state swap is silent and instant (B3).** No `Animated`/`LayoutAnimation` anywhere except the ShiftStatus halo — offer→job, delivered→payday, tab switches, and lifecycle steps all pop with no transition.
4. **No per-step acknowledgment and no numeric "Stop X of Y" (B2).** Collect/deliver produce only a button spinner then a silent content swap; the only success state in the app is the terminal payday card. The single-job stepper is a 4-phase bar, not a stop counter, and it is *hidden entirely* during pooled runs.
5. **No motion gating (B1).** `coords.speed` is never read; the full accept/counter/pass card — including an autofocus keyboard-popping counter input — is interactive while the vehicle is moving.

---

## 2. Screen & navigation inventory

### Navigation model

Fully **hand-rolled — no navigation library**. Three nesting levels:

1. **Root gate** (`App.tsx:97-135`): picks spinner / `LoginScreen` / `Onboarding` / `Tabs` from session + profile. Session change swaps Login↔app via re-render (`session.tsx`), not a navigator.
2. **Tabs** (`App.tsx:33-91`): a 4-key hand-rolled tab bar (`shift | earnings | history | profile`) driven by one `useState<Tab>`.
3. **Per-screen internal `useState` sub-navigation** (Login step, Onboarding step, Home state machine, Earnings→Payout, History→JobDetail).

**Mount/hide liveness rule (`App.tsx:28-32, 44-64`):** The Shift screen is **always mounted and only visually hidden** (`display:'none'` when `tab!=='shift'`) because its offer poll (5s / 20s slow), AppState listener, background-location heartbeat, and realtime socket are the on-shift liveness heartbeat — unmounting would stop offer notifications and sweep the driver off shift. Earnings/History/Profile are conditionally rendered (`tab==='x' ? <Screen/> : null`), so they **mount on entry / unmount on leave** (cheap, refetch on open).

**Every navigation is a silent instant swap.** Tab switch (display toggle), Login step (ternary), Onboarding step (ternary chain), Earnings↔Payout (`if(showPayout) return <PayoutScreen/>`), History→JobDetail (conditional overlay), and Home's giant state ternary all pop in with no motion. The only transition motion in the app is `JobDetail`'s `Modal animationType='slide'`.

**Entry points:** (a) cold launch → root spinner while session rehydrates, then routes; (b) any 401 → global sign-out → Login (`session.tsx:30-33`); (c) notification tap → `App.tsx:38-40` `setTab('shift')` + `HomeScreen.onPush` fetches/opens the offer (cold-start via `getLastNotificationResponseAsync`). **Notification-tap routing lands on Shift with no transition, highlight, or "new offer" banner** — the offers list just repopulates.

**Cross-tab active-job chip (`App.tsx:68-76`):** while off-Shift with an active job, a "On a delivery · {label}" chip (fed by `activeJob` context) taps back to Shift. This is the only spatial cue that mid-delivery state exists off-Shift.

### Screen inventory

| Screen / surface | Purpose | Entry point | Key components / sub-state |
|---|---|---|---|
| `LoginScreen.tsx` | Two-step OTP login (phone → code) | Root gate (no session) | `useState('phone'\|'code')` ternary; SubmitButton spinner; inline error |
| `Onboarding.tsx` | First-run / not-yet-verified (welcome/permissions/profile/waiting) | Root gate (unverified) | `setStep` ternary chain; **dot stepper**; approval poll on AppState |
| `HomeScreen.tsx` | **The Shift screen = the app's real state machine** | Default tab; notif tap | Giant ternary: completed→job→offers/board; `ActiveJob`, `OffersList`, `BoardList`, `ShiftStatus`; segmented "Offers \| Available" |
| `EarningsScreen.tsx` | Earnings tab; hosts Payout | Tab | `showPayout` boolean full swap; **sample** 7-day chart; no loading branch (renders dashes) |
| `PayoutScreen.tsx` | Cash-out (Phase-C preview, locked) | Inside Earnings | Custom back chevron (`onBack`); `PayoutMethods` |
| `HistoryScreen.tsx` | Jobs/history; filter chips, paginated list | Tab | `JobDetail` overlay; **only** `RefreshControl` in app; bare "Loading…" text |
| `ProfileScreen.tsx` | Identity, stats, vehicle, availability, COD cap, sign out | Tab | Pure form; persistent "Saved." note; `AvailabilityCard` |

**Load-bearing components (not top-level screens):** `ActiveJob.tsx` (entire active-run UI + stepper + lifecycle actions), `OffersList.tsx` (offer/auction card, reused for mid-run batch adds), `BoardList.tsx` (pulled "Available" board), `RouteMap.tsx` (WebView/Leaflet/OSRM map), `ShiftStatus.tsx` (online pulse halo), `JobDetail.tsx` (read-only history modal), `AvailabilityCard.tsx`, `VerificationCard.tsx`, `PayoutMethods.tsx`.

---

## 3. Component & state inventory

### State providers (`src/state/`)

| Provider | Role | Fires feedback? |
|---|---|---|
| `session.tsx` | Auth context (rehydrate, signIn/signOut). Drives root Login↔app swap via re-render | No |
| `activeJob.tsx` | Tiny cross-tab beacon `{id,label}` so non-Shift tabs render the "tap to return" chip. **State only** — no lifecycle/stop state | No |

### Network / lib layer (`src/lib/`)

| File | Role | Notes |
|---|---|---|
| `api.ts` | Single fetch wrapper for all `/v1/driver/*`. **One** degradation primitive: 10s `AbortController` timeout. 401 → global sign-out | **No retry/backoff at request layer** — single-shot |
| `queue.ts` | Persisted offline action queue (SecureStore) for must-land lifecycle taps. `shouldRetry`: retry on network/5xx, **drop on 4xx** (terminal). De-dupes by `deliveryId:action` | **The resilience core.** Retry *cadence* lives in caller (HomeScreen) |
| `realtime.ts` | SSE client behind `REALTIME_ENABLED`. 60s heartbeat timeout → capped exp backoff (max 30s). **Accelerator only** over push+poll floor; disconnected while on a job | onHealth(false) is the only degraded signal |
| `background-location.ts` | Headless TaskManager task. Location POSTs fire-and-forget. Piggybacks a 15s-throttled offers check — **early-returns when a job is active** | So a busy driver gets no screen-locked offer notify |
| `location.ts` | Foreground GPS. 8s cold-fix cap so online toggle never hangs. **`coords.speed` never read** | No motion signal captured anywhere |
| `notifications.ts` | The **only** alert-salience path. OS banner + channel sound `'default'` + fixed vibration `[0,250,250,250]`. `maybeNotifyNewOffers` — **suppressed mid-job** | Vibration/sound fire *only* on a posted OS notification |
| `format.ts` | Presentation tokens: `money()` minor→$x.xx (COD clarity), `placeLabel` landmark-first (informal addressing). **Centralized & reused — good B4** | — |
| `run.ts` | Pure route model: `runStops()` = all pickups then all dropoffs; `currentStopLeg()` = first remaining. No UI/feedback | — |
| `jobs.ts` | Shared `STATUS_META` vocabulary + `REASON_LABEL`. Used by Jobs tab — **not** by the active-run stepper (which uses its own `STEPS`/`STEP_DONE`) | Drift risk |
| `battery.ts` | The **only** `Alert.alert` usages (2): background-permission + battery-settings explainer | — |

### Feedback primitives that exist today

`ActivityIndicator` (spinner, dominant loading primitive, ~11 files) · opacity-0.6 busy dimming (re-declared in ~9 stylesheets) · inline `Text` for error + success (persistent, no auto-dismiss) · button-label swaps ("Claiming…"/"Sending…"/"Saving…") · one `Modal` slide (`JobDetail`) · two `Alert.alert` (`battery.ts`) · one `RefreshControl` (History) · **one** `Animated` loop (`ShiftStatus` halo). No shared `Spinner`/`Toast`/`Stepper`/`SuccessCard`/`Transition` primitive exists.

---

## 4. Courier flows walked (as the driver experiences them)

### (a) Go on shift → offer arrives → accept-at-seed / counter / pass

1. **Go online.** Toggle flips optimistically (`HomeScreen.tsx:590`); GPS cold-fix capped at 8s so it never hangs. `ShiftStatus` shows the online pulse halo (the app's one animation). *Feedback: good — optimistic + the only animated state.*
2. **Offer arrives.** Three redundant paths all converge on a **silent re-fetch** of the offers list (poll 5s / push / SSE). A new offer **pops into the list with no in-app animation, banner, or highlight**; salience is delegated entirely to the OS notification (MAX importance, default sound, fixed vibration). *Feedback: OS notification only; in-app arrival is invisible.*
3. **Accept-at-seed.** Default card shows "Accept — $X" (`onBid(id,'accept')`) — one tap. *Feedback: button label → "Sending…" + opacity; then card locks to "Offer sent — waiting for the customer." No success flash/haptic.*
4. **Counter (one sealed round).** "Offer my own price" flips to a single `$` input (**autofocus pops the keyboard**) + "Send counter-offer" / "Back". Submitting locks the card (`bidSent`); **no re-bid** — a correct single-round sealed auction. *Feedback: label swap only.*
5. **Pass.** `onDecline` — permanent, never re-offered. Optimistic decline (`HomeScreen.tsx:820`). *Feedback: card vanishes instantly, no transition.*

> The auction *mechanic* is well-built and correct. The gaps are entirely in **salience** (no in-app cue) and **motion gating** (below).

### (b) Single delivery: collect → deliver

Driven by `ActiveJob.tsx`, re-deriving UI from `job.status`: `assigned → picked_up → (in_transit) → delivered`.

1. **Assigned (going to pickup).** Card targets the merchant ("Pick up from" + pickup geo/contact) with a secondary "Then deliver to" card. Persistent **4-segment stepper** (Claimed / Picked up / On the way / Delivered) — a lifecycle phase bar, **not** an "X of Y" counter. *Feedback: stepper + RouteMap (spinner over map until tiles load).*
2. **Tap "I've picked up."** *Feedback: in-button spinner during round-trip, then the card **silently** re-renders into customer mode — target flips merchant→customer, secondary card vanishes, WhatsApp quick-replies + 4-digit code hint appear. **No success toast/checkmark/haptic/sound**; stepper bar just flips color. The driver's only signal a collect succeeded is the card silently changing target.*
3. **("On my way" → in_transit)** optional; the only visible difference from `picked_up` is that button disappearing.
4. **Tap "Delivered."** Deliver panel (COD/PIN). *Feedback: on success the **whole card unmounts** with no exit transition or success interstitial → Home swaps to the "completed" payday card (static check icon, earned amount, COD reminder). This is the app's **one real success state** — but appears via instant conditional render, no animation/haptic/sound.*

### (c) MID-RUN batch offer while navigating (the B1 scenario)

1. Driver is on an active job, moving, phone in one hand. `canBatch` keeps the poll running while on a job — but **every notification is suppressed** (`markOffersSeen` instead of `maybeNotifyNewOffers`, `HomeScreen.tsx:203`), the background notify path **early-returns** because a job is active (`background-location.ts:50`), and the **SSE socket is torn down** while on a job.
2. The batch offer appears **only** as a passively-rendered inline `<OffersList>` section titled "On your route" *below* the ActiveJob card (`HomeScreen.tsx:1030-1046`). The appendable card ("Add to run — $X") is **live and tappable immediately**, in the driver's scroll path, with **no vehicle-stopped gate**.
3. *Feedback: **none.** No badge, no banner, no buzz, no sound. The driver discovers the offer only by happening to look at and scroll the active-job screen — the exact failure B1 exists to prevent.*

### (d) Multi-stop pooled run (pickups-first): collect → deliver → next

1. When `run` has >1 leg, the 4-segment stepper is **hidden** (`stops ? null`). In its place the **run strip** renders: header "Pooled run · N orders · M stops" and one row per *remaining* stop from `runStops()` (all pickups, then all dropoffs). *Feedback: only the first row is "current" (`i===0`) — filled dot, highlighted bg, "Now" tag.*
2. **Complete the current leg.** Stop advance is orchestrated **entirely outside** `ActiveJob` — HomeScreen refetches the run list, `currentStopLeg()` picks the next leg, `job.id` flips, and the `useEffect` on `[job.id]` only resets panel/input state. *Feedback: the completed stop **silently vanishes** from the strip on the next refresh (no check/strike-through, no completed count); the newly-current stop is **not** transitioned in.*
3. *With 20+ stops, each advance is a bare data-driven re-render with no cue that the run moved forward — and during the run the driver has **no per-leg lifecycle** (are we before/after pickup on this stop?) because the phase stepper is hidden exactly when the run is most complex.*

---

## 5. Current feedback & state-change patterns (what EXISTS today)

| Category | What exists | Where |
|---|---|---|
| **Animation** | **One** total: ShiftStatus online-pulse halo (`Animated.loop`, native driver). Zero `LayoutAnimation`. Zero `Animated` elsewhere | `ShiftStatus.tsx` |
| **Haptics** | **None.** No haptics lib; RN built-in `Vibration` never called. Only vibration is the OS notification channel's fixed pattern — tray-only | `notifications.ts:37` |
| **Audio** | **None.** No `expo-av`/`expo-audio`; no `playAsync`. Sound only via notification channel `'default'` — tray-only, muted mid-run | `notifications.ts:36,73` |
| **Transitions** | **None** except `JobDetail`'s Modal slide. Every screen/state/tab swap is an instant conditional re-render | app-wide |
| **Success states** | **One** real state: the payday/completed card (static check icon). Every other success is a plain persistent "Saved." Text or **nothing** (claim/append/bid/step advance produce no ack) | `HomeScreen.tsx:989-1018`; `ProfileScreen`, `AvailabilityCard` |
| **Loading** | `ActivityIndicator` spinners + bespoke text ("Checking for offers…", "Loading the board…", "Loading…", map overlay, root spinner). Earnings renders dashes. **No skeletons anywhere** | 5+ distinct idioms |
| **Errors** | Inline `Text`, persistent (no auto-dismiss), re-implemented per screen (`styles.error` in Login/Onboarding/Home/History; `note` in Profile) | per-screen |
| **Steppers** | Three unrelated idioms: ActiveJob 4-bar phase stepper, ActiveJob pooled-run strip, Onboarding dot stepper. None shared | `ActiveJob.tsx`, `Onboarding.tsx` |
| **Optimistic / offline UI (strength)** | Optimistic online / decline; persisted offline action queue; "waiting to sync" pending banner | `HomeScreen.tsx:590,820,937,1189`; `queue.ts` |

---

## 6. Gap analysis (scored vs the 4 target behaviors)

| Behavior | What the app does today | Gap | Severity | Evidence |
|---|---|---|---|---|
| **B1** | Mid-run batch offer rendered silently inline; notifications suppressed mid-job; bg notify early-returns; SSE socket torn down on job | **Mid-run offer has zero active salience** — no badge/banner/buzz/sound; discovered only by scrolling the active-job screen | **High** | `HomeScreen.tsx:203,1030-1046`; `background-location.ts:50`; `HomeScreen.tsx:494` |
| **B1** | Only vibration is the OS channel pattern (tray-only, muted mid-run); RN `Vibration` unused | **No haptics** — B1's primary channel entirely absent | **High** | `notifications.ts:37`; grep Haptics/Vibration = 0 |
| **B1** | Sound only via OS notification `'default'`; no `expo-av`/`expo-audio` | **No in-app audio** — B1's primary channel absent | **High** | `notifications.ts:36,73`; grep audio = 0 |
| **B1** | `coords.speed` never read; no `isMoving` concept; full accept/counter/pass card (incl. autofocus keyboard input) always tappable | **No motion gating** — interactive UI not gated behind vehicle-stopped | **High** | `location.ts` (speed unused); `OffersList.tsx:211-219` |
| **B1** | New free-driver offer collapses to a single fixed-importance OS notification | Weak, non-distinct, non-escalating salience; competes with all other notifications; no in-app reinforcement | **Med** | `notifications.ts:31-40` |
| **B2** | Collect/deliver fire `onAction` directly; only feedback is in-button spinner; card unmounts on success | **No per-action acknowledgment/success** — no toast/checkmark/haptic/sound; only the terminal payday card is a success state | **High** | `ActiveJob.tsx:148-158,178-179,205,159-161`; `HomeScreen.tsx:900-932` |
| **B2** | Single-job progress is a 4-phase lifecycle bar | **No numeric "Stop X of Y"** for the common single-job flow; phase bar conflates in_transit/picked_up even though in_transit is skippable | **High** | `ActiveJob.tsx:58-65,245-269` |
| **B2** | 4-segment stepper is **hidden** in pooled runs (`stops ? null`) | Driver loses all per-leg lifecycle progress exactly when the run is most complex; strip shows "Now" but not progress *through* the current stop | **Med** | `ActiveJob.tsx:245,275-307` |
| **B2** | Completed stops filtered out of `runStops()`, vanish on refresh | **No completed acknowledgment / count** — driver can't confirm what they just finished vs what's next | **Med** | `ActiveJob.tsx:271-274`; `run.ts:20-26` |
| **B3** | Notification tap → `setTab('shift')` and list repopulates | **Screen changes with no transition or "new offer" signal** — change blindness on the tap-to-Shift path | **High** | `App.tsx:38-40`; `HomeScreen.tsx:246-277` |
| **B3** | Every screen/state/tab swap is an instant conditional re-render | **No transition layer** — offer→job, delivered→payday, tab switches, lifecycle steps all pop with no motion; only ShiftStatus animates | **High** | `App.tsx:44-64,151`; `HomeScreen.tsx:989-1181`; no `Animated` import in screens |
| **B3** | Picked_up→customer card + delivered→unmount + pooled advance are bare re-renders keyed on `job.id` | **Silent lifecycle advance** — no spatially-continuous transition; with 20+ stops, instant swaps give no cue the run moved | **High** | `ActiveJob.tsx:116-122,219-235,352-404` |
| **B3** | Offer cards enter/leave via plain `setState` | New/claimed/expired offer pops/vanishes with no `LayoutAnimation`/`Animated` | **Med** | `OffersList.tsx:52-73` |
| **B3** | No transition primitive at all | The "loud for offers / light+fast for routine" distinction **cannot exist** — routine steps are "fast" only by having no feedback | **Low** | `ActiveJob.tsx:1-13` (no Animated/Vibration import) |
| **B4** | Spinners, loading text, save notes, busy-dimming, steppers, errors, success re-implemented per surface | **No shared feedback/state-change layer** — the root cause that makes B1/B2/B3 unfixable without duplicating across ~9–16 files | **High** | `ProfileScreen.tsx:121` vs `AvailabilityCard.tsx:53`; 3 loading idioms (`App.tsx:121-127`, `HomeScreen.tsx:1155-1159`, `HistoryScreen.tsx:145`) |
| **B4** | No `components/ui` dir; every styled file rebuilds pill button / card / badge from raw literals | **No shared UI-primitive layer** (Button/Card/Badge/Stepper/Toast/Transition) — any new feedback UI necessarily ships ad-hoc | **High** | src tree = components/,lib/,screens/,state/,types/ only; 16 local `StyleSheet.create` blocks |
| **B4** | Earnings→Payout full swap w/ custom chevron; History→JobDetail overlay; Login/Onboarding step ternaries; Home state ternary | **Inconsistent sub-navigation** — each screen invents its own back/return affordance; no shared header/screen-container | **Med** | `EarningsScreen.tsx:50-52`; `HistoryScreen.tsx:227-229`; `Onboarding.tsx:158-270` |
| **B4** | Three unrelated stepper idioms; ActiveJob derives status from local `STEPS`/`STEP_DONE`, not shared `STATUS_META` | Progress semantics can drift between active-run and Jobs tab; no shared `Stepper` | **Med** | `ActiveJob.tsx:58-65,245-307`; `jobs.ts:15-26`; `Onboarding.tsx:281` |

### Market-constraint gaps

| Constraint | What the app does today | Gap | Severity | Evidence |
|---|---|---|---|---|
| **3G — connectivity awareness** | No NetInfo/online-offline listener; offline inferred only by a fetch timing out (10s) or throwing | Queue not flushed the instant connectivity returns (waits for poll tick/action); no screen can render an authoritative "offline/queued" banner from a real signal — only inferred (a silent-state failure, ties to B3) | **High** | `api.ts:49-51`; `queue.ts:42-55` (caller-triggered flush) |
| **3G — read-path retry** | Every non-queued call is single-shot; retry exists only for the queue + SSE | UI-gating reads (`listOffers`, `getActiveLegs`, `getDelivery`, `getBoard`, `getProfile`, `getEarnings`) and the money-critical `submitBid` fail hard on one 3G blip; recovery depends on a poll tick or manual re-tap | **High** | `api.ts:44-85` vs `queue.ts:35-55` |
| **3G — loading strategy** | Blocking full-screen / inline spinners; no skeletons; lib exposes only `Promise<T>` (no in-flight/optimistic/offline state to screens) | Dead time with no structure on slow links; no shared scaffolding to enforce "no blocking spinner / no silent change" | **High** (B3-linked) | `App.tsx:121-127`; `HomeScreen.tsx:1155-1159`; `HistoryScreen.tsx:145`; `api.ts` exposes only promises |
| **3G — flat timeout** | Uniform 10s `AbortController` on all calls incl. whole-screen GETs | A slow-but-alive 3G response >10s is lost with no retry; one constant can't both fail-fast on a dead socket and ride a slow response | **Med** | `api.ts:42,50,134-137,109-111` |
| **3G — SSE degradation** | On lossy 3G the socket hits the 60s silence timeout and backs off up to 30s; only `onHealth(false)` signals it | Offer delivery quietly falls back to the slower poll floor with no in-layer compensation and (largely) no UI signal — delayed B1 salience | **Med** | `realtime.ts:21,77-78,37-41` |
| **Low-end perf** | `OffersList` runs a 1s `setInterval` re-rendering every card for the countdown; no memoization | 1Hz re-render pressure with many stacked offers on low-end Android | **Low** | `OffersList.tsx:37-41` |
| **RouteMap 3G cost** | WebView fetches Leaflet + OSM tiles + OSRM route from public servers on every from/to change, gated behind a spinner | Heavy repeated 3G cost mid-route; no cached/skeleton map fallback | **Med** | `RouteMap.tsx:27,42-46,68-101` |
| **COD clarity (strength w/ debt)** | "Cash to hand in" COD copy is strong and consistent, but rendered independently in ~3 places | Three hand-built variants, no shared COD component (B4 debt on a money surface) | **Med** | `HomeScreen`, `EarningsScreen.tsx:77-85`, `ProfileScreen.tsx:372-379` |
| **COD clarity — sample data** | Earnings "Last 7 days" chart renders hard-coded SAMPLE bars | Partly-fabricated visualization on a money screen if the SAMPLE badge is missed | **Low** | `EarningsScreen.tsx:38-47,87-116` |
| **Queue at-rest data** | podPin + codCollectedMinor persisted as plaintext JSON in SecureStore; no TTL despite `createdAt` existing | SecureStore is encrypted-at-rest (acceptable) but the at-door PIN + COD amount in a retry queue on a low-end/shared device, plus no client-side expiry, is worth a conscious note | **Low** | `queue.ts:16-27,67-69` |
| **Informal addressing (strength)** | `placeLabel`/`placeLabelDetailed` put the landmark first; centralized in `format.ts` | Genuinely good and reused — no gap; preserve and generalize | — | `format.ts` |

---

## 7. Design-system maturity

**Token file (`theme.ts`) exports exactly three things:** `colors` (40+ role-named, WCAG-annotated, ADR-034 Brand V1), `shadow`, and `PILL=999`. Only ~1.5 of the 5 token axes are covered.

| Axis | Status | Detail |
|---|---|---|
| **Color** | **Mature** | 40+ role-named tokens (roles not hues); 459 `colors.*` refs; **zero hardcoded hex** outside `theme.ts`; zero inline `style={{}}` objects. Near-perfect for B4 |
| **Typography** | **Not tokenized** | 218 raw `fontSize` (15 distinct values), 141 `fontWeight`, ~30 `lineHeight`, scattered `letterSpacing`. No type scale, no `<Text>` wrapper. **Largest ad-hoc surface** |
| **Font family** | **System default** | No `useFonts`/`expo-font`/`fontFamily`. Renders platform system font (Roboto on Android); diverges from web brand's Lato-style family. An unowned decision (arguably safest for low-end perf) |
| **Spacing** | **Not tokenized** | All raw literals: 111 `marginTop`, 90 `gap`, 46 `paddingVertical`, 42 `paddingHorizontal`, 35 `padding`. No 4/8-pt grid; values drift within files |
| **Radii** | **Not tokenized** (beyond PILL) | 11 distinct `borderRadius` values; only PILL (999) named. Card/input radii drift (10/11/12/14) despite the `theme.ts:79` "10-14" comment |
| **Icons** | **Consistent lib, inconsistent size** | 100% Feather (matches brand canon, de-emoji rule); color tokenized. But 10 distinct raw `size={}` values (14 vs 15 vs 16 near-dup glyphs); no icon-size token |

**Ad-hoc hotspots:** `OffersList.tsx:289-370` and `ActiveJob.tsx` (styles to ~690) are representative — every fontSize/weight/padding/radius/gap is a hand-typed literal. `VEHICLE_TYPES` + chip styles are duplicated verbatim between `Onboarding.tsx:24-30` and `ProfileScreen.tsx:30-36`.

**Encouraging signal for a redesign:** the team already reuses `shadow.card` (spread idiom) and `PILL`, and routes **100% of styling through `StyleSheet.create`** (zero inline style objects) — the codebase demonstrably adopts a token the moment one is authored. The missing scales (type/spacing/radius/icon) and the missing primitives (Button/Card/Stepper/Toast/Transition) are **additive work, not a rewrite** — and those primitives are the exact prerequisites for B1/B2/B3, so authoring them pays down B4 debt and unblocks the target behaviors simultaneously.

---

## 8. Dependency reality & options

**Confirmed at the call-site level:** no haptics lib, no audio lib, no animation lib. In-app usage today = one `Animated` loop + `ActivityIndicator`. Nothing uses RN's built-in `Vibration`. Each missing capability, with the RN-built-in option vs a new Expo dep:

| Capability | RN built-in (no new dep) | New Expo dep | Recommendation to raise for Phase-1 |
|---|---|---|---|
| **Haptics** | `Vibration.vibrate(pattern)` — already available, zero install; coarse (duration-only, no impact styles) | `expo-haptics` — semantic feedback (`impactAsync`, `notificationAsync` success/warning/error), crisper on capable devices | **Ship with `Vibration` first** (unblocks B1/B2 immediately, no install, safe on the low-end target). Raise `expo-haptics` as an optional upgrade for offer vs step differentiation — evaluate benefit on real low-end hardware, since many budget Androids expose only basic vibration anyway |
| **Animation / transitions** | `Animated` (already used) + `LayoutAnimation` (one-line enable, ideal for list insert/remove + stepper fill; near-free) | `react-native-reanimated` + `gesture-handler` — richer, gesture-driven, worklet-based | **Use RN built-ins.** `LayoutAnimation` covers B3's list/stepper/step-advance needs; `Animated` (native driver) covers success pulses and the "loud vs light" distinction. **Do not add Reanimated in Phase 1** — the built-ins cover every target behavior and add zero bundle/perf cost on low-end Android |
| **Audio** | **None — there is no RN built-in for playing a bundled sound.** This is the one capability with no built-in path | `expo-av` (broad) or the lighter `expo-audio` | **This is the only capability that *requires* a new dep for B1's audio channel.** Raise explicitly for Phase-1 decision: add `expo-audio` (lighter, current) to play a short bundled new-offer chime, **or** consciously accept haptics-only in-app salience and lean on the OS notification sound. Recommend a small, gated (`SOUND_ENABLED`) `expo-audio` cue for the mid-run offer, since that is precisely where the OS sound is suppressed |
| **Connectivity** | `AppState` (already used) — coarse; no true online/offline | `@react-native-community/netinfo` | Raise for the 3G market gap: without NetInfo there is no authoritative offline signal and the queue can't flush on reconnect. Recommend adding it in the network-hardening slice |

**Bottom line:** B2, B3, and the tactile half of B1 can ship **with zero new dependencies** (Vibration + Animated + LayoutAnimation). Only the **audio** half of B1 forces a decision (`expo-audio` vs accept haptics-only), and **NetInfo** is the one dep the 3G-degradation gaps call for. Every one of these should be an explicit Phase-1 call, not an accident.

---

## 9. Recommended sequencing

The single highest-leverage move is **B4-first**: build the shared primitive layer, because its absence is what makes B1/B2/B3 individually unfixable. Everything downstream then consumes one component instead of duplicating across ~16 surfaces.

### Phase 1 — shared primitives (build once, in `src/components/ui/` + extend `theme.ts`)

| Primitive | Built with | Closes / unblocks |
|---|---|---|
| **Token scales** — `type`, `spacing`, `radius`, `iconSize` added to `theme.ts` + a `<Text>` wrapper | none | B4 (typography/spacing/radius/icon gaps); prerequisite for consistent primitives |
| **`<Stepper>`** — numeric "Stop X of Y" + phase segments; consumes shared `STATUS_META` | Animated fill | B2 (numeric stepper, pooled-run progress, completed count) |
| **`<Feedback>` / `<SuccessPulse>` + `<Toast>`** — per-action ack (checkmark + optional haptic/sound), auto-dismiss | `Vibration` + `Animated` (+ optional `expo-audio`) | B2 (per-step ack), B1 (in-app alert cue) |
| **`<ScreenTransition>` + `LayoutAnimation` list config** | `LayoutAnimation` / `Animated` | B3 (screen swaps, list insert/remove, lifecycle advance) |
| **`<OfferAlert>`** — non-blocking dismissible banner/badge + haptic + (gated) sound + **motion gate** reading `coords.speed` | `Vibration` + `location.ts` speed + optional `expo-audio` | B1 (mid-run salience + vehicle-stopped gating) |
| **Network state layer** — expose in-flight/offline/queued from the lib; add `NetInfo` + read-path retry + reconnect flush; `<Skeleton>` | `@react-native-community/netinfo` | Market 3G gaps; B3 (no silent/blocking state) |

### Phase 2 — screen adoption order (highest-traffic active-run flow first)

| # | Surface | Why here | Gaps closed |
|---|---|---|---|
| 1 | **`ActiveJob.tsx` + pooled-run strip** | The most-used, most-complex, most-under-fed surface; the app's real workhorse | B2 (stepper + per-step ack + completed count), B3 (lifecycle advance transition) |
| 2 | **Mid-run offer path** (`HomeScreen` batch section + `OfferAlert`) | The single most severe finding; the exact B1 scenario is currently unhandled | B1 (salience, motion gating), B3 (list insert) |
| 3 | **`HomeScreen` state machine** (offline↔online↔job↔payday) + offer list | Second-highest traffic; generalizes the payday success card into the shared feedback layer | B3 (state swaps), B4 (dedup loading/error/COD) |
| 4 | **Network hardening** (`api.ts`/`queue.ts`/screens) — NetInfo banner, read retry, skeletons | Underpins every screen's 3G behavior; the queue already protects money, so this is latency/honesty, not data-loss | Market 3G, B3 (offline signal) |
| 5 | **Secondary screens** (History / Earnings / Profile / Onboarding / Login) | Adopt shared `<Text>`/`<Toast>`/`<Skeleton>`/transition; retire the three stepper idioms and duplicated save-notes | B4 (consistency), market (skeletons, sample-data label) |

**Strengths to preserve while refactoring:** the sealed-auction mechanic; the persisted, terminal-4xx-aware offline action queue; optimistic online/decline + the pending-sync banner; the payday success card (the right model to generalize); `format.ts` money (COD) + landmark-first (informal addressing) tokens; and the mature color system.

---

*Phase-0, read-only. Follow-up: `ActiveJob.tsx` is the single most load-bearing component for B1/B2 and should anchor Phase-2 build order.*
