import { completeProgressiveOpen } from '../surface-progressive-open.ts';
import type { DocxEditorInstance } from '../docx-editor.ts';

/** Wait for the public opening lifecycle before inspecting a large document's surface. */
export async function waitForDocumentSurface(editor: DocxEditorInstance) {
  const deadline = Date.now() + 4000;
  while (!editor.surface || editor.snapshot().isOpening) {
    if (Date.now() >= deadline) throw new Error('Document did not finish opening');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  completeProgressiveOpen(editor.surface);
  editor.surface.layout();
  return editor.surface;
}
