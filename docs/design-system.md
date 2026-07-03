# urafro-driver — Design System (Phase 1)

The shared token + primitive layer the redesign is built on. It exists because the
Phase-0 audit found the root cause of every feedback gap was **B4**: there was no
shared layer, so spinners, steppers, save-notes, and success states were re-implemented
ad-hoc across ~16 surfaces, which made B1/B2/B3 individually unfixable. This layer is
the prerequisite; Phase 2 wires screens to it.

**Nothing here is wired into a screen yet** (that is Phase 2). Everything is additive.

- Built on RN built-ins (`Animated`, `LayoutAnimation`) — **zero** new animation dep.
- New deps (founder-approved): `expo-haptics`, `expo-audio`, `@react-native-community/netinfo`.
- Colours already came from `theme.ts` (mature, role-named, zero hex leakage). This phase
  adds the missing token axes and the motion/feedback primitives.

---

## Principles

1. **Tokens, not literals.** Type, spacing, radius, icon size, and motion timing all come
   from `src/theme.ts`. Screens never hand-type a `fontSize`/`padding`/`#hex`.
2. **Loud for offers, light for routine.** A new offer earns the audio + haptic channel and
   a slower "loud" entrance; routine, high-frequency steps (a 20-stop run) get near-instant,
   cheap transitions so friction never accumulates.
3. **No silent change (B3).** Every state swap shows a visible cue — `Transition` for content
   swaps, `animateNext()` for list/layout changes, `Toast` for acknowledgments.
4. **Feedback is best-effort and never throws.** Haptics/audio are advisory: a device with no
   vibrator, on silent, or with no audio route must never break a lifecycle action.
5. **Degrade gracefully.** Skeletons over blocking spinners; an authoritative offline signal;
   `reduce-motion` honoured everywhere (visual motion drops; haptic/audio salience stays).

---

## Tokens (`src/theme.ts`)

| Token | Members | Notes |
|---|---|---|
| `colors` | 40+ role-named | Pre-existing, Brand V1 (ADR-034). WCAG-annotated. |
| `typography` | display, title, heading, subheading, body, bodyStrong, callout, label, caption, micro | fontSize/lineHeight/fontWeight(/letterSpacing). `fontFamily` intentionally unset → system font (Lato bundling is a later isolated swap of one field). |
| `space` | xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32 | 4-pt grid. |
| `radius` | sm 8 · md 12 · lg 16 · pill 999 | Standardises the old 10/11/12/14 drift. |
| `iconSize` | sm 16 · md 20 · lg 24 | Collapses the 14/15/16 near-dups. |
| `duration` | instant 120 · fast 180 · base 240 · slow 320 (ms) | The "loud vs light" timings. |

---

## Motion

- **`animateNext(intensity)`** (`src/lib/motion.ts`) — call immediately before a `setState`
  that changes layout (list insert/remove, stepper advance); the next render animates instead
  of popping. `light` (opacity, 120ms) for routine, `base` default, `loud` (spring) reserved
  for an offer arriving. No-ops under reduce-motion (change still happens, instantly).
- **`<Transition trigger intensity>`** — wraps a region; when `trigger` changes the content
  cross-fades (`light`) or scales-in slower (`loud`). Latest children always render; only
  `trigger` drives the animation. Stops its animation and guards setState on unmount.
- **`reduce-motion`** (`src/lib/reduce-motion.ts`) — `prefersReducedMotion()` (imperative) and
  `useReducedMotion()` (hook). Every animated primitive consults it and snaps instead of animating.

All entrance/exit animations use `useNativeDriver: true` on opacity/transform (off the JS
thread, so they survive JS-thread congestion on a slow link). The two deliberate exceptions —
`OfflineBanner` height and the old `Stepper` width — were addressed: the stepper now animates
`scaleX` (native); the banner keeps an animated `height` on purpose (it must *push* content, and
connectivity flips are infrequent).

---

## Feedback engines

- **`haptics`** (`src/lib/haptics.ts`) — `tap` / `success` / `warning` / `error` / `offer`.
  Semantic, best-effort, never throws. `offer` is a distinct heavy double-pulse. Gated by
  `HAPTICS_ENABLED` (config) + `setHapticsEnabled(bool)` runtime toggle.
- **`playOfferChime()`** (`src/lib/sound.ts`) — plays `assets/sounds/new-offer.wav` (a short
  synthesized two-note chime; the OS tray sound is suppressed mid-run, which is the whole reason
  this exists). Respects the ringer (`playsInSilentMode: false` — a muted phone is a choice;
  haptics still fire), ducks nav audio. First offer plays immediately (never gated behind a seek).
  Gated by `SOUND_ENABLED` + `setSoundEnabled(bool)`; `releaseSound()` on sign-out.

