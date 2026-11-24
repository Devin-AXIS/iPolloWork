// Table-level shading: `w:tblPr/w:shd` (17.4.32) and a row's `w:tblPrEx/w:shd` exception.
//
// The table's fill is the background behind its cells, and it shows only where no cell
// covers it: in the `w:tblCellSpacing` gaps between cells and between the cells and the table
// edge. A cell without a fill of its own does not take it, so with no cell spacing the table
// fill shows nowhere. Reference renderings agree on each of these in compatibility modes 14
// and 15, and in a file that states no compatibility mode: an unshaded cell of a shaded table
// shows what lies behind the table (the page, or an outer cell's fill), with or without
// spacing; the gaps of a spaced table take the fill, the gap below the last row included, in
// flow and positioned; a cell's own fill paints over it; a row's `w:tblPrEx` fill replaces the
// table's around that row's cells; and a column a row skips by `w:gridBefore` takes none.
//
// The cascade follows `w:shd` everywhere else: the style chain's `w:tblPr`, base first, then
// the table's own `w:tblPr`, then the row exception. A stated `auto` fill clears the layers
// below it; `nil` leaves them showing.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { wmlChildNamed } from '../store/store/tree-op-table-shared.ts';
import { cascadedShadingFill } from './table-cell-shading.ts';
import { cellSpacingGapPt } from './table-cell-spacing.ts';
import { clipParagraphBox as clip } from './paragraph-frame-clip.ts';
import { shareRowFacts } from './table-row-facts.ts';
import type { SemanticTableRow } from './semantic-table.ts';
import type {
  LayoutBox,
  TableFragmentRecord,
  TableRowFragmentRecord,
  TableSpacingShading,
} from './semantic-records.ts';

/** One filled band of a table fragment: `box` minus the cell boxes in `holes`. @internal */
export interface TableSpacingShadingRegion {
  /** Validated `RRGGBB` fill. */
  readonly fill: string;
  /** The row band in page points; the last row's runs on to the bottom of the fragment. */
  readonly box: LayoutBox;
  /** Cell boxes inside `box`, clipped to it, that the fill leaves out. They never overlap. */
  readonly holes: readonly LayoutBox[];
}

/**
 * `rows` with the gap fill each one shows, or `rows` itself when the table has no cell
 * spacing: then no gap shows the fill.
 */
export function withRowSpacingShading(
  rows: readonly SemanticTableRow[],
  input: {
    readonly stylePropertyNodes: readonly OoxmlElement[];
    readonly tableProperties: OoxmlElement | undefined;
    /** The authored `w:tr` of `rows[index]`. */
    readonly rowNodeAt: (index: number) => OoxmlElement | undefined;
    readonly cellSpacingPt: number;
  }
): readonly SemanticTableRow[] {
  const { cellSpacingPt } = input;
  if (!(cellSpacingPt > 0)) return rows;
  const layers = [...input.stylePropertyNodes, input.tableProperties];
  const tableFill = cascadedShadingFill(layers);
  const gapPt = cellSpacingGapPt(cellSpacingPt);
  // One record for each fill, shared by its rows: most tables have one fill throughout.
  const shadings = new Map<string, TableSpacingShading>();
  let shaded = false;
  const result = rows.map((row, index) => {
    const node = input.rowNodeAt(index);
    const exception = node && wmlChildNamed(node, 'tblPrEx');
    const fill = exception ? cascadedShadingFill([...layers, exception]) : tableFill;
    if (fill === undefined) return row;
    let spacingShading = shadings.get(fill);
    if (!spacingShading) shadings.set(fill, (spacingShading = { fill, gapPt }));
    shaded = true;
    // The copy keeps the row's memoized facts: it changes nothing they read.
    return shareRowFacts(row, { ...row, spacingShading });
  });
  return shaded ? result : rows;
}

/**
 * The bands a table fragment fills, one per shaded row, less every cell box that reaches into
 * it. A band runs from the row's first cell to its last, with the gap on each side, so cells
 * skipped by `w:gridBefore` or `w:gridAfter` take no fill; a row that reaches the table's
 * edge fills out to its frame (`table-spacing-frame.ts`). The last row's band runs on to the
 * bottom of the fragment box, which holds the gap the table closes below its last row. A cell
 * merged down from an earlier row stays a hole in each row it crosses. Each cell is tested
 * only against the rows it can reach. Shared by the editor and PDF painters.
 *
 * @internal
 */
