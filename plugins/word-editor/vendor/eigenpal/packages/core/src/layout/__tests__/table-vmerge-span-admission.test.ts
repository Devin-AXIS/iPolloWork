import { readTableStructure } from '../semantic-table.ts';
import { vMergePlanFor } from '../table-vmerge-plan.ts';
// When a vertical merge is allowed to size its span, and what happens when it is not.
//
// Giving the span its own height is only safe while every row of it lands on one page and
// the span really can hold the merged content. Where either is untrue the merge has to stay
// on the row-by-row path, because a merged cell whose content is not bounded by its span
// paints past the box it owns. Content outside its box is worse than the row heights this
// file's sibling fixes, so every case here asserts the merged content is inside its CELL —
// inside the page is not the same claim, and a cell's content is `overflow: visible`.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type {
  PageGeometry,
  SemanticLayout,
  TableCellFragmentRecord,
  TableFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** 80pt of content box, and a 14pt line: every height below is checkable by hand. */
const TINY: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};
const CONTENT_BOTTOM_PT = 80;

function loadPart(bodyXml: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`part read failed: ${result.reason}`);
  return result.part;
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc>${tcPr}${content}</w:tc>`;
const RESTART = '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>';
const CONTINUE = '<w:tcPr><w:vMerge/></w:tcPr>';
const exactRow = (twips: number) =>
  `<w:trPr><w:trHeight w:val="${twips}" w:hRule="exact"/></w:trPr>`;

const GRID_RULE_PT = 1;
const GRID =
  '<w:tblPr><w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="${GRID_RULE_PT * 8}" w:color="000000"/>`)
    .join('') +
  '</w:tblBorders></w:tblPr>';

/** Five lines of merged content: taller than any single row below asks to be. */
const MERGED_CONTENT = Array.from({ length: 5 }, (_, index) => p(`T${index}`)).join('');

const layoutTiny = (part: OoxmlPart): SemanticLayout =>
  layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer(), geometry: TINY });

function tablesOf(layout: SemanticLayout, pageIndex: number): TableFragmentRecord[] {
  return (layout.pages[pageIndex]?.fragments ?? []).filter(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  );
}

/** Lowest y anything is painted at on this page, whatever kind of fragment holds it. */
function paintedBottomPt(layout: SemanticLayout, pageIndex: number): number {
  let bottom = 0;
  const takeBlocks = (blocks: TableCellFragmentRecord['blocks']): void => {
    for (const block of blocks) bottom = Math.max(bottom, block.box.y + block.box.height);
  };
  for (const fragment of layout.pages[pageIndex]?.fragments ?? []) {
    bottom = Math.max(bottom, fragment.box.y + fragment.box.height);
    if (fragment.kind === 'paragraph') takeBlocks([fragment]);
    if (fragment.kind !== 'table') continue;
    for (const row of fragment.rows) for (const cell of row.cells) takeBlocks(cell.blocks);
  }
  return bottom;
}

/**
 * Did a `w:tblHeader` row get re-emitted at the top of this page?
 *
 * The page COUNT alone cannot say so, and it moves whenever row heights change. This is the
 * precondition the overrun case actually needs: the merge landed on a page whose header
 * repeat had already taken room off it.
 */
function headerRepeatsOn(layout: SemanticLayout, pageIndex: number): boolean {
  return tablesOf(layout, pageIndex)
    .flatMap((table) => table.rows)
    .some((row) => row.isHeaderRepeat === true);
}

function contentBottomOf(cell: TableCellFragmentRecord): number {
  let bottom = Number.NEGATIVE_INFINITY;
  for (const block of cell.blocks) bottom = Math.max(bottom, block.box.y + block.box.height);
  return bottom;
}

/**
 * Every painted cell keeps its content inside its own box, and every box inside its table.
 *
 * The page-level check is not enough on its own: a merged head that outlives the rows under
 * it paints below the table's bottom border with no cell around it, and still lands well
 * inside the page.
 */
