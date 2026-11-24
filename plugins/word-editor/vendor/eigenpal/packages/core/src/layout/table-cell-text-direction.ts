import { paragraphFragmentsOfBlocks } from './semantic-records.ts';
import type {
  BlockFragmentRecord,
  LayoutBox,
  PageRecord,
  SemanticLayout,
  TableCellFragmentRecord,
  TableFragmentRecord,
} from './semantic-records.ts';
import type { CaretGeometry } from './semantic-interaction.ts';
import type { CellPlaceCursor } from './semantic-table-layout.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';
import { authoredRowMinimumFloorPt, type RowMinimumInsetMap } from './table-row-minimum-insets.ts';
import type { SemanticTableCell, SemanticTableRow } from './semantic-table.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';

/**
 * Whether a `btLr` cell lays out its text only after its row has a final height.
 *
 * `btLr` text runs along the row, so its line length is the row height less the cell's top
 * and bottom margins. The text never sizes the row: horizontal cells, `w:trHeight` and merge
 * spans do, and a row that nothing else sizes takes its end-of-cell paragraphs. Text that
 * the cell width cannot hold is clipped and never continues on another fragment. A merge
 * head lays out again along its merged box once its fragment is final
 * (`relayOutMergedBottomToTop`).
 */
export function waitsForRowHeight(cell: SemanticTableCell): boolean {
  return cell.textDirection === 'btLr' && !cell.vMergeContinue;
}

/** A cell's line span (`flowLeft`..`flowRight`) and block span (`contentTop`..). */
interface CellFlowBox {
  readonly flowLeft: number;
  readonly flowRight: number;
  readonly contentTop: number;
  readonly contentMaxBottom: number;
}

/**
 * Where a cell's content flows. `btLr` lines run along the row from its bottom inset, and
 * lines stack across the cell width. `maxBottom` bounds the row, so it sets the line length.
 */
export function cellFlowBox(
  vertical: boolean,
  x: number,
  width: number,
  rowTop: number,
  maxBottom: number,
  insets: CellContentInsets
): CellFlowBox {
  return vertical
    ? {
        flowLeft: x + insets.bottom,
        flowRight: x + Math.max(0, maxBottom - rowTop) - insets.top,
        contentTop: rowTop + insets.left,
        contentMaxBottom: rowTop + width - insets.right,
      }
    : {
        flowLeft: x + insets.left,
        flowRight: x + width - insets.right,
        contentTop: rowTop + insets.top,
        contentMaxBottom: maxBottom - insets.bottom,
      };
}

interface WaitingCellFlow {
  readonly blocks: readonly BlockFragmentRecord[];
  readonly bottom: number;
  readonly fitted: boolean;
}

/** One row entry as the row layout keeps it; `flowTo` is set while its `btLr` text waits. */
interface WaitingCellEntry {
  readonly cell: SemanticTableCell;
  readonly x: number;
  readonly insets: { readonly top: number };
  readonly blocks: readonly BlockFragmentRecord[];
  readonly contentBottom: number;
  readonly fitted: boolean;
  readonly nextCursor: CellPlaceCursor;
  readonly flowTo?: (right: number, relayout?: boolean) => WaitingCellFlow;
}

/**
 * Lay out every waiting `btLr` cell along the finished row height, in place. Each cell's
 * cursor then moves past its last block: text that the cell width cannot hold is clipped
 * and never continues on the next fragment. Returns whether any cell placed a line.
 */
export function layOutWaitingBottomToTopCells<T extends WaitingCellEntry>(
  entries: T[],
  rowHeight: number
): boolean {
  let fitted = false;
  for (const [index, entry] of entries.entries()) {
    if (!entry.flowTo) continue;
    const flow = entry.flowTo(entry.x + rowHeight - entry.insets.top);
    fitted ||= flow.fitted;
    entries[index] = {
      ...entry,
      blocks: flow.blocks,
      contentBottom: flow.bottom,
      fitted: flow.fitted,
      nextCursor: finishedCellCursor(entry.cell),
    };
  }
  return fitted;
}

/**
 * Lays a `btLr` cell out again along a longer box, keyed by the blocks array its row record
 * carries. Finalize copies a cell record but keeps that array, and the entry goes away with
 * the record, so a layout that is dropped leaves nothing behind.
 */
const bottomToTopRelayouts = new WeakMap<
  readonly BlockFragmentRecord[],
  (heightPt: number) => readonly BlockFragmentRecord[]
>();

