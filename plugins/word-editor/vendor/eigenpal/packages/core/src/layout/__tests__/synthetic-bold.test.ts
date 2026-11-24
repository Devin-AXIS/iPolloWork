// Synthesized bold follows the face's own bytes, not the weight it was registered under.
//
// A document embeds the face that draws bold text in the font's bold slot. For a family without
// a bold face, that slot holds a copy of the regular face, and bold text in it draws with a
// synthesized bold: each inked glyph also advances 1/50 em further. The test font stands in for such a family by filling the bold slot
// with the regular DejaVu Sans.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPart } from '../../store/index.ts';
import { linesOf } from '../semantic-records.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { HEAD_TAG, OS2_TAG, tableDirectoryBase, tableOffset } from '../sfnt-tables.ts';
import { sfntFaceIsBold } from '../synthetic-bold.ts';
import {
  DEFAULT_RUN_STYLE,
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  SYNTHETIC_BOLD_ADVANCE_EM,
  createFixedMeasurer,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
  type FontRequest,
  type ResolvedRunStyle,
  type StyleSpanRecord,
} from '../index.ts';

await initializeHarfBuzz();

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./fixtures/fonts/${name}`, import.meta.url)));
const regularBytes = fixture('DejaVuSans.ttf');
const boldBytes = fixture('DejaVuSans-Bold.ttf');

/** A copy of the regular face with one field of its `OS/2` or `head` table changed. */
function withField(table: number, offset: number, value: number): Uint8Array {
  const bytes = regularBytes.slice();
  const view = new DataView(bytes.buffer);
  const start = tableOffset(
    view,
    bytes.byteLength,
    tableDirectoryBase(view, bytes.length, 0)!,
    table,
    0
  );
  view.setUint16(start! + offset, value);
  return bytes;
}

describe('sfntFaceIsBold reads the face itself', () => {
  test('a regular face is not bold, a bold face is', () => {
    expect(sfntFaceIsBold(regularBytes, 0)).toBe(false);
    expect(sfntFaceIsBold(boldBytes, 0)).toBe(true);
  });

  test('a weight class of 600, the fsSelection bold bit, or the macStyle bold bit makes it bold', () => {
    expect(sfntFaceIsBold(withField(OS2_TAG, 4, 600), 0)).toBe(true);
    expect(sfntFaceIsBold(withField(OS2_TAG, 4, 599), 0)).toBe(false);
    expect(sfntFaceIsBold(withField(OS2_TAG, 62, 0x0020), 0)).toBe(true);
    expect(sfntFaceIsBold(withField(HEAD_TAG, 44, 0x0001), 0)).toBe(true);
  });

  test('bytes that are not a face are not bold', () => {
    expect(sfntFaceIsBold(new Uint8Array([1, 2, 3]), 0)).toBe(false);
    expect(sfntFaceIsBold(new Uint8Array(0), 0)).toBe(false);
  });
});

const face = (family: string, weight: number, bytes: Uint8Array) => ({
  request: { family, weight, style: 'normal' as const },
  id: `${family}-${weight}`,
  bytes,
  hash: sha256FontBytes(bytes),
  faceIndex: 0,
});
const snapshot = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2_000_000,
  resources: [
    face('Single Weight', 400, regularBytes),
    // The bold slot of a family without a bold face: the regular face again.
    face('Single Weight', 700, regularBytes),
    face('Two Weights', 400, regularBytes),
    face('Two Weights', 700, boldBytes),
  ],
  validateFont: harfBuzzFontValidator,
});
const measurer = createShapedMeasurer({
  shaper: createHarfBuzzTextShaper(),
  resolveFont: (style) => {
    const request: FontRequest = {
      family: style.fontFamily ?? 'Single Weight',
      weight: style.bold ? 700 : 400,
      style: 'normal',
    };
    const resolved = snapshot.resolve(request);
    return resolved instanceof FontResolutionError ? null : resolved;
  },
  fallback: createFixedMeasurer(6, 14),
  shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
  unicodeDataVersion: '15.1',
});
const style = (fontFamily: string, bold: boolean): ResolvedRunStyle => ({
  ...DEFAULT_RUN_STYLE,
  fontFamily,
  fontSizePt: 11,
  bold,
});

describe('a bold slot that holds a regular face', () => {
  test('measures each inked glyph 1/50 em wider', () => {
    const regular = measurer.measure('Bold text', style('Single Weight', false));
    const bold = measurer.measure('Bold text', style('Single Weight', true));
    // Eight inked glyphs; the space keeps its advance.
    expect(bold - regular).toBeCloseTo(8 * 11 * SYNTHETIC_BOLD_ADVANCE_EM, 3);
    expect(measurer.syntheticBold?.(style('Single Weight', true))).toBe(true);
    expect(measurer.caretAdvances?.('Bold text', style('Single Weight', true))?.at(-1)).toBeCloseTo(
      bold,
      3
    );
  });

  test('a real bold face takes no extra advance', () => {
    expect(measurer.syntheticBold?.(style('Two Weights', true))).toBe(false);
    expect(measurer.syntheticBold?.(style('Single Weight', false))).toBe(false);
  });

  test('text the face cannot shape takes the extra advance too', () => {
    // DejaVu Sans has no Hangul, so text with Hangul measures on the fallback. A substitute face
    // without bold widens each of its glyphs as the face widens its own.
    const extra = 11 * SYNTHETIC_BOLD_ADVANCE_EM;
    const widened = (text: string, smallCaps = false) =>
      (measurer.measure(text, { ...style('Single Weight', true), smallCaps }) -
        measurer.measure(text, { ...style('Single Weight', false), smallCaps })) /
      extra;
    expect(widened('가나다')).toBeCloseTo(3, 6);
    expect(widened('Bold가')).toBeCloseTo(5, 6);
    // A space, U+3000, and a combining mark keep their advance.
    expect(widened('가 나\u3000e\u0301')).toBeCloseTo(3, 6);
    // DejaVu Sans has no small capitals, so small caps measure on the fallback too.
    expect(widened('Small caps', true)).toBeCloseTo(9, 6);
    const bold = style('Single Weight', true);
    expect(measurer.caretAdvances?.('Bold가', bold)?.at(-1)).toBeCloseTo(
      measurer.measure('Bold가', bold),
      6
    );
  });

  test('fallback text widens once for each grapheme', () => {
    // An emoji sequence, a flag, and a skin-tone emoji each draw as one glyph. Conjoining jamo
    // compose into one syllable. Paint gives letter spacing once to each grapheme.
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    const flag = '\u{1F1F5}\u{1F1F1}';
    const thumb = '\u{1F44D}\u{1F3FD}';
    const jamo = '가';
    const extra = 11 * SYNTHETIC_BOLD_ADVANCE_EM;
    const bold = style('Single Weight', true);
    const regular = style('Single Weight', false);
    for (const [text, graphemes] of [
      [family, 1],
      [`${family}${family}가`, 3],
      [flag + flag, 2],
      [thumb, 1],
      [jamo + jamo, 2],
      [`가${'é'}`, 2],
    ] as const) {
      expect([
        text,
        (measurer.measure(text, bold) - measurer.measure(text, regular)) / extra,
      ]).toEqual([text, expect.closeTo(graphemes, 6)]);
      // The caret steps over each widened grapheme at its far edge.
      const advances = measurer.caretAdvances?.(text, bold);
      const plain = measurer.caretAdvances?.(text, regular);
      expect(advances?.at(-1)).toBeCloseTo(measurer.measure(text, bold), 6);
      expect((advances![1]! - plain![1]!) / extra).toBeCloseTo(1, 6);
    }
  });

  const spansOf = (runs: string) => {
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p>${runs}</w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    return linesOf(layoutSemanticDocument(read.part, 0, { measurer }))[0]!.spans;
  };
  const run = (family: string, text: string, bold = true) =>
    `<w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/>${bold ? '<w:b/>' : ''}<w:sz w:val="22"/></w:rPr>` +
    `<w:t xml:space="preserve">${text}</w:t></w:r>`;

  test('layout marks the spans whose bold is synthesized, and no blank span', () => {
    const spans = spansOf(
      run('Single Weight', 'Single ') +
        run('Two Weights', 'Two ') +
        run('Single Weight', '  ') +
        run('Single Weight', 'plain', false)
    );
    const marked = (text: string) => spans.find((span) => span.text === text)?.syntheticBold;
    expect(marked('Single ')).toBe(true);
    expect(marked('Two ')).toBeUndefined();
    expect(marked('  ')).toBeUndefined();
    expect(marked('plain')).toBeUndefined();
  });

  test('a blank that word spacing cannot take back splits off unmarked, at its own advance', () => {
    // Synthesized bold leaves U+3000 and U+2003 at their advance. Paint widens every character of
    // a marked span and takes the extra back only from U+0020 and U+00A0.
    const marks = (spans: readonly StyleSpanRecord[]) =>
      spans.map((span) => [span.text, span.syntheticBold === true]);
    expect(marks(spansOf(run('Single Weight', 'Bold\u3000text')))).toEqual([
      ['Bold', true],
      ['\u3000', false],
      ['text', true],
    ]);
    const spans = spansOf(run('Single Weight', 'Bold\u2003text'));
    expect(marks(spans)).toEqual([
      ['Bold', true],
      ['\u2003', false],
      ['text', true],
    ]);
    const bold = style('Single Weight', true);
    expect(spans[0]!.box.width).toBeCloseTo(measurer.measure('Bold', bold), 6);
    expect(spans[1]!.box.width).toBeCloseTo(measurer.measure('\u2003', bold), 6);
    expect(spans[1]!.box.x).toBeCloseTo(spans[0]!.box.x + spans[0]!.box.width, 6);
  });
});
