// applyEastAsiaFontSlots: how the paragraph-wide slot answer lands on pieces.

import { describe, expect, test } from 'bun:test';
import { applyEastAsiaFontSlots, type FieldAwarePiece } from '../field-pieces.ts';
import { resolveRunStyle } from '../run-style.ts';

const cjkStyle = resolveRunStyle([
  { localName: 'rFonts', attributes: { ascii: 'Arial', eastAsia: 'SimSun' } },
]);
const latinOnlyStyle = resolveRunStyle([{ localName: 'rFonts', attributes: { ascii: 'Arial' } }]);

let nextStart = 0;
function piece(text: string, overrides: Partial<FieldAwarePiece> = {}): FieldAwarePiece {
  const start = overrides.start ?? nextStart;
  const end = overrides.end ?? start + text.length;
  nextStart = end;
  return { text, props: [], style: cjkStyle, start, end, ...overrides };
}

describe('applyEastAsiaFontSlots', () => {
  test('splits mixed literal text into slot-homogeneous pieces, offsets contiguous', () => {
    nextStart = 0;
    const out = applyEastAsiaFontSlots([piece('甲方shall履行')]);
    expect(out.map(({ text, start, end, fontSlot }) => ({ text, start, end, fontSlot }))).toEqual([
      { text: '甲方', start: 0, end: 2, fontSlot: 'eastAsia' },
      { text: 'shall', start: 2, end: 7, fontSlot: undefined },
      { text: '履行', start: 7, end: 9, fontSlot: 'eastAsia' },
    ]);
    // The style object is untouched and SHARED across the slices: readback and the
    // format painter see the run's real resolution, whichever slice they start on.
    expect(out[0]!.style).toBe(cjkStyle);
    expect(out[1]!.style).toBe(cjkStyle);
  });

  test('a weak character alone in its own run inherits across the run boundary', () => {
    nextStart = 0;
    const out = applyEastAsiaFontSlots([piece('甲'), piece('，'), piece('方')]);
    expect(out.map((item) => item.fontSlot)).toEqual(['eastAsia', 'eastAsia', 'eastAsia']);
    expect(out.map((item) => item.text)).toEqual(['甲', '，', '方']);
  });

  test('ASCII punctuation between CJK runs stays in the base slots', () => {
    nextStart = 0;
    const out = applyEastAsiaFontSlots([piece('中文'), piece(', '), piece('Hello')]);
    expect(out.map((item) => item.fontSlot)).toEqual(['eastAsia', undefined, undefined]);
  });

  test('layout-owned pieces stay whole: uniform text takes the slot, mixed keeps base', () => {
    // A projected field result covers ONE model unit however long its display text is;
    // slicing its range would corrupt every offset after it.
    nextStart = 0;
    const uniform = piece('二〇二六', { projected: true, start: 0, end: 1 });
    const mixed = piece('二〇二六年8月', { projected: true, start: 1, end: 2 });
    const out = applyEastAsiaFontSlots([uniform, mixed]);
    expect(out).toHaveLength(2);
    expect(out[0]!.fontSlot).toBe('eastAsia');
    expect(out[0]!.start).toBe(0);
    expect(out[0]!.end).toBe(1);
    expect(out[1]!.fontSlot).toBeUndefined();
  });

  test('an unsupported code point costs itself the face, not its piece', () => {
    nextStart = 0;
    const out = applyEastAsiaFontSlots([piece('甲த文')]);
    expect(out.map(({ text, fontSlot }) => ({ text, fontSlot }))).toEqual([
      { text: '甲', fontSlot: 'eastAsia' },
      { text: 'த', fontSlot: undefined },
      { text: '文', fontSlot: 'eastAsia' },
    ]);
  });

  test('no distinct eastAsia face anywhere returns the input array untouched', () => {
    nextStart = 0;
    const pieces = [piece('甲方', { style: latinOnlyStyle })];
    expect(applyEastAsiaFontSlots(pieces)).toBe(pieces);
  });

  test('CJK text in a run WITHOUT its own eastAsia face keeps the base slots', () => {
    nextStart = 0;
    const out = applyEastAsiaFontSlots([piece('甲方'), piece('乙方', { style: latinOnlyStyle })]);
    expect(out[0]!.fontSlot).toBe('eastAsia');
    expect(out[1]!.fontSlot).toBeUndefined();
  });

  test('control pieces neither classify nor split', () => {
    nextStart = 0;
    const tab = piece('\t', { breakKind: undefined });
    const out = applyEastAsiaFontSlots([piece('甲'), tab, piece('方')]);
    expect(out.map((item) => item.text)).toEqual(['甲', '\t', '方']);
    expect(out[1]!.fontSlot).toBeUndefined();
  });
});
