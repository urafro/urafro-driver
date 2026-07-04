// Single source of truth for every colour in the app — the urAfro Brand V1
// light theme (urafro ADR-034, founder-ratified: the driver app matches the
// web light theme; the old ad-hoc dark slate/cyan scheme is retired).
//
// A11y canon (computed WCAG, from ADR-034): gold fills ALWAYS carry the smoky
// black text (11.93:1 — never white); money values use the gold text stop
// #9e6b00 (4.61:1 on white); danger is the red text/fill-safe stop #c20000
// (6.38:1 under white text); muted text never lighter than #6b6661 (5.68:1).
//
// Roles, not hues: name what the colour DOES so the theme can swap wholesale.
export const colors = {
  // Surfaces
  bg: '#f9f9f9',            // screen background — brand off-white
  surface: '#ffffff',       // cards, tab bar, raised panels
  surfaceAlt: '#f6f3f7',    // secondary buttons inside cards (navigate/call, reasons)
  inputBg: '#f9f9f9',       // inputs sitting ON a (white) card — a subtle well
  inputBgRaised: '#ffffff', // inputs sitting on the screen bg
  hairline: '#ece9e6',      // faint in-card divider (warm light gray)
  border: '#b26eb4',        // purple field boundary (primary-400 — 3.63:1 on
                            // white, 3.45:1 on bg; WCAG 1.4.11 needs ≥3:1 for
                            // input boundaries — the web's hairline #d8bfd9
                            // fails that on mobile where there is no hover cue)

  // Text
  textPrimary: '#100c08',   // THE smoky black
  textSecondary: '#37332f', // shift status line, contacts, phone
  textMuted: '#534d46',     // field labels, links, secondary place lines (7.92:1)
  textFaint: '#6b6661',     // metadata, empty states, cancel links, dates (5.68:1)
  placeholder: '#a39e99',

  // Accents
  info: '#7e4280',          // in-progress status (purple-600 — replaces the old cyan)
  money: '#9e6b00',         // earnings/fee amounts — gold as text (4.61:1)
  tabActive: '#603262',     // purple-700
  badgeBg: '#7e4280',       // active-job status pill
  badgeText: '#ffffff',

  // Actions
  btnPrimaryBg: '#ffc03d',  // THE brand gold — accept / save / confirm / go-online
  btnPrimaryText: '#100c08',
  btnSecondaryBg: '#d8bfd9',// go-offline — calm purple tint, keeps the dark text
  dangerBorder: '#c20000',  // "Can't complete" outline

  // Status
  success: '#15803d',
  successSoft: '#15803d',   // background-GPS active note (full-strength on light)
  successBg: '#dcf2e3',     // tinted disc behind the online shift glyph (icon 4.3:1)
  warning: '#a16207',       // pending-sync note (4.58:1)
  cod: '#a16207',           // cash-to-collect amounts (on white — 4.58:1)
  codBg: '#fef3c7',         // COD "cash to hand in" callout fill
  codText: '#854f0b',       // COD callout text/icon ON codBg (5.6:1 — AA)
  danger: '#c20000',        // errors, failed status

  // Banners
  batteryBg: '#fef9c3',
  batteryBorder: '#a16207',
  batteryTitle: '#100c08',
  batteryBody: '#534d46',
  pendingBg: '#fef9c3',     // awaiting-approval note (Profile)
  pendingText: '#534d46',

  // Native chrome
  notificationAccent: '#432344', // foreground-service notification tint — brand purple
} as const;

// The original soft card shadow (web --shadow-card), translated to RN. Spread
// into card styles; Android uses elevation, iOS the shadow* quartet.
export const shadow = {
  card: {
    elevation: 2,
    shadowColor: '#100c08',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
} as const;

// Brand V1 pill radius for primary action buttons (the original's pill
// language); cards/inputs keep their soft 10–14 radii.
export const PILL = 999;

// ---------------------------------------------------------------------------
// Non-colour design tokens (added in the UX redesign — see docs/design-system.md).
// Same philosophy as `colors`: name what the token DOES, not its raw value, so
// every screen reads from one scale and the system can be retuned wholesale.
// Consumed via the `src/components/ui` primitives — screens never hand-type these.
// ---------------------------------------------------------------------------

// Type scale (role-named). fontFamily is intentionally UNSET → the platform
// system font (Roboto on Android) renders. This is the safest default for
// low-end devices; bundling the web's Lato-style family (expo-font + asset) is
// a deliberate, isolated follow-up — swap a single `fontFamily` in here and the
// whole app changes. Weights kept to 400/500/600/700 (crisp on Android Roboto).
// Brand font (ADR-034). Bundled as a grouped Android family via the expo-font config
// plugin (Lato-Regular=400, Lato-Bold=700), so a single `fontFamily: FONT` + the
// variant's fontWeight selects the right cut — no per-weight family juggling. Baked
// into every typography token below so every screen/style that spreads a variant
// (and the <Text> primitive) inherits Lato with no per-call change. Raw-Text
// components that don't use these tokens set `fontFamily: FONT` on their own styles.
export const FONT = 'Lato';

export const typography = {
  display: { fontFamily: FONT, fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title: { fontFamily: FONT, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontFamily: FONT, fontSize: 18, lineHeight: 24, fontWeight: '700' },
  subheading: { fontFamily: FONT, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontFamily: FONT, fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontFamily: FONT, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  callout: { fontFamily: FONT, fontSize: 14, lineHeight: 20, fontWeight: '400' },
  label: { fontFamily: FONT, fontSize: 13, lineHeight: 18, fontWeight: '600', letterSpacing: 0.2 },
  caption: { fontFamily: FONT, fontSize: 12, lineHeight: 16, fontWeight: '400' },
  micro: { fontFamily: FONT, fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.4 },
} as const;

export type TypeVariant = keyof typeof typography;

// 4-pt spacing grid — replaces the ad-hoc 4/8/12/16/20/24 literals the audit found.
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

// Corner radii — standardises the 10/11/12/14 drift down to one scale (+ PILL).
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: PILL,
} as const;

// Icon sizes — collapses the 14/15/16 near-duplicates the audit flagged.
export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
} as const;

// Motion timings (ms). The "loud vs light" policy: routine, high-frequency steps
// use `fast`/`base` so a 20-stop run never accumulates friction; a new offer is
// the only thing that earns `slow` + the audio/haptic channel.
export const duration = {
  instant: 120,
  fast: 180,
  base: 240,
  slow: 320,
} as const;