Config flags (`src/config.ts`): `EXPO_PUBLIC_SOUND_ENABLED`, `EXPO_PUBLIC_HAPTICS_ENABLED`
(default on). `expo-audio`'s config plugin is intentionally **not** registered — it only injects
iOS mic-permission strings, and we only play (never record); Android playback needs no plugin.

---

## Hooks

- **`useConnectivity()`** — `{ online, type, cellularGeneration }` from NetInfo. Treats an
  indefinite reachability sample by **holding the last definitive state** (no false "offline"
  flash on cold start; no false "online" on a has-signal-no-internet 3G cell once known).
- **`useIsStopped(active, speedSource?)`** — `{ moving, speed }` motion gate for B1. Pure policy
  in `src/lib/motion-gate.ts` (`deriveMoving`): hysteresis (enter ~9km/h, exit ~3.6km/h),
  unknown speed **holds** last state, initial = stopped (card reachable). A watchdog decays a
  stuck "moving" to stopped after 8s of unknown speed so a GPS drop never latches the card shut.
  Only re-renders when the gate flips. Pass `speedSource` to reuse the app's GPS instead of a 2nd watch.
- **`useReducedMotion()`** — see Motion.

---

## Primitives (`src/components/ui/`)

Import from the barrel: `import { Text, useToast, Stepper, OfferAlert, ... } from '../components/ui'`.

| Primitive | Serves | Summary |
|---|---|---|
| `<Text variant color>` | B4 | The only text component; maps to the type scale + colour tokens. Replaces 218 `fontSize` literals. |
| `ToastProvider` + `useToast()` | B2, B1 | Non-blocking snackbar for acks/soft errors. One at a time, queued, auto-dismiss, fires the matching haptic. `success/error/warning/info/show/dismiss`. A sticky toast is superseded by a new one so acks are never swallowed. **Wrap the app tree in `<ToastProvider>` once** (dev-warns if you forget). |
| `<Stepper current total label sublabel steps?>` | B2 | Persistent "Stop X of Y" + native `scaleX` progress fill + segment ticks. `progressbar` a11y with text. Never hidden during pooled runs. |
| `<Skeleton>` / `<SkeletonText lines>` | 3G, B3 | Loading placeholders (native-driver pulse) instead of blocking spinners. `SkeletonText` announces "Loading" politely. |
| `<OfflineBanner queued>` | 3G, B3 | Authoritative "offline / queued / back-online (slow link)" status; animates its height; hidden from the a11y tree when collapsed. |
| `<Transition trigger intensity>` | B3 | Content-swap cross-fade so no screen pops silently. |
| `<OfferAlert offer moving onAccept onCounter onPass onDismiss>` | B1 | The flagship. See below. |

### OfferAlert (B1) — the contract

- On a new offer id: fires `haptics.offer()` + `playOfferChime()` **once**, and drops a small,
  **non-blocking** banner (`pointerEvents: box-none` — the rest of the screen stays live). It does
  **not** auto-expand.
- **Motion gate:** the accept/counter/pass card is gated behind `!moving`. While `moving`, tapping
  the banner shows a "pull over to respond" state with **no interactive buttons** — a single gate,
  no second source of truth. Feed `moving` from `useIsStopped`.
- **Sealed single-round auction:** Accept-at-seed · one Counter (minor units — see `onCounter`) · Pass.
- **Expiry:** an isolated `Countdown` leaf ticks without re-rendering the card; at 0 the actions are
  replaced with an "expired" state (no live buttons to submit a reclaimed offer).
- Dismiss silences that id for the component's lifetime; a new id re-alerts and re-animates in.
- `*Minor` fields and `onCounter(amountMinor)` are all in **cents**.

---

## Dependencies added

| Dep | Why | Version |
|---|---|---|
| `expo-haptics` | Semantic haptics (B1/B2). Degrades to basic vibration on low-end. | ~56.0.3 |
| `expo-audio` | In-app new-offer chime (OS sound is suppressed mid-run). | ~56.0.12 |
| `@react-native-community/netinfo` | Authoritative offline signal for the 3G market. | 12.0.1 |

---

## Testing

- `npm test` (vitest) — pure logic incl. `motion-gate.test.ts` (hysteresis / unknown-holds / idle).
- `npm run test:component` (jest-expo) — component render tests.
- `npm run typecheck` — clean.
- CI colour-literal gate (ADR-034) passes — zero hex outside `theme.ts`.

## Behavior coverage

| Behavior | Primitives |
|---|---|
| B1 new-offer alert | `OfferAlert` + `useIsStopped` + `haptics.offer` + `playOfferChime` |
| B2 stepper + acks | `Stepper` + `Toast` (`success` = per-action ack) |
| B3 no silent change | `Transition` + `animateNext` + `Toast` + `OfflineBanner` |
| B4 consistency | tokens + `Text` + the shared `ui/` layer |
