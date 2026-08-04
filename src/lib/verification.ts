// What to do when a driver's verification lapses WHILE THEY ARE ALREADY IN THE APP.
//
// App.tsx routes only `verified` drivers to the tabbed app — everyone else gets
// Onboarding, which has the full per-state screen (upload UI, "in review", ops contact).
// So a driver on the Shift tab was verified when they got there. If the platform then
// suspends them, drops them to `in_review` on a document re-upload, or bans them, the
// app keeps them in the tabbed UI until it is restarted, because Root only fetches the
// profile on mount. Meanwhile the server has started refusing their claims.
//
// THE MID-JOB CONSTRAINT: a driver holding an in-flight delivery must NOT be bounced out
// to Onboarding. urafro-next's lifecycle deliberately does not re-check verification on
// picked_up / in_transit / delivered — only `freeDriverIfIdle` reads it, to park them
// `offline` once the run ends. The server expects them to finish; Onboarding has no job
// UI, so routing them there would strand a real delivery (and its COD) mid-run. They get
// a banner instead and keep working.

/** The verification states the contract defines (see api.gen.ts DriverProfile). */
export type VerificationStatus = 'unverified' | 'in_review' | 'verified' | 'suspended' | 'banned';

/** True when the platform will refuse this driver new jobs. */
export function isBlockedFromJobs(status: string | undefined | null): boolean {
  return status != null && status !== 'verified';
}

/**
 * The mid-run banner: they cannot be routed to Onboarding, so this is the ONLY place
 * they learn what happened. Every string names the delivery first — finishing it is the
 * immediate obligation — then the remedy.
 *
 * Voice matches Onboarding's waiting step ("on hold" / "blocked" / "in review",
 * "urAfro ops"), deliberately: a driver who finishes the run and lands on Onboarding
 * should read a continuation, not a different vocabulary. Kept separate from that copy
 * because the action differs — Onboarding says "add the items below" next to the upload
 * UI; here the next action is "finish the drop".
 */
export function verificationBannerCopy(
  status: string | undefined | null,
): { title: string; body: string } | null {
  switch (status) {
    case 'banned':
      return {
        title: 'Account blocked',
        body: 'Finish this delivery and hand over any cash. Your account has been blocked — contact urAfro ops if you think this is a mistake.',
      };
    case 'suspended':
      return {
        title: 'Account on hold',
        body: 'Finish this delivery and hand over any cash. Your account is on hold — message urAfro ops to sort it out.',
      };
    case 'in_review':
      return {
        title: "You're back in review",
        body: "Finish this delivery as normal. The urAfro team is re-checking your documents — you won't get new offers until you're cleared.",
      };
    case 'unverified':
      return {
        title: 'Verification needs attention',
        body: "Finish this delivery as normal, then open Profile to sort your documents. You won't get new offers until you're cleared.",
      };
    case 'verified':
      return null;
    default:
      // An UNKNOWN status (a state the platform adds after this build shipped — and this
      // app cannot be force-updated, so that will happen). isBlockedFromJobs treats it as
      // blocked, so returning null here would leave the driver blocked AND mute mid-run:
      // no banner, no explanation, offers silently drying up. Generic but honest. The
      // invariant `isBlockedFromJobs(s) === (verificationBannerCopy(s) !== null)` is
      // pinned in the test.
      return status == null
        ? null
        : {
            title: 'Account needs attention',
            body: 'Finish this delivery and hand over any cash. Your account needs attention before you can take new jobs — message urAfro ops.',
          };
  }
}
