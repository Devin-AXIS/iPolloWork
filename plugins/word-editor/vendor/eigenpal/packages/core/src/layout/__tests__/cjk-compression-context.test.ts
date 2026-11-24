import { expect, test } from 'bun:test';
import { compressCjkPieces } from '../cjk-spacing.ts';
import { DEFAULT_CJK_TYPOGRAPHY } from '../cjk-typography.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';

const measurer = createFixedMeasurer(12, 14);
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
function compress(text: string, split = text.length) {
  const pieces: FieldAwarePiece[] = [text.slice(0, split), text.slice(split)]
    .filter(Boolean)
    .map((text, index) => ({
      text,
      start: index === 0 ? 0 : split,
      end: index === 0 ? split : split + text.length,
      style: { ...DEFAULT_RUN_STYLE, kerningMinPt: 1, fontSizePt: 11 },
      props: [],
    }));
  return compressCjkPieces(pieces, policy, measurer);
}
function advances(pieces: readonly FieldAwarePiece[]) {
  return pieces.flatMap((piece) => [...piece.text].map(() => 12 + piece.style.characterSpacingPt));
}

test('issue #792 contract brackets and form spaces keep their natural advances', () => {
  for (const text of [
    '甲方（出租方）：【    】',
    '原合同租期自【  】年【  】月【  】日起至【  】年【  】月【  】日止。',
    '签订了《    》（以下简称“原合同”），双方同意按以下第【  】种方式处理：',
  ]) {
    const pieces = compress(text);
    expect(pieces.map((piece) => piece.text).join('')).toBe(text);
    for (const piece of pieces) {
      if (/[（【《 ]/u.test(piece.text)) {
        expect(piece.style.characterSpacingPt).toBe(0);
        expect(piece.glyphOffsetPt).toBeUndefined();
      }
    }
  }
});

test.each([
  ['甲（乙）丙', [12, 12, 12, 12, 12]],
  ['甲【  】乙', [12, 12, 12, 12, 12, 12]],
  ['（甲）', [12, 12, 12]],
  ['甲）（乙', [12, 6, 12, 12]],
  ['甲（（乙', [12, 12, 6, 12]],
  ['甲）。乙', [12, 6, 12, 12]],
  ['甲！？：；乙', [12, 12, 12, 12, 12, 12]],
  ['甲）：【乙', [12, 6, 6, 12, 12]],
  ['甲：：）乙', [12, 12, 12, 12, 12]],
  ['甲。乙', [12, 12, 12]],
  ['甲。\n（乙', [12, 12, 12, 12, 12]],
] as const)('contextual advances survive every run seam: %s', (text, expected) => {
  for (let split = 1; split <= text.length; split++) {
    const pieces = compress(text, split);
    expect(advances(pieces)).toEqual([...expected]);
    let end = 0;
    for (const piece of pieces) {
      expect(piece.start).toBe(end);
      expect(piece.end - piece.start).toBe(piece.text.length);
      end = piece.end;
      if (piece.glyphOffsetPt) expect(piece.glyphOffsetPt).toBe(-6);
    }
    expect(end).toBe(text.length);
  }
});

test('opening glyphs move by the removed left bearing; closing glyphs keep their origin', () => {
  const pieces = compress('（（甲））');
  expect(pieces.map((piece) => piece.glyphOffsetPt ?? 0)).toEqual([0, -6, 0, 0, 0]);
  expect(pieces.map((piece) => piece.style.characterSpacingPt)).toEqual([0, -6, 0, -6, 0]);
});

test('punctuation compression removes natural bearings, not authored tracking', () => {
  for (const tracking of [2, -2, -10]) {
    const style = {
      ...DEFAULT_RUN_STYLE,
      kerningMinPt: 1,
      fontSizePt: 11,
      characterSpacingPt: tracking,
    };
    const pieces = compressCjkPieces(
      [{ text: '（（', start: 0, end: 2, props: [], style }],
      policy,
      measurer
    );
    const compressed = pieces[1]!;
    const reduction = Math.min(6, 12 + tracking);
    expect(compressed.style.characterSpacingPt).toBe(tracking - reduction);
    expect(compressed.glyphOffsetPt).toBe(-reduction);
    expect(measurer.measure(compressed.text, compressed.style)).toBeGreaterThanOrEqual(0);
    expect(style.characterSpacingPt).toBe(tracking);
  }
});

test('outlined punctuation retains its bearing for the extended ink', () => {
  const piece: FieldAwarePiece = {
    text: '（（甲））',
    start: 0,
    end: 5,
    props: [],
    style: { ...DEFAULT_RUN_STYLE, kerningMinPt: 1, textOutline: { widthPt: 1, color: 'FF0000' } },
  };
  expect(compressCjkPieces([piece], policy, measurer)).toEqual([piece]);
});

test('decorated, linked-style, and tracked punctuation retains native ink and selection', () => {
  const base: FieldAwarePiece = {
    text: '（（甲））',
    start: 0,
    end: 5,
    props: [],
    style: { ...DEFAULT_RUN_STYLE, kerningMinPt: 1 },
  };
  const decorated: FieldAwarePiece[] = [
    {
      ...base,
      style: {
        ...DEFAULT_RUN_STYLE,
        kerningMinPt: 1,
        underline: { variant: 'single', color: null },
      },
    },
    { ...base, style: { ...DEFAULT_RUN_STYLE, kerningMinPt: 1, strike: true } },
    { ...base, style: { ...DEFAULT_RUN_STYLE, kerningMinPt: 1, doubleStrike: true } },
    { ...base, props: [{ localName: 'rPrChange', attributes: { id: '1' } }] },
    ...(['insertion', 'deletion', 'moveFrom', 'moveTo'] as const).map((kind) => ({
      ...base,
      revisions: [{ kind, id: '1', author: 'QA', nodeId: 'revision' }],
    })),
  ];
  for (const piece of decorated)
    expect(compressCjkPieces([piece], policy, measurer)).toEqual([piece]);
  const plain = { ...base, start: 5, end: 10 };
  const result = compressCjkPieces([decorated[0]!, plain], policy, measurer);
  expect(result[0]).toEqual(decorated[0]);
  expect(result.some((piece) => piece.glyphOffsetPt !== undefined)).toBe(true);
});
