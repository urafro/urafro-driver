// Audio cue engine (expo-audio). The ONLY reason this dependency exists: mid-run,
// the OS notification sound is suppressed (a busy driver gets no tray alert), so a
// new batch offer needs an in-app chime. Best-effort and NEVER throws — a device
// on silent or with no audio route must not break the offer flow (haptics still
// fire). The chime is a short synthesized two-note motif (assets/sounds/new-offer.wav).
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { SOUND_ENABLED } from '../config';

let enabled = SOUND_ENABLED;
let player: AudioPlayer | null = null;
let configured = false;
let hasPlayed = false;
let generation = 0; // bumped by releaseSound so an in-flight play resolving after release is dropped

// Runtime mute (Phase-2 driver setting). Build-time default from config.
export function setSoundEnabled(v: boolean) {
  enabled = v;
}

async function ensure(): Promise<AudioPlayer> {
  if (!configured) {
    configured = true;
    try {
      // Respect the ringer (don't force through silent — a muted phone is a choice;
      // haptics carry the alert). Duck any nav audio briefly rather than stopping it.
      await setAudioModeAsync({
        playsInSilentMode: false,
        shouldPlayInBackground: false,
        interruptionMode: 'duckOthers',
      });
    } catch {
      // audio mode is advisory
    }
  }
  if (!player) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    player = createAudioPlayer(require('../../assets/sounds/new-offer.wav'));
    player.volume = 0.9;
  }
  return player;
}

// Play the new-offer chime from the start. Idempotent-safe to call repeatedly.
// CRITICAL: the FIRST offer is the whole reason this dependency exists (the OS tray
// sound is suppressed mid-run), so it must not be dropped. On a freshly-created
// player the position is already 0 — play() immediately; only seek on later replays,
// and never let a seek gate the first play.
export async function playOfferChime() {
  if (!enabled) return;
  const gen = generation;
  try {
    const p = await ensure();
    if (gen !== generation) return; // released while we were awaiting — drop
    if (hasPlayed) {
      try {
        await p.seekTo(0);
      } catch {
        // fall through — play() below still restarts from wherever we are
      }
      if (gen !== generation) return;
    }
    hasPlayed = true;
    p.play();
  } catch {
    // audio is an advisory salience channel — never let it surface
  }
}

// Free the native player (e.g. on sign-out). Safe to call when nothing is loaded.
export function releaseSound() {
  generation++;
  try {
    player?.remove();
  } catch {
    // ignore
  }
  player = null;
  configured = false;
  hasPlayed = false;
}
