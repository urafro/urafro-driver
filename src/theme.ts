// Single source of truth for every colour in the app (ADR-034 Brand V1 prep).
// Step 1 of the rebrand: these are the EXACT values previously scattered as
// literals across the screens/components — extracting them here is a pure
// refactor with zero visual change. Step 2 flips these values to the light
// urAfro brand theme in one place.
//
// Roles, not hues: name what the colour DOES so the theme can swap wholesale.
export const colors = {
  // Surfaces
  bg: '#0f172a',            // screen background
  surface: '#1e293b',       // cards, tab bar, raised panels
  surfaceAlt: '#334155',    // secondary buttons inside cards (navigate/call, reasons)
  inputBg: '#0f172a',       // inputs sitting ON a card
  inputBgRaised: '#1e293b', // inputs sitting on the screen bg
  border: '#334155',

  // Text
  textPrimary: '#fff',
  textSecondary: '#cbd5e1', // shift status line, contacts, phone
  textMuted: '#94a3b8',     // field labels, links, secondary place lines
  textFaint: '#64748b',     // metadata, empty states, cancel links, dates
  placeholder: '#475569',

  // Accents
  info: '#22d3ee',          // in-progress status + informational accent
  money: '#22d3ee',         // earnings/fee amounts
  tabActive: '#22d3ee',
  badgeBg: '#22d3ee',       // active-job status pill
  badgeText: '#0f172a',

  // Actions
  btnPrimaryBg: '#22c55e',  // accept / save / confirm / go-online
  btnPrimaryText: '#0f172a',
  btnSecondaryBg: '#f59e0b',// go-offline
  dangerBorder: '#7f1d1d',  // "Can't complete" outline

  // Status
  success: '#22c55e',
  successSoft: '#86efac',   // background-GPS active note
  warning: '#fbbf24',       // pending-sync note
  cod: '#fbbf24',           // cash-to-collect amounts
  danger: '#fca5a5',        // errors, failed status

  // Banners
  batteryBg: '#451a03',
  batteryBorder: '#b45309',
  batteryTitle: '#fbbf24',
  batteryBody: '#fcd34d',
  pendingBg: '#7c2d12',     // awaiting-approval note (Profile)
  pendingText: '#fed7aa',

  // Native chrome
  notificationAccent: '#22c55e', // foreground-service notification tint
} as const;
