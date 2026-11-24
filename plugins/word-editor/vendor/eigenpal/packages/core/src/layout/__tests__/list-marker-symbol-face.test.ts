// An AUTHORED symbol face sizing its own marker line.
//
// Word writes a bulleted level as `w:lvlText` U+F0B7 with `w:rFonts w:ascii="Symbol"`: the
// font's own byte on the private-use page. When the face is really there the codepoint must
// survive, because the face both draws the glyph and sets the line's ascent. Captured
// control, 12 pt: Symbol ascends 12.064 pt against the paragraph's 11.520, so its line grows
// to 16.482 where a plain line is 15.856; Wingdings ascends 10.787, below the paragraph, so
// its line does not move. Two faces, one rule, opposite outcomes.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { markerSymbolFontAvailability } from '../marker-symbol-font.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import type { ResolvedRunStyle } from '../run-style.ts';
import type { TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Word's default level-0 bullet, and the level-2 one. */
const SYMBOL_PUA_BULLET = '\u{f0b7}';
const WINGDINGS_PUA_SQUARE = '\u{f0a7}';
const UNICODE_BULLET = '\u{2022}';
const UNICODE_SMALL_SQUARE = '\u{25aa}';

/**
 * Real captured ascent/descent at 12 pt: the paragraph face, then the two symbol faces.
 * The document sets `w:spacing w:line="276"`, Word's 1.15 default, so a plain line is
 * (11.520 + 2.268) x 1.15 = 15.856 and a Symbol-marked one (12.064 + 2.268) x 1.15 = 16.482.
 */
const BANDS: Record<string, readonly [number, number]> = {
  '': [11.52, 2.268],
  symbol: [12.064, 2.268],
  wingdings: [10.787, 2.268],
};

/**
 * A measurer that knows a fixed set of families and reports vertical metrics per family.
 *
 * `admitted` is what `hasResolvedFont` answers yes to — the same question the export font
 * snapshot answers, so this double stands in for "the resolver supplied this face".
 */
function faceMeasurer(admitted: readonly string[]): TextMeasurer {
  const has = new Set(admitted.map((family) => family.toLowerCase()));
  const band = (style: ResolvedRunStyle): readonly [number, number] => {
    const family = (style.fontFamily ?? '').toLowerCase();
    return BANDS[has.has(family) ? family : ''] ?? BANDS['']!;
  };
  return {
    measure: (text) => text.length * 6,
    hasResolvedFont: (style) =>
      style.fontFamily === null || has.has(style.fontFamily.toLowerCase()),
    lineMetrics: (style) => {
      const [ascent, descent] = band(style);
      return { height: ascent + descent, baseline: ascent };
    },
  };
}

function partOf(xml: string, name: string): OoxmlPart {
  const part = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!part.ok) throw new Error(part.reason);
  return part.part;
}

