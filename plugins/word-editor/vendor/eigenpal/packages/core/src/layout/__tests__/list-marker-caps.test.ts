// A list marker paints in capitals when `w:caps` reaches it, so it also measures in capitals:
// the first line starts after the painted marker. `w:smallCaps` never applies to a marker,
// whether the level, the paragraph mark, or a style sets it.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { listFirstLineOffset, resolveStoryListItems } from '../list-resolve.ts';
import { listMarkerWidth } from '../list-marker-geometry.ts';
import { rtlListMarkerPieces } from '../list-marker-bidi.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { paragraphFragmentsOf, type TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** The space suffix: 569/2048 em of the 11pt marker. */
const SPACE = (569 / 2048) * 11;

// Capital letters are 9pt wide and everything else 6pt, so a marker measured in its
// original case comes out narrower than the capitals it paints.
const fixed = createFixedMeasurer(6, 14);
const measurer: TextMeasurer = {
  ...fixed,
  measure: (text, style) => {
    const capitals = [...text].filter((char) => char !== char.toLowerCase()).length;
    return fixed.measure(text, style) + (capitals * 3 * style.fontSizePt) / 11;
  },
};

function part(name: string, root: string, body: string) {
  const result = readOoxmlPart(`<w:${root} xmlns:w="${W}">${body}</w:${root}>`, {
    name,
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** One level, `Article %1 –` with a space suffix, the level's own `w:rPr` given. */
function numbering(levelRunProperties: string) {
  return buildNumberingIndex(
    part(
      '/word/numbering.xml',
      'numbering',
      `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/>
        <w:numFmt w:val="decimal"/><w:suff w:val="space"/><w:lvlText w:val="Article %1 –"/>
        <w:lvlJc w:val="left"/><w:rPr><w:sz w:val="22"/>${levelRunProperties}</w:rPr>
        <w:pPr><w:ind w:left="0" w:hanging="0"/></w:pPr></w:lvl></w:abstractNum>
        <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>`
    ).root
  );
}

const BODY =
  '<w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
  '<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>Definitions</w:t></w:r></w:p></w:body>';

function itemOf(levelRunProperties: string) {
  const document = part('/word/document.xml', 'document', BODY);
  const body = document.root.children.find((child) => child.localName === 'body')!;
  const paragraphs = body.children.filter((child) => child.kind === 'paragraph');
  const items = resolveStoryListItems(paragraphs, numbering(levelRunProperties), undefined);
  return { document, paragraph: paragraphs[0]!, item: [...items.values()][0]! };
}

test('a marker in capitals measures as the capitals it paints', () => {
  const { item } = itemOf('<w:caps/>');
  // "Article 1 –" has 11 characters, all 6pt, plus 3pt more for each of its 7 capitals.
  expect(listMarkerWidth(item, measurer)).toBe(11 * 6 + 7 * 3);
  // The space suffix starts the text after that.
  expect(listFirstLineOffset(item, measurer)).toBeCloseTo(11 * 6 + 7 * 3 + SPACE, 6);
  // Without caps only the authored capital counts.
  expect(listMarkerWidth(itemOf('').item, measurer)).toBe(11 * 6 + 3);
});

test('the laid-out text starts after a marker in capitals, not inside it', () => {
  const { document, paragraph, item } = itemOf('<w:caps/>');
  const layout = layoutSemanticDocument(document, 1, {
    measurer,
    listItems: new Map([[paragraph.id, item]]),
    geometry: { width: 400, height: 400, margin: { top: 20, right: 20, bottom: 20, left: 20 } },
  });
  const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
  const marker = fragment.marker!;
  expect(marker.box.width).toBe(11 * 6 + 7 * 3);
  // The record keeps the authored text; paint draws it in capitals from its style.
  expect(marker.text).toBe('Article 1 –');
  expect(marker.style.caps).toBe(true);
  const firstSpan = fragment.lines[0]!.spans[0]!;
  expect(firstSpan.box.x).toBeGreaterThanOrEqual(marker.box.x + marker.box.width + SPACE - 1e-6);
});

test('a marker never takes small capitals', () => {
  const { item } = itemOf('<w:smallCaps/>');
  expect(item.markerStyle.smallCaps).toBe(false);
  expect(listMarkerWidth(item, measurer)).toBe(11 * 6 + 3);
});

/** A heading style that numbers its paragraphs and gives them `styleRunProperties`. */
function layOutStyled(styleRunProperties: string) {
  const styles = part(
    '/word/styles.xml',
    'styles',
    `<w:style w:type="paragraph" w:styleId="Heading"><w:name w:val="Heading"/><w:pPr>
      <w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
      <w:rPr><w:sz w:val="22"/>${styleRunProperties}</w:rPr></w:style>`
  );
  const document = part(
    '/word/document.xml',
    'document',
    '<w:body><w:p><w:pPr><w:pStyle w:val="Heading"/></w:pPr>' +
      '<w:r><w:t>Definitions</w:t></w:r></w:p></w:body>'
  );
  const layout = layoutSemanticDocument(document, 1, {
    measurer,
    numberingIndex: numbering(''),
    styleCascade: buildStyleCascadeTable(styles.root),
    geometry: { width: 400, height: 400, margin: { top: 20, right: 20, bottom: 20, left: 20 } },
  });
  return paragraphFragmentsOf(layout.pages[0]!)[0]!;
}

test('caps from the paragraph style reach the marker and move the text after it', () => {
  const fragment = layOutStyled('<w:caps/>');
  const marker = fragment.marker!;
  expect(marker.style.caps).toBe(true);
  expect(marker.box.width).toBe(11 * 6 + 7 * 3);
  const text = fragment.lines[0]!.spans[0]!;
  expect(text.box.x).toBeGreaterThanOrEqual(marker.box.x + marker.box.width + SPACE - 1e-6);
});

test('small caps from the paragraph style leave the marker in its own letters', () => {
  const fragment = layOutStyled('<w:smallCaps/>');
  expect(fragment.marker!.style.smallCaps).toBe(false);
  expect(fragment.marker!.box.width).toBe(11 * 6 + 3);
  // The heading text itself keeps its small capitals.
  expect(fragment.lines[0]!.spans[0]!.style.smallCaps).toBe(true);
});

test('each piece of a right-to-left marker measures in capitals', () => {
  const { item } = itemOf('<w:caps/>');
  const box = { x: 0, y: 0, width: 100, height: 14 };
  const pieces = rtlListMarkerPieces('1 – Article', item.markerStyle, box, measurer);
  // A left-to-right word inside the right-to-left marker: its 7 letters paint as capitals.
  const word = pieces?.find((piece) => piece.text.includes('Article'));
  expect(word?.box.width).toBe(7 * 6 + 7 * 3);
});
