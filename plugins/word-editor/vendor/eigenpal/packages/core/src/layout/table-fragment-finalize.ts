// Turning a page fragment's placed rows into the rows that get painted.
//
// Everything here runs AFTER placement, on measured geometry: a vertically merged cell's box
// is the extent of the rows its span really covered, `w:vAlign` is re-applied over that box
// rather than over the head's own row, and collapsed borders are resolved once the whole
// grid of the fragment is known. Split out of row layout because the two answer different
// questions — row layout decides what fits, this decides what the result looks like — and
// because a row cannot know its merged neighbour's box until every row of the span is down.

import { shiftInlineDrawingRecord } from './drawing-layout.ts';
import { exactOpeningExtensionPt, exactTerminalBorderPt } from './table-exact-terminal-border.ts';
import { rememberMovableCopy } from './table-row-geometry-reuse.ts';
import { relayOutMergedBottomToTop } from './table-cell-text-direction.ts';
import { separatedCellBorders } from './table-spacing-frame.ts';
import { cellDiagonalRecords } from './table-cell-diagonals.ts';
import { republishAnchoredParagraphsInBlocks } from './table-anchor-republish.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';
import { outerBottomInsetFloor, sharedCellContentInsets } from './cell-content-insets-memo.ts';
import {
  resolveTableCellBorderGrid,
  type BorderGridCell,
  type BorderGridGeometry,
  type TableBorderBox,
  type TableBorderOwnershipBudget,
} from './table-borders.ts';
import {
  resolveVMergeSpans,
  type TableVMergeResolveBudget,
  type TableVMergeResolveWork,
} from './table-vmerge.ts';
import type {
  SemanticTableCell,
  SemanticTableRow,
  SemanticTableStructure,
} from './semantic-table.ts';
import type {
  BlockFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';

/**
 * A complete table fragment moved by `dy`, with the anchored drawings its cell paragraphs
 * already published moved along through `shiftAnchor`.
 */
export function shiftTableFragment(
  fragment: TableFragmentRecord,
  dy: number,
  shiftAnchor: (paragraphId: string, dy: number) => void
): TableFragmentRecord {
  const shifted = shiftBlocks([fragment], dy)[0] as TableFragmentRecord;
  if (Math.abs(dy) <= 0.001) return shifted;
  const shiftParagraphAnchors = (blocks: readonly BlockFragmentRecord[]): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') shiftAnchor(block.paragraphId, dy);
      else
        for (const row of block.rows)
          for (const cell of row.cells) shiftParagraphAnchors(cell.blocks);
    }
  };
  for (const row of fragment.rows) for (const cell of row.cells) shiftParagraphAnchors(cell.blocks);
  return shifted;
}

export function shiftBlocks(
  blocks: readonly BlockFragmentRecord[],
  dy: number
): BlockFragmentRecord[] {
  if (dy === 0) return [...blocks];
  return blocks.map((block) => {
    if (block.kind === 'table') {
      return {
        ...block,
        box: { ...block.box, y: block.box.y + dy },
        rows: block.rows.map((row) => ({
          ...row,
          box: { ...row.box, y: row.box.y + dy },
          cells: row.cells.map((cell) => ({
            ...cell,
            box: { ...cell.box, y: cell.box.y + dy },
            blocks: shiftBlocks(cell.blocks, dy),
          })),
        })),
      };
    }
    return rememberMovableCopy(block, {
      ...block,
      box: { ...block.box, y: block.box.y + dy },
      ...(block.shadingBox
        ? { shadingBox: { ...block.shadingBox, y: block.shadingBox.y + dy } }
        : {}),
      ...(block.bottomBorder
        ? {
            bottomBorder: {
              ...block.bottomBorder,
              box: { ...block.bottomBorder.box, y: block.bottomBorder.box.y + dy },
            },
          }
        : {}),
      // Every `w:pBdr` stroke, not only the bottom one. vAlign moves the whole paragraph
      // down its cell; a frame left at the pre-shift y would sit above the text it encloses.
      ...(block.borders
        ? {
            borders: block.borders.map((strokeRecord) => ({
              ...strokeRecord,
              box: { ...strokeRecord.box, y: strokeRecord.box.y + dy },
            })),
          }
        : {}),
      ...(block.marker
        ? {
            marker: {
              ...block.marker,
              box: { ...block.marker.box, y: block.marker.box.y + dy },
              // The picture bullet shares the marker's coordinate space and moves with it, or
              // a bullet in a bottom-aligned cell paints at the pre-shift origin.
              ...(block.marker.picture
                ? {
                    picture: {
                      ...block.marker.picture,
                      box: { ...block.marker.picture.box, y: block.marker.picture.box.y + dy },
                    },
                  }
                : {}),
            },
          }
        : {}),
      lines: block.lines.map((line) => ({
        ...line,
        box: { ...line.box, y: line.box.y + dy },
        spans: line.spans.map((span) => ({
          ...span,
          box: { ...span.box, y: span.box.y + dy },
        })),
        ...(line.drawings
          ? {
              drawings: line.drawings.map((drawing) => shiftInlineDrawingRecord(drawing, 0, dy)),
            }
          : {}),
      })),
    });
  });
}

