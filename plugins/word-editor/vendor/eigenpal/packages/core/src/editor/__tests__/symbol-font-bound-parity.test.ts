// The two lanes that decide whether a `w:sym` replaces the run's face must agree.
//
// `layout/symbol-run.ts` applies `@w:font` up to its own bound; `store/package/rendered-fonts.ts`
// answers "did that happen?" for the substitution notice, and cannot import layout to ask.
// It keeps the bound by value, the way that file keeps every other cross-lane constant, so
// this is the gate: a name in the gap between two bounds would be an override to one lane
// and not the other, and the run's real face would silently leave or re-enter the notice.

import { expect, test } from 'bun:test';
import { MAX_SYMBOL_FONT_LENGTH as LAYOUT_BOUND } from '../../layout/symbol-run.ts';
import { MAX_SYMBOL_FONT_LENGTH as STORE_BOUND } from '../../store/package/rendered-fonts.ts';

test('the store lane keeps layout own symbol-font bound', () => {
  expect(STORE_BOUND).toBe(LAYOUT_BOUND);
});
