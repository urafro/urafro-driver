// Normalize a user-entered phone number to E.164 (what the API expects).
// Zimbabwe-friendly and forgiving: accepts "+263…", "0772…", "263…", "00263…",
// or a bare local "772…", and strips spaces/dashes/parens. Returns null when the
// result can't form a valid E.164 number, so callers can show an error.
export function toE164(input: string, defaultCountry = '263'): string | null {
  const cleaned = input.replace(/[\s()-]/g, '');
  let digits: string;
  if (cleaned.startsWith('+')) {
    digits = cleaned.slice(1);
  } else if (cleaned.startsWith('00')) {
    digits = cleaned.slice(2);
  } else if (cleaned.startsWith('0')) {
    digits = defaultCountry + cleaned.slice(1);
  } else if (cleaned.startsWith(defaultCountry)) {
    digits = cleaned;
  } else {
    digits = defaultCountry + cleaned;
  }
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
}
