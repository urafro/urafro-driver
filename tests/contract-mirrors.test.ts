import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// No-hand-written-wire-types gate.
//
// WHY: `Earnings` in src/lib/api.ts was hand-written and had silently drifted — it
// omitted `referral_earned_minor`, a field the contract marks REQUIRED and the server
// has always returned. Referral credit could therefore never appear in the app, and
// nothing caught it: the "Contract types in sync" CI step regenerates api.gen.ts and
// diffs THAT, so it can only detect a stale generated file. It never checked whether
// hand-written types agreed with the generated ones. Five more mirrors (BoardJob,
// PodPhotoUpload, FailureReason, PodMethod, HistoryItem) were in the same class and
// happened to still be correct.
//
// All six are now derived from the generated types, so the COMPILER is the real gate.
// This test defends that decision: it fails if someone re-introduces a hand-written
// shape for a wire type instead of deriving it.
//
// Scope note: this is a source-shape check, deliberately narrow. It looks only for
// `interface`/object-literal type declarations in the API client — the one file where
// wire types live. Aliases (`export type X = Schemas[...]`, `= paths[...]`, unions of
// other derived types) are exactly what we want and pass.

const API_CLIENT = readFileSync(join(__dirname, '..', 'src', 'lib', 'api.ts'), 'utf8');

describe('src/lib/api.ts — wire types are derived, never hand-written', () => {
  it('declares no `interface` (a wire shape must alias the generated types)', () => {
    // `export class ApiError` is fine; interfaces here have only ever been wire shapes.
    const interfaces = [...API_CLIENT.matchAll(/^\s*(?:export\s+)?interface\s+(\w+)/gm)].map(
      (m) => m[1],
    );
    expect(interfaces).toEqual([]);
  });

  it('declares no inline object-literal type alias for a wire shape', () => {
    // Matches `type X = {` / `export type X = {` at the start of a declaration —
    // i.e. a shape spelled out by hand rather than looked up from the contract.
    const literals = [
      ...API_CLIENT.matchAll(/^\s*(?:export\s+)?type\s+(\w+)\s*=\s*\{/gm),
    ].map((m) => m[1]);
    expect(literals).toEqual([]);
  });

  it('still derives the type whose drift caused this gate to exist', () => {
    // Guard the guard: if api.ts stops mentioning Earnings at all, the checks above
    // would pass vacuously.
    expect(API_CLIENT).toMatch(/export type Earnings\s*=\s*\n?\s*paths\[/);
  });
});
