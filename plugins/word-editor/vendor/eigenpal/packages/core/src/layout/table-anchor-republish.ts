// Anchored drawings inside a table row, and the two-pass problem they create.
//
// A `wp:anchor` inside a cell is positioned against the row it sits in, and a row's height
// is only known once every cell has flowed. So the anchors a cell publishes while it flows
// are DEFERRED, then republished against the finished row box — and any paragraph fragment
// the row moved has to be republished with them, or the drawing keeps the geometry of a row
// that no longer exists.
//
// Lifted out of `semantic-table-layout.ts` whole: it is one self-contained concern and that
// file is at its line ceiling.

import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';
import { cellAnchorScope } from './cell-anchor-layout.ts';
import {
  anchoredDrawingAtomsInParagraph,
  publishAnchoredDrawingsForParagraph,
} from './drawing-layout.ts';
import type {
  AnchoredDrawingRecord,
  BlockFragmentRecord,
  LayoutBox,
  LineRecord,
  TableCellFragmentRecord,
} from './semantic-records.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';

export function anchorPublishSink(
  deps: TableFlowDeps
): ((drawings: readonly AnchoredDrawingRecord[]) => void) | undefined {
  return deps.publishAnchoredDrawings ?? deps.collectAnchoredDrawings;
}

export type DeferredRowAnchor = {
  readonly paragraph: OoxmlNode;
  readonly paragraphId: string;
  readonly paragraphBox: LayoutBox;
  readonly lines: readonly LineRecord[];
  readonly cellOriginX: number;
  readonly cellContentWidth: number;
};

/**
 * Where the text area of a flowed cell starts and how far its bottom margin reaches up, by
 * cell id: what positions an object laid out in the cell against its margins.
 */
export type CellTextAreas = ReadonlyMap<string, { readonly top: number; readonly bottom: number }>;

/** The text areas of a row's flowed cells. A bottom-to-top cell keeps its whole box. */
export function cellTextAreas(
  flowed: readonly {
    readonly cell: { readonly id: string; readonly textDirection?: string };
    readonly contentTop: number;
    readonly insets: { readonly bottom: number };
  }[]
): CellTextAreas {
  const areas = new Map<string, { readonly top: number; readonly bottom: number }>();
  for (const entry of flowed) {
    if (entry.cell.textDirection === 'btLr') continue;
    areas.set(entry.cell.id, { top: entry.contentTop, bottom: entry.insets.bottom });
  }
  return areas;
}

export function publishDeferredRowAnchors(
  deferredRowAnchors: readonly DeferredRowAnchor[],
  cells: readonly TableCellFragmentRecord[],
  rowTop: number,
  rowHeight: number,
  deps: TableFlowDeps,
  textAreas?: CellTextAreas
): void {
  const publish = anchorPublishSink(deps);
  if (
    deferredRowAnchors.length === 0 ||
    !publish ||
    !deps.inlineDrawingLayout ||
    !deps.anchorFrameBase ||
    !deps.pageContentClip
  ) {
    return;
  }
  for (const pending of deferredRowAnchors) {
    let paragraphBox: LayoutBox | null = null;
    let cellFrameBox: LayoutBox | null = null;
    let cellId: string | null = null;
    let lines: readonly LineRecord[] = pending.lines;
    for (const cell of cells) {
      for (const block of cell.blocks) {
        if (block.kind === 'paragraph' && block.paragraphId === pending.paragraphId) {
          paragraphBox = block.box;
          lines = block.lines;
          cellFrameBox = cell.box;
          cellId = cell.id;
          break;
        }
      }
      if (paragraphBox) break;
    }
    if (!paragraphBox) continue;
    const cellBox =
      cellFrameBox ??
      Object.freeze({
        x: pending.cellOriginX,
        y: rowTop,
        width: pending.cellContentWidth,
        height: rowHeight,
      });
    const area = cellId === null ? undefined : textAreas?.get(cellId);
    const contentTop = area?.top ?? cellBox.y;
    const contentBottom = cellBox.y + cellBox.height - (area?.bottom ?? 0);
    publish(
      publishAnchoredDrawingsForParagraph({
        paragraph: pending.paragraph,
        paragraphId: pending.paragraphId,
        paragraphBox,
        lines,
        drawingLayout: deps.inlineDrawingLayout,
        frameBase: deps.anchorFrameBase(),
        columnBox: deps.columnBoxForParagraph?.(paragraphBox) ?? paragraphBox,
        cellBox,
        cellContentBox: {
          x: pending.cellOriginX,
          y: contentTop,
          width: pending.cellContentWidth,
          height: Math.max(0, contentBottom - contentTop),
        },
        pageClip: deps.pageContentClip(),
        cellAnchorScope: cellAnchorScope(true, deps),
        measurer: deps.measurer,
        ...(deps.hostedStory ? { layoutTextboxStory: deps.hostedStory.layoutTextboxStoryFor } : {}),
        ...(deps.displayMode ? { displayMode: deps.displayMode } : {}),
        ...(deps.revisionAuthorFilter ? { revisionAuthorFilter: deps.revisionAuthorFilter } : {}),
      })
    );
  }
}

