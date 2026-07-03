// App + API configuration. Expo inlines EXPO_PUBLIC_* vars at build time, so the
// API base can be overridden per build (local / staging) without code changes;
// it defaults to the live urAfro Next platform.
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'https://urafro-next.fly.dev';
export const API_V1 = `${API_BASE}/v1`;

// Ops WhatsApp line for the in-app "Contact support" button. Set per build
// (EXPO_PUBLIC_OPS_WHATSAPP=+2637...); the button hides when unset.
export const OPS_WHATSAPP = process.env.EXPO_PUBLIC_OPS_WHATSAPP ?? '';

// In-app feedback channels (UX redesign). Default ON; a build can mute the chime
// or haptics (e.g. QA / low-end devices). A driver-facing mute lives in Phase-2
// settings and calls setSoundEnabled/setHapticsEnabled at runtime.
export const SOUND_ENABLED = (process.env.EXPO_PUBLIC_SOUND_ENABLED ?? 'true') !== 'false';
export const HAPTICS_ENABLED = (process.env.EXPO_PUBLIC_HAPTICS_ENABLED ?? 'true') !== 'false';
