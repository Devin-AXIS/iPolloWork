import { expect, test } from 'bun:test';
import { compressCjkPieces } from '../cjk-spacing.ts';
import { DEFAULT_CJK_TYPOGRAPHY } from '../cjk-typography.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import { bidiPieces } from '../rtl-paragraph.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';

const measurer = createFixedMeasurer(6, 14);
const policy = {
  ...DEFAULT_CJK_TYPOGRAPHY,
  settings: {
    compression: 'compressPunctuation' as const,
    sourceEastAsianFont: true,
    strict: false,
    before: {},
    after: {},
  },
};
const piece = (text: string): FieldAwarePiece => ({
  text,
  start: 0,
  end: text.length,
  props: [],
  style: { ...DEFAULT_RUN_STYLE, kerningMinPt: 1 },
});

test('odd-direction mirrored punctuation retains its complete glyph advances', () => {
  const pieces = bidiPieces([piece('（אבג）')], true);
  expect(pieces.some((p) => p.style.shaping?.direction === 'rtl')).toBe(true);
  const compressed = compressCjkPieces(pieces, policy, measurer);
  expect(compressed).toEqual(pieces);
  expect(compressed.reduce((width, p) => width + measurer.measure(p.text, p.style), 0)).toBe(
    pieces.reduce((width, p) => width + measurer.measure(p.text, p.style), 0)
  );
});

test('LTR CJK punctuation still compresses when another piece has odd direction', () => {
  const rtl = {
    ...piece('（'),
    style: {
      ...DEFAULT_RUN_STYLE,
      kerningMinPt: 1,
      shaping: { script: 'Hani', direction: 'rtl' as const, level: 1, baseLevel: 1 },
    },
  };
  const ltr = {
    ...piece('（（甲））'),
    start: 1,
    end: 6,
    style: {
      ...DEFAULT_RUN_STYLE,
      kerningMinPt: 1,
      shaping: { script: 'Hani', direction: 'ltr' as const, level: 2, baseLevel: 1 },
    },
  };
  const compressed = compressCjkPieces([rtl, ltr], policy, measurer);
  expect(compressed[0]).toBe(rtl);
  const ltrCompressed = compressed.slice(1);
  expect(ltrCompressed.map((p) => p.text).join('')).toBe(ltr.text);
  expect(
    ltrCompressed.reduce((width, p) => width + measurer.measure(p.text, p.style), 0)
  ).toBeLessThan(measurer.measure(ltr.text, ltr.style));
});
