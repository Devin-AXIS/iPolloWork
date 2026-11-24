/**
 * The refused-open read model, split out of `editor.ts`.
 *
 * Re-exported from `editor.ts`, so consumers keep importing
 * `@docx-editor.dev/core/contracts/editor`.
 */

import type { DocumentOpenDiagnosticCode } from './diagnostics.ts';

/**
 * What a person can do about a document that did not open. It groups the open codes so a
 * host can pick a message without listing every code:
 *
 * - `damaged`: the archive or its XML is broken. Saving the file again in a desktop editor
 *   can repair it.
 * - `not-docx`: the bytes are not a `.docx` document, or hold no main document.
 * - `too-large`: the file crosses a size, count or depth limit.
 * - `blocked`: the file uses XML features that the editor refuses for security.
 * - `unknown`: any other failure.
 *
 * @public
 */
export type DocumentOpenFailureReason =
  'damaged' | 'not-docx' | 'too-large' | 'blocked' | 'unknown';

/**
 * A document the editor refused to open. It carries a stable code only, never the file's
 * content or name, so a host can show it, log it, or send it with a support request.
 *
 * Each refusal is a new object, so a host can compare it by reference to tell a second
 * refusal of the same file from the first.
 *
 * @public
 */
export interface DocumentOpenFailure {
  /** The stable open code, the same one the `document.open` diagnostic reports. */
  readonly code: DocumentOpenDiagnosticCode;
  /** The group of {@link DocumentOpenFailure.code} that picks the message. */
  readonly reason: DocumentOpenFailureReason;
}
