// An exact row height (ECMA-376 Part 1, 17.4.81) measures a cell from its top edge to the bottom
// of its content. The cell bottom margin (17.4.42, 17.4.69) lies below it, so the row grows by
// the largest bottom margin of its cells. The top margin stays inside the authored height.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) =>
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>' +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;
const margin = (side: string, twips?: number) =>
  twips === undefined ? '' : `<w:${side} w:w="${twips}" w:type="dxa"/>`;
const cell = (text: string, bottom?: number) =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${
    bottom === undefined ? '' : `<w:tcMar>${margin('bottom', bottom)}</w:tcMar>`
  }</w:tcPr>${text}</w:tc>`;
/** One exact 40 pt row of three 12 pt lines, with table cell margins `top` and `bottom`. */
const table = (top: number, bottom: number, cells = cell(p('A') + p('B') + p('C'))) =>
  `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>` +
  `${margin('top', top)}${margin('bottom', bottom)}</w:tblCellMar></w:tblPr><w:tblGrid>` +
  '<w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr>' +
  `<w:trHeight w:val="800" w:hRule="exact"/></w:trPr>${cells}</w:tr></w:tbl>`;

function layout(body: string): SemanticLayout {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 0, {
    measurer: createFixedMeasurer(6, 12),
    compatibilityMode: 15,
  });
}

/** The row height, and the text of each line the cell shows. */
function row(result: SemanticLayout): { height: number; lines: string[] } {
  const table = result.pages[0]!.fragments.find((fragment) => fragment.kind === 'table')!;
  if (table.kind !== 'table') throw new Error('no table');
  const placed = table.rows[0]!;
  const lines = placed.cells[0]!.blocks.flatMap((block) =>
    block.kind === 'paragraph' ? block.lines.map((line) => line.spans[0]?.text ?? '') : []
  );
  return { height: placed.box.height, lines };
}

test('the bottom margin lies below the exact height', () => {
  // 40 pt of content: three 12 pt lines fit; the 20 pt bottom margin adds below them.
  expect(row(layout(table(0, 400)))).toEqual({ height: 60, lines: ['A', 'B', 'C'] });
});

test('the top margin stays inside the exact height', () => {
  // 20 pt of top margin leaves room for one line and part of a second inside 40 pt.
  expect(row(layout(table(400, 0))).height).toBe(40);
});

test('the largest bottom margin of the row counts', () => {
  const cells = cell(p('A'), 600) + cell(p('B'), 200);
  expect(row(layout(table(0, 0, cells))).height).toBe(70);
});
