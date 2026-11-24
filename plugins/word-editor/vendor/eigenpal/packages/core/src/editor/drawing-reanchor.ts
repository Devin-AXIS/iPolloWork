// A floating drawing moved on its page takes the paragraph under its new top as its anchor.
// The anchor decides which text wraps: a drawing dragged above its anchor paragraph still
// left the text between the drop point and the anchor running under it. The move is one
// transaction (delete, then insert at the target paragraph's start with the new position),
// so it is one undo step and syncs as ordinary drawing ops.

import type { DrawingPositionInput } from '../store/package/drawing-projection.ts';
import type { OoxmlDrawingNode, OoxmlNode } from '../store/package/ooxml-tree.ts';
import { findNode, parentNodeOf } from '../store/package/ooxml-edit.ts';
import { drawingAnchorLocked, drawingWithPosition } from '../store/store/tree-op-drawings.ts';
import type { DrawingTreeDocOp } from '../store/store/tree-op-types.ts';
import type { AnchoredDrawingRecord } from '../layout/drawing-layout.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

const EMU_PER_POINT = 12_700;

/** The vertical frames whose origin does not depend on the anchor paragraph. */
const PAGE_FRAMES: ReadonlySet<string> = new Set([
  'page',
  'margin',
  'topMargin',
  'bottomMargin',
  'insideMargin',
  'outsideMargin',
]);

/** What a re-anchor needs: the drawing's ops and the paragraph that will hold it. */
export interface DrawingReanchorPlan {
  readonly ops: readonly DrawingTreeDocOp[];
  readonly paragraphId: string;
  readonly previousDrawingIds: ReadonlySet<string>;
}

function drawingIdsIn(node: OoxmlNode, into: Set<string>): Set<string> {
  if (node.kind === 'drawing') into.add(node.id);
  if ('children' in node) for (const child of node.children) drawingIdsIn(child, into);
  return into;
}

/** Whether the drawing sits directly in a run, with no fallback wrapper or text box story. */
function plainRunDrawing(surface: PaginatedSurface, drawing: OoxmlNode): boolean {
  const part = surface.session.part();
  const parent = parentNodeOf(part, drawing.id);
  if (!parent || parent.kind !== 'run') return false;
  let textbox = false;
  const walk = (node: OoxmlNode): void => {
    if (textbox) return;
    if (node.kind !== 'textValue' && node.localName === 'txbxContent') textbox = true;
    else if ('children' in node) node.children.forEach(walk);
  };
  walk(drawing);
  return !textbox;
}

function recordOf(surface: PaginatedSurface, drawingNodeId: string) {
  const pages = surface.layout().pages;
  for (const page of pages) {
    const record = page.anchoredDrawings?.find((d) => d.drawingNodeId === drawingNodeId);
    if (record) return { page, record };
  }
  return null;
}

/** The new top of the drawing's frame, in page points, or null when it cannot be known. */
function newTopOf(record: AnchoredDrawingRecord, position: DrawingPositionInput): number | null {
  if (position.mode !== 'frame' || position.verticalEmu === undefined) return null;
  if (position.relativeToV !== undefined && position.relativeToV !== record.verticalFrame)
    return null;
  return record.verticalFrameOrigin + position.verticalEmu / EMU_PER_POINT;
}

/**
 * The ops that move a floating body drawing to the paragraph under its new top, with
 * `position` adjusted to the new paragraph. Null keeps the anchor: a locked anchor, a
 * line-relative or character-relative frame, a drawing in a table or another story, a target
 * that starts on another page, or the same paragraph.
 */
export function planDrawingReanchor(
  surface: PaginatedSurface,
  drawingNodeId: string,
  position: DrawingPositionInput
): DrawingReanchorPlan | null {
  if (surface.storyScope().kind !== 'body' || surface.editingMode() !== 'edit') return null;
  const found = recordOf(surface, drawingNodeId);
  if (!found) return null;
  const { page, record } = found;
  if (record.horizontalFrame === 'character' || record.verticalFrame === 'line') return null;
  const paragraphs = page.fragments.filter(
    (f) => f.kind === 'paragraph' && !f.positionedFrame && !f.outOfFlow
  );
  // A top-level body anchor only: an anchor in a table cell lays out in the cell.
  if (!paragraphs.some((f) => f.kind === 'paragraph' && f.paragraphId === record.anchorParagraphId))
    return null;
  const top = newTopOf(record, position);
  if (top === null || !Number.isFinite(top)) return null;
  const target =
    paragraphs.find((f) => f.box.y <= top && top < f.box.y + f.box.height) ??
    (top < (paragraphs[0]?.box.y ?? 0) ? paragraphs[0] : paragraphs[paragraphs.length - 1]);
  if (!target || target.kind !== 'paragraph') return null;
  if (target.paragraphId === record.anchorParagraphId || target.fragmentIndex !== 0) return null;
  const part = surface.session.part();
  const drawing = findNode(part, drawingNodeId);
  if (!drawing || drawing.kind !== 'drawing' || !plainRunDrawing(surface, drawing)) return null;
  if (drawingAnchorLocked(drawing as OoxmlDrawingNode)) return null;
  const verticalEmu =
    record.verticalFrame === 'paragraph'
      ? Math.round((top - target.box.y) * EMU_PER_POINT)
      : PAGE_FRAMES.has(record.verticalFrame)
        ? position.verticalEmu
        : undefined;
  if (verticalEmu === undefined) return null;
  let scratch = 0;
  const moved = drawingWithPosition(
    drawing as OoxmlDrawingNode,
    { ...position, verticalEmu },
    () => `reanchor-${++scratch}`
  );
  if (!moved) return null;
  const targetNode = findNode(part, target.paragraphId);
  if (!targetNode) return null;
  return {
    ops: [
      { op: 'deleteDrawing', drawingNodeId },
      { op: 'insertDrawing', paragraphId: target.paragraphId, offset: 0, drawing: moved },
    ],
    paragraphId: target.paragraphId,
    previousDrawingIds: drawingIdsIn(targetNode, new Set()),
  };
}

/** The drawing the re-anchor inserted into `plan.paragraphId`, after the ops applied. */
function reanchoredDrawingId(surface: PaginatedSurface, plan: DrawingReanchorPlan): string | null {
  const paragraph = findNode(surface.session.part(), plan.paragraphId);
  if (!paragraph) return null;
  for (const id of drawingIdsIn(paragraph, new Set())) {
    if (!plan.previousDrawingIds.has(id)) return id;
  }
  return null;
}

/**
 * Moves a floating drawing to the paragraph under its new top and keeps it selected. False
 * when the anchor stays, or when the store refused the move: the plain position then applies.
 */
export function reanchorMovedDrawing(
  surface: PaginatedSurface,
  drawingNodeId: string,
  position: DrawingPositionInput
): boolean {
  const plan = planDrawingReanchor(surface, drawingNodeId, position);
  if (!plan || surface.applyDrawingOps(plan.ops).rejected) return false;
  const moved = reanchoredDrawingId(surface, plan);
  if (moved) surface.selectDrawing(moved, plan.paragraphId);
  return true;
}
