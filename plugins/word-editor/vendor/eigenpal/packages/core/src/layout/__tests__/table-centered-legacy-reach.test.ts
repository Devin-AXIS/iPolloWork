// Before compatibility mode 15, a centered AutoFit table with an absolute width keeps that width
// while its columns fit. Columns that need more than the text column fill it with their content
// edges on the text edges: the table reaches past each text edge by its outer cell margin and
// stays centered. Mode 15 keeps the table inside the text column.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// Letter with 1" margins: a 468pt text column.
const LETTER =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
const COLUMN = 468;
const MARGIN = 5.4;
const GRID = [3136, 900, 990, 900, 900, 810, 900, 900, 1015];
// The 108-twip side margins that a default table style gives.
const MARGINS =
  '<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** A centered table whose first cell holds `word`, and whose other cells hold their widths. */
function table(tblW: number, word: string, jc = 'center'): string {
  const cells = GRID.map((width, index) =>
    index === 0
      ? `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${p(word)}</w:tc>`
      : `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:noWrap/></w:tcPr>${p('1')}</w:tc>`
  ).join('');
  return (
    `<w:tbl><w:tblPr><w:jc w:val="${jc}"/><w:tblW w:w="${tblW}" w:type="dxa"/>${MARGINS}</w:tblPr>` +
    `<w:tblGrid>${GRID.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>` +
    `<w:tr>${cells}</w:tr></w:tbl>`
  );
}

function layTable(body: string, compatibilityMode?: number): TableFragmentRecord {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}${LETTER}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 0, {
    measurer: createFixedMeasurer(6, 12),
    ...(compatibilityMode === undefined ? {} : { compatibilityMode }),
  });
  return layout.pages[0]!.fragments.find((f) => f.kind === 'table') as TableFragmentRecord;
}

// 40 characters with no break opportunity: the first column cannot narrow below them.
const LONG = 'x'.repeat(40);

test('columns that overflow the text column fill it with their content on the text edges', () => {
  const fragment = layTable(table(9000, LONG), 14);
  expect(fragment.box.width).toBeCloseTo(COLUMN + 2 * MARGIN, 1);
  expect(fragment.box.x).toBeCloseTo(-MARGIN, 1);
});

test('the stated width holds while the columns fit', () => {
  const fragment = layTable(table(9000, 'Item'), 14);
  expect(fragment.box.width).toBeCloseTo(450, 1);
  expect(fragment.box.x).toBeCloseTo((COLUMN - 450) / 2, 1);
});

test('compatibility mode 15 keeps the table inside the text column', () => {
  const fragment = layTable(table(9000, LONG), 15);
  expect(fragment.box.width).toBeCloseTo(COLUMN, 1);
  expect(fragment.box.x).toBeCloseTo(0, 1);
});
