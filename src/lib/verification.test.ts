import { describe, it, expect } from 'vitest';
import { isBlockedFromJobs, verificationBannerCopy, type VerificationStatus } from './verification';

// The five states are the contract's (api.gen.ts DriverProfile.verification_status).
const ALL: VerificationStatus[] = ['unverified', 'in_review', 'verified', 'suspended', 'banned'];

describe('isBlockedFromJobs', () => {
  it('only `verified` may take new jobs', () => {
    for (const s of ALL) expect(isBlockedFromJobs(s)).toBe(s !== 'verified');
  });

  it('treats an absent status as NOT blocked — never lock a driver out on missing data', () => {
    // An old server, a trimmed payload or a failed parse must not strand a working
    // driver. The server is the gate; this is only how we explain it.
    expect(isBlockedFromJobs(undefined)).toBe(false);
    expect(isBlockedFromJobs(null)).toBe(false);
  });

  it('an UNKNOWN future status counts as blocked', () => {
    // Anything the platform adds that isn't `verified` means "no new jobs" — the
    // conservative read, since the server will refuse them regardless.
    expect(isBlockedFromJobs('shadow_banned')).toBe(true);
  });
});

describe('verificationBannerCopy', () => {
  it('returns nothing for a verified driver or an absent status', () => {
    expect(verificationBannerCopy('verified')).toBeNull();
    expect(verificationBannerCopy(undefined)).toBeNull();
    expect(verificationBannerCopy(null)).toBeNull();
  });

  it('INVARIANT: blocked ⇔ has copy — a blocked driver is never left mute', () => {
    // The render ANDs these two. If they ever disagree, a driver is refused jobs with no
    // banner explaining why. An unknown future status must land on the generic copy, not
    // on silence — this app ships via EAS and cannot be force-updated, so it WILL meet
    // states it does not know.
    for (const s of [...ALL, 'shadow_banned', 'probation']) {
      expect(isBlockedFromJobs(s)).toBe(verificationBannerCopy(s) !== null);
    }
  });

  it('every blocked state gets copy', () => {
    for (const s of ALL.filter((x) => x !== 'verified')) {
      expect(verificationBannerCopy(s)).not.toBeNull();
    }
  });

  it('always tells them to finish the delivery first — that is the whole point', () => {
    for (const s of ALL.filter((x) => x !== 'verified')) {
      expect(verificationBannerCopy(s)!.body).toMatch(/Finish this delivery/);
    }
  });

  it('routes the driver to the right remedy per state', () => {
    // A suspended/banned driver cannot fix anything in Profile — send them to ops.
    expect(verificationBannerCopy('banned')!.body).toMatch(/urAfro ops/);
    expect(verificationBannerCopy('suspended')!.body).toMatch(/urAfro ops/);
    // in_review is nobody's action — do NOT tell them to go do something.
    expect(verificationBannerCopy('in_review')!.body).not.toMatch(/open Profile/);
    // unverified IS their action.
    expect(verificationBannerCopy('unverified')!.body).toMatch(/open Profile/);
  });

  it('mentions the cash, because COD in a blocked driver\'s bag is the real risk', () => {
    expect(verificationBannerCopy('banned')!.body).toMatch(/cash/);
    expect(verificationBannerCopy('suspended')!.body).toMatch(/cash/);
  });
});