/**
 * After all rows of a table fragment are placed: expand vMerge restart boxes, re-apply
 * vAlign over the full span, and publish collapsed border edges.
 */
export function finalizeTableRows(
  rows: readonly TableRowFragmentRecord[],
  structure: SemanticTableStructure,
  sourceRows: readonly SemanticTableRow[],
  ownershipBudget?: TableBorderOwnershipBudget,
  vMergeBudget?: TableVMergeResolveBudget,
  vMergeWork?: TableVMergeResolveWork,
  onAnchorShift?: (paragraphId: string, dy: number) => void,
  anchorDeps?: TableFlowDeps,
  occurrenceInsets?: ReadonlyMap<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>,
  /**
   * Rows taken whole from an earlier finalize of the same rows, with only x geometry changed.
   * Their merges, heights and vertical alignment are already final, so only their borders are
   * resolved again. A row with any merge is finalized as usual.
   */
  settledRows?: ReadonlySet<TableRowFragmentRecord>
): TableRowFragmentRecord[] {
  if (rows.length === 0) return [];

  // Map laid-out cells back to authored structure cells (same order within each row).
  const authoredById = new Map<string, SemanticTableCell>();
  for (const row of sourceRows) {
    for (const cell of row.cells) authoredById.set(cell.id, cell);
  }

  // One-pass column-keyed merge spans — O(cells), not O(rows × columns²). These rows are
  // one PAGE FRAGMENT: a merge whose restart was placed on an earlier page is headed here
  // by its continuation copy, which is why that copy comes back keyed in the span map.
  const mergeSpanById = resolveVMergeSpans(rows, vMergeWork, vMergeBudget, {
    pageFragment: true,
  });

  // Expand restart heights and shift content for vAlign over the full span.
  const settled = (row: TableRowFragmentRecord): boolean =>
    settledRows?.has(row) === true &&
    row.cells.every(
      (cell) =>
        !cell.vMergeContinue && cell.rowSpan === 1 && (mergeSpanById.get(cell.id) ?? 1) === 1
    );
  const expanded: TableRowFragmentRecord[] = rows.map((row, rowIndex) =>
    settled(row)
      ? row
      : {
          ...row,
          cells: row.cells.map((cell) => {
            const resolvedSpan = mergeSpanById.get(cell.id);
            if (cell.vMergeContinue && resolvedSpan === undefined) {
              return { ...cell, paintInert: true, rowSpan: 1, borders: {}, blocks: [] };
            }
            // A carried-in continuation paints like the restart it continues: Word draws the
            // merged cell's rules, fill and box on every page the merge crosses. Its content
            // stayed with the restart on the earlier page, so `blocks` is empty either way.
            const carried = cell.vMergeContinue;
            const span = resolvedSpan ?? 1;
            let height = cell.box.height;
            if (span > 1) {
              const last = rows[rowIndex + span - 1]!;
              height = last.box.y + last.box.height - cell.box.y;
            }
            const authored = authoredById.get(cell.id);
            const terminalIndex = rowIndex + span - 1;
            const terminalSource = sourceRows[terminalIndex];
            const terminalRow = rows[terminalIndex]!;
            const terminalHeight = terminalSource?.height;
            const terminalBudget =
              anchorDeps &&
              terminalSource &&
              !terminalRow.isHeaderRepeat &&
              !terminalRow.isContinuation &&
              terminalHeight?.rule === 'exact' &&
              Math.abs(
                terminalRow.box.height -
                  (terminalHeight.valuePt +
                    exactOpeningExtensionPt(terminalSource, anchorDeps) +
                    exactTerminalBorderPt(terminalSource, anchorDeps))
              ) < 0.001
                ? exactTerminalBorderPt(terminalSource, anchorDeps)
                : 0;
            // A merged `btLr` head lays its text along the rows its merge covers in this fragment.
            let blocks =
              (span > 1 && relayOutMergedBottomToTop(cell.blocks, height)) || cell.blocks;
            // A cell holding floats keeps the alignment its row gave it: its floats stay where
            // they were placed, so the band of its blocks no longer says where the text began.
            const holdsFloats = blocks.some(
              (block) => block.kind === 'table' && block.floatingWrap
            );
            if (authored && authored.vAlign !== 'top' && blocks.length > 0 && !holdsFloats) {
              const insets =
                occurrenceInsets?.get(row)?.get(cell.id) ??
                sharedCellContentInsets(authored, structure.cellSpacingPt === 0);
              // Content was placed relative to the first row; measure current content band.
              let contentTop = Number.POSITIVE_INFINITY;
              let contentBottom = Number.NEGATIVE_INFINITY;
              for (const block of blocks) {
                contentTop = Math.min(contentTop, block.box.y);
                contentBottom = Math.max(contentBottom, block.box.y + block.box.height);
              }
              if (Number.isFinite(contentTop) && Number.isFinite(contentBottom)) {
                const vertical = authored.textDirection === 'btLr';
                const available =
                  (vertical
                    ? cell.box.width - insets.left - insets.right
                    : height -
                      terminalBudget -
                      insets.top -
                      (terminalBudget > 0 ? authored.margins.bottom : insets.bottom)) -
                  (contentBottom - contentTop);
                // Reset any per-row shift by measuring from cell top + inset.
                const desiredTop =
                  cell.box.y +
                  (vertical ? insets.left : insets.top) +
                  (available > 0 ? (authored.vAlign === 'center' ? available / 2 : available) : 0);
                const dy = desiredTop - contentTop;
                if (Math.abs(dy) > 0.001) {
                  blocks = shiftBlocks(blocks, dy);
                  for (const block of blocks) {
                    if (block.kind === 'paragraph') onAnchorShift?.(block.paragraphId, dy);
                  }
                }
              }
            }
            const finalizedCellBox = Object.freeze({
              x: cell.box.x,
              y: cell.box.y,
              width: cell.box.width,
              height,
            });
            if (
              authored &&
              anchorDeps &&
              (span > 1 || (authored.vAlign !== 'top' && blocks.length > 0))
            ) {
              const insets =
                occurrenceInsets?.get(row)?.get(cell.id) ??
                sharedCellContentInsets(authored, structure.cellSpacingPt === 0);
              const cellContentBox = {
                x: finalizedCellBox.x + insets.left,
                y: finalizedCellBox.y + insets.top,
                width: Math.max(1, finalizedCellBox.width - insets.left - insets.right),
                height: Math.max(0, finalizedCellBox.height - insets.top - insets.bottom),
              };
              republishAnchoredParagraphsInBlocks(
                blocks,
                authored.blocks,
                finalizedCellBox,
                anchorDeps,
                cellContentBox
              );
            }
            return {
              ...cell,
              ...(carried ? { vMergeContinue: false, paintInert: false } : {}),
              rowSpan: span,
              blocks,
              box: { ...cell.box, height },
            };
          }),
        }
  );

  // A spaced table's cells draw their own whole boxes (`table-spacing-frame.ts`).
  if (structure.cellSpacingPt > 0) return withSeparatedCellBorders(expanded, authoredById);

  // Border grid from authored structure (same row/cell order as laid-out fragment rows).
  // Header repeats use the same authored header row; match by cell id.
  const gridRows: BorderGridCell[][] = expanded.map((row) =>
    row.cells.map((cell) => {
      const authored = authoredById.get(cell.id);
      return {
        gridColumn: cell.gridColumn,
        gridSpan: cell.gridSpan,
        vMergeContinue: cell.vMergeContinue,
        borders: authored?.borders ?? {
          top: { state: 'omitted' as const },
          left: { state: 'omitted' as const },
          bottom: { state: 'omitted' as const },
          right: { state: 'omitted' as const },
        },
        mergeRowSpan: cell.rowSpan ?? 1,
        ...(authored?.rowTableBorders ? { rowTableBorders: authored.rowTableBorders } : {}),
      };
    })
  );

  const columnCount = structure.columnWidthsPt.length;
  const tableBorders: TableBorderBox = structure.tableBorders;
  const geometry: BorderGridGeometry = {
    collapsedHorizontal: structure.cellSpacingPt === 0,
    columnWidthsPt: structure.columnWidthsPt,
    rowBands: expanded.map((row) => ({ y: row.box.y, height: row.box.height })),
    cellBoxes: expanded.map((row, rowIndex) =>
      row.cells.map((cell) => {
        const authored = authoredById.get(cell.id);
        const insets =
          authored &&
          (occurrenceInsets?.get(rows[rowIndex]!)?.get(cell.id) ??
            sharedCellContentInsets(authored, structure.cellSpacingPt === 0));
        // Split/merged occurrences can decline the terminal re-probe. Do not move their
        // stroke into content until admission has reserved the complete outer inset.
        const outerBottomInsetReserved =
          authored && insets
            ? insets.bottom >=
              outerBottomInsetFloor(
                authored,
                (authored.rowTableBorders ?? structure.tableBorders).bottom
              ) -
                0.001
            : false;
        return {
          width: cell.box.width,
          height: cell.box.height,
          outerBottomInsetReserved,
          centeredSideRules: authored?.centeredSideRules === true && structure.cellSpacingPt === 0,
          centeredSidePaint: authored?.centeredSidePaint === true && structure.cellSpacingPt === 0,
        };
      })
    ),
  };
  const resolved = resolveTableCellBorderGrid(
    gridRows,
    tableBorders,
    columnCount,
    geometry,
    undefined,
    ownershipBudget
  );

  return expanded.map((row, rowIndex) => ({
    ...row,
    cells: row.cells.map((cell, cellIndex) => {
      if (paintsNothing(cell)) return inertCell(cell);
      return { ...cell, borders: resolved[rowIndex]![cellIndex]! };
    }),
  }));
}

