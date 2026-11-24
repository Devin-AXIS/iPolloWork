import { noteScopeIdInLayout } from './surface-scope.ts';
import type { Editor } from '../contracts/editor.ts';
import type { DocxEditorInstance } from './docx-editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { SurfaceHostListeners } from './surface-host-listeners.ts';
import type { SemanticPosition } from '../layout/semantic-interaction.ts';
import type { TreeApplyResult } from '../binding/tree-session-contract.ts';
import { findDrawingOverlayFrameInLayout } from '../layout/semantic-hit-test.ts';
import { validateMoveInlineDrawing } from '../store/store/tree-op-move-inline-drawing.ts';
import { diagramDrawingOf } from '../store/store/tree-op-diagram-drawing.ts';
import { capturePointPosition, pointTargetRefusal } from './editor-point-target.ts';
import { clearSurfaceDrop, previewSurfaceDrop } from './surface-drop.ts';
import { isElementNode } from './host-realm.ts';

const controllers = new WeakMap<PaginatedSurface, ReturnType<typeof createInlineImageDrag>>();
const refused = (reason: string): TreeApplyResult => ({
  committed: false,
  rejected: true,
  opCount: 0,
  reason,
});

function sourceOf(surface: PaginatedSurface, id: string) {
  if (surface.editingMode() !== 'edit' || !surface.session.editable || surface.parked())
    return null;
  const record = findDrawingOverlayFrameInLayout(surface.layout(), id)?.record;
  if (!record || record.kind !== 'inlineDrawing') return null;
  const part = surface.session.currentPackage().parts.get(record.ownerPartName);
  if (!part) return null;
  // Pictures, charts and diagrams move; the store refuses a chart with a fallback picture.
  const graphic = record.placeholderGraphicKind;
  if (graphic && !record.chart && graphic !== 'chart' && !diagramDrawingOf(part, id)) return null;
  const active = surface.activeScope();
  if (active.kind === 'body' && part.name !== surface.session.part().name) return null;
  if (active.kind === 'frame') return null;
  if (
    active.kind === 'note' &&
    noteScopeIdInLayout(surface.layout(), record.paragraphId) !== active.id
  )
    return null;
  if (active.kind === 'headerFooter') {
    const matches = surface.session
      .headerFooterResolutionBySection()
      .some((section) =>
        [...section.headers.values(), ...section.footers.values()].some(
          (slot) => slot.rId === active.rId && slot.partName === part.name
        )
      );
    if (!matches) return null;
  }
  const gate = validateMoveInlineDrawing(part, {
    op: 'moveInlineDrawing',
    drawingNodeId: id,
    paragraphId: record.paragraphId,
    offset: record.start,
  });
  return gate ? null : record;
}

/** Whether the selected inline picture supports an identity-preserving move. @public */
export function canMoveInlineImage(editor: Editor, drawingNodeId: string): boolean {
  const surface = (editor as DocxEditorInstance).surface;
  if (!surface || surface.editingMode() !== 'edit' || !surface.session.editable || surface.parked())
    return false;
  const layout = surface.layout();
  const revision = surface.session.packageRevision();
  const scope = JSON.stringify(surface.activeScope());
  const previous = eligibility.get(surface);
  if (
    previous?.layout === layout &&
    previous.revision === revision &&
    previous.scope === scope &&
    previous.id === drawingNodeId
  )
    return previous.allowed;
  const allowed = sourceOf(surface, drawingNodeId) !== null;
  eligibility.set(surface, { layout, revision, scope, id: drawingNodeId, allowed });
  return allowed;
}

// Resize previews reuse eligibility; gesture start and commit always validate again.
const eligibility = new WeakMap<
  PaginatedSurface,
  {
    layout: ReturnType<PaginatedSurface['layout']>;
    revision: number;
    scope: string;
    id: string;
    allowed: boolean;
  }
>();

/** Begin the shared pointer gesture from an adapter's selected-picture frame. @public */
export function beginInlineImageDrag(
  editor: Editor,
  event: PointerEvent,
  drawingNodeId: string
): boolean {
  const surface = (editor as DocxEditorInstance).surface;
  return surface ? (controllers.get(surface)?.begin(event, drawingNodeId) ?? false) : false;
}

