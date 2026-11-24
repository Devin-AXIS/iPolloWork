// Modern modes test a wrap band against a line's content, not the extra an auto multiple adds.

import { expect, test } from 'bun:test';
import { createLineExclusionProbe } from '../line-exclusion-clearance.ts';
import type { ParagraphLineSpacing } from '../paragraph-style.ts';
import type { PendingLine } from '../pending-line.ts';

const probe = (lineSpacing: ParagraphLineSpacing, picture = false) => {
  const line = { height: 0, baseline: 0, drawings: [] } as unknown as PendingLine;
  const created = createLineExclusionProbe({
    line: () => line,
    top: () => 0,
    left: 0,
    right: 400,
    lineSpacing,
    initialMetrics: { height: 13.8, baseline: 11 },
  });
  if (picture) created.setMetrics({ height: 36.75, baseline: 36.75 }, 300, true);
  return created.height();
};

test('a text line under 1.5 spacing tests its text height when the band ignores the extra', () => {
  expect(probe({ rule: 'auto', value: 360 })).toBeCloseTo(20.7, 6);
  expect(probe({ rule: 'auto', value: 360, wrapsContentOnly: true })).toBeCloseTo(13.8, 6);
});

test('a picture line under 1.5 spacing tests the picture alone when the band ignores the extra', () => {
  // Legacy: the picture plus half a text line of extra. Modern: the picture.
  expect(probe({ rule: 'auto', value: 360 }, true)).toBeCloseTo(36.75 + 6.9, 6);
  expect(probe({ rule: 'auto', value: 360, wrapsContentOnly: true }, true)).toBeCloseTo(36.75, 6);
});
