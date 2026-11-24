// Semantic table interaction geometry and hit index over layout records.
//
// Furniture reads ONLY these records — never painted DOM — to place handles and map pointer
// targets to canonical ids. Each index is a pure WeakMap cache of one layout's captured
// geometry; `sourceRevision` is always `layout.revision` at build time.

import type {
  BlockFragmentRecord,
  LayoutBox,
  SemanticLayout,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';
import { pageAtY } from './semantic-hit-test.ts';
import { isCarriedHeadRow } from './table-carried-head-row.ts';

/** Cumulative column boundary positions in table-local points. */
export function columnEdgesFromWidths(columnWidthsPt: readonly number[]): readonly number[] {
  const edges: number[] = [0];
  let x = 0;
  for (const width of columnWidthsPt) {
    x += width;
    edges.push(x);
  }
  return edges;
}

/** Assign authored row ordinals; header repeats reuse the original row's index. */
export function annotateRowIndex(
  record: TableRowFragmentRecord,
  ordinals: Map<string, number>
): TableRowFragmentRecord {
  let rowIndex = ordinals.get(record.id);
  if (rowIndex === undefined) {
    if (record.isHeaderRepeat) {
      rowIndex = 0;
    } else {
      rowIndex = ordinals.size;
      ordinals.set(record.id, rowIndex);
    }
  }
  return { ...record, rowIndex };
}

/** Attach nesting depth and resolved column edges to a table fragment. */
export function annotateTableFragmentGeometry(
  fragment: Omit<TableFragmentRecord, 'nestingDepth' | 'columnEdges'> & {
    readonly nestingDepth?: number;
    readonly columnEdges?: readonly number[];
  },
  columnWidthsPt: readonly number[],
  nestingDepth: number,
  rowOrdinals: Map<string, number>
): TableFragmentRecord {
  return {
    ...fragment,
    nestingDepth,
    columnEdges: fragment.columnEdges ?? columnEdgesFromWidths(columnWidthsPt),
    rows: fragment.rows.map((row) => annotateRowIndex(row, rowOrdinals)),
  };
}

export interface TableInteractionOccurrence {
  readonly pageIndex: number;
  readonly table: TableFragmentRecord;
  readonly row: TableRowFragmentRecord;
  readonly rowOrdinal: number;
  readonly nestingDepth: number;
  readonly editable: boolean;
  readonly pageContentBox: LayoutBox;
}

export type TableInteractionHit =
  | {
      readonly kind: 'rowDivider';
      readonly pageIndex: number;
      readonly sourceRevision: number;
      readonly tableId: string;
      readonly rowId: string;
      readonly isHeaderRepeat: boolean;
      readonly nestingDepth: number;
      readonly edgeY: number;
    }
  | {
      readonly kind: 'columnDivider';
      readonly pageIndex: number;
      readonly sourceRevision: number;
      readonly tableId: string;
      readonly rowId: string;
      readonly leftGridColumnId: string;
      readonly rightGridColumnId: string;
      readonly isHeaderRepeat: boolean;
      readonly nestingDepth: number;
      readonly edgeX: number;
      readonly sheetY: number;
    }
  | {
      readonly kind: 'rightEdge';
      readonly pageIndex: number;
      readonly sourceRevision: number;
      readonly tableId: string;
      readonly rowId: string;
      readonly gridColumnId: string;
      readonly isHeaderRepeat: boolean;
      readonly nestingDepth: number;
      readonly edgeX: number;
      readonly sheetY: number;
    }
  | {
      readonly kind: 'insertRow';
      readonly pageIndex: number;
      readonly sourceRevision: number;
      readonly tableId: string;
      readonly rowId: string;
      readonly isHeaderRepeat: boolean;
      readonly nestingDepth: number;
    }
  | {
      readonly kind: 'insertColumn';
      readonly pageIndex: number;
      readonly sourceRevision: number;
      readonly tableId: string;
      readonly rowId: string;
      readonly gridColumnId: string;
      readonly isHeaderRepeat: boolean;
      readonly nestingDepth: number;
    }
  | {
      readonly kind: 'tableBody';
      readonly pageIndex: number;
      readonly sourceRevision: number;
      readonly tableId: string;
      readonly nestingDepth: number;
      readonly editable: boolean;
    };

export interface TableInteractionIndex {
  /** Store revision stamped on the layout when geometry was captured. */
  readonly sourceRevision: number;
  readonly occurrences: readonly TableInteractionOccurrence[];
}

const indexCache = new WeakMap<SemanticLayout, TableInteractionIndex>();

interface MergedTableColumns {
  /** Grid column index to its `w:gridCol` id, read from the cells that start there. */
  readonly ids: ReadonlyMap<number, string>;
  /** In RTL a merged cell's physical start can name the wrong grid boundary. */
  readonly rtl: boolean;
}

const mergedTablesCache = new WeakMap<
  TableInteractionIndex,
  ReadonlyMap<string, MergedTableColumns>
>();

/** Tables with merged cells, with the grid column ids their dividers resize. */
function tablesWithMergedCells(
  index: TableInteractionIndex
): ReadonlyMap<string, MergedTableColumns> {
  const cached = mergedTablesCache.get(index);
  if (cached) return cached;
  const merged = new Map<string, { ids: Map<number, string>; rtl: boolean; merged: boolean }>();
  for (const occurrence of index.occurrences) {
    let entry = merged.get(occurrence.table.tableId);
    if (!entry) {
      entry = { ids: new Map(), rtl: false, merged: false };
      merged.set(occurrence.table.tableId, entry);
    }
    for (const cell of occurrence.row.cells) {
      if (cell.logicalGridColumn !== undefined) entry.rtl = true;
      if (cell.gridSpan > 1 || cell.vMergeContinue || (cell.rowSpan ?? 1) > 1) entry.merged = true;
      if (cell.gridColumnId !== undefined) entry.ids.set(cell.gridColumn, cell.gridColumnId);
    }
  }
  const result = new Map<string, MergedTableColumns>();
  for (const [tableId, entry] of merged) {
    if (entry.merged) result.set(tableId, { ids: entry.ids, rtl: entry.rtl });
  }
  mergedTablesCache.set(index, result);
  return result;
}

/** Whether a cell edge of this row falls on grid boundary `edgeIndex`. */
function rowHasBoundaryAt(row: TableRowFragmentRecord, edgeIndex: number): boolean {
  return (
    row.cells.some((cell) => cell.gridColumn === edgeIndex) ||
    row.cells.some((cell) => cell.gridColumn + cell.gridSpan === edgeIndex)
  );
}

const DIVIDER_HIT_PX = 4;
const INSERT_ROW_BAND_PX = 6;
/** Matches `paintInsertControl` column furniture offset above the table top. */
const INSERT_COLUMN_BAND_PX = 14;

const HIT_SPECIFICITY: Record<TableInteractionHit['kind'], number> = {
  rowDivider: 4,
  columnDivider: 4,
  rightEdge: 4,
  insertRow: 3,
  insertColumn: 3,
  tableBody: 0,
};

function visitTableBlocks(
  blocks: readonly BlockFragmentRecord[],
  pageIndex: number,
  pageContentBox: LayoutBox,
  nestingDepth: number,
  visit: (occ: TableInteractionOccurrence) => void
): void {
  for (const block of blocks) {
    if (block.kind !== 'table') continue;
    const depth = block.nestingDepth ?? nestingDepth;
    for (const row of block.rows) {
      visit({
        pageIndex,
        table: block,
        row,
        rowOrdinal: row.rowIndex,
        nestingDepth: depth,
        editable: !row.isHeaderRepeat,
        pageContentBox,
      });
      for (const cell of row.cells) {
        visitTableBlocks(cell.blocks, pageIndex, pageContentBox, depth + 1, visit);
      }
    }
  }
}

/** Build or retrieve the cached interaction index for one published layout. */
export function tableInteractionIndex(layout: SemanticLayout): TableInteractionIndex {
  const cached = indexCache.get(layout);
  if (cached) return cached;

  const occurrences: TableInteractionOccurrence[] = [];
  for (let pageIndex = 0; pageIndex < layout.pages.length; pageIndex += 1) {
    const page = layout.pages[pageIndex]!;
    const take = (occ: TableInteractionOccurrence): void => {
      // A carried head row has zero height: no band to resize or insert beside.
      if (isCarriedHeadRow(occ.row)) return;
      occurrences.push(occ);
    };
    visitTableBlocks(page.fragments, pageIndex, page.contentBox, 0, take);
    // The HEADER and FOOTER stories. A table in one was never indexed, so hovering it
    // offered no row or column handles at all — the table was there and inert.
    //
    // Each story carries its OWN origin. A story's fragments are laid out relative to its own
    // box, not the page content box, so indexing them against the body's origin would place
    // every handle at the wrong point on the page rather than fixing anything.
    for (const story of [page.header, page.footer]) {
      if (!story) continue;
      visitTableBlocks(story.fragments, pageIndex, story.box, 0, take);
    }
  }

  const index: TableInteractionIndex = Object.freeze({
    sourceRevision: layout.revision,
    occurrences: Object.freeze(occurrences),
  });
  indexCache.set(layout, index);
  return index;
}

/** True when the index was built from this layout revision. */
export function isInteractionIndexFresh(
  index: TableInteractionIndex,
  layout: SemanticLayout
): boolean {
  return index.sourceRevision === layout.revision;
}

/** Page-content coordinates to sheet-space points (contentBox is already sheet-relative). */
export function pageContentToSheet(
  pageIndex: number,
  x: number,
  y: number,
  layout: SemanticLayout
): { readonly x: number; readonly y: number } {
  const page = layout.pages[pageIndex];
  if (!page) return { x, y };
  return {
    x: page.contentBox.x + x,
    y: page.contentBox.y + y,
  };
}

/** Sheet-space points to page-content coordinates (semantic, without paint offset). */
export function sheetToPageContent(
  layout: SemanticLayout,
  sheetX: number,
  sheetY: number,
  pageOffsetX: (pageIndex: number) => number = () => 0,
  scale = 1
): { readonly pageIndex: number; readonly x: number; readonly y: number } | null {
  const scaledX = sheetX / scale;
  const scaledY = sheetY / scale;
  const pageIndex = pageAtY(layout, scaledY);
  if (pageIndex < 0) return null;
  const page = layout.pages[pageIndex]!;
  return {
    pageIndex,
    x: scaledX - page.contentBox.x - pageOffsetX(pageIndex),
    y: scaledY - page.contentBox.y,
  };
}

/** Stable identity for hover furniture refresh within one table. */
export function tableInteractionHitIdentity(hit: TableInteractionHit): string {
  const revision = hit.sourceRevision;
  switch (hit.kind) {
    case 'rowDivider':
      return `${revision}:${hit.kind}:${hit.pageIndex}:${hit.tableId}:${hit.rowId}:${hit.isHeaderRepeat}:${hit.edgeY}`;
    case 'columnDivider':
      return `${revision}:${hit.kind}:${hit.pageIndex}:${hit.tableId}:${hit.rowId}:${hit.isHeaderRepeat}:${hit.leftGridColumnId}:${hit.rightGridColumnId}:${hit.edgeX}`;
    case 'rightEdge':
      return `${revision}:${hit.kind}:${hit.pageIndex}:${hit.tableId}:${hit.rowId}:${hit.isHeaderRepeat}:${hit.gridColumnId}:${hit.edgeX}`;
    case 'insertRow':
      return `${revision}:${hit.kind}:${hit.pageIndex}:${hit.tableId}:${hit.rowId}:${hit.isHeaderRepeat}`;
    case 'insertColumn':
      return `${revision}:${hit.kind}:${hit.pageIndex}:${hit.tableId}:${hit.rowId}:${hit.gridColumnId}:${hit.isHeaderRepeat}`;
    case 'tableBody':
      return `${revision}:${hit.kind}:${hit.pageIndex}:${hit.tableId}:${hit.nestingDepth}:${hit.editable}`;
  }
}

/** Canonical target identity ignoring captured revision (for relayout refresh). */
export function tableInteractionTargetIdentity(hit: TableInteractionHit): string {
  switch (hit.kind) {
    case 'rowDivider':
      return `${hit.kind}:${hit.pageIndex}:${hit.tableId}:${hit.rowId}:${hit.isHeaderRepeat}:${hit.edgeY}`;
    case 'columnDivider':
      return `${hit.kind}:${hit.pageIndex}:${hit.tableId}:${hit.rowId}:${hit.isHeaderRepeat}:${hit.leftGridColumnId}:${hit.rightGridColumnId}:${hit.edgeX}`;
    case 'rightEdge':
      return `${hit.kind}:${hit.pageIndex}:${hit.tableId}:${hit.rowId}:${hit.isHeaderRepeat}:${hit.gridColumnId}:${hit.edgeX}`;
    case 'insertRow':
      return `${hit.kind}:${hit.pageIndex}:${hit.tableId}:${hit.rowId}:${hit.isHeaderRepeat}`;
    case 'insertColumn':
      return `${hit.kind}:${hit.pageIndex}:${hit.tableId}:${hit.rowId}:${hit.gridColumnId}:${hit.isHeaderRepeat}`;
    case 'tableBody':
      return `${hit.kind}:${hit.pageIndex}:${hit.tableId}:${hit.nestingDepth}:${hit.editable}`;
  }
}

/** Resolve a retained insertion target against a fresh interaction index. */
export function resolveTableInteractionInsertHit(
  index: TableInteractionIndex,
  prior: Extract<TableInteractionHit, { kind: 'insertRow' | 'insertColumn' }>
): Extract<TableInteractionHit, { kind: 'insertRow' | 'insertColumn' }> | null {
  if (prior.kind === 'insertRow') {
    for (const occ of index.occurrences) {
      if (occ.pageIndex !== prior.pageIndex) continue;
      if (occ.table.tableId !== prior.tableId) continue;
      if (occ.row.id !== prior.rowId) continue;
      if (occ.row.isHeaderRepeat !== prior.isHeaderRepeat) continue;
      if (!occ.editable) return null;
      return {
        kind: 'insertRow',
        pageIndex: occ.pageIndex,
        sourceRevision: index.sourceRevision,
        tableId: occ.table.tableId,
        rowId: occ.row.id,
        isHeaderRepeat: occ.row.isHeaderRepeat,
        nestingDepth: occ.nestingDepth,
      };
    }
    return null;
  }

  for (const occ of index.occurrences) {
    if (occ.pageIndex !== prior.pageIndex) continue;
    if (occ.table.tableId !== prior.tableId) continue;
    if (occ.row.id !== prior.rowId) continue;
    if (occ.row.isHeaderRepeat !== prior.isHeaderRepeat) continue;
    if (!occ.editable) continue;
    for (let col = 0; col < occ.table.columnEdges.length - 1; col += 1) {
      const gridColumnId = gridColumnIdAt(occ.row, col);
      if (gridColumnId !== prior.gridColumnId) continue;
      return {
        kind: 'insertColumn',
        pageIndex: occ.pageIndex,
        sourceRevision: index.sourceRevision,
        tableId: occ.table.tableId,
        rowId: occ.row.id,
        gridColumnId,
        isHeaderRepeat: occ.row.isHeaderRepeat,
        nestingDepth: occ.nestingDepth,
      };
    }
  }
  return null;
}

function gridColumnIdAt(row: TableRowFragmentRecord, columnIndex: number): string | null {
  for (const cell of row.cells) {
    if (cell.gridColumn === columnIndex) return cell.gridColumnId ?? null;
  }
  return null;
}

function tableLocalPoint(
  layout: SemanticLayout,
  occ: TableInteractionOccurrence,
  sheetX: number,
  sheetY: number,
  pageOffsetX: number
): { readonly x: number; readonly y: number } | null {
  const page = layout.pages[occ.pageIndex];
  if (!page) return null;
  // The OCCURRENCE's origin, not the page's content box. A table in a header is laid out
  // relative to the header's box, and the occurrence carries that box for exactly this
  // conversion. Using the page's origin for every occurrence had two failures at once: the
  // real header table was never hit, and a point in the BODY at the same story-local offset
  // matched it — so a column handle for the header appeared over body text and dragging it
  // resized the header.
  const origin = occ.pageContentBox;
  const contentX = sheetX - origin.x - pageOffsetX;
  const contentY = sheetY - origin.y;
  const table = occ.table;
  const localX = contentX - table.box.x;
  const localY = contentY - table.box.y;
  if (
    localX < -DIVIDER_HIT_PX ||
    localY < -INSERT_COLUMN_BAND_PX ||
    localX > table.box.width + DIVIDER_HIT_PX ||
    localY > table.box.height + INSERT_ROW_BAND_PX
  ) {
    return null;
  }
  return { x: localX, y: localY };
}

function dividerHit(
  index: TableInteractionIndex,
  occ: TableInteractionOccurrence,
  localX: number,
  localY: number
): TableInteractionHit | null {
  if (occ.row.isHeaderRepeat) return null;
  const table = occ.table;
  const rowBottom = occ.row.box.y - table.box.y + occ.row.box.height;
  const nearColumnEdge = table.columnEdges
    .slice(1)
    .some((edgeX) => Math.abs(localX - edgeX) <= DIVIDER_HIT_PX);
  if (
    !nearColumnEdge &&
    localX >= 0 &&
    localX <= table.box.width &&
    Math.abs(localY - rowBottom) <= DIVIDER_HIT_PX
  ) {
    return {
      kind: 'rowDivider',
      pageIndex: occ.pageIndex,
      sourceRevision: index.sourceRevision,
      tableId: table.tableId,
      rowId: occ.row.id,
      isHeaderRepeat: occ.row.isHeaderRepeat,
      nestingDepth: occ.nestingDepth,
      edgeY: rowBottom,
    };
  }
  if (
    localY < occ.row.box.y - occ.table.box.y ||
    localY > occ.row.box.y - occ.table.box.y + occ.row.box.height
  ) {
    return null;
  }
  // In a table with merged cells a divider shows only where this row has a cell edge, and it
  // names the grid columns on either side from any row. In RTL a merged cell's physical start
  // can name the wrong grid boundary, so those tables keep no divider.
  const merged = tablesWithMergedCells(index).get(table.tableId);
  if (merged?.rtl) return null;
  for (let edgeIndex = 1; edgeIndex < table.columnEdges.length - 1; edgeIndex += 1) {
    const edgeX = table.columnEdges[edgeIndex]!;
    if (Math.abs(localX - edgeX) > DIVIDER_HIT_PX) continue;
    if (merged && !rowHasBoundaryAt(occ.row, edgeIndex)) continue;
    const left = merged
      ? (merged.ids.get(edgeIndex - 1) ?? null)
      : gridColumnIdAt(occ.row, edgeIndex - 1);
    const right = merged ? (merged.ids.get(edgeIndex) ?? null) : gridColumnIdAt(occ.row, edgeIndex);
    if (!left || !right) continue;
    return {
      kind: 'columnDivider',
      pageIndex: occ.pageIndex,
      sourceRevision: index.sourceRevision,
      tableId: table.tableId,
      rowId: occ.row.id,
      leftGridColumnId: left,
      rightGridColumnId: right,
      isHeaderRepeat: occ.row.isHeaderRepeat,
      nestingDepth: occ.nestingDepth,
      edgeX,
      sheetY: occ.pageContentBox.y + table.box.y + localY,
    };
  }
  const rightEdge = table.columnEdges.at(-1)!;
  if (Math.abs(localX - rightEdge) <= DIVIDER_HIT_PX) {
    const lastCol = table.columnEdges.length - 2;
    const gridColumnId = gridColumnIdAt(occ.row, lastCol);
    if (!gridColumnId) return null;
    // The store's outer-edge operation resizes the last STORED column. In RTL that
    // is the left edge. Do not offer a right-edge handle that edits the wrong cell.
    if (occ.row.cells.some((cell) => cell.logicalGridColumn !== undefined)) return null;
    return {
      kind: 'rightEdge',
      pageIndex: occ.pageIndex,
      sourceRevision: index.sourceRevision,
      tableId: table.tableId,
      rowId: occ.row.id,
      gridColumnId,
      isHeaderRepeat: occ.row.isHeaderRepeat,
      nestingDepth: occ.nestingDepth,
      edgeX: rightEdge,
      sheetY: occ.pageContentBox.y + table.box.y + localY,
    };
  }
  return null;
}

/**
 * Deepest-first table interaction hit at a sheet-space point.
 *
 * Returns the innermost nested table when several overlap.
 */
export function findTableInteractionAt(
  index: TableInteractionIndex,
  sheetX: number,
  sheetY: number,
  layout: SemanticLayout,
  pageOffsetX = 0,
  pageIndexHint?: number
): TableInteractionHit | null {
  const pageIndex = pageIndexHint ?? pageAtY(layout, sheetY);
  const offsetX = pageIndex >= 0 ? pageOffsetX : 0;

  let best: TableInteractionHit | null = null;
  let bestDepth = -1;
  let bestSpecificity = -1;

  const consider = (hit: TableInteractionHit | null): void => {
    if (!hit) return;
    const specificity = HIT_SPECIFICITY[hit.kind];
    if (
      hit.nestingDepth < bestDepth ||
      (hit.nestingDepth === bestDepth && specificity <= bestSpecificity)
    ) {
      return;
    }
    bestDepth = hit.nestingDepth;
    bestSpecificity = specificity;
    best = hit;
  };

  for (const occ of index.occurrences) {
    if (pageIndex >= 0 && occ.pageIndex !== pageIndex) continue;
    const local = tableLocalPoint(layout, occ, sheetX, sheetY, offsetX);
    if (!local) continue;

    consider(
      dividerHit(index, occ, local.x, local.y) ?? {
        kind: 'tableBody',
        pageIndex: occ.pageIndex,
        sourceRevision: index.sourceRevision,
        tableId: occ.table.tableId,
        nestingDepth: occ.nestingDepth,
        editable: occ.editable,
      }
    );

    if (!occ.editable) continue;

    const rowTop = occ.row.box.y - occ.table.box.y;
    if (
      local.x <= INSERT_ROW_BAND_PX &&
      Math.abs(local.y - (rowTop + occ.row.box.height / 2)) <=
        occ.row.box.height / 2 + INSERT_ROW_BAND_PX
    ) {
      consider({
        kind: 'insertRow',
        pageIndex: occ.pageIndex,
        sourceRevision: index.sourceRevision,
        tableId: occ.table.tableId,
        rowId: occ.row.id,
        isHeaderRepeat: occ.row.isHeaderRepeat,
        nestingDepth: occ.nestingDepth,
      });
    }

    for (let col = 0; col < occ.table.columnEdges.length - 1; col += 1) {
      const left = occ.table.columnEdges[col]!;
      const right = occ.table.columnEdges[col + 1]!;
      const midX = (left + right) / 2;
      if (Math.abs(local.x - midX) > (right - left) / 2 + 2) continue;
      if (local.y > INSERT_COLUMN_BAND_PX) continue;
      const gridColumnId = gridColumnIdAt(occ.row, col);
      if (!gridColumnId) continue;
      consider({
        kind: 'insertColumn',
        pageIndex: occ.pageIndex,
        sourceRevision: index.sourceRevision,
        tableId: occ.table.tableId,
        rowId: occ.row.id,
        gridColumnId,
        isHeaderRepeat: occ.row.isHeaderRepeat,
        nestingDepth: occ.nestingDepth,
      });
      break;
    }
  }

  return best;
}
