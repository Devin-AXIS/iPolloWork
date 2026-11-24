// The external-HTML table walk — split from clipboard-html-read.ts at the max-lines
// cap. The block-flow recursion is injected, so the runtime dependency stays one-way.

import {
  cellCssPropertiesXml,
  htmlSpanOf,
  tableBordersXml,
  tableColumnWidths,
  tableJustification,
  tablePositionXml,
  tableRowsOf,
  tableRowPropertiesXml,
  tableSpanWidth,
  tablePreferredWidth,
} from './clipboard-html-table-styles.ts';
import { tableSide } from './clipboard-table-direction.ts';
import { parseInlineStyle, tagOf } from './clipboard-html-styles.ts';
import type { FlowContext, Projection } from './clipboard-html-projection.ts';

const TABLE_TOTAL_TWIPS = 9360; // 6.5 inches, Word's default content width.

type RowSpanCarry = { remaining: number; readonly span: number };

type ProjectFlow = (
  nodes: readonly Node[],
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[],
  forceEmit?: boolean
) => void;

export function projectHtmlTable(
  table: Element,
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[],
  projectFlow: ProjectFlow
): void {
  if (p.nodesLeft <= 0) {
    p.truncated = true;
    return;
  }
  if (depth > p.maxDepth) return;
  p.nodesLeft -= 1;
  // A `<caption>` is real text; it projects as a paragraph ahead of the table.
  for (const child of Array.from(table.children)) {
    if (tagOf(child) === 'caption') {
      projectFlow(Array.from(child.childNodes), depth + 1, ctx, p, out, true);
    }
  }
  const rows = tableRowsOf(table);
  if (rows.length === 0) return;

  // Count columns INCLUDING rowspan carry-over: a row that receives carried columns
  // still owns its trailing cells, which would otherwise be dropped. The walk is
  // POSITIONAL and clamps a colspan at the next carried column exactly like the
  // emission walk below, so the two never disagree on the grid width. It is bounded
  // by its OWN copy of the remaining budget (so a crafted rowspan lattice cannot
  // spin) without consuming the shared budget the emission walk charges.
  let columns = 1;
  let precountLeft = p.nodesLeft;
  const carryAt: Array<{ remaining: number; span: number } | null> = [];
  for (const row of rows) {
    if (precountLeft <= 0 || columns >= 63) break;
    const carriedNow: Array<number | null> = carryAt.map((entry) => (entry ? entry.span : null));
    for (let index = 0; index < carryAt.length; index += 1) {
      const entry = carryAt[index];
      if (entry) {
        entry.remaining -= 1;
        if (entry.remaining <= 0) carryAt[index] = null;
      }
    }
    const sourceCells = Array.from(row.children).filter((cell) => /^t[dh]$/.test(tagOf(cell)));
    let sourceAt = 0;
    let column = 0;
    while (column < 63) {
      precountLeft -= 1;
      if (precountLeft <= 0) break;
      const carriedSpan = column < carriedNow.length ? carriedNow[column] : null;
      if (carriedSpan !== null && carriedSpan !== undefined) {
        column += carriedSpan;
        continue;
      }
      const cell = sourceCells[sourceAt];
      if (cell === undefined) break;
      sourceAt += 1;
      let span = Math.min(htmlSpanOf(cell, 'colspan', 63), 63 - column);
      for (let ahead = column + 1; ahead < column + span; ahead += 1) {
        if (ahead < carriedNow.length && carriedNow[ahead] != null) {
          span = ahead - column;
          break;
        }
      }
      const rowSpan = htmlSpanOf(cell, 'rowspan', 1000);
      if (rowSpan > 1) {
        while (carryAt.length <= column) carryAt.push(null);
        carryAt[column] = { remaining: rowSpan - 1, span };
      }
      column += span;
    }
    // Carried columns past the row's own cells still occupy the grid.
    for (let at = column; at < carriedNow.length && at < 63; at += 1) {
      const carriedSpan = carriedNow[at];
      if (carriedSpan != null) column = Math.max(column, at + carriedSpan);
    }
    columns = Math.max(columns, column);
  }
  columns = Math.min(Math.max(columns, 1), 63);

  const preferredWidth = tablePreferredWidth(table, TABLE_TOTAL_TWIPS);
  const totalWidth = preferredWidth.twips;
  // Width inference walks at most as many rows as the remaining budget could emit,
  // so a row flood cannot spin an uncharged O(rows x columns) pass.
  const budgetedRows = rows.length > p.nodesLeft ? rows.slice(0, Math.max(1, p.nodesLeft)) : rows;
  const columnWidths = tableColumnWidths(budgetedRows, columns, totalWidth);
  const direction = parseInlineStyle(table).get('direction') ?? table.getAttribute('dir');
  const rtl = direction?.trim().toLowerCase() === 'rtl';
  const borders = tableBordersXml(table, rtl);
  const position = tablePositionXml(table);
  // HTML tables without alignment stay physically left, also under dir=rtl.
  const justification = tableJustification(table) ?? (rtl ? 'left' : undefined);
  const jc = justification === undefined ? '' : `<w:jc w:val="${tableSide(justification, rtl)}"/>`;
  const grid = columnWidths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');

  const carry: Array<RowSpanCarry | null> = new Array<RowSpanCarry | null>(columns).fill(null);
  const rowXml: string[] = [];
  for (const row of rows) {
    if (p.nodesLeft <= 0) {
      p.truncated = true;
      break;
    }
    p.nodesLeft -= 1;
    // Snapshot the carries entering THIS row, then age every entry exactly once —
    // a colspan cell that jumps a carried column must not leave it un-aged.
    const carriedNow: Array<number | null> = carry.map((entry) => (entry ? entry.span : null));
    for (let index = 0; index < columns; index += 1) {
      const entry = carry[index];
      if (entry) {
        entry.remaining -= 1;
        if (entry.remaining <= 0) carry[index] = null;
      }
    }
    const sourceCells = Array.from(row.children).filter((cell) => /^t[dh]$/.test(tagOf(cell)));
    let sourceAt = 0;
    const cells: string[] = [];
    let column = 0;
    let rowComplete = true;
    while (column < columns) {
      p.nodesLeft -= 1;
      if (p.nodesLeft <= 0) {
        p.truncated = true;
        rowComplete = false;
        break;
      }
      const carriedSpan = carriedNow[column];
      if (carriedSpan !== null) {
        const gridSpan = carriedSpan > 1 ? `<w:gridSpan w:val="${carriedSpan}"/>` : '';
        cells.push(
          `<w:tc><w:tcPr>` +
            `<w:tcW w:w="${tableSpanWidth(columnWidths, column, carriedSpan)}" w:type="dxa"/>` +
            `${gridSpan}<w:vMerge/></w:tcPr><w:p/></w:tc>`
        );
        column += carriedSpan;
        continue;
      }
      const cell = sourceCells[sourceAt];
      if (cell === undefined) {
        cells.push(
          `<w:tc><w:tcPr><w:tcW w:w="${columnWidths[column]}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`
        );
        column += 1;
        continue;
      }
      sourceAt += 1;
      // The span clamps at the table edge AND at the next carried column: jumping a
      // carried column would suppress its w:vMerge continuation and dangle the merge.
      let span = Math.min(htmlSpanOf(cell, 'colspan', 63), columns - column);
      for (let ahead = column + 1; ahead < column + span; ahead += 1) {
        if (carriedNow[ahead] !== null) {
          span = ahead - column;
          break;
        }
      }
      const rowSpan = htmlSpanOf(cell, 'rowspan', 1000);
      if (rowSpan > 1) carry[column] = { remaining: rowSpan - 1, span };
      cells.push(
        projectCell(
          cell,
          span,
          tableSpanWidth(columnWidths, column, span),
          rowSpan > 1,
          depth,
          ctx,
          p,
          projectFlow,
          rtl
        )
      );
      column += span;
    }
    // A budget break mid-row must not emit the partial row: a `<w:tr>` missing its
    // trailing cells drops `w:vMerge` continuations and dangles the merge above.
    if (!rowComplete) break;
    rowXml.push(`<w:tr>${tableRowPropertiesXml(row)}${cells.join('')}</w:tr>`);
  }

  // A `w:tbl` without a single `w:tr` is schema-invalid (Word repairs the file),
  // so a budget break before the first complete row emits nothing at all.
  if (rowXml.length === 0) return;
  out.push(
    `<w:tbl><w:tblPr>${rtl ? '<w:bidiVisual/>' : ''}${position}${preferredWidth.xml}${jc}${borders}</w:tblPr>` +
      `<w:tblGrid>${grid}</w:tblGrid>${rowXml.join('')}</w:tbl>`
  );
  p.lastMarkCovered = false;
}

