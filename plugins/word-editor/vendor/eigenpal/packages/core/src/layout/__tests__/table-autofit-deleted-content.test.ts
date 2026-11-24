import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LONG = 'x'.repeat(30);
const DEL = 'w:author="A" w:date="2026-01-01T00:00:00Z"';
const cell = (content: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="3120" w:type="dxa"/></w:tcPr><w:p>${content}</w:p></w:tc>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const deleted = (id: number, text: string) =>
  `<w:del w:id="${id}" ${DEL}><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;

/** Column widths of a three-column automatic-width table with one extra row. */
function widths(row: string): number[] {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>` +
      `<w:tblGrid>${'<w:gridCol w:w="3120"/>'.repeat(3)}</w:tblGrid>` +
      `<w:tr>${cell(run('a'))}${cell(run('b'))}${cell(run('c'))}</w:tr>${row}</w:tbl>` +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 1, {
    measurer: createFixedMeasurer(6, 14),
    compatibilityMode: 15,
    displayMode: 'proposed',
  });
  const table = layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  return table.rows[0]!.cells.map((cell) => cell.box.width);
}

test('deleted content sizes autofit columns in a view that hides it', () => {
  const plain = widths(`<w:tr>${cell(run('x'))}${cell(run('y'))}${cell(run(LONG))}</w:tr>`);
  const deletedRow = widths(
    `<w:tr><w:trPr><w:del w:id="1" ${DEL}/></w:trPr>${cell(deleted(2, 'x'))}${cell(deleted(3, 'y'))}${cell(deleted(4, LONG))}</w:tr>`
  );
  const deletedText = widths(
    `<w:tr>${cell(run('x'))}${cell(run('y'))}${cell(run('z ') + deleted(5, LONG))}</w:tr>`
  );
  expect(plain[2]!).toBeGreaterThan(156 + 1);
  expect(deletedRow[2]!).toBeCloseTo(plain[2]!, 6);
  expect(deletedText[2]!).toBeCloseTo(plain[2]!, 6);
});
