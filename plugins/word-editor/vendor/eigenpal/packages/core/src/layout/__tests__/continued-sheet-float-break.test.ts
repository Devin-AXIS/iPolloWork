// A continuous section (ECMA-376 Part 1, 17.6.22) continues on the sheet of the section before
// it, and that sheet keeps the earlier section's bottom margin (17.6.11). A page-positioned table
// (17.4.57) on that sheet that reaches below the margin breaks there, not at the continued
// section's own, lower margin.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string, ppr = '') =>
  `<w:p><w:pPr>${ppr}<w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const section = (bottom: number, continuous: boolean) =>
  `<w:sectPr>${continuous ? '<w:type w:val="continuous"/>' : ''}<w:pgSz w:w="12240" w:h="15840"/>` +
  `<w:pgMar w:top="1440" w:right="1440" w:bottom="${bottom}" w:left="1440" w:header="720" ` +
  'w:footer="720" w:gutter="0"/></w:sectPr>';
/** Two 200pt rows, 300pt below the top edge of the page. */
const float =
  '<w:tbl><w:tblPr><w:tblpPr w:vertAnchor="page" w:horzAnchor="page" w:tblpX="1440" ' +
  'w:tblpY="6000"/><w:tblW w:w="5000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
  [1, 2]
    .map(
      (row) =>
        `<w:tr><w:trPr><w:trHeight w:val="4000"/></w:trPr><w:tc>${p(`ROW${row}`)}</w:tc></w:tr>`
    )
    .join('') +
  '</w:tbl>';

function rowPages(body: string): Record<string, number> {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 0, {
    measurer: createFixedMeasurer(6, 12),
    compatibilityMode: 15,
  });
  const pages: Record<string, number> = {};
  layout.pages.forEach((page, index) => {
    for (const fragment of page.fragments)
      if (fragment.kind === 'table')
        for (const row of fragment.rows) {
          const cell = row.cells[0]!.blocks[0]!;
          if (cell.kind === 'paragraph') pages[cell.lines[0]!.spans[0]!.text] = index;
        }
  });
  return pages;
}

test('a page-positioned table on a continued sheet breaks at the host section margin', () => {
  // The first section leaves the body 504pt (72pt to 576pt); the second section's own margin
  // would leave it 705.6pt, room for both rows.
  const body = p('S1', section(4320, false)) + float + p('AFTER') + section(288, true);
  expect(rowPages(body)).toEqual({ ROW1: 0, ROW2: 1 });
});

test('the continued section keeps its own margin on its later sheets', () => {
  const lines = Array.from({ length: 60 }, (_, index) => p(`L${index}`)).join('');
  const body = p('S1', section(4320, false)) + lines + float + p('AFTER') + section(288, true);
  // The table now opens on the second sheet, which the continued section's margin governs.
  expect(rowPages(body)).toEqual({ ROW1: 1, ROW2: 1 });
});
