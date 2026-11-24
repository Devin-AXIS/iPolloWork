// Go to a heading from an outline or navigation pane. One engine path for every adapter.

import type { Editor } from '../contracts/editor.ts';
import { pastLeadingBreaks } from '../layout/paragraph-start-page.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';

/**
 * Put the caret at the start of a heading's text and scroll the heading into view.
 *
 * A heading that opens with a page break starts its text on the next page. The caret goes in
 * front of that text, not in front of the break at the bottom of the previous page, so the
 * reader sees the heading and typing lands in it. Returns false for an empty or unknown id.
 *
 * @internal
 */
export function goToHeading(editor: Editor, blockId: string): boolean {
  if (typeof blockId !== 'string' || blockId.length === 0) return false;
  // Focus first, so the surface owns the selection it is about to paint.
  editor.focus();
  const surface = (editor as DocxEditorInstance).surface;
  const start = { paragraphId: blockId, offset: 0 };
  const position = surface ? pastLeadingBreaks(surface.layout().pages, start) : start;
  // Anchor and head equal is a caret: the heading is not selected.
  editor.exec({ type: 'setSelection', range: { anchor: position, head: position } });
  // Moving the caret does not move the viewport. The engine knows the heading's page.
  return editor.scrollToBlock(blockId);
}
