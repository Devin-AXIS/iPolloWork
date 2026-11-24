import type { ExecResult } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { allocateDrawingPropertyId } from '../store/package/drawing-package-edit.ts';
import { buildTextboxDrawing } from '../store/package/textbox-drawing-builder.ts';
import { textboxStoriesInPart } from '../store/package/textbox-stories.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { paragraphLength } from '../store/store/tree-op-segments.ts';

export function textboxInsertionRefusal(
  surface: PaginatedSurface
): Exclude<ExecResult, { ok: true }> | null {
  const scope = surface.activeScope();
  if (surface.editingMode() !== 'edit' || (scope.kind !== 'body' && scope.kind !== 'frame'))
    return {
      ok: false,
      code: 'unsupported',
      reason: 'Textboxes can only be inserted in body editing mode',
    };
  const id =
    scope.kind === 'frame' ? scope.hostParagraphId : surface.state().selection.head.paragraphId;
  if (
    !surface
      .layout()
      .pages.some((page) =>
        page.fragments.some(
          (fragment) => fragment.kind === 'paragraph' && fragment.paragraphId === id
        )
      )
  )
    return {
      ok: false,
      code: 'unsupported',
      reason: 'Select a body paragraph outside a table to insert a textbox',
    };
  return null;
}

export function insertTextbox(surface: PaginatedSurface): ExecResult {
  const refusal = textboxInsertionRefusal(surface);
  if (refusal) return refusal;
  const scope = surface.activeScope();
  const paragraphId =
    scope.kind === 'frame' ? scope.hostParagraphId : surface.state().selection.head.paragraphId;
  const part = surface.session.part();
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph')
    return { ok: false, code: 'notFound', reason: 'Textbox anchor is missing' };
  const allocated = allocateDrawingPropertyId(
    surface.session.currentPackage(),
    surface.collaborationSession()?.identity.actorId
  );
  if (!allocated.ok)
    return { ok: false, code: 'invalidArgs', reason: 'Cannot allocate textbox identity' };
  const before = new Set(textboxStoriesInPart(part).map((story) => story.root.id));
  const fragment = surface
    .layout()
    .pages.flatMap((page) => page.fragments)
    .find((fragment) => fragment.kind === 'paragraph' && fragment.paragraphId === paragraphId);
  const width = Math.min(300, fragment?.box.width ?? 300);
  if (scope.kind === 'frame') surface.setActiveScope({ kind: 'body' });
  const offset = paragraphLength(paragraph);
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
  const result = surface.applyDrawingOps([
    { op: 'insertDrawing', paragraphId, offset, drawing: buildTextboxDrawing(allocated.id, width) },
  ]);
  if (result.rejected)
    return {
      ok: false,
      code: 'invalidArgs',
      reason: result.reason ?? 'Textbox insertion was refused',
    };
  const story = textboxStoriesInPart(surface.session.part()).find(
    (story) => !before.has(story.root.id)
  );
  if (story)
    surface.setActiveScope({
      kind: 'frame',
      id: story.root.id,
      drawingNodeId: story.drawingNodeId,
      hostParagraphId: story.hostParagraphId,
    });
  surface.focus();
  return { ok: true, changed: result.committed };
}
