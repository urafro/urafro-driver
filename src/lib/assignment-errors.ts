// Why an attempt to take a job failed, and what to tell the driver.
//
// Three screens' worth of handlers (claim / append / grab) each grew their own
// substring ladder over the server's 409 text, and they drifted: `claim` had no branch
// at all for verification, capacity or the cash cap, so all three landed on "That job
// was just taken — try another." A driver whose verification lapsed would tap job after
// job, told each time that someone beat them to it. `grab` folded "not verified" in with
// "off shift" and told them to go online, which does not help either.
//
// One classifier, one copy table, three callers. Same reason the server now has a single
// admission gate: the moment the same question is answered in three places, the answers
// diverge.
//
// WHY SUBSTRINGS: the API returns a human-readable `message` and no machine-readable
// error code. Matching on text is fragile, and the honest fix is a stable `code` on the
// error body — but this app ships via EAS and cannot be force-updated, so even after the
// server grows codes, builds already in drivers' hands would still be matching text.
// A substring ladder is therefore load-bearing for the life of these builds; keeping it
// in ONE tested module is the containment. See the follow-up note in the PR.

/** The failure classes a driver can actually do something about (plus the two they can't). */
export type AssignmentFailure =
  | 'off_shift' // sweep took them off shift / they went busy elsewhere — resync + retry
  | 'unverified' // verification lapsed or is under review — NOT fixable by going online
  | 'vehicle_too_small' // active vehicle can't carry this package
  | 'over_cash_limit' // COD collateral cap
  | 'run_full' // at MAX_CONCURRENT_JOBS in-flight legs
  | 'offer_expired' // the offer lapsed before they tapped
  | 'bids_only' // an auction job — bid, don't claim
  | 'job_gone' // someone else took it
  | 'network' // never reached the server
  | 'unknown'; // reached it, got a non-409

/** Which action the driver was attempting — only affects wording, never the class. */
export type AssignmentAction = 'claim' | 'append' | 'grab';

const VERB: Record<AssignmentAction, string> = {
  claim: 'claim that job',
  append: 'add that job',
  grab: 'grab that job',
};

/** An ApiError-shaped value, duck-typed so this module stays dependency-free (and so a
 *  pure vitest run needs no Expo/RN config). A transport failure has no numeric status. */
function apiShape(e: unknown): { status: number; message: string } | null {
  if (typeof e !== 'object' || e === null) return null;
  const { status, message } = e as { status?: unknown; message?: unknown };
  if (typeof status !== 'number') return null;
  return { status, message: typeof message === 'string' ? message : '' };
}

/**
 * Classify a failed claim/append/grab.
 *
 * Order matters: the checks run most-specific first so a message that would match two
 * patterns lands on the actionable one. In particular "driver is not verified…" must be
 * tested before any looser availability match, because the remedy is completely
 * different (fix your documents vs go back online).
 */
export function classifyAssignmentFailure(e: unknown): AssignmentFailure {
  const api = apiShape(e);
  if (!api) return 'network';
  if (api.status !== 409) return 'unknown';
  const m = api.message;
  if (m.includes('not verified')) return 'unverified';
  if (m.includes('capacity') || m.includes('cannot carry')) return 'vehicle_too_small';
  if (m.includes('COD') || m.includes('cash limit')) return 'over_cash_limit';
  if (m.includes('concurrent-job limit')) return 'run_full';
  if (m.includes('no active offer')) return 'offer_expired';
  if (m.includes('auction')) return 'bids_only';
  if (m.includes('not available')) return 'off_shift';
  return 'job_gone'; // 'delivery is no longer available' + anything else the server adds
}

/**
 * Driver-facing copy. Short, concrete, and it always says what to do next — a dead end
 * ("that failed") on a 3G phone mid-shift just gets tapped again.
 */
export function assignmentFailureMessage(reason: AssignmentFailure, action: AssignmentAction): string {
  switch (reason) {
    case 'unverified':
      // Deliberately does NOT suggest going online: their shift is fine, their paperwork
      // is not. Points at the one screen that can actually clear it.
      return "Your verification isn't active — open Profile to finish it. You can't take jobs until it's cleared.";
    case 'off_shift':
      return `You're off shift — go online again to ${action === 'append' ? 'add' : action} jobs.`;
    case 'vehicle_too_small':
      return "That job won't fit your vehicle — try another.";
    case 'over_cash_limit':
      return action === 'append'
        ? "That job's cash is over your limit for this run — try another."
        : "That job's cash is over your limit — try another.";
    case 'run_full':
      return 'Your run is full — finish a drop first.';
    case 'offer_expired':
      return 'That offer expired — the next one will pop up here.';
    case 'bids_only':
      return 'That job takes bids — send yours instead.';
    case 'job_gone':
      return 'That job was just taken — try another.';
    case 'network':
      return 'No connection — check your signal and try again.';
    case 'unknown':
      return `Could not ${VERB[action]} — please try again.`;
  }
}

/** Convenience: classify + phrase in one call. Callers still branch on `reason` when the
 *  failure needs an action beyond copy (off_shift resyncs the shift toggle). */
export function assignmentErrorCopy(
  e: unknown,
  action: AssignmentAction,
): { reason: AssignmentFailure; message: string } {
  const reason = classifyAssignmentFailure(e);
  return { reason, message: assignmentFailureMessage(reason, action) };
}
