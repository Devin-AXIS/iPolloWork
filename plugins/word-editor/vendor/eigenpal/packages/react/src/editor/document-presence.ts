// The one predicate for "is there a document to describe?", shared by every part whose
// content is a STATEMENT ABOUT THE DOCUMENT (rulers, outline, navigation empty states).
// Chrome that merely acts on the document (toolbar buttons, menu rows) disables through
// `toolbarCommandState` instead — disabled is honest for an action, but "no headings" or
// a page-width ruler is a claim, and a claim about a document that is not there is false.

import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';

/**
 * True while the editor has NO painted document: still loading one, the one it was
 * handed would not parse, or bytes are held but detached from any mount point. Not
 * `isLoading` alone — a parse failure clears that flag (so hosts can put their own error
 * screen up), and a detach never sets it, while both leave nothing to describe.
 * `pageSetup` is null in exactly those states (it is derived from the mounted surface).
 */
export const selectDocumentAbsent = (snapshot: EditorSnapshot): boolean =>
  snapshot.isLoading || snapshot.parseError !== null || snapshot.pageSetup == null;
