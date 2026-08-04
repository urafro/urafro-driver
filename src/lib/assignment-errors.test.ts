import { describe, it, expect } from 'vitest';
import {
  classifyAssignmentFailure,
  assignmentFailureMessage,
  assignmentErrorCopy,
  type AssignmentFailure,
} from './assignment-errors';

// These are the ACTUAL 409 bodies urafro-next returns from the assignment paths
// (dispatch/driver-gates.ts GATE_MESSAGES + matching.service.ts). They are pinned here
// on purpose: the app matches on message text because the API has no machine-readable
// error code, so a server-side rewording silently degrades every one of these back to
// "That job was just taken". If someone changes the wire text, this file goes red — which
// is the only warning the contract gives us.
const SERVER_409 = {
  unverified: 'driver is not verified to take jobs',
  capacity: 'package exceeds your vehicle capacity',
  cod: 'COD amount exceeds your cash limit',
  runFull: 'driver is at their concurrent-job limit',
  noOffer: 'no active offer for this driver',
  offShift: 'driver is not available to take a job',
  gone: 'delivery is no longer available',
  auctionBatch: 'cannot batch an auction delivery',
  auctionGrab: 'cannot grab an auction delivery',
} as const;

/** Exactly what api.ts builds: `<status> <path> — <raw body>`, body being Nest's JSON. */
function apiError(status: number, detail: string, path = '/driver/deliveries/9f2c1b40/claim') {
  return {
    name: 'ApiError',
    status,
    message: `${status} ${path} — ${JSON.stringify({ message: detail, error: 'Conflict', statusCode: status })}`,
  };
}

describe('classifyAssignmentFailure', () => {
  const cases: [keyof typeof SERVER_409, AssignmentFailure][] = [
    ['unverified', 'unverified'],
    ['capacity', 'vehicle_too_small'],
    ['cod', 'over_cash_limit'],
    ['runFull', 'run_full'],
    ['noOffer', 'offer_expired'],
    ['offShift', 'off_shift'],
    ['gone', 'job_gone'],
    ['auctionBatch', 'bids_only'],
    ['auctionGrab', 'bids_only'],
  ];

  it.each(cases)('maps the real server 409 %s → %s', (key, expected) => {
    expect(classifyAssignmentFailure(apiError(409, SERVER_409[key]))).toBe(expected);
  });

  it('does NOT mistake "no longer available" for "not available" (off shift)', () => {
    // The two differ by one word and mean opposite things: one is "someone took it",
    // the other is "you're off shift, resync the toggle".
    expect(classifyAssignmentFailure(apiError(409, SERVER_409.gone))).toBe('job_gone');
    expect(classifyAssignmentFailure(apiError(409, SERVER_409.offShift))).toBe('off_shift');
  });

  it('separates verification from availability — different remedies', () => {
    expect(classifyAssignmentFailure(apiError(409, SERVER_409.unverified))).toBe('unverified');
    expect(assignmentFailureMessage('unverified', 'claim')).toMatch(/Profile/);
    expect(assignmentFailureMessage('unverified', 'claim')).not.toMatch(/online/i);
    expect(assignmentFailureMessage('off_shift', 'claim')).toMatch(/online/);
  });

  it('classifies the ops/customer wordings too (defensive — same gate, other audiences)', () => {
    expect(classifyAssignmentFailure(apiError(409, "the chosen driver's vehicle cannot carry this package"))).toBe(
      'vehicle_too_small',
    );
    expect(classifyAssignmentFailure(apiError(409, 'the chosen courier is over their cash limit for this delivery'))).toBe(
      'over_cash_limit',
    );
  });

  it('a transport failure is network, not a job problem', () => {
    expect(classifyAssignmentFailure(new TypeError('Network request failed'))).toBe('network');
    expect(classifyAssignmentFailure(new DOMException('Aborted', 'AbortError'))).toBe('network');
    expect(classifyAssignmentFailure(undefined)).toBe('network');
    expect(classifyAssignmentFailure(null)).toBe('network');
  });

  it('a non-409 API failure is unknown, never a confident job-specific claim', () => {
    expect(classifyAssignmentFailure(apiError(500, 'Internal server error'))).toBe('unknown');
    expect(classifyAssignmentFailure(apiError(404, 'delivery not found'))).toBe('unknown');
  });

  it('an unrecognised 409 degrades to "just taken", the old catch-all', () => {
    expect(classifyAssignmentFailure(apiError(409, 'some brand new server rule'))).toBe('job_gone');
  });

  it('the delivery id in the path never triggers a false match', () => {
    // Paths carry a uuid; the keywords are either uppercase or non-hex, so they cannot
    // appear in one. Guard it anyway — a false "off shift" would log a working driver out
    // of their shift toggle.
    const p = '/driver/deliveries/deadbeef-cafe-4ace-b0bb-0ddba11deca7/claim';
    expect(classifyAssignmentFailure(apiError(409, SERVER_409.gone, p))).toBe('job_gone');
  });
});

describe('assignmentFailureMessage', () => {
  it('always tells the driver what to do next — never a bare failure', () => {
    const reasons: AssignmentFailure[] = [
      'off_shift',
      'unverified',
      'vehicle_too_small',
      'over_cash_limit',
      'run_full',
      'offer_expired',
      'bids_only',
      'job_gone',
      'network',
      'unknown',
    ];
    for (const r of reasons) {
      const msg = assignmentFailureMessage(r, 'claim');
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).toMatch(/—|\btry\b|\bopen\b|\bgo\b|\bfinish\b|\bsend\b|\bwill\b/i);
    }
  });

  it('phrases the action per surface', () => {
    expect(assignmentFailureMessage('off_shift', 'grab')).toContain('grab');
    expect(assignmentFailureMessage('off_shift', 'append')).toContain('add');
    expect(assignmentFailureMessage('over_cash_limit', 'append')).toContain('this run');
    expect(assignmentFailureMessage('over_cash_limit', 'claim')).not.toContain('this run');
  });
});

describe('assignmentErrorCopy', () => {
  it('returns the reason so callers can act, not just display', () => {
    // off_shift is the one that needs a side effect (resync the shift toggle).
    const { reason, message } = assignmentErrorCopy(apiError(409, SERVER_409.offShift), 'claim');
    expect(reason).toBe('off_shift');
    expect(message).toMatch(/off shift/);
  });
});
