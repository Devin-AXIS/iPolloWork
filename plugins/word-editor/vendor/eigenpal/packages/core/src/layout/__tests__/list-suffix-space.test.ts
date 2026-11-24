// A `w:suff="space"` suffix is 569/2048 em of the marker's size, scaled and spaced as the
// marker is. The marker face's own space never sets it, so a monospaced or symbol bullet gets
// the same gap as any other. Measured on reference renderings: 3.33pt after a 12pt marker in
// Times New Roman, Courier New, Arial, or Wingdings, 6.67pt after a 24pt marker,
// 6.67pt + 2pt for a 12pt marker scaled to 200% with 2pt character spacing, and the full
// 3.33pt (3.37pt within rendering tolerance) after a 12pt superscript marker.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { listFirstLineOffset, resolveStoryListItems } from '../list-resolve.ts';
import { listMarkerWidth, listSuffixSpaceWidth } from '../list-marker-geometry.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import type { TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

test('the suffix space is 569/2048 em of the marker size', () => {
  const style = { ...DEFAULT_RUN_STYLE, fontSizePt: 12 };
  expect(listSuffixSpaceWidth(style)).toBeCloseTo(3.334, 3);
  expect(listSuffixSpaceWidth({ ...style, fontSizePt: 24 })).toBeCloseTo(6.668, 3);
});

test('the suffix space takes the marker scaling and character spacing', () => {
  const style = {
    ...DEFAULT_RUN_STYLE,
    fontSizePt: 12,
    horizontalScalePercent: 200,
    characterSpacingPt: 2,
  };
  expect(listSuffixSpaceWidth(style)).toBeCloseTo(6.668 + 2, 3);
});

test('the marker face does not set the suffix space', () => {
  // A face whose space is 50pt wide: the text still starts 569/2048 em past the marker.
  const fixed = createFixedMeasurer(6, 14);
  const wideSpace: TextMeasurer = {
    ...fixed,
    measure: (text, style) => (text === ' ' ? 50 : fixed.measure(text, style)),
  };
  const item = itemWithLevelRunProperties(
    '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="22"/>'
  );
  expect(listFirstLineOffset(item, wideSpace)).toBeCloseTo(
    listMarkerWidth(item, wideSpace) + (569 / 2048) * 11,
    6
  );
});

test('a superscript marker keeps the full-size suffix space', () => {
  // The marker glyphs shrink, but the gap after them stays 569/2048 em of the full size.
  const measurer = createFixedMeasurer(6, 14);
  const item = itemWithLevelRunProperties('<w:vertAlign w:val="superscript"/><w:sz w:val="22"/>');
  expect(item.markerStyle.verticalAlign).toBe('superscript');
  expect(listFirstLineOffset(item, measurer)).toBeCloseTo(
    listMarkerWidth(item, measurer) + (569 / 2048) * 11,
    6
  );
});

/** The list item of a one-level bullet list whose level states `levelRunProperties`. */
function itemWithLevelRunProperties(levelRunProperties: string) {
  const read = (name: string, xml: string) => {
    const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
    if (!result.ok) throw new Error(result.reason);
    return result.part;
  };
  const numbering = read(
    '/word/numbering.xml',
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">
      <w:start w:val="1"/><w:numFmt w:val="bullet"/><w:suff w:val="space"/>
      <w:lvlText w:val="o"/><w:lvlJc w:val="left"/>
      <w:rPr>${levelRunProperties}</w:rPr>
      <w:pPr><w:ind w:left="0" w:hanging="0"/></w:pPr></w:lvl></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
  );
  const document = read(
    '/word/document.xml',
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/>
      <w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Item</w:t></w:r></w:p></w:body></w:document>`
  );
  const body = document.root.children.find((child) => child.localName === 'body')!;
  const items = resolveStoryListItems(
    body.children.filter((child) => child.kind === 'paragraph'),
    buildNumberingIndex(numbering.root),
    undefined
  );
  return [...items.values()][0]!;
}
