// A list marker's own face sizes its line: the level's `w:rPr` reaches the marker, and the
// marker's ascent — never its descent — grows the paragraph's first line.
//
// Captured control: a 12pt list whose paragraph face ascends 11.52pt and descends 2.27pt,
// with markers in three faces. The one that ascends further (12.06pt) grows its line by the
// excess; the two that descend further (2.53pt and 3.60pt) leave their lines at the plain
// height. Two signs, one rule.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import type { ResolvedRunStyle } from '../run-style.ts';
import type { TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Word's default level-0 bullet: Symbol's byte 0xB7 on the private-use page. */
const SYMBOL_PUA_BULLET = '\u{f0b7}';
const UNICODE_BULLET = '\u{2022}';

/** The paragraph face: ascends 11, descends 3. */
const TEXT_ASCENT = 11;
const TEXT_DESCENT = 3;

/**
 * A measurer whose vertical metrics depend on the FAMILY, so a marker face is visible in the
 * line box. `Taller` out-ascends the text; `Deeper` out-descends it by the same amount.
 */
function familyMeasurer(): TextMeasurer {
  const bands: Record<string, readonly [number, number]> = {
    Taller: [TEXT_ASCENT + 4, TEXT_DESCENT],
    Deeper: [TEXT_ASCENT, TEXT_DESCENT + 4],
  };
  return {
    measure: (text) => text.length * 6,
    lineMetrics: (style: ResolvedRunStyle) => {
      const [ascent, descent] = bands[style.fontFamily ?? ''] ?? [TEXT_ASCENT, TEXT_DESCENT];
      return { height: ascent + descent, baseline: ascent };
    },
  };
}

function partOf(xml: string, name: string): OoxmlPart {
  const part = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!part.ok) throw new Error(part.reason);
  return part.part;
}

function numbering(levelRunProperties: string, lvlText = 'o'): OoxmlPart {
  return partOf(
    `<w:numbering xmlns:w="${W}">` +
      `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">` +
      `<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${lvlText}"/>` +
      `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>` +
      `<w:rPr>${levelRunProperties}</w:rPr>` +
      `</w:lvl></w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>` +
      `</w:numbering>`,
    '/word/numbering.xml'
  );
}

/** One list paragraph that wraps onto a second line, so later lines can be checked too. */
function body(): OoxmlPart {
  return partOf(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:numPr>` +
      `<w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
      `<w:r><w:t>${'one two three four five six seven eight nine ten '.repeat(8)}</w:t></w:r>` +
      `</w:p></w:body></w:document>`,
    '/word/document.xml'
  );
}

function fragmentOf(levelRunProperties: string, measurer: TextMeasurer, lvlText = 'o') {
  const layout = layoutSemanticDocument(body(), 1, {
    measurer,
    numberingIndex: buildNumberingIndex(numbering(levelRunProperties, lvlText).root),
  });
  return paragraphFragmentsOf(layout.pages[0]!)[0]!;
}

describe('a list level run property reaching the marker', () => {
  test("a bullet level's authored w:rFonts reaches the marker style", () => {
    const marker = fragmentOf(
      `<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:hint="default"/>`,
      familyMeasurer()
    ).marker;
    expect(marker?.text).toBe('o');
    expect(marker?.style.fontFamily).toBe('Courier New');
  });

  test('a symbol level translated to Unicode keeps the face that sizes it', () => {
    // `w:lvlText` U+F0B7 in Symbol is the default bullet. The text becomes U+2022 so that any
    // face can draw it, but the marker keeps Symbol: an unavailable symbol face still sizes
    // the marker by its own metrics, and paint draws the Unicode bullet in another face.
    const marker = fragmentOf(
      `<w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/>`,
      familyMeasurer(),
      SYMBOL_PUA_BULLET
    ).marker;
    expect(marker?.text).toBe(UNICODE_BULLET);
    expect(marker?.style.fontFamily).toBe('Symbol');
  });
});

describe('the marker face sizing its first line', () => {
  const plain = fragmentOf('', familyMeasurer());

  test('the plain list line is the paragraph face', () => {
    expect(plain.lines[0]!.baseline).toBe(TEXT_ASCENT);
    expect(plain.lines[0]!.box.height).toBe(TEXT_ASCENT + TEXT_DESCENT);
    expect(plain.lines.length).toBeGreaterThan(1);
  });

  test('a marker face that ascends further pushes the first line down by the excess', () => {
    const fragment = fragmentOf(`<w:rFonts w:ascii="Taller" w:hAnsi="Taller"/>`, familyMeasurer());
    const first = fragment.lines[0]!;
    expect(first.baseline).toBe(TEXT_ASCENT + 4);
    expect(first.box.height).toBe(plain.lines[0]!.box.height + 4);
    // Only the first line carries the marker; the rest of the paragraph is untouched.
    expect(fragment.lines[1]!.baseline).toBe(TEXT_ASCENT);
    expect(fragment.lines[1]!.box.height).toBe(plain.lines[1]!.box.height);
  });

  test('a marker face that descends further leaves the line alone', () => {
    const first = fragmentOf(`<w:rFonts w:ascii="Deeper" w:hAnsi="Deeper"/>`, familyMeasurer())
      .lines[0]!;
    expect(first.baseline).toBe(TEXT_ASCENT);
    expect(first.box.height).toBe(plain.lines[0]!.box.height);
  });

  test("a level's w:sz larger than the text grows the first line", () => {
    // The deterministic measurer scales its band with `w:sz`, so a 22pt marker on an 11pt
    // paragraph is the size case the same rule covers.
    const measurer = createFixedMeasurer();
    const grown = fragmentOf(`<w:sz w:val="44"/>`, measurer).lines[0]!;
    const base = fragmentOf('', measurer).lines[0]!;
    const markerBaseline = measurer.lineMetrics({
      ...base.spans[0]!.style,
      fontSizePt: 22,
    }).baseline;
    expect(markerBaseline).toBeGreaterThan(base.baseline);
    expect(grown.baseline).toBeCloseTo(markerBaseline, 9);
    expect(grown.box.height).toBeCloseTo(base.box.height + (markerBaseline - base.baseline), 9);
  });

  test('a vanished marker is not measured, so it never grows the line', () => {
    const first = fragmentOf(
      `<w:rFonts w:ascii="Taller" w:hAnsi="Taller"/><w:vanish/>`,
      familyMeasurer()
    ).lines[0]!;
    expect(first.baseline).toBe(TEXT_ASCENT);
    expect(first.box.height).toBe(plain.lines[0]!.box.height);
  });
});
