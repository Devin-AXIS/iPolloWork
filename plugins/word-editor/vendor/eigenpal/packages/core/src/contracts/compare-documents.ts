import type {
  CompareDocumentsErrorCode,
  CompareDocumentsProgress,
  CompareDocumentsRefusalReason,
} from './document-compare.ts';

/**
 * The `accept` value for a file input that picks the revised document: DOCX files only.
 *
 * @public
 */
export const COMPARE_DOCUMENTS_ACCEPT =
  '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * The `@docx-editor.dev/i18n` key of the message for a refused compare:
 * `compareDocuments.reasons.<reason>` when the refusal names a reason, else
 * `compareDocuments.errors.<code>`.
 *
 * @example
 * ```ts
 * const outcome = await session.apply({ revised });
 * if (!outcome.ok) showError(t(compareDocumentsErrorKey(outcome)));
 * ```
 *
 * @public
 */
export function compareDocumentsErrorKey(refusal: {
  readonly code: CompareDocumentsErrorCode;
  readonly reason?: CompareDocumentsRefusalReason;
}):
  | `compareDocuments.errors.${CompareDocumentsErrorCode}`
  | `compareDocuments.reasons.${CompareDocumentsRefusalReason}` {
  return refusal.reason === undefined
    ? `compareDocuments.errors.${refusal.code}`
    : `compareDocuments.reasons.${refusal.reason}`;
}

/** What one compare request carries: the revised DOCX and its options. @public */
export interface CompareDocumentsRequest {
  /** The revised document's DOCX bytes. The open document is the original. */
  readonly revised: Uint8Array;
  /**
   * Author recorded on every revision. When absent or blank, the editor's author. Without an
   * editor author, the revised document's last author, then its creator, then `Comparison`.
   */
  readonly authorName?: string;
  /** Record formatting differences as formatting revisions. Default `true`. */
  readonly detectFormatChanges?: boolean;
  /** Write the revisions without dates. Default `false`. */
  readonly removeDateAndTime?: boolean;
}

/** The outcome of one compare. @public */
export type CompareDocumentsOutcome =
  | {
      readonly ok: true;
      /**
       * Tracked change items recorded in the body, headers, footers, and notes. A replaced word
       * counts as two items, a deletion and an insertion; the review pane can show them as one
       * replacement.
       */
      readonly revisionCount: number;
      /**
       * Whether the document changed. False when the documents have no differences: the
       * document, its undo history, and its saved state stay as they were.
       */
      readonly changed: boolean;
    }
  | {
      readonly ok: false;
      /** Why the compare was refused. `compareDocuments.errors.<code>` translates it. */
      readonly code: CompareDocumentsErrorCode;
      /**
       * Set with `unsupportedContent`: what the refusal is about.
       * `compareDocuments.reasons.<reason>` translates it more precisely than the code.
       */
      readonly reason?: CompareDocumentsRefusalReason;
      /** Diagnostic detail, in English; not for display. */
      readonly message: string;
    };

/**
 * One open Compare documents dialog. The editor owns it: the session aborts when the dialog
 * closes, is replaced, or the document, mount, or editor goes away.
 *
 * @public
 */
export interface CompareDocumentsDialogSession {
  /** Aborts on close, replacement, load, detach, or destroy. */
  readonly signal: AbortSignal;
  /** The author name the dialog offers first: the editor's author, or an empty string. */
  readonly defaultAuthor: string;
  /**
   * Whether the open document has tracked changes when the dialog opens. The compare treats
   * them as accepted, so a dialog says so before the user compares.
   */
  readonly originalHasTrackedChanges: boolean;
  /** Whether a compare can run now. */
  canApply(): boolean;
  /**
   * Compare the open document with the revised DOCX and record the differences in it as
   * tracked changes, as one undoable step. Closes the session when the document changes. With
   * no differences (`changed` false) or a refusal, the session stays open with a message to
   * show.
   *
   * When the review module runs compares in the background, `onProgress` reports each step,
   * and `cancel()` stops a running compare: `apply` then answers `closed`. Otherwise the
   * compare runs on the main thread, `onProgress` is not called, and nothing can stop the
   * compare once it starts.
   *
   * A call while another compare of this session runs, or while a preview or an external
   * document refresh blocks writes, answers `busy` and changes nothing. A background compare
   * whose document changed before the result applies answers `documentChanged`; the editor
   * never retries it by itself.
   */
  apply(
    request: CompareDocumentsRequest,
    options?: { readonly onProgress?: (progress: CompareDocumentsProgress) => void }
  ): Promise<CompareDocumentsOutcome>;
  /**
   * Whether `cancel()` can stop a running compare: true when compares run in the background.
   * A compare that falls back to the main thread, because the worker never started, cannot stop.
   */
  readonly cancelable: boolean;
  /** Close the dialog. A running background compare stops, and nothing changes. */
  cancel(): void;
}

/** Host rendering for the Compare documents dialog. @public */
export interface CompareDocumentsChromeHandlers {
  readonly onRequest?: (session: CompareDocumentsDialogSession) => void;
}
