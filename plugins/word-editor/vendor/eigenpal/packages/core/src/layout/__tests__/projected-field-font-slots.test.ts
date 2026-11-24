import { describe, expect, test } from 'bun:test';
import { applyEastAsiaFontSlots, type FieldAwarePiece } from '../field-pieces.ts';
import { resolveRunStyle } from '../run-style.ts';

const style = resolveRunStyle([
  {
    localName: 'rFonts',
    attributes: { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: 'SimSun' },
  },
  { localName: 'sz', attributes: { val: '28' } },
  { localName: 'b', attributes: {} },
  { localName: 'smallCaps', attributes: {} },
]);

function atomic(text: string, overrides: Partial<FieldAwarePiece> = {}): FieldAwarePiece {
  return {
    text,
    props: [],
    style,
    start: 9,
    end: 10,
    projected: true,
    fieldAtom: { formField: false },
    ...overrides,
  };
}

describe('projected atomic field font slots', () => {
  test('mixed result text selects East Asian glyphs without expanding its model unit', () => {
    const source = atomic('A抗B土');
    const output = applyEastAsiaFontSlots([source]);
    expect(output.map((piece) => [piece.text, piece.fontSlot])).toEqual([
      ['A', undefined],
      ['抗', 'eastAsia'],
      ['B', undefined],
      ['土', 'eastAsia'],
    ]);
    expect(output.map((piece) => [piece.start, piece.end])).toEqual([
      [9, 10],
      [9, 10],
      [9, 10],
      [9, 10],
    ]);
    for (const piece of output) {
      expect(piece.fieldAtom).toBe(source.fieldAtom);
      expect(piece.props).toBe(source.props);
      expect(piece.style).toBe(source.style);
      expect(piece.projected).toBe(true);
    }
  });

  test('literal and cached atomic results use the same displayed font partition', () => {
    const source = atomic('ABC抗浮DEF土');
    const literal: FieldAwarePiece = {
      ...source,
      projected: false,
      fieldAtom: undefined,
      start: 20,
      end: 20 + source.text.length,
    };
    const literalOutput = applyEastAsiaFontSlots([literal]);
    const projectedOutput = applyEastAsiaFontSlots([source]);
    const visible = (pieces: readonly FieldAwarePiece[]) =>
      pieces.map((piece) => ({
        text: piece.text,
        fontSlot: piece.fontSlot,
      }));
    expect(visible(projectedOutput)).toEqual(visible(literalOutput));
    expect(projectedOutput.every((piece) => piece.start === 9 && piece.end === 10)).toBe(true);
    expect(literalOutput[0]?.start).toBe(20);
    expect(literalOutput.at(-1)?.end).toBe(20 + source.text.length);
  });

  test('a simple font-dependent glyph oracle gives equal literal and atomic widths', () => {
    const source = atomic('ABC抗浮DEF土');
    const literal = {
      ...source,
      projected: false,
      fieldAtom: undefined,
      start: 0,
      end: source.text.length,
    };
    // Deliberately different font advances: equal scalar metrics cannot reveal
    // a missed East Asian font slot. This is an oracle, not a visual WPS claim.
    const measured = (pieces: readonly FieldAwarePiece[]) =>
      pieces.reduce(
        (sum, piece) =>
          sum +
          [...piece.text].reduce(
            (width, glyph) =>
              width +
              (/\p{Script=Han}/u.test(glyph) ? (piece.fontSlot === 'eastAsia' ? 14 : 10.89) : 7),
            0
          ),
        0
      );
    expect(measured(applyEastAsiaFontSlots([source]))).toBe(
      measured(applyEastAsiaFontSlots([literal]))
    );
    expect(measured(applyEastAsiaFontSlots([source]))).toBe(84);
  });

  test('whole East Asian and whole Latin atomic results retain their ownership', () => {
    const cjk = atomic('抗浮');
    const output = applyEastAsiaFontSlots([cjk]);
    expect(output.map((piece) => [piece.text, piece.start, piece.end, piece.fontSlot])).toEqual([
      ['抗浮', 9, 10, 'eastAsia'],
    ]);
    const latin = atomic('ABC');
    expect(applyEastAsiaFontSlots([latin])).toEqual([latin]);
  });

  test('projected text without an atomic owner retains its existing whole-piece behavior', () => {
    const piece = atomic('A抗B', { fieldAtom: undefined });
    expect(applyEastAsiaFontSlots([piece])).toEqual([piece]);
  });

  test('nonprojected atomic text is not treated as a cached display span', () => {
    const piece = atomic('A抗B', { projected: false });
    expect(applyEastAsiaFontSlots([piece])).toEqual([piece]);
  });

  test('form-field ownership is retained for every display slice', () => {
    const piece = atomic('A抗B', { fieldAtom: { formField: true } });
    const output = applyEastAsiaFontSlots([piece]);
    expect(output.map((span) => span.fontSlot)).toEqual([undefined, 'eastAsia', undefined]);
    expect(
      output.every(
        (span) =>
          span.fieldAtom === piece.fieldAtom && span.start === piece.start && span.end === piece.end
      )
    ).toBe(true);
  });

  test('measurement reservations remain indivisible', () => {
    const piece = atomic('A抗B', { measureText: '0000' });
    expect(applyEastAsiaFontSlots([piece])).toEqual([piece]);
  });

  test('navigation-owned pieces retain their reserved display range', () => {
    const piece = atomic('A抗B', { noteNav: {} as NonNullable<FieldAwarePiece['noteNav']> });
    expect(applyEastAsiaFontSlots([piece])).toEqual([piece]);
  });

  test.each(['positionalTab', 'breakKind', 'inlineDrawing', 'anchoredAtom', 'equation'])(
    'layout marker %s is not split into ordinary glyph spans',
    (key) => {
      const piece = {
        ...atomic('A抗B'),
        [key]: key === 'breakKind' ? 'page' : {},
      } as FieldAwarePiece;
      expect(applyEastAsiaFontSlots([piece])).toEqual([piece]);
    }
  );

  test('source piece is never rewritten while font slots are split', () => {
    const piece = atomic('A抗B');
    const before = { ...piece };
    applyEastAsiaFontSlots([piece]);
    expect(piece).toEqual(before);
    expect(piece.text).toBe('A抗B');
    expect(piece.start).toBe(9);
    expect(piece.end).toBe(10);
  });
});