/** Two bulleted levels: level 0 in Symbol, level 1 in Wingdings, both private-use. */
function numbering(wingdingsText = WINGDINGS_PUA_SQUARE, wingdingsFormat = 'bullet'): OoxmlPart {
  const level = (ilvl: number, family: string, lvlText: string): string =>
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${ilvl === 1 ? wingdingsFormat : 'bullet'}"/>` +
    `<w:lvlText w:val="${lvlText}"/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr>` +
    `<w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:hint="default"/></w:rPr></w:lvl>`;
  return partOf(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1">` +
      level(0, 'Symbol', SYMBOL_PUA_BULLET) +
      level(1, 'Wingdings', wingdingsText) +
      `</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    '/word/numbering.xml'
  );
}

function body(): OoxmlPart {
  const paragraph = (ilvl: number, text: string): string =>
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr>` +
    `<w:spacing w:line="276" w:lineRule="auto"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  return partOf(
    `<w:document xmlns:w="${W}"><w:body>${paragraph(0, 'One')}${paragraph(1, 'Two')}` +
      `<w:p><w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr>` +
      `<w:r><w:t>Plain</w:t></w:r></w:p></w:body></w:document>`,
    '/word/document.xml'
  );
}

function fragments(
  measurer: TextMeasurer,
  wingdingsText = WINGDINGS_PUA_SQUARE,
  wingdingsFormat = 'bullet'
) {
  const layout = layoutSemanticDocument(body(), 1, {
    measurer,
    numberingIndex: buildNumberingIndex(numbering(wingdingsText, wingdingsFormat).root),
  });
  return paragraphFragmentsOf(layout.pages[0]!);
}

describe('an admitted symbol face reaching a numbering marker', () => {
  test('a byte-encoded square uses the same fallback as its private-use form', () => {
    const byte = fragments(faceMeasurer([]), 'o')[1]!;
    const pua = fragments(faceMeasurer([]), '\uf06f')[1]!;
    expect(byte.marker?.text).toBe('□');
    expect(byte.marker?.style.fontFamily).toBe('Wingdings');
    expect(byte.marker).toEqual(pua.marker);
    expect(byte.lines).toEqual(pua.lines);
  });

  test('an available symbol face keeps an authored byte code', () => {
    const marker = fragments(faceMeasurer(['Wingdings']), 'o')[1]!.marker!;
    expect(marker.text).toBe('o');
    expect(marker.style.fontFamily).toBe('Wingdings');
  });

  test('a literal label in a decimal format does not use the byte-bullet fallback', () => {
    const marker = fragments(faceMeasurer([]), 'o', 'decimal')[1]!.marker!;
    expect(marker.text).toBe('o');
    expect(marker.style.fontFamily).toBe('Wingdings');
  });

  test('unknown and multi-character byte markers keep their authored face', () => {
    for (const text of ['z', 'oz', 'o ']) {
      const marker = fragments(faceMeasurer([]), text)[1]!.marker!;
      expect(marker.text).toBe(text);
      expect(marker.style.fontFamily).toBe('Wingdings');
    }
  });

  test('no symbol face keeps the Unicode translation and the plain line', () => {
    const [symbol, wingdings, plain] = fragments(faceMeasurer([]));
    expect(symbol!.marker?.text).toBe(UNICODE_BULLET);
    // The authored face stays on the marker, so it sizes the marker by its own metrics.
    expect(symbol!.marker?.style.fontFamily).toBe('Symbol');
    expect(wingdings!.marker?.text).toBe(UNICODE_SMALL_SQUARE);
    expect(symbol!.lines[0]!.box.height).toBe(plain!.lines[0]!.box.height);
    expect(wingdings!.lines[0]!.box.height).toBe(plain!.lines[0]!.box.height);
  });

  test('an admitted face keeps the private-use codepoint and its own face', () => {
    const [symbol, wingdings] = fragments(faceMeasurer(['Symbol', 'Wingdings']));
    expect(symbol!.marker?.text).toBe(SYMBOL_PUA_BULLET);
    expect(symbol!.marker?.style.fontFamily).toBe('Symbol');
    expect(wingdings!.marker?.text).toBe(WINGDINGS_PUA_SQUARE);
    expect(wingdings!.marker?.style.fontFamily).toBe('Wingdings');
  });

  test('the marker line takes its pitch from the authored face, in both directions', () => {
    const [symbol, wingdings, plain] = fragments(faceMeasurer(['Symbol', 'Wingdings']));
    // Symbol's taller ascent raises the baseline, and the box by the same amount.
    expect(plain!.lines[0]!.box.height).toBeCloseTo(15.856, 3);
    expect(symbol!.lines[0]!.baseline).toBeCloseTo(12.064, 3);
    expect(symbol!.lines[0]!.box.height).toBeCloseTo(16.482, 3);
    // Wingdings ascends LESS than the paragraph face, so its line is untouched.
    expect(wingdings!.lines[0]!.baseline).toBeCloseTo(11.52, 3);
    expect(wingdings!.lines[0]!.box.height).toBeCloseTo(15.856, 3);
  });

  test('admitting one face does not give the other one its glyph', () => {
    const [symbol, wingdings] = fragments(faceMeasurer(['Symbol']));
    expect(symbol!.marker?.text).toBe(SYMBOL_PUA_BULLET);
    expect(wingdings!.marker?.text).toBe(UNICODE_SMALL_SQUARE);
    expect(wingdings!.marker?.style.fontFamily).toBe('Wingdings');
  });
});

describe('the availability oracle', () => {
  test('a measurer with no symbol face is indistinguishable from no oracle', () => {
    expect(markerSymbolFontAvailability(undefined)).toBeUndefined();
    expect(markerSymbolFontAvailability(faceMeasurer([]))).toBeUndefined();
    expect(
      markerSymbolFontAvailability({
        measure: () => 0,
        lineMetrics: () => ({ height: 1, baseline: 1 }),
      })
    ).toBeUndefined();
  });

  test('equal coverage interns one oracle, so a font epoch that changed no symbol face keeps the memo', () => {
    const first = markerSymbolFontAvailability(faceMeasurer(['Symbol']));
    const second = markerSymbolFontAvailability(faceMeasurer(['Symbol']));
    expect(first).toBe(second!);
    expect(first!('Symbol')).toBe(true);
    expect(first!('symbol')).toBe(true);
    expect(first!('Wingdings')).toBe(false);
    expect(markerSymbolFontAvailability(faceMeasurer(['Wingdings']))).not.toBe(first!);
  });
});
