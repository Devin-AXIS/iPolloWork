// Column dividers on tables with merged cells: a divider shows where the row has a cell edge,
// and names the grid columns on either side even when this row's cell spans one of them.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  findTableInteractionAt,
  pageContentToSheet,
  tableInteractionIndex,
} from '../semantic-table-interaction.ts';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  type SemanticLayout,
  type TableFragmentRecord,
} from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') =>
  `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}${content}</w:tc>`;
const tr = (cells: string) => `<w:tr>${cells}</w:tr>`;
const GRID =
  '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>';

function layout(body: string): SemanticLayout {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  const part: OoxmlPart = result.part;
  return layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    geometry: { width: 400, height: 300, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
  });
}

function tableOf(result: SemanticLayout): TableFragmentRecord {
  const table = result.pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
  if (!table || table.kind !== 'table') throw new Error('no table');
  return table;
}

function hitAt(result: SemanticLayout, edge: number, row: number) {
  const table = tableOf(result);
  const x = table.box.x + table.columnEdges[edge]!;
  const y = table.rows[row]!.box.y + table.rows[row]!.box.height / 2;
  const sheet = pageContentToSheet(0, x, y, result);
  return findTableInteractionAt(tableInteractionIndex(result), sheet.x, sheet.y, result);
}

describe('column dividers on merged tables', () => {
  test('a row beside a vertical merge offers its dividers', () => {
    const result = layout(
      `<w:tbl>${GRID}` +
        tr(tc(p('A'), '<w:vMerge w:val="restart"/>') + tc(p('B')) + tc(p('C'))) +
        tr(tc(p(''), '<w:vMerge/>') + tc(p('E')) + tc(p('F'))) +
        `</w:tbl>${p('after')}`
    );
    const hit = hitAt(result, 1, 1);
    expect(hit?.kind).toBe('columnDivider');
    expect(hitAt(result, 2, 1)?.kind).toBe('columnDivider');
  });

  test('a divider names grid columns a merged cell in its row spans', () => {
    const result = layout(
      `<w:tbl>${GRID}` +
        tr(tc(p('A'), '<w:gridSpan w:val="2"/>') + tc(p('C'))) +
        tr(tc(p('D')) + tc(p('E')) + tc(p('F'))) +
        `</w:tbl>${p('after')}`
    );
    // Row 0 has no cell edge at grid boundary 1, so no divider there.
    expect(hitAt(result, 1, 0)?.kind).not.toBe('columnDivider');
    // At boundary 2 the left column is the spanned one, named from row 1.
    const hit = hitAt(result, 2, 0);
    expect(hit?.kind).toBe('columnDivider');
    if (hit?.kind === 'columnDivider') expect(hit.leftGridColumnId).not.toBe(hit.rightGridColumnId);
  });
});
