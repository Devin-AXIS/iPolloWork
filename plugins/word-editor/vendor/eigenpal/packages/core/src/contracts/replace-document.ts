// The `replaceDocument` command: replace the whole open document with a DOCX file as one
// undoable edit.

import type { DocumentHandle } from './editor.ts';

/**
 * What one `replaceDocument` command carries.
 *
 * The replacement is one undo step above the existing history, and a collaboration session
 * shares it as an ordinary edit. `ExecResult.replaceDocument` carries the outcome.
 *
 * @example
 * ```ts
 * const expected = editor.getDocumentHandle();
 * const docx = await renderTemplate(await editor.save());
 * const result = editor.exec({ type: 'replaceDocument', docx, expected });
 * if (!result.ok) console.warn(result.replaceDocument?.code, result.reason);
 * ```
 *
 * @public
 */
export interface ReplaceDocumentRequest {
  /** The complete replacement DOCX file. */
  readonly docx: Uint8Array | ArrayBuffer;
  /**
   * The handle from `getDocumentHandle()` when you took the document. The command refuses with
   * `staleDocument` unless the open document is still that one, unedited: same `loadId` and
   * same `revision`. Pass it whenever the file was made from the document, so neither an edit
   * since then nor another loaded document is ever overwritten.
   */
  readonly expected?: DocumentHandle;
}

/**
 * Why a `replaceDocument` command was refused. Read this code rather than the top-level
 * `ExecResult.code`, which is coarser: `staleDocument` and `unavailable` both report `notFound`.
 *
 * - `invalidRequest`: the command's arguments are wrong, or it was given a history group. A
 *   replacement is always its own undo step.
 * - `invalidDocument`: the bytes are not a valid DOCX file.
 * - `staleDocument`: the open document is not the one `expected` describes.
 * - `unavailable`: no document is mounted, the editor was destroyed, or the collaboration
 *   session cannot accept edits now.
 * - `busy`: a document refresh or a preview blocks edits. A later retry can succeed.
 * - `editNotPermitted`: viewing mode, suggesting mode, or document protection does not permit
 *   an untracked edit. A retry does not help until that changes.
 * - `editUnsupported`: the difference cannot apply as one undoable edit, or the collaboration
 *   room refused it.
 *
 * Every refusal leaves the document and its undo history unchanged.
 *
 * @public
 */
export type ReplaceDocumentErrorCode =
  | 'invalidRequest'
  | 'invalidDocument'
  | 'staleDocument'
  | 'unavailable'
  | 'busy'
  | 'editNotPermitted'
  | 'editUnsupported';

/**
 * The specific cause behind a refusal code, where one exists.
 *
 * - `viewing`, `suggesting`, `protected`: with `editNotPermitted`. A replacement is an untracked
 *   edit, so suggesting mode refuses it rather than record it without revisions. Protection
 *   means enforced protection that permits only comments, form fields, tracked changes, or no
 *   edits.
 * - `otherDocument`, `edited`: with `staleDocument`. Another document was loaded since
 *   `expected`, or the same document was edited, by anyone.
 * - `collaborationUnavailable`: with `unavailable`.
 * - `differentMainPart`: with `editUnsupported`; the file names a different main part.
 * - `unsupportedDifference`: with `editUnsupported`; the difference cannot be expressed as an
 *   edit of the open document.
 * - `collaborationRefused`: with `editUnsupported`; the collaboration room refused the edit,
 *   for example because a value exceeds its size limits. The document keeps the room's content.
 *
 * @public
 */
export type ReplaceDocumentRefusalReason =
  | 'viewing'
  | 'suggesting'
  | 'protected'
  | 'collaborationUnavailable'
  | 'differentMainPart'
  | 'unsupportedDifference'
  | 'collaborationRefused'
  | 'otherDocument'
  | 'edited';

/**
 * A refused `replaceDocument` command. `code` is stable; `reason` names the specific cause
 * where one exists and narrows `code`.
 *
 * @public
 */
export type ReplaceDocumentRefusal = {
  readonly ok: false;
  /** Why the command was refused, in English, for logs. Never parse it. */
  readonly message: string;
} & (
  | {
      readonly code: 'editNotPermitted';
      readonly reason: 'viewing' | 'suggesting' | 'protected';
    }
  | {
      readonly code: 'editUnsupported';
      readonly reason: 'differentMainPart' | 'unsupportedDifference' | 'collaborationRefused';
    }
  | { readonly code: 'unavailable'; readonly reason?: 'collaborationUnavailable' }
  | { readonly code: 'staleDocument'; readonly reason: 'otherDocument' | 'edited' }
  | { readonly code: 'invalidRequest'; readonly reason?: undefined }
  | { readonly code: 'invalidDocument' | 'busy'; readonly reason?: undefined }
);

/**
 * The outcome of one `replaceDocument` command, on `ExecResult.replaceDocument`.
 *
 * @public
 */
export type ReplaceDocumentOutcome =
  | {
      readonly ok: true;
      /**
       * Whether the document changed. False when the file matches the open document: no undo
       * step is added.
       */
      readonly changed: boolean;
    }
  | ReplaceDocumentRefusal;
