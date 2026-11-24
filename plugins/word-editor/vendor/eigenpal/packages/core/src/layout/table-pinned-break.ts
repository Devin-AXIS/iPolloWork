// A table positioned against the page or margin that does not fit above the bottom margin.
//
// A `w:tblpPr` table with `w:vertAnchor="page"` or `"margin"` normally keeps its sheet
// position and stays out of the text flow. When its authored box would reach below the
// bottom margin, it breaks across pages in the body flow instead:
//
// - Its leading part is what fits between the body cursor and the bottom margin: the whole
//   rows that fit and the lines of the next row that fit below them.
// - It starts at the higher of two tops: the authored position of a box as tall as the
//   leading part, and the top that puts the leading part's bottom at the bottom page edge.
//   A box that ends above the page edge therefore keeps its `w:tblpY`, and bottom alignment
//   is the page-edge top itself.
// - Its first fragment is no taller than the room the body had below its cursor. Since mode 15
//   it also ends at the bottom margin (`positionedTableBreaksAtMargin`); earlier modes run it
//   to the page edge.
// - Later fragments open at the top of the next page. Rows split at line boundaries,
//   `w:cantSplit` rows included. The body flow resumes on the last page as after a breaking
//   text-anchored table (`resumeAfterBreak` in `table-text-float-break.ts`): below the last row
//   and `w:bottomFromText`, or beside a last part that leaves a passage for text.
// - When the start lies above the body cursor, the table would cover text already on the
//   page, so it opens the next page and starts there by the same rule.
//
// - Earlier modes break only a table that reaches below the page edge.
//
// Limits, each keeping the sheet-pinned placement:
// - A table entirely outside the text column, or one with an exact-height row.
// - A table with a line, a minimum row height, or a nested row taller than the page band.
// - A table whose authored top is already in the bottom margin.
// - Multi-column sections, and `w:doNotBreakWrappedTables`.
// Further differences: `inside`/`outside` alignment resolve as top/bottom, and a nested table row
// moves whole, as it does in every table, instead of splitting at line boundaries.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { TableFragmentRecord, TableRowFragmentRecord } from './semantic-records.ts';
import { tableRefusesOverlap } from './table-float-overlap.ts';
import {
  createTableBorderOwnershipBudget,
  createTableVMergeResolveBudget,
  layoutTableFragment,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import type { SemanticTableStructure, TableAnchorFrames } from './semantic-table.ts';
import { tableFloatOriginY, type TableVerticalAnchorFrames } from './table-float-position.ts';
import { positionedTableOriginX } from './table-origin.ts';
import { measuringFlowDeps } from './table-probe-deps.ts';
import type { TableFlowCursor } from './table-flow-cursor.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';

const EPSILON = 0.001;

/** Where the body stands when it reaches a positioned table, in page-content points. */
export interface PinnedTableFlow {
  /** The body cursor. */
  readonly top: number;
  /** Bottom of the page content box. */
  readonly bottom: number;
  readonly frames: TableAnchorFrames;
  readonly verticalFrames: TableVerticalAnchorFrames;
  /** The width the table structure was read against. */
  readonly width: number;
}

/**
 * Which positioned tables may break: their anchor paragraph does not keep whole-table
 * placement (a page or column break or space before it, or an anchor shared with another
 * table). Carried on the table deps, which every probe and placement copies.
 */
export interface PinnedBreakDeps {
  readonly pinnedBreakAllowed?: (tableId: string) => boolean;
}

/** The positioned-table facts a body pass gives its table deps. */
export function positionedTableDeps(
  anchors: readonly { readonly table: OoxmlElement }[],
  policy: ReadonlyMap<string, boolean>
): { readonly floatRefusesOverlap?: (tableId: string) => boolean } & PinnedBreakDeps {
  const refusing = new Set(
    anchors.filter(({ table }) => tableRefusesOverlap(table)).map(({ table }) => table.id)
  );
  return {
    floatRefusesOverlap: (tableId) => refusing.has(tableId),
    pinnedBreakAllowed: (tableId) => policy.get(tableId) !== false,
  };
}

/** Where a breaking positioned table's first fragment opens and how far it may reach. */
export interface PinnedTableBreak {
  readonly top: number;
  /** Bottom of the band the first fragment may fill, in page-content points. */
  readonly firstBottom: number;
}

const probes = new WeakMap<
  TableFlowDeps,
  WeakMap<OoxmlElement, Map<number, TableFragmentRecord>>
>();

/**
 * A positioned table laid out whole from 0, without breaks, for measurement only. Page
 * exclusion zones are left out, so the probe does not depend on the cursor; it is memoized per
 * body pass and width.
 */
export function probeTable(
  table: OoxmlElement,
  structure: SemanticTableStructure,
  width: number,
  deps: TableFlowDeps
): TableFragmentRecord {
  // Inline drawing layout can place cell drawings against the page, so its probes are not reused.
  let widths: Map<number, TableFragmentRecord> | undefined;
  if (!deps.inlineDrawingLayout) {
    let tables = probes.get(deps);
    if (!tables) probes.set(deps, (tables = new WeakMap()));
    widths = tables.get(table);
    if (!widths) tables.set(table, (widths = new Map()));
    const cached = widths.get(width);
    if (cached) return cached;
  }
  const { fragment } = layoutTableFragment(structure, 0, 0, 0, table.id, 0, {
    ...measuringFlowDeps(deps, false),
    onCellBreakKey: undefined,
    borderOwnershipBudget: createTableBorderOwnershipBudget(),
    vMergeResolveBudget: createTableVMergeResolveBudget(),
  });
  widths?.set(width, fragment);
  return fragment;
}

/**
 * Bottoms of the pieces a row can break between, in probe coordinates: each line, and each
 * nested table row as a whole, since the paginator never splits a nested row.
 */
function lineBottoms(row: TableRowFragmentRecord, out: number[]): number[] {
  for (const cell of row.cells) {
    for (const block of cell.blocks) {
      if (block.kind === 'table') {
        for (const nested of block.rows) out.push(nested.box.y + nested.box.height);
        continue;
      }
      for (const line of block.lines) out.push(line.box.y + line.box.height);
    }
  }
  return out;
}

/**
 * Height the first fragment needs to open: the header rows, which move as one group, and the
 * first line of the first body row.
 */
export function openingHeight(fragment: TableFragmentRecord): number {
  let bottom = 0;
  let index = 0;
  for (; index < fragment.rows.length && fragment.rows[index]!.isHeaderRow; index++) {
    const header = fragment.rows[index]!;
    bottom = header.box.y + header.box.height;
  }
  const row = fragment.rows[index];
  if (!row) return bottom;
  const rowBottom = row.box.y + row.box.height;
  // Every cell must place its first line, so the opening is the lowest of those first lines.
  let opening = row.box.y;
  let last = row.box.y;
  for (const cell of row.cells) {
    const bottoms = lineBottoms({ ...row, cells: [cell] }, []);
    if (bottoms.length === 0) continue;
    opening = Math.max(
      opening,
      bottoms.reduce((min, value) => Math.min(min, value), Infinity)
    );
    last = Math.max(
      last,
      bottoms.reduce((max, value) => Math.max(max, value), row.box.y)
    );
  }
  if (opening <= row.box.y) return rowBottom;
  return Math.min(rowBottom, opening + Math.max(0, rowBottom - last));
}

/**
 * Whether every piece the paginator cannot split fits a page band of `band` points: each line,
 * each row's authored minimum height, and each nested table row, which keeps its whole height.
 */
function paginates(
  structure: SemanticTableStructure,
  fragment: TableFragmentRecord,
  band: number
): boolean {
  if (structure.rows.some((row) => row.height.rule === 'atLeast' && row.height.valuePt > band))
    return false;
  const fits = (rows: readonly TableRowFragmentRecord[], nested: boolean): boolean =>
    rows.every(
      (row) =>
        (!nested || row.box.height <= band + EPSILON) &&
        row.cells.every((cell) =>
          cell.blocks.every((block) =>
            block.kind === 'table'
              ? fits(block.rows, true)
              : block.lines.every((line) => line.box.height <= band + EPSILON)
          )
        )
    );
  return fits(fragment.rows, false);
}

/**
 * Height of the leading part of a probed table that fits `room`: the whole rows that fit, and
 * the lines of the next row that fit below them. A split row keeps the space its cells leave
 * below their last line. Every box of the probe shares one frame, with the table top at 0.
 */
export function leadingPartHeight(fragment: TableFragmentRecord, room: number): number {
  let whole = 0;
  let next: TableRowFragmentRecord | undefined;
  for (const row of fragment.rows) {
    const bottom = row.box.y + row.box.height;
    if (bottom > room + EPSILON) {
      next = row;
      break;
    }
    whole = bottom;
  }
  const split = whole > 0 ? next : fragment.rows[0];
  if (!split) return whole;
  const bottoms = lineBottoms(split, []);
  const lastLine = bottoms.reduce((max, bottom) => Math.max(max, bottom), split.box.y);
  const below = split.box.y + split.box.height - lastLine;
  let fit = whole;
  for (const bottom of bottoms) {
    if (bottom + below <= room + EPSILON) fit = Math.max(fit, bottom + below);
  }
  return fit;
}

/**
 * Where a page- or margin-positioned table that breaks across pages opens, or `undefined`
 * when the table keeps its sheet position. See the module comment.
 */
export function pinnedTableBreak(
  table: OoxmlElement,
  structure: SemanticTableStructure,
  deps: TableFlowDeps,
  flow: PinnedTableFlow
): PinnedTableBreak | undefined {
  const float = structure.float;
  if (
    !float ||
    float.vertAnchor === 'text' ||
    float.ySpec === 'inline' ||
    // One column spans the margins; a narrower text frame is one of several columns.
    flow.frames.text.width < flow.frames.margin.width - 0.5 ||
    deps.styleCascade?.doNotBreakWrappedTables ||
    (deps as TableFlowDeps & PinnedBreakDeps).pinnedBreakAllowed?.(table.id) === false ||
    structure.rows.length === 0 ||
    structure.rows.some((row) => row.height.rule === 'exact')
  )
    return undefined;
  const distances = float.distances ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const left = positionedTableOriginX(structure, flow.frames, deps.compatibilityMode);
  const width = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const column = flow.frames.text;
  if (
    left + width + distances.right <= column.left + EPSILON ||
    left - distances.left >= column.left + column.width - EPSILON
  )
    return undefined;
  const probe = probeTable(table, structure, flow.width, deps);
  const height = probe.box.height;
  const authored = tableFloatOriginY(float, height, flow.verticalFrames);
  // Reaching below the bottom margin is judged against the margin line, so a footnote reserve
  // that shortens this page's band neither starts a break nor flips it between passes.
  const margin = flow.verticalFrames.margin;
  const marginBottom = Math.max(flow.bottom, margin.top + margin.height);
  const pageEdge = flow.verticalFrames.page.top + flow.verticalFrames.page.height;
  const atMargin = hasCompatibilityRule(deps.compatibilityMode, 'positionedTableBreaksAtMargin');
  // Earlier modes break only a table that reaches below the page edge itself.
  const breakLine = atMargin ? marginBottom : Math.max(marginBottom, pageEdge);
  if (
    authored >= marginBottom - EPSILON ||
    authored + height <= breakLine + EPSILON ||
    !paginates(structure, probe, flow.bottom)
  )
    return undefined;
  const leading = leadingPartHeight(probe, flow.bottom - flow.top);
  // The band below the start must still hold the header rows and the first body line, unless
  // that opening is taller than the band itself, where the paginator degrades the group.
  const opening = openingHeight(probe);
  // A note reserve that shortens the band also stops an earlier mode's run to the page edge.
  const limit = atMargin || flow.bottom < marginBottom ? flow.bottom : pageEdge;
  const top = Math.min(
    tableFloatOriginY(float, leading, flow.verticalFrames),
    pageEdge - leading,
    opening <= flow.bottom ? limit - opening : Infinity
  );
  return { top, firstBottom: Math.min(limit, top + flow.bottom - flow.top) };
}

/**
 * {@link pinnedTableBreak} for the paginator's cursor, after moving to the next page when the
 * start would cover body content already above the cursor.
 */
export function pinnedBreakAtCursor(
  table: OoxmlElement,
  structure: SemanticTableStructure,
  flow: TableFlowCursor
): PinnedTableBreak | undefined {
  const at = (): PinnedTableFlow => ({
    top: flow.cursorY,
    bottom: flow.contentHeight(),
    frames: flow.anchorFrames(),
    verticalFrames: flow.verticalAnchorFrames(),
    width: flow.columnWidth(),
  });
  const placed = pinnedTableBreak(table, structure, flow.deps, at());
  if (!placed || placed.top >= flow.cursorY - EPSILON || !flow.pageHoldsContent(flow.cursorY))
    return placed;
  flow.advancePage();
  return pinnedTableBreak(table, structure, flow.deps, at()) ?? placed;
}

const splittable = new WeakMap<SemanticTableStructure, SemanticTableStructure>();

/**
 * The structure a breaking positioned table paginates with: its rows may all split. Memoized,
 * so identity-keyed row and structure caches keep hitting across passes.
 */
export function withSplittableRows(structure: SemanticTableStructure): SemanticTableStructure {
  if (!structure.rows.some((row) => row.cantSplit)) return structure;
  let result = splittable.get(structure);
  if (!result) {
    result = {
      ...structure,
      rows: structure.rows.map((row) => (row.cantSplit ? { ...row, cantSplit: false } : row)),
    };
    splittable.set(structure, result);
  }
  return result;
}
