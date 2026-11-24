// A vertically merged cell is as tall as the ROWS IT COVERS (17.4.85 `w:vMerge`), not as
// tall as the row that starts it.
//
// The engine used to give the whole merged content height to the merge head's own row. Every
// later row of the span then started that far down the page, so rows that Word fits on one
// page fell onto the next and the column beside the merge painted as one band of the first
// row's fill instead of one band per row.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type {
  SemanticLayout,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from '../semantic-records.ts';

const FIXTURE = new URL('../../../../../e2e/fixtures/vmerge-row-span.docx', import.meta.url);

/** `w:trHeight` minimums the fixture authors, in points. */
const SHORT_MINIMUMS_PT = [60, 120, 80];
// Each row carries its OWN 1pt top rule outside its authored content minimum, and no row
// carries a bottom until the table's outer edge, which the last row adds. The span still
// totals 264: the captured rule moved the boundaries, not the table.
const SHORT_ROW_HEIGHTS_PT = [61, 121, 82];
const TALL_MINIMUM_PT = 36;

function layoutFixture(): SemanticLayout {
  const result = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
  if (!result.ok) throw new Error(`package read failed: ${result.reason}`);
  const part = result.package.parts.get(result.package.mainDocumentPart);
  if (!part) throw new Error('no main document part');
  return layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer() });
}

function tables(layout: SemanticLayout): TableFragmentRecord[] {
  return layout.pages.flatMap((page) =>
    page.fragments.filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
  );
}

function cellText(cell: TableCellFragmentRecord): string {
  return cell.blocks
    .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
    .flatMap((line) => line.spans)
    .map((span) => span.text)
    .join('');
}

/** The painted extent of the merged cell's own content, relative to the head row's top. */
function mergedContentHeightPt(head: TableCellFragmentRecord): number {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const block of head.blocks) {
    top = Math.min(top, block.box.y);
    bottom = Math.max(bottom, block.box.y + block.box.height);
  }
  expect(Number.isFinite(top)).toBe(true);
  return bottom - top;
}

function rowsOf(table: TableFragmentRecord): readonly TableRowFragmentRecord[] {
  return table.rows;
}

/**
 * Every painted cell keeps its content inside its own box, and every box inside its table.
 * A merged head that outlives the rows under it paints below the table's bottom border with
 * no cell around it, which a page-level check does not see.
 */
function expectContentInsideItsTable(layout: SemanticLayout): void {
  for (const table of tables(layout)) {
    const tableBottom = table.box.y + table.box.height;
    for (const row of table.rows) {
      for (const cell of row.cells) {
        if (cell.blocks.length === 0) continue;
        const cellBottom = cell.box.y + cell.box.height;
        let contentBottom = Number.NEGATIVE_INFINITY;
        for (const block of cell.blocks) {
          contentBottom = Math.max(contentBottom, block.box.y + block.box.height);
        }
        expect(contentBottom).toBeLessThanOrEqual(cellBottom + 0.001);
        expect(cellBottom).toBeLessThanOrEqual(tableBottom + 0.001);
      }
    }
  }
}

const shortTable = (layout: SemanticLayout): TableFragmentRecord => tables(layout)[0]!;
const tallTable = (layout: SemanticLayout): TableFragmentRecord => tables(layout)[1]!;

describe('a cell merged over several rows takes the span, not the first row', () => {
  test('the whole two-table fixture lays out on one page', () => {
    const layout = layoutFixture();
    expect(layout.pages).toHaveLength(1);
    expect(tables(layout)).toHaveLength(2);
    expectContentInsideItsTable(layout);
  });

  test('the merged content really is taller than the head row: the defect stays visible', () => {
    // Pin the configuration the regression needs. With merged content that fits the head
    // row's own minimum, sizing the row and sizing the span give the same answer and this
    // file would pass against the defect it exists to catch.
    const rows = rowsOf(shortTable(layoutFixture()));
    const head = rows[0]!.cells[1]!;
    expect(head.rowSpan).toBe(3);
    expect(mergedContentHeightPt(head)).toBeGreaterThan(SHORT_MINIMUMS_PT[0]!);
  });

  test('each row keeps its own authored content minimum plus local border clearance', () => {
    const rows = rowsOf(shortTable(layoutFixture()));
    expect(rows.map((row) => row.box.height)).toEqual(SHORT_ROW_HEIGHTS_PT);
  });

  test('the label cells paint at their own row offsets, each with its own fill', () => {
    const rows = rowsOf(shortTable(layoutFixture()));
    const labels = rows.map((row) => row.cells[0]!);
    const top = rows[0]!.box.y;
    expect(labels.map((cell) => cell.box.y - top)).toEqual([0, 61, 182]);
    expect(labels.map((cell) => cell.box.height)).toEqual(SHORT_ROW_HEIGHTS_PT);
    expect(labels.map((cell) => cell.shading)).toEqual(['355D7E', '7BA79D', 'B4C7DC']);
    expect(labels.map(cellText)).toEqual(['Short row 1', 'Short row 2', 'Short row 3']);
  });

  test('the merged cell box covers every row of the span', () => {
    const rows = rowsOf(shortTable(layoutFixture()));
    const head = rows[0]!.cells[1]!;
    expect(head.rowSpan).toBe(3);
    expect(head.box.y).toBe(rows[0]!.box.y);
    expect(head.box.height).toBe(264);
    expectContentInsideItsTable(layoutFixture());
  });

  test('merged content taller than the span grows the LAST row, not the head row', () => {
    const layout = layoutFixture();
    const rows = rowsOf(tallTable(layout));
    const head = rows[0]!.cells[1]!;
    const contentPt = mergedContentHeightPt(head);
    // The rows the merge covers cannot hold the content at their authored minimums.
    expect(contentPt).toBeGreaterThan(TALL_MINIMUM_PT * rows.length);

    expect(rows[0]!.box.height).toBe(TALL_MINIMUM_PT + 1);
    expect(rows[1]!.box.height).toBe(TALL_MINIMUM_PT + 1);
    expect(rows[2]!.box.height).toBeGreaterThan(TALL_MINIMUM_PT + 2);

    const spanPt = rows.reduce((sum, row) => sum + row.box.height, 0);
    expect(head.box.height).toBe(spanPt);
    // The span is exactly what the merged content needs, insets included.
    expect(spanPt).toBeGreaterThanOrEqual(contentPt);
    expect(spanPt - contentPt).toBeLessThan(2 * 3 + 0.001);
    expectContentInsideItsTable(layout);
  });

  test('the label cells of the taller merge keep their own bands too', () => {
    const rows = rowsOf(tallTable(layoutFixture()));
    const top = rows[0]!.box.y;
    expect(rows.map((row) => row.cells[0]!.box.y - top)).toEqual([
      0,
      TALL_MINIMUM_PT + 1,
      TALL_MINIMUM_PT * 2 + 2,
    ]);
    expect(rows.map((row) => row.cells[0]!.shading)).toEqual(['355D7E', '7BA79D', 'B4C7DC']);
  });
});