function expectContentInsideItsTable(layout: SemanticLayout): void {
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'table') continue;
      const tableBottom = fragment.box.y + fragment.box.height;
      for (const row of fragment.rows) {
        for (const cell of row.cells) {
          if (cell.blocks.length === 0) continue;
          const cellBottom = cell.box.y + cell.box.height;
          expect(contentBottomOf(cell)).toBeLessThanOrEqual(cellBottom + 0.001);
          expect(cellBottom).toBeLessThanOrEqual(tableBottom + 0.001);
        }
      }
    }
  }
}

describe('a merge is only sized as a span where the span can hold it', () => {
  test('a repeated header row on the next page does not let the merge overrun it', () => {
    // The merge does not fit the band it is offered in. Moving the row to a fresh page
    // re-emits the `w:tblHeader` row, so the page it lands on has LESS room than the one the
    // offer was judged against. Deciding before the move and not looking again let the head
    // detach anyway, and its content — no longer bounded by the row — painted past the box.
    const layout = layoutTiny(
      loadPart(
        `${p('F0')}${p('F1')}<w:tbl>${GRID}` +
          `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(p('H'))}${tc(p('Hb'))}</w:tr>` +
          `<w:tr>${tc(MERGED_CONTENT, RESTART)}${tc(p('side'))}</w:tr>` +
          `<w:tr>${tc(p('ghost'), CONTINUE)}${tc(p('side2'))}</w:tr>` +
          '</w:tbl>'
      )
    );
    // The one-point table grid reserves clearance even when tcBorders omits it.
    // The shared half-strokes fit on two pages; the repeated header must still
    // reduce the merge's admission band and every fragment must remain contained.
    expect(layout.pages).toHaveLength(2);
    expect(headerRepeatsOn(layout, 1)).toBe(true);
    expectContentInsideItsTable(layout);
    for (const pageIndex of layout.pages.keys()) {
      expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
    }
    // And no page is spent on nothing: every page carries a body row, not just the repeat.
    for (const pageIndex of layout.pages.keys()) {
      const rows = tablesOf(layout, pageIndex).flatMap((table) => table.rows);
      if (rows.length === 0) continue;
      expect(rows.some((row) => row.isHeaderRepeat !== true)).toBe(true);
    }
  });

  test('an exact last row takes no surplus, and the head is clipped at the span bottom', () => {
    // The span's last row is `hRule="exact"`, which fixes it at its authored box (17.18.37).
    // The surplus does not move up to the head row: every row keeps the height its own cells
    // give it, and the merged content is clipped at the authored bottom of the exact row.
    const table2 = (head: string) =>
      loadPart(
        `<w:tbl>${GRID}` +
          `<w:tr>${tc(head, RESTART)}${tc(p('side'))}</w:tr>` +
          `<w:tr>${exactRow(400)}${tc(p('ghost'), CONTINUE)}${tc(p('side2'))}</w:tr>` +
          '</w:tbl>' +
          p('AFTER')
      );
    const part = table2(MERGED_CONTENT);
    const source = serializeOoxmlPart(part);
    const layout = layoutTiny(part);
    const table = tablesOf(layout, 0)[0]!;
    const head = table.rows[0]!.cells[0]!;
    expect(head.rowSpan).toBe(2);
    // The exact row keeps its authored 20pt, and its fragment adds the outer closing rule
    // below it. The head row is as tall as with a one-line head.
    const short = tablesOf(layoutTiny(table2(p('T0'))), 0)[0]!;
    expect(table.rows[1]!.box.height).toBe(400 / 20 + GRID_RULE_PT);
    expect(table.rows[0]!.box.height).toBe(short.rows[0]!.box.height);
    expect(head.box.height).toBe(table.box.height);
    // The merged text runs through both rows and is clipped at the authored bottom of the
    // second, above the closing rule.
    expect(contentBottomOf(head)).toBeLessThanOrEqual(
      head.box.y + head.box.height - GRID_RULE_PT + 0.001
    );
    const cut = head.blocks.at(-1)!;
    expect(cut.kind === 'paragraph' && cut.clipToBox).toBe(true);
    expect(layout.pages).toHaveLength(1);
    const after = layout.pages[0]!.fragments.find(
      (fragment) =>
        fragment.kind === 'paragraph' &&
        fragment.lines.some((line) => line.spans.some((span) => span.text === 'AFTER'))
    );
    expect(after?.box.y).toBeCloseTo(table.box.y + table.box.height, 8);
    expect(serializeOoxmlPart(part)).toBe(source);
    expectContentInsideItsTable(layout);
    expect(paintedBottomPt(layout, 0)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
  });

  test('a span where nothing can grow keeps its authored height and clips at its bottom', () => {
    const part = loadPart(
      `<w:tbl>${GRID}` +
        `<w:tr>${exactRow(400)}${tc(MERGED_CONTENT, RESTART)}${tc(p('side'))}</w:tr>` +
        `<w:tr>${exactRow(400)}${tc(p('ghost'), CONTINUE)}${tc(p('side2'))}</w:tr>` +
        '</w:tbl>' +
        p('AFTER')
    );
    const source = serializeOoxmlPart(part);
    const layout = layoutTiny(part);
    const table = tablesOf(layout, 0)[0]!;
    const authoredSpanPt = (400 + 400) / 20;
    expect(table.rows.map((row) => row.box.height)).toEqual([20, 20 + GRID_RULE_PT]);
    const head = table.rows[0]!.cells[0]!;
    expect(head.box.height).toBe(authoredSpanPt + GRID_RULE_PT);
    // The span cannot hold the head, so the merged text runs through both rows and is
    // clipped at the bottom of the second one.
    expect(contentBottomOf(head)).toBeGreaterThan(head.box.y + 20);
    // Clipping stops at the authored span, before its outer closing rule.
    expect(contentBottomOf(head)).toBeCloseTo(head.box.y + authoredSpanPt, 8);
    const cut = head.blocks.at(-1)!;
    expect(cut.kind === 'paragraph' && cut.clipToBox).toBe(true);
    const after = layout.pages[0]!.fragments.find(
      (fragment) =>
        fragment.kind === 'paragraph' &&
        fragment.lines.some((line) => line.spans.some((span) => span.text === 'AFTER'))
    );
    expect(after?.box.y).toBeCloseTo(table.box.y + table.box.height, 8);
    expect(serializeOoxmlPart(part)).toBe(source);
    expectContentInsideItsTable(layout);
    expect(paintedBottomPt(layout, 0)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
  });

  test('overlapping merges keep their content contained when the second head splits', () => {
    // Column 0 merges rows 0-1 and column 1 restarts at row 1. The second head can
    // start in the remaining band; both fragments must still bound their own content.
    const layout = layoutTiny(
      loadPart(
        `${p('F0')}${p('F1')}<w:tbl>${GRID}` +
          `<w:tr>${tc(p('A0') + p('A1'), RESTART)}${tc(p('b0'))}</w:tr>` +
          `<w:tr>${tc(p('a1'), CONTINUE)}${tc(MERGED_CONTENT, RESTART)}</w:tr>` +
          `<w:tr>${tc(p('a2'))}${tc(p('b2'), CONTINUE)}</w:tr>` +
          `<w:tr>${tc(p('a3'))}${tc(p('b3'))}</w:tr>` +
          '</w:tbl>'
      )
    );
    // The first merge covers the partial second row on this page.
    const first = tablesOf(layout, 0)[0]!;
    const head = first.rows[0]!.cells[0]!;
    expect(head.rowSpan).toBe(2);
    expect(contentBottomOf(head)).toBeGreaterThan(first.box.y + 18);
    expectContentInsideItsTable(layout);
    // The second merge continues into the following row on the next page.
    const carried = tablesOf(layout, 1)[0]!;
    expect(carried.rows[0]!.cells[1]!.rowSpan).toBe(2);
    for (const pageIndex of layout.pages.keys()) {
      expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
    }
  });

  test('an exact head row fixes the ROW, and the merged content flows on through the span', () => {
    // `hRule="exact"` is a height for the row (17.18.37), not a lid on a merged cell that
    // covers rows below it. Clipping the head to its own row while the span reserved the
    // surplus somewhere else left a tall blank band under one visible line.
    const layout = layoutTiny(
      loadPart(
        `<w:tbl>${GRID}` +
          `<w:tr>${exactRow(400)}${tc(MERGED_CONTENT, RESTART)}${tc(p('side'))}</w:tr>` +
          `<w:tr>${tc(p('ghost'), CONTINUE)}${tc(p('side2'))}</w:tr>` +
          `<w:tr>${tc(p('c0'))}${tc(p('c1'))}</w:tr>` +
          '</w:tbl>'
      )
    );
    const table = tablesOf(layout, 0)[0]!;
    const head = table.rows[0]!.cells[0]!;
    expect(table.rows[0]!.box.height).toBe(20);
    expect(head.rowSpan).toBe(2);
    // All five lines are painted, inside the merged box — not one line and a blank band.
    const lineCount = head.blocks.filter((block) => block.kind === 'paragraph').length;
    expect(lineCount).toBe(5);
    expect(head.box.height).toBe(20 + table.rows[1]!.box.height);
    expectContentInsideItsTable(layout);
  });

  test('a head taller than a page paginates instead of losing its tail', () => {
    // A detached head answers to the page, so it splits and continues like any other cell.
    // Bounding it by its span instead swallowed everything past the span's bottom: the
    // fragment reported itself complete, no remainder was carried, and the tail was gone.
    const nine = Array.from({ length: 9 }, (_, index) => p(`T${index}`)).join('');
    const layout = layoutTiny(
      loadPart(
        `<w:tbl>${GRID}` +
          `<w:tr>${tc(nine, RESTART)}${tc(p('side'))}</w:tr>` +
          `<w:tr>${tc(p('ghost'), CONTINUE)}${tc(p('side2'))}</w:tr>` +
          '</w:tbl>'
      )
    );
    const painted = layout.pages
      .flatMap((page) => page.fragments)
      .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
      .flatMap((table) => table.rows)
      .flatMap((row) => row.cells)
      .flatMap((cell) => cell.blocks)
      .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
      .flatMap((line) => line.spans)
      .map((span) => span.text)
      .join(' ');
    for (let index = 0; index < 9; index += 1) expect(painted).toContain(`T${index}`);
    expectContentInsideItsTable(layout);
  });

  test('a row that starts two merges is measured with the head that stayed in it', () => {
    // Row 0 heads both columns. Whichever merge is not planned goes on sizing row 0, so the
    // row's planned height has to include it. Measuring the row without the content the plan
    // detached judged it against a height nobody would place and broke the page under it.
    const layout = layoutTiny(
      loadPart(
        `${p('F0')}<w:tbl>${GRID}` +
          `<w:tr>${tc(p('A0') + p('A1') + p('A2'), RESTART)}${tc(p('B0') + p('B1') + p('B2'), RESTART)}</w:tr>` +
          `<w:tr>${tc(p('a1'), CONTINUE)}${tc(p('b1'), CONTINUE)}</w:tr>` +
          `<w:tr>${tc(p('a2'), CONTINUE)}${tc(p('b2'))}</w:tr>` +
          `<w:tr>${tc(p('a3'), CONTINUE)}${tc(p('b3'))}</w:tr>` +
          '</w:tbl>'
      )
    );
    // The row after the heads shares their page: no break opened under a mostly empty page.
    expect(tablesOf(layout, 0)[0]!.rows.length).toBeGreaterThanOrEqual(2);
    expectContentInsideItsTable(layout);
  });

  test('the unsplit placement bounds a detached head by the page too', () => {
    // The unsplit branch places a row with no bound and then compares its bottom against the
    // page — a check a detached head is invisible to, because the row does not carry its
    // height. Left unbounded there, the head painted below the page content box outright.
    // Nine lines do not fit an 80pt page, so the head has to split whatever branch it takes.
    const nine = Array.from({ length: 9 }, (_, index) => p(`T${index}`)).join('');
    const layout = layoutTiny(
      loadPart(
        `<w:tbl>${GRID}` +
          `<w:tr>${tc(nine, RESTART)}${tc(p('side'))}</w:tr>` +
          `<w:tr>${tc(p('ghost'), CONTINUE)}${tc(p('side2'))}</w:tr>` +
          '</w:tbl>'
      )
    );
    for (const pageIndex of layout.pages.keys()) {
      expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
    }
    expectContentInsideItsTable(layout);
  });

  test('a covered row that can place nothing paginates instead of aborting the table', () => {
    // Refusing the recovery breaks for a covered row turned any probe-versus-placement
    // divergence into `TablePaginationError` for the whole table. `w:cantSplit` on a covered
    // row is the shape that reaches one of those breaks without any divergence at all.
    const layout = layoutTiny(
      loadPart(
        `${p('F0')}${p('F1')}${p('F2')}<w:tbl>${GRID}` +
          `<w:tr>${tc(p('head'), RESTART)}${tc(p('side'))}</w:tr>` +
          `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
          `${tc(p('ghost'), CONTINUE)}${tc(MERGED_CONTENT)}</w:tr>` +
          '</w:tbl>'
      )
    );
    // Pinned, not just "more than none": the claim is that this lays out rather than
    // aborting, and a page count is the difference between the two.
    expect(layout.pages).toHaveLength(2);
    expectContentInsideItsTable(layout);
    for (const pageIndex of layout.pages.keys()) {
      expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
    }
  });

  test('a row holding nothing but a merge head is still a line tall', () => {
    // Detaching a head takes it out of its row's height, and in a single-column table that
    // is the only cell there is — so nothing raised the row and it collapsed to zero, with
    // the row below it starting at the same y. Word draws that row a line tall. The two
    // height passes skip detached cells on purpose; the floor has to come from somewhere
    // else.
    const layout = layoutTiny(
      loadPart(
        `<w:tbl>${GRID}` +
          `<w:tr>${tc(p('head'), RESTART)}</w:tr>` +
          `<w:tr>${tc(p('g'), CONTINUE)}</w:tr>` +
          '</w:tbl>'
      )
    );
    const table = tablesOf(layout, 0)[0]!;
    expect(table.rows[0]!.box.height).toBeGreaterThan(12);
    expect(table.rows[1]!.box.y).toBe(table.rows[0]!.box.y + table.rows[0]!.box.height);
    expect(table.box.height).toBe(table.rows[0]!.box.height + table.rows[1]!.box.height);
    expectContentInsideItsTable(layout);
  });

  test('two merges starting in the SAME row keep their content inside the table', () => {
    // Both cells of row 0 restart a merge over rows 0-1. Accepting the second detaches it
    // from row 0 as well, which empties row 0 of everything it had and changes what the
    // FIRST span covers. A height captured for that span when it was admitted describes a
    // row that no longer exists, and its content painted below the table's bottom border.
    const layout = layoutTiny(
      loadPart(
        `<w:tbl>${GRID}` +
          `<w:tr>${tc(MERGED_CONTENT, RESTART)}${tc(p('b0'), RESTART)}</w:tr>` +
          `<w:tr>${tc(p('a1'), CONTINUE)}${tc(p('b1'), CONTINUE)}</w:tr>` +
          '</w:tbl>'
      )
    );
    const table = tablesOf(layout, 0)[0]!;
    expect(table.rows[0]!.cells[0]!.rowSpan).toBe(2);
    expect(table.rows[0]!.cells[1]!.rowSpan).toBe(2);
    expectContentInsideItsTable(layout);
    for (const pageIndex of layout.pages.keys()) {
      expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
    }
  });

  test('merges over the same rows leave the head row to the cells that stay in it', () => {
    // Columns 1 and 2 both merge rows 0-1. The head row is as tall as its side cell alone;
    // the taller merge is carried by the rows together, whichever column it sits in.
    const shaped = (b: string, c: string): SemanticLayout =>
      layoutTiny(
        loadPart(
          `<w:tbl>${GRID}` +
            `<w:tr>${tc(p('s0'))}${tc(b, RESTART)}${tc(c, RESTART)}</w:tr>` +
            `<w:tr>${tc(p('s1'))}${tc(p(''), CONTINUE)}${tc(p(''), CONTINUE)}</w:tr>` +
            '</w:tbl>'
        )
      );
    const tall = Array.from({ length: 4 }, (_, index) => p(`T${index}`)).join('');
    const short = p('A0') + p('A1');
    const control = tablesOf(shaped(p('x'), p('y')), 0)[0]!;
    const layouts = [shaped(short, tall), shaped(tall, short)];
    for (const layout of layouts) {
      expect(layout.pages).toHaveLength(1);
      const table = tablesOf(layout, 0)[0]!;
      expect(table.rows[0]!.box.height).toBe(control.rows[0]!.box.height);
      expect(table.rows[1]!.box.height).toBeGreaterThan(control.rows[1]!.box.height);
      for (const column of [1, 2]) {
        const head = table.rows[0]!.cells[column]!;
        expect(head.rowSpan).toBe(2);
        expect(head.box.height).toBe(table.box.height);
      }
      expectContentInsideItsTable(layout);
    }
    const [first, second] = layouts.map((layout) => tablesOf(layout, 0)[0]!) as [
      TableFragmentRecord,
      TableFragmentRecord,
    ];
    expect(first.rows.map((row) => row.box.height)).toEqual(
      second.rows.map((row) => row.box.height)
    );
    // The span is exactly as tall as the tallest head needs: four lines and no stacked row.
    const tallHead = first.rows[0]!.cells[2]!;
    expect(contentBottomOf(tallHead)).toBeLessThanOrEqual(tallHead.box.y + tallHead.box.height);
    expect(first.box.height).toBeLessThan(control.rows[0]!.box.height + 4 * 14 + 4);
  });

  test('merges over the same rows that no page holds keep every line inside the table', () => {
    const nine = (prefix: string) =>
      Array.from({ length: 9 }, (_, index) => p(`${prefix}${index}`)).join('');
    const layout = layoutTiny(
      loadPart(
        `<w:tbl>${GRID}` +
          `<w:tr>${tc(p('side'))}${tc(nine('A'), RESTART)}${tc(nine('B'), RESTART)}</w:tr>` +
          `<w:tr>${tc(p('side2'))}${tc(p('ghost'), CONTINUE)}${tc(p('ghost'), CONTINUE)}</w:tr>` +
          '</w:tbl>'
      )
    );
    const painted = layout.pages
      .flatMap((page) => tablesOf(layout, layout.pages.indexOf(page)))
      .flatMap((table) => table.rows)
      .flatMap((row) => row.cells)
      .flatMap((cell) => cell.blocks)
      .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
      .flatMap((line) => line.spans)
      .map((span) => span.text);
    for (const prefix of ['A', 'B']) {
      for (let index = 0; index < 9; index += 1) expect(painted).toContain(`${prefix}${index}`);
    }
    expect(painted).toContain('side2');
    expectContentInsideItsTable(layout);
    for (const pageIndex of layout.pages.keys()) {
      expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
    }
  });

  test('merges over the same rows under a repeated header stay inside their page', () => {
    const layout = layoutTiny(
      loadPart(
        `${p('F0')}${p('F1')}<w:tbl>${GRID}` +
          `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(p('H'))}${tc(p('Hb'))}${tc(p('Hc'))}</w:tr>` +
          `<w:tr>${tc(p('side'))}${tc(p('A0') + p('A1'), RESTART)}${tc(MERGED_CONTENT, RESTART)}</w:tr>` +
          `<w:tr>${tc(p('side2'))}${tc(p('g'), CONTINUE)}${tc(p('g'), CONTINUE)}</w:tr>` +
          '</w:tbl>'
      )
    );
    expectContentInsideItsTable(layout);
    for (const pageIndex of layout.pages.keys()) {
      expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
    }
  });

  test('two merges in different columns are decided one at a time', () => {
    // Column 0 merges rows 0-1 and column 1 merges rows 1-2. Treating the two as one
    // keep-together block moved the whole table to the next page and left the first one
    // blank, and once such a chain outgrew a page it turned the plan off for every row.
    const layout = layoutTiny(
      loadPart(
        `${p('F0')}${p('F1')}<w:tbl>${GRID}` +
          `<w:tr>${tc(p('a0'), RESTART)}${tc(p('b0'))}</w:tr>` +
          `<w:tr>${tc(p('a1'), CONTINUE)}${tc(MERGED_CONTENT, RESTART)}</w:tr>` +
          `<w:tr>${tc(p('a2'))}${tc(p('b2'), CONTINUE)}</w:tr>` +
          `<w:tr>${tc(p('a3'))}${tc(p('b3'))}</w:tr>` +
          '</w:tbl>'
      )
    );
    // Both the first row and the start of the second use the remaining page band.
    expect(tablesOf(layout, 0)[0]!.rows).toHaveLength(2);
    // The continued merge covers the remaining rows, with its content inside its box.
    const carried = tablesOf(layout, 1)[0]!;
    const merged = carried.rows[0]!.cells[1]!;
    expect(merged.rowSpan).toBe(2);
    expect(merged.box.height).toBe(carried.rows[0]!.box.height + carried.rows[1]!.box.height);
    expectContentInsideItsTable(layout);
    for (const pageIndex of layout.pages.keys()) {
      expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 0.001);
    }
  });
});

// Every row reserves the rule its OWN top resolves to, so an interior row only measures
// differently as a fragment's first row when the table's outer `w:top` differs from its
// `w:insideH`. Here they are 4pt and 1pt, and the merge starts at the second row.
const OUTER_TOP_GRID =
  '<w:tblPr><w:tblBorders>' +
  ['left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="8" w:color="000000"/>`)
    .join('') +
  '<w:top w:val="single" w:sz="32" w:color="000000"/></w:tblBorders></w:tblPr>';
test('merge preflight remeasures the outer top inset after an occurrence changes', () => {
  const part = loadPart(`<w:tbl>${OUTER_TOP_GRID}<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>
    <w:tr>${tc(p('Lead'))}</w:tr>
    <w:tr>${tc(MERGED_CONTENT, RESTART)}</w:tr><w:tr>${tc(p(''), CONTINUE)}</w:tr></w:tbl>`);
  const body = part.root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  );
  if (!body || body.kind === 'textValue') throw new Error('body expected');
  const table = body.children.find((node) => node.kind === 'table')!;
  const structure = readTableStructure(table, 180, 0)!;
  let first = false;
  const plan = vMergePlanFor(
    structure,
    0,
    0,
    {
      measurer: createFixedMeasurer(),
      producer: 'probe',
      nextLineId: () => 'probe',
    },
    undefined,
    (row) => first && row.id === structure.rows[1]!.id
  )!;
  const span = plan.spansAt(1)[0]!;
  const interior = plan.heightOf(span, 0);
  first = true;
  const outer = plan.heightOf(span, 0);
  expect(outer - interior).toBeCloseTo(3, 8);
  first = false;
  expect(plan.heightOf(span, 0)).toBe(interior);
});

describe('coextensive merges over fixed rows', () => {
  test('both heads paint every line that fits their shared span', () => {
    for (const [a, b] of [
      [1, 2],
      [2, 1],
      [2, 2],
    ]) {
      const lines = (prefix: string, count: number) =>
        Array.from({ length: count }, (_, index) => p(`${prefix}${index}`)).join('');
      const result = layoutTiny(
        loadPart(
          `<w:tbl><w:tblPr/><w:tr>${exactRow(500)}` +
            tc(lines('A', a!), RESTART) +
            tc(lines('B', b!), RESTART) +
            '</w:tr>' +
            `<w:tr>${exactRow(500)}${tc(p(''), CONTINUE)}${tc(p(''), CONTINUE)}</w:tr></w:tbl>`
        )
      );
      expect(result.pages).toHaveLength(1);
      const table = tablesOf(result, 0)[0]!;
      expect(table.box.height).toBeCloseTo(50, 3);
      const painted = table.rows
        .flatMap((row) => row.cells)
        .flatMap((cell) => cell.blocks)
        .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
        .flatMap((line) => line.spans)
        .map((span) => span.text);
      for (let i = 0; i < a!; i += 1) expect(painted).toContain(`A${i}`);
      for (let i = 0; i < b!; i += 1) expect(painted).toContain(`B${i}`);
    }
  });
});