/** Remember how to lay out each waiting `btLr` cell of a placed row along a taller box. */
export function rememberBottomToTopRelayouts(
  entries: readonly WaitingCellEntry[],
  cells: readonly TableCellFragmentRecord[]
): void {
  entries.forEach((entry, index) => {
    const flowTo = entry.flowTo;
    const cell = cells[index];
    if (!flowTo || !cell) return;
    bottomToTopRelayouts.set(
      cell.blocks,
      (heightPt) => flowTo(entry.x + heightPt - entry.insets.top, true).blocks
    );
  });
}

/**
 * The blocks of a merged `btLr` head laid along `heightPt`, the height of the rows its merge
 * really covers in this fragment, or `undefined` when the cell is not a waiting `btLr` cell.
 * Only these rows bound the text, so it never runs past its table fragment or its header
 * group, and a row that moved to the next page does not lend the head its height.
 */
export function relayOutMergedBottomToTop(
  blocks: readonly BlockFragmentRecord[],
  heightPt: number
): readonly BlockFragmentRecord[] | undefined {
  return bottomToTopRelayouts.get(blocks)?.(heightPt);
}

/** A cursor past the last block, so a waiting `btLr` cell adds nothing to later fragments. */
function finishedCellCursor(cell: SemanticTableCell): CellPlaceCursor {
  return {
    blockIndex: cell.blocks.length,
    lineIndex: 0,
    previousSpaceAfter: 0,
    paragraphFragmentIndex: 0,
    precededByEmittedTable: false,
  };
}

/**
 * Whether `btLr` text keeps its row whole when a fresh page can hold the row.
 *
 * A split at a page end gives the text only that page's share of the row as its line
 * length and clips the rest. A row that only end marks size moves whole. A row with an
 * authored minimum moves whole when that minimum, padded by the row's margins, does not fit
 * `roomPt`; when it fits, the row splits like any other. A row no page can hold still splits.
 */
export function bottomToTopTextKeepsRowWhole(
  row: SemanticTableRow,
  roomPt: number,
  insetsOf: (cell: SemanticTableCell) => CellContentInsets,
  minimumInsets?: RowMinimumInsetMap
): boolean {
  if (row.height.rule === 'exact') return false;
  if (!row.cells.some((cell) => waitsForRowHeight(cell))) return false;
  if (row.cells.every((cell) => cell.vMergeContinue || cell.textDirection === 'btLr')) return true;
  if (row.height.rule !== 'atLeast') return false;
  const cells = row.cells.map((cell) => ({ cell, insets: insetsOf(cell) }));
  return authoredRowMinimumFloorPt(row.height.valuePt, cells, minimumInsets) > roomPt + 0.001;
}

/** Supported `w:textDirection` value, with horizontal layout as the safe default. */
export function readCellTextDirection(
  cellProperties: OoxmlElement | undefined
): 'horizontal' | 'btLr' {
  const node = cellProperties?.children.find(
    (child) => child.kind !== 'textValue' && child.localName === 'textDirection'
  );
  if (!node || node.kind === 'textValue') return 'horizontal';
  const value = node?.attributes.find((attribute) => attribute.localName === 'val')?.value;
  return value === 'btLr' ? 'btLr' : 'horizontal';
}

/** Map a sheet point into the horizontal local plane used to lay out `btLr` content. */
export function pointInBottomToTopCell(point: LayoutBoxPoint, cell: LayoutBox): LayoutBoxPoint {
  return {
    x: cell.x + cell.height - (point.y - cell.y),
    y: cell.y + (point.x - cell.x),
  };
}

interface BottomToTopCellLocation {
  readonly pageIndex: number;
  readonly cell: TableCellFragmentRecord;
}

const locationsByLayout = new WeakMap<
  SemanticLayout,
  ReadonlyMap<string, readonly BottomToTopCellLocation[]>
>();
const bottomToTopCarets = new WeakSet<CaretGeometry>();

const locationsByPage = new WeakMap<
  PageRecord,
  readonly {
    readonly paragraphId: string;
    readonly cell: TableCellFragmentRecord;
  }[]
>();

/**
 * Table fragments with no `btLr` cell in any row, repeated header rows and nested tables
 * included. Such a fragment adds no location, so the scan below skips its rows. Records are
 * never changed after placement, so the answer holds for the object; the set holds nothing.
 */
const horizontalTables = new WeakSet<TableFragmentRecord>();

/**
 * Record that `fragment` has no `btLr` cell at any depth. Only for a caller that proved it:
 * the table width update, whose structures admit horizontal cells holding paragraphs only.
 */
export function markHorizontalTableFragment(fragment: TableFragmentRecord): void {
  horizontalTables.add(fragment);
}

let scanObserver: { walked: number; skipped: number; skipOff: boolean } | null = null;

/**
 * @internal Counts table fragments whose rows the location scan walked or skipped.
 * `skipOff` walks every fragment, so tests can compare against the full scan.
 */
