// The section-prepass guard map stays true (companion to section-prepass-guards.ts).
//
// The map's `satisfies` clause catches a `SectionPrepass` field that was never classified.
// This test catches the drift the compiler cannot see: the hand-written `prepassValid`
// expression in semantic-layout.ts (and the input comparison it calls in
// section-prepass-inputs.ts) silently dropping a `'validity-checked'` clause — the
// exact omission that serves a stale prepass — or quietly comparing a `'derived-covered'`
// field, which would mean the map's proof for that field is stale.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SECTION_PREPASS_GUARDS, type SectionPrepassGuard } from '../section-prepass-guards.ts';

describe('the prepassValid expression agrees with the map', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../semantic-layout.ts', import.meta.url)),
    'utf8'
  );
  // From the memo's input record through the validity expression.
  const start = source.indexOf('const prepassInputs =');
  expect(start).toBeGreaterThan(-1);
  // The validity expression ends where the memo is consumed.
  const end = source.indexOf('const prepass: SectionPrepass', start);
  expect(end).toBeGreaterThan(start);
  const region = source.slice(start, end);
  // The shared input comparison lives in its own module and reads the memo as `previous`.
  const helperSource = readFileSync(
    fileURLToPath(new URL('../section-prepass-inputs.ts', import.meta.url)),
    'utf8'
  );
  const helper = helperSource.slice(
    helperSource.indexOf('export function sectionPrepassInputsMatch')
  );
  const callsHelper = /\bsectionPrepassInputsMatch\(\s*prepassMemo\b/.test(region);

  const fields = Object.entries(SECTION_PREPASS_GUARDS) as [string, SectionPrepassGuard][];

  for (const [field, guard] of fields) {
    // Word boundary, not substring: a future `prepassMemo.keysExtra` must not satisfy
    // the `keys` gate.
    const readsInRegion = new RegExp(`\\bprepassMemo\\.${field}\\b`).test(region);
    const readsInHelper = callsHelper && new RegExp(`\\bprevious\\.${field}\\b`).test(helper);
    if (guard === 'validity-checked') {
      test(`'${field}' has a prepassValid clause`, () => {
        expect(readsInRegion || readsInHelper).toBe(true);
      });
    } else {
      test(`'${field}' is derived-covered and prepassValid never reads it`, () => {
        // If the expression starts comparing it, the field is no longer a pure derivation
        // of the checked inputs — reclassify it, do not just silence this.
        expect(readsInRegion || readsInHelper).toBe(false);
      });
    }
  }
});