/** A single canonical move; no resource bytes are copied or decoded. */
export function moveInlineImage(
  surface: PaginatedSurface,
  drawingNodeId: string,
  target: SemanticPosition,
  expectedRevision: number
): TreeApplyResult {
  if (surface.session.packageRevision() !== expectedRevision) return refused('stale-image-drag');
  if (!sourceOf(surface, drawingNodeId)) return refused('unsupported-image-drag');
  const result = surface.applyDrawingOps([
    {
      op: 'moveInlineDrawing',
      drawingNodeId,
      paragraphId: target.paragraphId,
      offset: target.offset,
    },
  ]);
  if (result.committed) surface.selectDrawing(drawingNodeId, target.paragraphId);
  return result;
}

/** Cancel a gesture when the host moves or detaches. */
export function cancelInlineImageDrag(surface: PaginatedSurface): void {
  controllers.get(surface)?.cancel();
}

/** Capture painted-image presses; adapter frames use the same controller. */
export function createInlineImageDrag(
  surface: PaginatedSurface,
  pagesLayer: HTMLElement,
  listeners: SurfaceHostListeners
) {
  let cleanup: (() => void) | null = null;
  function cancel() {
    const stop = cleanup;
    cleanup = null;
    stop?.();
    clearSurfaceDrop(surface);
  }
  function begin(event: PointerEvent, id: string): boolean {
    if (event.button !== 0 || event.pointerType === 'touch') return false;
    // A modified press keeps its text-selection meaning, such as Shift+click to extend.
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
    const source = sourceOf(surface, id);
    if (!source) return false;
    cancel();
    event.preventDefault();
    event.stopPropagation();
    surface.selectDrawing(id, source.paragraphId);
    const token = capturePointPosition(surface, {
      paragraphId: source.paragraphId,
      offset: source.start,
    });
    const revision = surface.session.packageRevision();
    const startX = event.clientX,
      startY = event.clientY,
      pointerId = event.pointerId;
    let dragging = false;
    const valid = () => pointTargetRefusal(surface, token) === null;
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return;
      if (!valid()) {
        cancel();
        return;
      }
      if (!dragging && Math.hypot(move.clientX - startX, move.clientY - startY) < 4) return;
      dragging = true;
      move.preventDefault();
      move.stopPropagation();
      previewSurfaceDrop(surface, move.clientX, move.clientY);
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== pointerId) return;
      const point =
        dragging && up.type === 'pointerup' && valid()
          ? surface.pointAt(up.clientX, up.clientY)
          : null;
      cancel();
      if (!point) return;
      up.preventDefault();
      up.stopPropagation();
      moveInlineImage(surface, id, point.hit.position, revision);
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key === 'Escape') {
        key.preventDefault();
        cancel();
      }
    };
    const stop = [
      listeners.onDocument('pointermove', onMove, { capture: true }),
      listeners.onDocument('pointerup', onUp, { capture: true }),
      listeners.onDocument('pointercancel', onUp, { capture: true }),
      listeners.onDocument('keydown', onKey, { capture: true }),
      listeners.onWindow('blur', cancel),
    ];
    pagesLayer.addEventListener('lostpointercapture', cancel);
    try {
      pagesLayer.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events and detached hosts have no active pointer to capture.
    }
    cleanup = () => {
      for (const remove of stop) remove();
      pagesLayer.removeEventListener('lostpointercapture', cancel);
      if (pagesLayer.hasPointerCapture?.(pointerId)) pagesLayer.releasePointerCapture(pointerId);
    };
    return true;
  }
  const onPress = (event: PointerEvent) => {
    const element = isElementNode(event.target) ? event.target : null;
    const id = element?.closest('[data-drawing-node-id]')?.getAttribute('data-drawing-node-id');
    if (id) begin(event, id);
  };
  pagesLayer.addEventListener('pointerdown', onPress, { capture: true });
  const controller = {
    begin,
    cancel,
    destroy() {
      cancel();
      pagesLayer.removeEventListener('pointerdown', onPress, { capture: true });
      controllers.delete(surface);
    },
  };
  controllers.set(surface, controller);
  return controller;
}
