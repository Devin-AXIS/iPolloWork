// Rectangular table-cell selection.
//
// Dragging across cells means the rectangle, not the run of characters between the first cell
// and the last — which would take in everything painted in between and let one delete unpick
// the table.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  cellAddressAt,
  cellSelectionBetween,
  cellSelectionRects,
  cellSelectionText,
  paragraphsInCells,
  spansInCells,
  tableContextAt,
} from '../semantic-cell-selection.ts';
import { hitTestPage, type TableCellAddress } from '../semantic-hit-test.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const lay = (body: string): SemanticLayout => layoutSemanticDocument(load(body), 1, { measurer });

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc>${tcPr}${content}</w:tc>`;
const tr = (cells: string) => `<w:tr>${cells}</w:tr>`;

function tableOf(layout: SemanticLayout): TableFragmentRecord {
  const fragment = layout.pages[0]!.fragments.find((block) => block.kind === 'table');
  if (!fragment || fragment.kind !== 'table') throw new Error('fixture is not a table');
  return fragment;
}

/** The address a click in a cell produces, which is what a drag actually feeds in. */
function addressAt(layout: SemanticLayout, x: number, y: number): TableCellAddress {
  const hit = hitTestPage(layout, 0, { x, y });
  if (!hit?.cell) throw new Error('point is not in a cell');
  return hit.cell;
}

const GRID = `<w:tbl>${tr(tc(p('A1')) + tc(p('B1')) + tc(p('C1')))}${tr(
  tc(p('A2')) + tc(p('B2')) + tc(p('C2'))
)}${tr(tc(p('A3')) + tc(p('B3')) + tc(p('C3')))}</w:tbl>`;

describe('the rectangle two cells define', () => {
  const layout = lay(GRID);
  const table = tableOf(layout);
  const cellId = (row: number, column: number) => table.rows[row]!.cells[column]!.id;
  const at = (row: number, column: number): TableCellAddress => ({
    tableId: table.tableId,
    rowId: table.rows[row]!.id,
    cellId: cellId(row, column),
    rowIndex: row,
    gridColumn: table.rows[row]!.cells[column]!.gridColumn,
    gridSpan: table.rows[row]!.cells[column]!.gridSpan,
  });

  test('a drag from A1 to B2 takes four cells, not the text between them', () => {
    const selection = cellSelectionBetween(layout, at(0, 0), at(1, 1))!;
    expect(selection.cellIds).toEqual([cellId(0, 0), cellId(0, 1), cellId(1, 0), cellId(1, 1)]);
    expect(selection.rows).toEqual({ from: 0, to: 1 });
    expect(selection.columns).toEqual({ from: 0, to: 1 });
  });

  test('a paragraph inside a cell reconstructs that cell address', () => {
    const paragraph = table.rows[0]!.cells[1]!.blocks[0]!;
    if (paragraph.kind !== 'paragraph') throw new Error('fixture cell is not a paragraph');
    expect(cellAddressAt(layout, paragraph.paragraphId)).toMatchObject({
      tableId: table.tableId,
      cellId: cellId(0, 1),
      rowIndex: 0,
      gridColumn: 1,
    });
  });

  test('the rectangle is the same whichever corner the drag started from', () => {
    const forward = cellSelectionBetween(layout, at(0, 0), at(1, 1))!;
    const backward = cellSelectionBetween(layout, at(1, 1), at(0, 0))!;
    expect(backward.cellIds).toEqual(forward.cellIds);
  });

  test('a column drag takes the column, and nothing beside it', () => {
    const selection = cellSelectionBetween(layout, at(0, 1), at(2, 1))!;
    expect(selection.cellIds).toEqual([cellId(0, 1), cellId(1, 1), cellId(2, 1)]);
  });

  test('one cell is a one-cell rectangle', () => {
    const selection = cellSelectionBetween(layout, at(1, 1), at(1, 1))!;
    expect(selection.cellIds).toEqual([cellId(1, 1)]);
  });

  test('two different tables have no rectangle between them', () => {
    const other = { ...at(0, 0), tableId: 'somewhere else' };
    expect(cellSelectionBetween(layout, at(0, 0), other)).toBeNull();
  });

  test('it carries a text range, so every existing reader keeps working', () => {
    const selection = cellSelectionBetween(layout, at(0, 0), at(1, 1))!;
    const paragraphs = paragraphsInCells(layout, selection.cellIds);
    expect(selection.text.anchor.paragraphId).toBe(paragraphs[0]!);
    expect(selection.text.head.paragraphId).toBe(paragraphs[paragraphs.length - 1]!);
    expect(selection.text.head.offset).toBe(2);
  });

  test('the paragraphs it reports are only the ones inside it', () => {
    const selection = cellSelectionBetween(layout, at(0, 0), at(1, 1))!;
    const spans = spansInCells(layout, selection.cellIds);
    expect(spans.map((span) => span.text).sort()).toEqual(['A1', 'A2', 'B1', 'B2']);
  });

  test('a rectangle down one column does NOT sweep the cells beside it', () => {
    // The whole point. The text range from A1 to A3 runs through B1, C1, B2 and C2, so a
    // reader working off the range alone reports six extra cells' formatting.
    const selection = cellSelectionBetween(layout, at(0, 0), at(2, 0))!;
    expect(spansInCells(layout, selection.cellIds).map((span) => span.text)).toEqual([
      'A1',
      'A2',
      'A3',
    ]);
  });

  test('one rectangle is painted per selected cell', () => {
    const selection = cellSelectionBetween(layout, at(0, 0), at(1, 1))!;
    const rects = cellSelectionRects(layout, selection.cellIds);
    expect(rects).toHaveLength(4);
    for (const rect of rects) {
      expect(rect.pageIndex).toBe(0);
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    }
  });
});

describe('merges cannot be selected in half', () => {
  test('touching a column-spanning cell pulls the rectangle out to its full width', () => {
    const spanned = `<w:tbl>${tr(
      tc(p('wide'), '<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>') + tc(p('C1'))
    )}${tr(tc(p('A2')) + tc(p('B2')) + tc(p('C2')))}</w:tbl>`;
    const layout = lay(spanned);
    const table = tableOf(layout);
    expect(table.rows[0]!.cells[0]!.gridSpan).toBe(2);

    // A drag that touches only grid column 0, in a row where a cell covers 0 and 1.
    const selection = cellSelectionBetween(
      layout,
      addressAt(layout, 5, table.rows[0]!.box.y + 2),
      addressAt(layout, 5, table.rows[1]!.box.y + 2)
    )!;
    expect(selection.columns).toEqual({ from: 0, to: 1 });
    expect(selection.cellIds).toHaveLength(3);
  });

  test('touching a vertical merge takes the whole run', () => {
    const merged = `<w:tbl>${tr(
      tc(p('tall'), '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') + tc(p('B1'))
    )}${tr(tc('', '<w:tcPr><w:vMerge/></w:tcPr>') + tc(p('B2')))}${tr(
      tc(p('A3')) + tc(p('B3'))
    )}</w:tbl>`;
    const layout = lay(merged);
    const table = tableOf(layout);
    expect(table.rows[1]!.cells[0]!.vMergeContinue).toBe(true);

    // A drag confined to the FIRST row of the merged column. The continuation below is part
    // of the same displayed cell, so the rectangle has to reach it.
    const anchor: TableCellAddress = {
      tableId: table.tableId,
      rowId: table.rows[0]!.id,
      cellId: table.rows[0]!.cells[0]!.id,
      rowIndex: 0,
      gridColumn: 0,
      gridSpan: 1,
    };
    const selection = cellSelectionBetween(layout, anchor, anchor)!;
    expect(selection.rows).toEqual({ from: 0, to: 1 });
    expect(selection.cellIds).toEqual([table.rows[0]!.cells[0]!.id, table.rows[1]!.cells[0]!.id]);
  });

  test('and the row below the merge is left alone', () => {
    const merged = `<w:tbl>${tr(
      tc(p('tall'), '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') + tc(p('B1'))
    )}${tr(tc('', '<w:tcPr><w:vMerge/></w:tcPr>') + tc(p('B2')))}${tr(
      tc(p('A3')) + tc(p('B3'))
    )}</w:tbl>`;
    const layout = lay(merged);
    const table = tableOf(layout);
    const anchor: TableCellAddress = {
      tableId: table.tableId,
      rowId: table.rows[0]!.id,
      cellId: table.rows[0]!.cells[0]!.id,
      rowIndex: 0,
      gridColumn: 0,
      gridSpan: 1,
    };
    const selection = cellSelectionBetween(layout, anchor, anchor)!;
    expect(selection.cellIds).not.toContain(table.rows[2]!.cells[0]!.id);
  });
});

describe('where the caret is in a table', () => {
  const layout = lay(GRID);
  const table = tableOf(layout);

  test('a caret in a cell reports the table it is in, and where', () => {
    // Answered for a plain caret, not only for a rectangle: a toolbar has to know it is in a
    // table while the user is typing, or its table controls sit disabled the whole time.
    const paragraph = table.rows[1]!.cells[2]!.blocks[0]!;
    if (paragraph.kind !== 'paragraph') throw new Error('fixture cell is not a paragraph');
    expect(tableContextAt(layout, paragraph.paragraphId)).toEqual({
      tableId: table.tableId,
      rows: 3,
      columns: 3,
      rowIndex: 1,
      columnIndex: 2,
    });
  });

  test('a paragraph outside every table reports nothing', () => {
    const outside = lay(p('loose') + GRID);
    expect(tableContextAt(outside, '/word/document.xml#0.0.0')).toBeNull();
  });
});

describe('a rectangle on the clipboard', () => {
  const layout = lay(GRID);
  const table = tableOf(layout);
  const at = (row: number, column: number): TableCellAddress => ({
    tableId: table.tableId,
    rowId: table.rows[row]!.id,
    cellId: table.rows[row]!.cells[column]!.id,
    rowIndex: row,
    gridColumn: table.rows[row]!.cells[column]!.gridColumn,
    gridSpan: table.rows[row]!.cells[column]!.gridSpan,
  });

  test('is a grid: tabs between cells, newlines between rows', () => {
    const selection = cellSelectionBetween(layout, at(0, 0), at(1, 1))!;
    expect(cellSelectionText(layout, selection)).toBe('A1\tB1\nA2\tB2');
  });

  test('a single column is one cell per line', () => {
    const selection = cellSelectionBetween(layout, at(0, 1), at(2, 1))!;
    expect(cellSelectionText(layout, selection)).toBe('B1\nB2\nB3');
  });
});

describe('the rectangle grows until it is actually a rectangle', () => {
  test('staggered column spans converge instead of stopping one short', () => {
    // Column growth only propagates forward through one pass, so a cell in an earlier row
    // that newly overlaps needs another. A fixed pass count published a ragged selection
    // whose `columns` disagreed with its own `cellIds`.
    const wide = (n: number) => `<w:tcPr><w:gridSpan w:val="${n}"/></w:tcPr>`;
    const rowA = tr([0, 1, 2, 3, 4].map((i) => tc(p(`A${i}`), wide(2))).join(''));
    const rowB = tr(
      tc(p('B0')) + [1, 2, 3, 4].map((i) => tc(p(`B${i}`), wide(2))).join('') + tc(p('B5'))
    );
    const layout = lay(`<w:tbl>${rowA}${rowB}</w:tbl>`);
    const table = tableOf(layout);
    const last = (row: number) => {
      const cells = table.rows[row]!.cells;
      const cell = cells[cells.length - 1]!;
      return {
        tableId: table.tableId,
        rowId: table.rows[row]!.id,
        cellId: cell.id,
        rowIndex: row,
        gridColumn: cell.gridColumn,
        gridSpan: cell.gridSpan,
      };
    };
    const selection = cellSelectionBetween(layout, last(0), last(1))!;
    // Every cell whose columns intersect the range must be wholly inside it.
    for (const row of table.rows) {
      for (const cell of row.cells) {
        const from = cell.gridColumn;
        const to = cell.gridColumn + Math.max(1, cell.gridSpan) - 1;
        if (to < selection.columns.from || from > selection.columns.to) continue;
        expect({
          cell: cell.id,
          whole: from >= selection.columns.from && to <= selection.columns.to,
        }).toEqual({ cell: cell.id, whole: true });
      }
    }
  });
});

describe('a rectangle whose cells are all empty', () => {
  test('still aims inside its own table, not at the top of the document', () => {
    // Pointing at the document's first paragraph meant the next keystroke typed outside the
    // table entirely.
    const layout = lay(p('intro') + `<w:tbl>${tr(tc('') + tc(p('B1')))}</w:tbl>`);
    const table = tableOf(layout);
    const empty = table.rows[0]!.cells[0]!;
    const selection = cellSelectionBetween(
      layout,
      {
        tableId: table.tableId,
        rowId: table.rows[0]!.id,
        cellId: empty.id,
        rowIndex: 0,
        gridColumn: empty.gridColumn,
        gridSpan: empty.gridSpan,
      },
      {
        tableId: table.tableId,
        rowId: table.rows[0]!.id,
        cellId: empty.id,
        rowIndex: 0,
        gridColumn: empty.gridColumn,
        gridSpan: empty.gridSpan,
      }
    )!;
    expect(selection.text.anchor.paragraphId).not.toBe('/word/document.xml#0.0.0');
    expect(selection.text.anchor.paragraphId.startsWith(table.tableId)).toBe(true);
  });
});

describe('the clipboard grid lines up', () => {
  test('a row that starts late keeps its columns aligned', () => {
    // `w:gridBefore` leaves the first grid column empty. Emitting one field per PRESENT cell
    // shifted every later column one place left.
    const layout = lay(
      `<w:tbl>${tr(tc(p('A1')) + tc(p('B1')))}${tr(
        tc(p('B2')),
        '<w:trPr><w:gridBefore w:val="1"/></w:trPr>'
      )}</w:tbl>`
    );
    const table = tableOf(layout);
    const address = (row: number, cell: number) => {
      const record = table.rows[row]!.cells[cell]!;
      return {
        tableId: table.tableId,
        rowId: table.rows[row]!.id,
        cellId: record.id,
        rowIndex: row,
        gridColumn: record.gridColumn,
        gridSpan: record.gridSpan,
      };
    };
    const selection = cellSelectionBetween(layout, address(0, 0), address(1, 0))!;
    const rows = cellSelectionText(layout, selection).split('\n');
    expect(rows).toHaveLength(2);
    // Whatever the second row holds, it must not put its cell under the first column.
    expect(rows[1]!.split('\t').length).toBe(rows[0]!.split('\t').length);
  });
});

describe('nested tables', () => {
  test('a paragraph inside a nested table reports the INNER table', () => {
    // `collectParagraphs` recurses, so the outer table also "contains" the inner paragraphs.
    // Reporting the outer one contradicted the innermost-cell rule the hit test follows.
    const inner = `<w:tbl>${tr(tc(p('deep')))}</w:tbl>`;
    const layout = lay(`<w:tbl>${tr(tc(inner) + tc(p('beside')))}</w:tbl>`);
    const outer = tableOf(layout);
    const innerFragment = outer.rows[0]!.cells[0]!.blocks[0]!;
    if (innerFragment.kind !== 'table') throw new Error('fixture has no nested table');
    const deep = innerFragment.rows[0]!.cells[0]!.blocks[0]!;
    if (deep.kind !== 'paragraph') throw new Error('nested cell is not a paragraph');

    const context = tableContextAt(layout, deep.paragraphId)!;
    expect(context.tableId).toBe(innerFragment.tableId);
    expect(context.tableId).not.toBe(outer.tableId);
  });
});
