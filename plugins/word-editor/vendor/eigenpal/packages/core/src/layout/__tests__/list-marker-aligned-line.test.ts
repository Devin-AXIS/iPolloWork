// In a centered or right-aligned list paragraph (17.3.1.13), the marker and its suffix belong
// to the first line (17.9.7): the text keeps its distance from the marker, so the marker moves
// as far as alignment moves the text, in the body and in a table cell.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string) {
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw Error(parsed.reason);
  return parsed.part;
}

const numberingIndex = buildNumberingIndex(
  part(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">` +
      '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>'
  ).root
);

function layOut(jc: string, table: boolean, text = 'Item text', cellWidth = 5000) {
  const run = text ? `<w:r><w:t>${text}</w:t></w:r>` : '';
  const paragraph =
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>` +
    `${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>${run}</w:p>`;
  const body = table
    ? `<w:tbl><w:tblPr><w:tblW w:w="${cellWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="${cellWidth}"/></w:tblGrid><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl><w:p/>`
    : paragraph;
  const layout = layoutSemanticDocument(
    part(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
    0,
    {
      measurer: createFixedMeasurer(6, 14),
      numberingIndex,
      geometry: { width: 400, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    }
  );
  const fragment = [...paragraphFragmentsOf(layout.pages[0]!)].find((entry) => entry.marker)!;
  const textX = Math.min(Infinity, ...fragment.lines[0]!.spans.map((span) => span.box.x));
  return { markerX: fragment.marker!.box.x, textX };
}

describe('list marker on an aligned first line', () => {
  for (const table of [false, true]) {
    test(`moves with centered and right-aligned text (table=${table})`, () => {
      const left = layOut('', table);
      // The hanging slot: the marker starts 18pt before the text.
      expect(left.textX - left.markerX).toBeCloseTo(18, 5);
      for (const jc of ['center', 'right']) {
        const aligned = layOut(jc, table);
        expect(aligned.textX).toBeGreaterThan(left.textX + 1);
        expect(aligned.textX - aligned.markerX).toBeCloseTo(18, 5);
      }
    });
  }

  for (const table of [false, true]) {
    test(`moves with the empty first line of a centered paragraph (table=${table})`, () => {
      const left = layOut('', table, '');
      expect(layOut('center', table, '').markerX).toBeGreaterThan(left.markerX + 1);
    });
  }

  test('keeps its slot when the indents leave the line no room', () => {
    // A 492-twip cell holds less than the 36pt list indent, so the line has no slack.
    for (const text of ['', 'Item text']) {
      const left = layOut('', true, text, 492);
      for (const jc of ['center', 'right']) {
        expect(layOut(jc, true, text, 492).markerX).toBeCloseTo(left.markerX, 5);
      }
    }
  });
});
