// In legacy modes an inline object that opens its line stays on it beside a float.

import { expect, test } from 'bun:test';
import type { ExclusionZone } from '../drawing-exclusion.ts';
import { besideFloatWidth } from '../legacy-inline-beside-float.ts';

const zone = (sourceKind?: ExclusionZone['sourceKind']) =>
  ({
    sourceKind,
    drawingNodeId: 'z',
    anchorParagraphId: 'p',
    anchorModelStart: 0,
  }) as ExclusionZone;
const legacy = { inlineObjectsBesideFloats: true };

test('an opening object beside a float asks only for a token width in legacy modes', () => {
  expect(besideFloatWidth(113, legacy, false, () => [zone('table')])).toBe(1);
  expect(besideFloatWidth(300, legacy, false, () => [zone()])).toBe(1);
});

test('the authored width stays everywhere else', () => {
  // Modern modes, a line that already holds content, and a line with no float beside it.
  expect(besideFloatWidth(113, {}, false, () => [zone('table')])).toBe(113);
  expect(besideFloatWidth(113, legacy, true, () => [zone('table')])).toBe(113);
  expect(besideFloatWidth(113, legacy, false, () => [])).toBe(113);
  expect(besideFloatWidth(0.5, legacy, false, () => [zone()])).toBe(0.5);
});