export function republishAnchoredParagraphsInBlocks(
  blocks: readonly BlockFragmentRecord[],
  authoredBlocks: readonly OoxmlElement[],
  cellBox: LayoutBox,
  deps: TableFlowDeps,
  cellContentBox: LayoutBox
): void {
  if (
    !deps.onAnchorRepublish ||
    !deps.inlineDrawingLayout ||
    !deps.anchorFrameBase ||
    !deps.pageContentClip
  ) {
    return;
  }
  for (const block of blocks) {
    if (block.kind !== 'paragraph') continue;
    const paragraph = authoredBlocks.find(
      (candidate) => candidate.kind === 'paragraph' && candidate.id === block.paragraphId
    );
    if (!paragraph || paragraph.kind !== 'paragraph') continue;
    const atoms = anchoredDrawingAtomsInParagraph(paragraph, deps.inlineDrawingLayout);
    if (atoms.length === 0) continue;
    deps.onAnchorRepublish(
      block.paragraphId,
      publishAnchoredDrawingsForParagraph({
        paragraph,
        paragraphId: block.paragraphId,
        paragraphBox: block.box,
        lines: block.lines,
        drawingLayout: deps.inlineDrawingLayout,
        frameBase: deps.anchorFrameBase(),
        columnBox: deps.columnBoxForParagraph?.(block.box) ?? block.box,
        cellBox,
        cellContentBox,
        pageClip: deps.pageContentClip(),
        cellAnchorScope: cellAnchorScope(true, deps),
        measurer: deps.measurer,
        ...(deps.hostedStory ? { layoutTextboxStory: deps.hostedStory.layoutTextboxStoryFor } : {}),
        ...(deps.displayMode ? { displayMode: deps.displayMode } : {}),
        ...(deps.revisionAuthorFilter ? { revisionAuthorFilter: deps.revisionAuthorFilter } : {}),
      })
    );
  }
}

export function rowDepsForAnchors(
  deps: TableFlowDeps,
  deferredRowAnchors: DeferredRowAnchor[]
): {
  readonly rowDeps: TableFlowDeps;
  readonly flushDeferred: (
    cells: readonly TableCellFragmentRecord[],
    rowTop: number,
    rowHeight: number,
    textAreas?: CellTextAreas
  ) => void;
} {
  const publishAnchoredDrawings = anchorPublishSink(deps);
  const parentDefer = deps.deferAnchoredDrawings;
  if (!publishAnchoredDrawings && !parentDefer) {
    return { rowDeps: deps, flushDeferred: () => {} };
  }
  const rowDeps: TableFlowDeps = {
    ...deps,
    publishAnchoredDrawings,
    collectAnchoredDrawings: undefined,
    deferAnchoredDrawings: (pending) => {
      deferredRowAnchors.push(pending);
    },
  };
  const flushDeferred = (
    cells: readonly TableCellFragmentRecord[],
    rowTop: number,
    rowHeight: number,
    textAreas?: CellTextAreas
  ): void => {
    if (deferredRowAnchors.length === 0) return;
    if (publishAnchoredDrawings && !deps.anchorDeferOnly) {
      publishDeferredRowAnchors(deferredRowAnchors, cells, rowTop, rowHeight, deps, textAreas);
    } else if (parentDefer) {
      for (const pending of deferredRowAnchors) parentDefer(pending);
    }
    deferredRowAnchors.length = 0;
  };
  return { rowDeps, flushDeferred };
}