function projectCell(
  cell: Element,
  span: number,
  width: number,
  vMergeRestart: boolean,
  depth: number,
  ctx: FlowContext,
  p: Projection,
  projectFlow: ProjectFlow,
  rtl: boolean
): string {
  const isHeader = tagOf(cell) === 'th';
  let tcPr = `<w:tcW w:w="${width}" w:type="dxa"/>`;
  if (span > 1) tcPr += `<w:gridSpan w:val="${span}"/>`;
  if (vMergeRestart) tcPr += '<w:vMerge w:val="restart"/>';
  tcPr += cellCssPropertiesXml(cell, rtl);

  const cellCtx: FlowContext = {
    run: isHeader ? { ...ctx.run, bold: true } : ctx.run,
    para: isHeader ? { jc: 'center' } : {},
    paragraphMarkCovered: false,
    pre: false,
    list: null,
    ...(ctx.noteBody ? { noteBody: ctx.noteBody } : {}),
    ...(ctx.rels ? { rels: ctx.rels } : {}),
  };
  const blocks: string[] = [];
  projectFlow(Array.from(cell.childNodes), depth + 2, cellCtx, p, blocks, true);
  // A cell must end with a paragraph.
  if (blocks.length === 0 || blocks[blocks.length - 1]!.endsWith('</w:tbl>')) {
    blocks.push('<w:p/>');
  }
  return `<w:tc><w:tcPr>${tcPr}</w:tcPr>${blocks.join('')}</w:tc>`;
}