function withSeparatedCellBorders(
  rows: readonly TableRowFragmentRecord[],
  authoredById: ReadonlyMap<string, SemanticTableCell>
): TableRowFragmentRecord[] {
  return rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => {
      if (paintsNothing(cell)) return inertCell(cell);
      const authored = authoredById.get(cell.id);
      const sides = authored?.contentBorders ?? authored?.borders;
      const { width, height } = cell.box;
      const borders = sides ? separatedCellBorders(sides, width, height) : {};
      const diagonals = authored ? cellDiagonalRecords(authored.borders, width, height) : [];
      return { ...cell, borders: diagonals.length > 0 ? { ...borders, diagonals } : borders };
    }),
  }));
}

type FragmentCell = TableRowFragmentRecord['cells'][number];

/** A merged-over or continued cell: it keeps its box but paints no borders of its own. */
const paintsNothing = (cell: FragmentCell): boolean =>
  cell.paintInert === true || cell.vMergeContinue === true;

const inertCell = (cell: FragmentCell): FragmentCell => ({
  ...cell,
  borders: {},
  paintInert: true,
});

/** A row fragment whose rest continues on the next page: the head of a split row. */
export function splitHead(record: TableRowFragmentRecord): TableRowFragmentRecord {
  return { ...record, hasContinuation: true };
}
