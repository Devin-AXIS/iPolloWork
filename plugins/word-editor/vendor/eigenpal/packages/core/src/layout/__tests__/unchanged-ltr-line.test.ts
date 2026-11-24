import { expect, test } from 'bun:test';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import type { StyleSpanRecord } from '../semantic-records.ts';
import { reorderBidiSpans } from '../rtl-paragraph.ts';
import { bidiTrailingSpaces } from '../bidi-trailing-spaces.ts';

function span(text: string, x: number, width: number): StyleSpanRecord {
  return {
    text,
    range: { paragraphId: 'p', start: 0, end: text.length },
    props: [],
    box: { x, y: 0, width, height: 12 },
    style: {
      ...DEFAULT_RUN_STYLE,
      shaping: { script: 'Latn', direction: 'ltr', level: 0, baseLevel: 0, runDirection: 'ltr' },
    },
  };
}

test('ordinary LTR text and trailing spaces retain span records during reflow', () => {
  const spans = [span('Text', 10, 24), span(' ', 34, 6)];
  expect(reorderBidiSpans(spans, false)).toBe(spans);
  expect(bidiTrailingSpaces(spans, false, true, false)).toBeUndefined();
});

test('justification gaps still become span advances and word spacing', () => {
  const spans = [span('A ', 10, 12), span('B', 28, 6)];
  const result = reorderBidiSpans(spans, false);
  expect(result[0]!.box.width).toBe(18);
  expect(result[0]!.style.shaping!.wordSpacingPt).toBe(6);
  expect(result[1]!.box.x).toBe(28);
});

test('RTL runs and nonzero embedding levels still reorder', () => {
  const first = span('A', 0, 6);
  const second = span('B', 6, 6);
  const rtl = [first, second].map((item) => ({
    ...item,
    style: {
      ...item.style,
      shaping: {
        ...item.style.shaping!,
        direction: 'rtl' as const,
        level: 1,
        runDirection: 'rtl' as const,
      },
    },
  }));
  expect(reorderBidiSpans(rtl, false)[0]!.box.x).toBe(6);
  expect(reorderBidiSpans(rtl, true)[0]!.box.x).toBe(6);
});