export function tableSpacingShadingRegions(
  fragment: Pick<TableFragmentRecord, 'rows' | 'box'> & {
    readonly columnEdges?: TableFragmentRecord['columnEdges'];
  }
): readonly TableSpacingShadingRegion[] {
  const regions: TableSpacingShadingRegion[] = [];
  if (!fragment.rows.some((row) => row.spacingShading)) return regions;
  let open: LayoutBox[] = [];
  const lastRow = fragment.rows.at(-1);
  // Below the last row the fragment box holds the gap the table closes there, if any.
  const fragmentBottom = fragment.box.y + fragment.box.height;
  const columns = fragment.columnEdges ? fragment.columnEdges.length - 1 : Infinity;
  for (const row of fragment.rows) {
    const cells: LayoutBox[] = [];
    for (const cell of row.cells) if (!cell.paintInert) cells.push(cell.box);
    const shading = row.spacingShading;
    const bottom = row === lastRow ? fragmentBottom : row.box.y + row.box.height;
    const band = shading && rowBand(row, shading, bottom, columns);
    if (shading && band) {
      const holes: LayoutBox[] = [];
      // Cells merged down from different rows sit in different columns, as do a row's own
      // cells: only a row's cell against a merged one can overlap.
      for (const cell of open) addHole(holes, clip(cell, band), 0);
      const merged = holes.length;
      for (const cell of cells) addHole(holes, clip(cell, band), merged);
      // A band that continues the one above in the same fill and width joins it: two fills
      // meeting on one edge leave a hairline seam where a viewer antialiases each.
      const above = regions.at(-1);
      const joins =
        above &&
        above.fill === shading.fill &&
        Math.abs(above.box.x - band.x) < 0.001 &&
        Math.abs(above.box.width - band.width) < 0.001 &&
        Math.abs(above.box.y + above.box.height - band.y) < 0.001;
      if (joins) {
        const box = { ...above.box, height: band.y + band.height - above.box.y };
        regions[regions.length - 1] = {
          fill: shading.fill,
          box,
          holes: [...above.holes, ...holes],
        };
      } else regions.push({ fill: shading.fill, box: band, holes });
    }
    // Only a cell that reaches below its row can cover a later one.
    const rowBottom = row.box.y + row.box.height;
    open = open.filter((cell) => cell.y + cell.height > rowBottom + 0.001);
    for (const cell of cells) if (cell.y + cell.height > rowBottom + 0.001) open.push(cell);
  }
  return regions;
}

function rowBand(
  row: TableRowFragmentRecord,
  shading: TableSpacingShading,
  bottom: number,
  columns: number
): LayoutBox | null {
  if (row.cells.length === 0) return null;
  let left = Infinity;
  let right = -Infinity;
  let first = Infinity;
  let end = 0;
  for (const { box, gridColumn, gridSpan } of row.cells) {
    left = Math.min(left, box.x);
    right = Math.max(right, box.x + box.width);
    first = Math.min(first, gridColumn);
    end = Math.max(end, gridColumn + gridSpan);
  }
  // A row reaching the table's edge fills out to the frame, which sits that much further out.
  const frame = row.spacingFrame;
  left -= shading.gapPt + (frame && first === 0 ? frame.leftPt : 0);
  right += shading.gapPt + (frame && end >= columns ? frame.rightPt : 0);
  const height = Math.max(row.box.height, bottom - row.box.y);
  return clip({ x: left, y: row.box.y, width: right - left, height }, { ...row.box, height });
}

/**
 * Even-odd filling needs holes that never overlap. Cells do not overlap, so a hole that does
 * is a layout defect: the part already cut stays cut, and the overlapping hole is dropped
 * rather than turned back into fill.
 */
function addHole(holes: LayoutBox[], hole: LayoutBox | null, checked: number): void {
  if (!hole) return;
  for (let index = 0; index < checked; index += 1) if (clip(hole, holes[index]!)) return;
  holes.push(hole);
}
