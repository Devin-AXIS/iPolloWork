// Where a selected drawing's frame sits on the published layout: the box a selection overlay
// rings, in page-content points, found from layout records without reading painted DOM.

import type { InlineDrawingRecord, AnchoredDrawingRecord } from './drawing-layout.ts';
import type {
  BlockFragmentRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
} from './semantic-records.ts';
import { headerFooterAnchoredDrawingOrigin } from './header-footer-drawing-origin.ts';
import { turnedShapeBounds } from './vector-shape-hit.ts';

/**
 * The box a drawing's frame rings, in the record's coordinates: its painted box, or for a
 * turned shape the upright box its extent covers once turned about its centre. A quarter-turned
 * line keeps a thin frame; a line at another angle gets the box around it.
 */
function frameBounds(record: InlineDrawingRecord | AnchoredDrawingRecord) {
  return turnedShapeBounds(record) ?? record.paintBounds;
}

/** Page-content overlay rectangle for a drawing's painted extent. */
export interface DrawingOverlayFrame {
  readonly pageIndex: number;
  /** Relative to {@link PageRecord.contentBox}. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly record: InlineDrawingRecord | AnchoredDrawingRecord;
}

/**
 * Whether a drawing's painted box can carry a selection frame. A straight line has no height
 * or no width and stays selectable: its hit test reaches past its path.
 */
function selectableBounds(record: InlineDrawingRecord | AnchoredDrawingRecord): boolean {
  const { width, height } = record.paintBounds;
  if (!(width >= 0) || !(height >= 0)) return false;
  return (width > 0 && height > 0) || !!record.vectorShape;
}

function overlayFrameOf(
  pageIndex: number,
  record: InlineDrawingRecord | AnchoredDrawingRecord
): DrawingOverlayFrame | null {
  const bounds = frameBounds(record);
  if (!selectableBounds(record) || record.accessibility.hidden) return null;
  return Object.freeze({
    pageIndex,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    record,
  });
}

function findDrawingInParagraphFragment(
  pageIndex: number,
  fragment: ParagraphFragmentRecord,
  drawingNodeId: string
): DrawingOverlayFrame | null {
  for (const line of fragment.lines) {
    for (const drawing of line.drawings ?? []) {
      if (drawing.drawingNodeId === drawingNodeId) return overlayFrameOf(pageIndex, drawing);
    }
  }
  return null;
}

function findDrawingInBlock(
  pageIndex: number,
  block: BlockFragmentRecord,
  drawingNodeId: string
): DrawingOverlayFrame | null {
  if (block.kind === 'paragraph') {
    return findDrawingInParagraphFragment(pageIndex, block, drawingNodeId);
  }
  for (const row of block.rows) {
    for (const cell of row.cells) {
      for (const inner of cell.blocks) {
        const found = findDrawingInBlock(pageIndex, inner, drawingNodeId);
        if (found) return found;
      }
    }
  }
  return null;
}

function findDrawingInFragments(
  pageIndex: number,
  fragments: readonly BlockFragmentRecord[],
  drawingNodeId: string
): DrawingOverlayFrame | null {
  for (const fragment of fragments) {
    const found = findDrawingInBlock(pageIndex, fragment, drawingNodeId);
    if (found) return found;
  }
  return null;
}

/**
 * Locate a drawing's painted extent on the published layout.
 *
 * Coordinates are page-content relative — the same space {@link hitTestPage} uses — so an
 * overlay can position from records without reading painted DOM geometry. A header or footer
 * drawing repeats on every page of its section; `preferPage` names the occurrence to use.
 */
export function findDrawingOverlayFrameInLayout(
  layout: SemanticLayout,
  drawingNodeId: string,
  preferPage?: number
): DrawingOverlayFrame | null {
  const preferred = preferPage === undefined ? undefined : layout.pages[preferPage];
  for (const page of preferred ? [preferred, ...layout.pages] : layout.pages) {
    for (const drawing of page.anchoredDrawings ?? []) {
      if (drawing.drawingNodeId === drawingNodeId) return overlayFrameOf(page.index, drawing);
    }
    const body = findDrawingInFragments(page.index, page.fragments, drawingNodeId);
    if (body) return body;
    for (const story of [page.header, page.footer]) {
      if (!story) continue;
      for (const drawing of story.anchoredDrawings ?? []) {
        if (drawing.drawingNodeId !== drawingNodeId) continue;
        const bounds = frameBounds(drawing);
        if (!selectableBounds(drawing) || drawing.accessibility.hidden) return null;
        // A page-relative axis resolves against the page, a story-relative one against the
        // story box, exactly as the furniture layer paints it.
        const origin = headerFooterAnchoredDrawingOrigin(drawing, story.box, page.box);
        return Object.freeze({
          pageIndex: page.index,
          x: origin.x + bounds.x - drawing.x - page.contentBox.x,
          y: origin.y + bounds.y - drawing.y - page.contentBox.y,
          width: bounds.width,
          height: bounds.height,
          record: drawing,
        });
      }
      const furniture = findDrawingInFragments(page.index, story.fragments, drawingNodeId);
      if (furniture) {
        const bounds = frameBounds(furniture.record);
        return Object.freeze({
          pageIndex: page.index,
          x:
            page.header?.box.x === story.box.x || page.footer?.box.x === story.box.x
              ? story.box.x + bounds.x - page.contentBox.x
              : furniture.x,
          y: story.box.y + bounds.y - page.contentBox.y,
          width: furniture.width,
          height: furniture.height,
          record: furniture.record,
        });
      }
    }
  }
  return null;
}
