// Text art outlines in visual order: a right-to-left run shapes right to left, and mixed
// runs are placed left to right as the bidi algorithm orders them.

import { describe, expect, test } from 'bun:test';
import { DEFAULT_RUN_STYLE, type ResolvedRunStyle } from '../run-style.ts';
import { textArtOutline } from '../text-art-outline.ts';
import type { TextMeasurer } from '../semantic-records.ts';

/** Each character is 10pt wide; an outline is one box per call, tagged by its direction. */
function measurer(calls: { text: string; direction?: string }[]): TextMeasurer {
  return {
    measure: (text) => text.length * 10,
    lineMetrics: () => ({ height: 12, baseline: 10 }),
    textOutline(text: string, style: ResolvedRunStyle) {
      calls.push({ text, ...(style.shaping ? { direction: style.shaping.direction } : {}) });
      const width = text.length * 10;
      return {
        path: `M0 -8L${width} -8L${width} 0Z`,
        ink: { left: 0, top: -8, right: width, bottom: 0 },
      };
    },
  };
}

describe('text art outlines', () => {
  test('left-to-right text shapes in one call, unchanged', () => {
    const calls: { text: string; direction?: string }[] = [];
    const outline = textArtOutline('Title', DEFAULT_RUN_STYLE, measurer(calls));
    expect(calls).toEqual([{ text: 'Title' }]);
    expect(outline?.path).toBe('M0 -8L50 -8L50 0Z');
  });

  test('a right-to-left word shapes right to left; a mixed string orders its runs', () => {
    const calls: { text: string; direction?: string }[] = [];
    const outline = textArtOutline('ab אבג', DEFAULT_RUN_STYLE, measurer(calls));
    expect(calls).toEqual([
      { text: 'ab ', direction: 'ltr' },
      { text: 'אבג', direction: 'rtl' },
    ]);
    // The right-to-left run follows the left-to-right one and its space.
    expect(outline?.path).toBe('M0 -8L30 -8L30 0ZM30 -8L60 -8L60 0Z');
    expect(outline?.ink).toEqual({ left: 0, top: -8, right: 60, bottom: 0 });
  });
});
