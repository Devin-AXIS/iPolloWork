import { describe, expect, test } from 'bun:test';
import { separatorLeadingCost, trailingGapCost } from '../toolbar-measure.ts';

describe('toolbar width accounting', () => {
  test('separator leading cost includes width, inline margins, and both flex gaps', () => {
    // 1px rule + 6px margins each side + 2px gap twice (toolbar gap: 2px).
    expect(separatorLeadingCost(1, 6, 6, 2)).toBe(17);
  });

  test('fixed and More widths use trailing gap only, not a separator allowance', () => {
    expect(trailingGapCost(140, 2)).toBe(142);
    expect(trailingGapCost(34, 2)).toBe(36);
  });

  test('old undercount (width + 2 gaps only) is 12px short of the separator slot', () => {
    const legacy = 1 + 2 * 2;
    const corrected = separatorLeadingCost(1, 6, 6, 2);
    expect(corrected - legacy).toBe(12);
  });
});
