import type { UnsupportedElement } from '../layout/unsupported-content-types.ts';
import {
  createDrawingPreviewPackage,
  type DrawingPreviewPackageLimits,
  type DrawingPreviewPackageResult,
} from '../store/package/drawing-preview-package.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';

/**
 * A small DOCX that holds one drawing from the editor's current document, including unsaved
 * edits, for an external renderer. It equals `createDrawingPreviewPackage` on the document as
 * a save would write it now; see that function for the page and renderer rules.
 *
 * Pass an occurrence that an `UnsupportedElement` component receives, and the editor from
 * `useDocxEditor()`, returning early on `null`. The call is synchronous and serializes the
 * drawing's parts: make it in an effect keyed on `element.source`, not during render, and
 * spread out or queue the calls when there are many drawings. By default a package copies at
 * most 64 parts and 64 MiB; pass `limits` to change that.
 *
 * @public
 */
export function drawingPreviewDocx(
  editor: DocxEditorInstance,
  element: Pick<UnsupportedElement, 'ownerPartName' | 'nodeId'>,
  limits?: DrawingPreviewPackageLimits
): DrawingPreviewPackageResult {
  const session = editor.surface?.session;
  if (!session) return { ok: false, reason: 'drawing-not-found' };
  return createDrawingPreviewPackage(session.currentPackage(), element, limits);
}
