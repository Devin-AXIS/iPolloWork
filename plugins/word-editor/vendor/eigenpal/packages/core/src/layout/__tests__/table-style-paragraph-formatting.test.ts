// `w:tblStylePr` paragraph and run properties (17.7.6.6).
//
// A table style states more than borders, margins and fill: its `w:pPr`/`w:rPr` set the look
// of every paragraph in the table, and each conditional format restates them for the rows and
// columns it covers. That is how Word makes a header row bold and centred while the document
// carries nothing but `<w:tblStyle w:val="…"/>` and plain runs.
//
// Cascade, weakest first (17.7.2): whole-table style → conditional formats in banding →
// column → row → corner order → the paragraph's own `w:pPr` → the run's own `w:rPr`.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout, StyleSpanRecord, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * A style shaped like Word's own banded table styles: italic everywhere, a bold centred
 * header row, a coloured banded row.
 */
const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="table" w:styleId="Banded">' +
  '<w:pPr><w:jc w:val="left"/></w:pPr>' +
  '<w:rPr><w:i/></w:rPr>' +
  '<w:tblStylePr w:type="firstRow">' +
  '<w:pPr><w:jc w:val="center"/></w:pPr>' +
  '<w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr>' +
  '</w:tblStylePr>' +
  '<w:tblStylePr w:type="band1Horz"><w:rPr><w:color w:val="0000FF"/></w:rPr></w:tblStylePr>' +
  '</w:style></w:styles>';

const LOOK =
  '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" ' +
  'w:noHBand="0" w:noVBand="1"/>';

function part(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const cascade = () => buildStyleCascadeTable(part(STYLES, '/word/styles.xml').root);

const p = (text: string, pPr = '', rPr = '') =>
  `<w:p>${pPr}<w:r>${rPr}<w:t>${text}</w:t></w:r></w:p>`;
const tc = (content: string) => `<w:tc>${content}</w:tc>`;
const tr = (cells: string) => `<w:tr>${cells}</w:tr>`;

function layoutTable(rows: string, withCascade = true): SemanticLayout {
  const body =
    `<w:tbl><w:tblPr><w:tblStyle w:val="Banded"/>${LOOK}<w:tblLayout w:type="fixed"/></w:tblPr>` +
    '<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
    rows +
    '</w:tbl>';
  const document = part(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    '/word/document.xml'
  );
  return layoutSemanticDocument(document, 0, {
    measurer: createFixedMeasurer(),
    ...(withCascade ? { styleCascade: cascade() } : {}),
  });
}

function spansOf(result: SemanticLayout, rowIndex: number, cellIndex = 0): StyleSpanRecord[] {
  const fragment = result.pages
    .flatMap((page) => page.fragments)
    .find((candidate): candidate is TableFragmentRecord => candidate.kind === 'table')!;
  return fragment.rows[rowIndex]!.cells[cellIndex]!.blocks.flatMap((block) =>
    block.kind === 'paragraph' ? block.lines : []
  ).flatMap((line) => line.spans);
}

/** Header row, one banded body row, one plain body row. */
const THREE_ROWS =
  tr(tc(p('H1')) + tc(p('H2'))) + tr(tc(p('B1')) + tc(p('B2'))) + tr(tc(p('C1')) + tc(p('C2')));

describe('a table style formats the text in its cells', () => {
  test('the header row is bold from w:tblStylePr, the body rows are not', () => {
    const result = layoutTable(THREE_ROWS);
    expect(spansOf(result, 0)[0]!.style.bold).toBe(true);
    expect(spansOf(result, 1)[0]!.style.bold).toBe(false);
    expect(spansOf(result, 2)[0]!.style.bold).toBe(false);
  });

  test('the whole-table w:rPr reaches every cell, header and body alike', () => {
    const result = layoutTable(THREE_ROWS);
    expect(spansOf(result, 0)[0]!.style.italic).toBe(true);
    expect(spansOf(result, 2)[0]!.style.italic).toBe(true);
  });

  test('a conditional format overrides the whole-table properties', () => {
    const result = layoutTable(THREE_ROWS);
    // firstRow states white; the style's own rPr states no colour at all.
    expect(spansOf(result, 0)[0]!.style.color).toBe('FFFFFF');
    expect(spansOf(result, 2)[0]!.style.color).toBe(null);
  });

  test('banding colours the rows the look enables', () => {
    const result = layoutTable(THREE_ROWS);
    expect(spansOf(result, 1)[0]!.style.color).toBe('0000FF');
  });

  test('the header row w:pPr centres its paragraphs', () => {
    const result = layoutTable(THREE_ROWS);
    const header = spansOf(result, 0)[0]!;
    const body = spansOf(result, 2)[0]!;
    expect(header.box.x).toBeGreaterThan(body.box.x);
  });

  test('the cell paragraph and run win over the style, in that order', () => {
    const overridden =
      tr(tc(p('H1', '<w:pPr><w:jc w:val="left"/></w:pPr>', '<w:rPr><w:b w:val="0"/></w:rPr>'))) +
      tr(tc(p('B1')));
    const result = layoutTable(overridden);
    const header = spansOf(result, 0)[0]!;
    expect(header.style.bold).toBe(false);
    expect(header.box.x).toBe(spansOf(result, 1)[0]!.box.x);
  });

  test('without the cascade the same table is plain text', () => {
    const result = layoutTable(THREE_ROWS, false);
    expect(spansOf(result, 0)[0]!.style.bold).toBe(false);
    expect(spansOf(result, 0)[0]!.style.italic).toBe(false);
  });
});