export function bottomToTopScanTestRecorder(options: { readonly skipOff?: boolean } = {}): {
  readonly walked: number;
  readonly skipped: number;
  dispose(): void;
} {
  const counts = { walked: 0, skipped: 0, skipOff: options.skipOff === true };
  scanObserver = counts;
  return {
    get walked() {
      return counts.walked;
    },
    get skipped() {
      return counts.skipped;
    },
    dispose() {
      if (scanObserver === counts) scanObserver = null;
    },
  };
}

function pageBottomToTopLocations(page: PageRecord) {
  const cached = locationsByPage.get(page);
  if (cached) return cached;
  const found: { paragraphId: string; cell: TableCellFragmentRecord }[] = [];
  /** Adds the locations in `blocks`; true when some table in them has a `btLr` cell. */
  const visit = (blocks: readonly BlockFragmentRecord[]): boolean => {
    let vertical = false;
    for (const block of blocks) {
      if (block.kind !== 'table') continue;
      if (horizontalTables.has(block) && !scanObserver?.skipOff) {
        if (scanObserver) scanObserver.skipped += 1;
        continue;
      }
      if (scanObserver) scanObserver.walked += 1;
      let blockVertical = false;
      for (const row of block.rows)
        for (const cell of row.cells) {
          if (cell.textDirection === 'btLr') {
            blockVertical = true;
            for (const paragraph of paragraphFragmentsOfBlocks(cell.blocks))
              found.push({ paragraphId: paragraph.paragraphId, cell });
          } else if (visit(cell.blocks)) blockVertical = true;
        }
      // Every row and cell was read, nested tables included: the walk itself is the proof.
      if (blockVertical) vertical = true;
      else horizontalTables.add(block);
    }
    return vertical;
  };
  visit(page.fragments);
  if (page.header) visit(page.header.fragments);
  if (page.footer) visit(page.footer.fragments);
  for (const area of [page.footnotes, page.endnotes]) {
    if (!area) continue;
    if (area.separator) visit(area.separator.fragments);
    if (area.continuationNotice) visit(area.continuationNotice.fragments);
    for (const note of area.notes) visit(note.fragments);
  }
  locationsByPage.set(page, found);
  return found;
}

function bottomToTopLocations(
  layout: SemanticLayout
): ReadonlyMap<string, readonly BottomToTopCellLocation[]> {
  const cached = locationsByLayout.get(layout);
  if (cached) return cached;
  const found = new Map<string, BottomToTopCellLocation[]>();
  for (const page of layout.pages) {
    for (const { paragraphId, cell } of pageBottomToTopLocations(page)) {
      let locations = found.get(paragraphId);
      if (!locations) found.set(paragraphId, (locations = []));
      locations.push({ pageIndex: page.index, cell });
    }
  }
  locationsByLayout.set(layout, found);
  return found;
}

function locationFor(
  layout: SemanticLayout,
  pageIndex: number,
  paragraphId: string
): BottomToTopCellLocation | undefined {
  const locations = bottomToTopLocations(layout).get(paragraphId) ?? [];
  return locations.find((location) => location.pageIndex === pageIndex) ?? locations[0];
}

/** Rotate virtual horizontal caret geometry into its painted table-cell plane. */
export function bottomToTopCaretInLayout(
  layout: SemanticLayout,
  caret: CaretGeometry
): CaretGeometry {
  const location = locationFor(layout, caret.pageIndex, caret.position.paragraphId);
  if (!location) return caret;
  const point = pointFromBottomToTopCell(caret, location.cell.box);
  const transformed = { ...caret, ...point };
  bottomToTopCarets.add(transformed);
  return transformed;
}

/** Whether caret paint must follow the `btLr` plane used for its geometry. */
export function isBottomToTopCaret(caret: CaretGeometry): boolean {
  return bottomToTopCarets.has(caret);
}

/** Rotate one virtual selection band into page-content coordinates. */
export function bottomToTopRectInLayout<T extends LayoutBox & { readonly pageIndex: number }>(
  layout: SemanticLayout,
  paragraphId: string,
  rect: T
): T {
  const location = locationFor(layout, rect.pageIndex, paragraphId);
  if (!location) return rect;
  const cell = location.cell.box;
  return {
    ...rect,
    x: cell.x + (rect.y - cell.y),
    y: cell.y + cell.height - (rect.x - cell.x) - rect.width,
    width: rect.height,
    height: rect.width,
  };
}

function pointFromBottomToTopCell(point: LayoutBoxPoint, cell: LayoutBox): LayoutBoxPoint {
  return {
    x: cell.x + (point.y - cell.y),
    y: cell.y + cell.height - (point.x - cell.x),
  };
}

export interface LayoutBoxPoint {
  readonly x: number;
  readonly y: number;
}
