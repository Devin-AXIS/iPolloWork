import type {
  AnchorHighlightAnimation,
  AnchorHighlightOptions,
  ClearAnchorHighlightOptions,
  ScrollPlacement,
  ScrollToAnchorOptions,
} from '../contracts/editor.ts';

/** A processor location in the returned document's body, including table paragraphs. @public */
export interface RefreshLocation {
  /** OOXML w14:paraId: eight hexadecimal digits, 00000001 through 7FFFFFFF. Case-insensitive. Use this or paragraphIndex, not both. */
  readonly paragraphId?: string;
  /** Zero-based body paragraph index in document order. */
  readonly paragraphIndex?: number;
  /** UTF-16 offsets in the returned paragraph. */
  readonly start: number;
  readonly end: number;
  /** Exact returned text at these offsets. Required to reject mismatched metadata. */
  readonly text: string;
}

/** One processor change. Keep its id stable across cumulative results. @public */
export interface RefreshChangeInput {
  readonly id: string;
  /** Processor-provided review summary, including changes without a body location. Maximum: 1000 characters. */
  readonly description?: string;
  readonly location?: RefreshLocation;
  /** Deletions without a surviving range have no highlight. */
  readonly unavailableReason?: 'deleted' | 'unavailable';
}

/** One validated change for an accepted result. @public */
export interface RefreshChange {
  readonly id: string;
  /** Processor-provided summary. The controller does not compute a document diff. */
  readonly description?: string;
  /** Identity of the accepted submission and processor sequence. */
  readonly resultId: string;
  /** True for a new change id, changed text, or changed description in an existing change id. */
  readonly isNew: boolean;
  readonly status: 'available' | 'deleted' | 'unavailable' | 'invalid' | 'unsupported-story';
  readonly location?: RefreshLocation;
  /** Why this change cannot receive a highlight. Includes the requested location when supplied. */
  readonly diagnostic?: {
    readonly code:
      | 'missing-location'
      | 'deleted'
      | 'invalid-selector'
      | 'invalid-paragraph-id'
      | 'paragraph-not-found'
      | 'ambiguous-paragraph-id'
      | 'invalid-offsets'
      | 'text-mismatch'
      | 'not-rendered'
      | 'unsupported-story'
      | 'multiple-paragraphs';
    readonly location?: RefreshLocation;
  };
}

/** A document captured for external processing. Treat this object as an opaque token. @public */
export interface RefreshSubmission {
  readonly id: string;
  readonly bytes: ArrayBuffer;
}

/**
 * How `applyUpdate()` puts returned bytes on screen.
 *
 * - `'reload'` (default): reload the document. Resets selection and undo history. Refused in
 *   collaboration sessions.
 * - `'edit'`: apply the difference as ONE undoable edit on top of the current history. Undo
 *   returns to the captured submission (or the previous accepted result), and redo applies the
 *   result again. Works in collaboration sessions, where the update reaches other participants
 *   as an ordinary edit. Refuses with `edit-unsupported` when the difference cannot apply as an
 *   edit; the document and its history stay unchanged, so outside a collaboration session you
 *   can retry with `'reload'`. Refuses with `edit-not-permitted` in viewing mode or on a
 *   protected document.
 *
 * @public
 */
export type RefreshUpdateMode = 'reload' | 'edit';

/** Cumulative output for one submission. Assign sequence at the processor, before delivery. @public */
export interface RefreshUpdate {
  readonly submission: RefreshSubmission;
  readonly sequence: number;
  readonly bytes: ArrayBuffer | Uint8Array;
  /**
   * `'edit'` applies the result as one undoable edit; `'reload'` (default) reloads the document.
   * See {@link RefreshUpdateMode}.
   *
   * @example
   * ```ts
   * let result = await refresh.applyUpdate({ submission, sequence: 1, bytes, mode: 'edit' });
   * if (!result.ok && result.code === 'edit-unsupported') {
   *   result = await refresh.applyUpdate({ submission, sequence: 1, bytes });
   * }
   * ```
   */
  readonly mode?: RefreshUpdateMode;
  /** Omit to derive changes from tracked revisions when a review module is registered. */
  readonly changes?: readonly RefreshChangeInput[];
  /** Stable failed operation ids. The controller reports these and never retries processor work. */
  readonly failures?: readonly string[];
}

/**
 * Stable refusal codes for external document replacement.
 *
 * - `local-edits`: the document changed after capture, even through undo. With `mode: 'edit'`
 *   in a collaboration session, another participant's edit counts too.
 * - `collaboration`: a reload while a collaboration session is attached.
 * - `unavailable`: no mounted document, the document is still opening, or the collaboration
 *   session cannot accept edits now. A later retry can succeed.
 * - `edit-not-permitted`: the editor or the document does not permit an update with
 *   `mode: 'edit'`. A retry does not help until that changes.
 * - `edit-unsupported`: the result cannot apply as one undoable edit, or the collaboration
 *   room refused it. The document and its history are unchanged.
 *
 * The document refresh guide describes every code and the usual response.
 *
 * @public
 */
export type RefreshFailureCode =
  | 'unavailable'
  | 'collaboration'
  | 'busy'
  | 'cancelled'
  | 'superseded'
  | 'document-changed'
  | 'local-edits'
  | 'out-of-order'
  | 'invalid-result'
  | 'invalid-document'
  | 'input-failed'
  | 'load-failed'
  | 'recovery-failed'
  | 'edit-not-permitted'
  | 'edit-unsupported';

/**
 * The specific cause behind a refusal code, for an update with `mode: 'edit'`.
 *
 * With code `edit-not-permitted`:
 * - `viewing`: the editor is in viewing mode.
 * - `protected`: enforced document protection permits only comments, form fields, tracked
 *   changes, or no edits, and the update would be an untracked edit.
 *
 * With code `unavailable`:
 * - `collaboration-unavailable`: the collaboration session cannot accept edits now.
 *
 * With code `edit-unsupported`:
 * - `different-main-part`: the returned file names a different main document part.
 * - `unsupported-difference`: the difference cannot be expressed as an edit of the open
 *   document.
 * - `collaboration-refused`: the collaboration room refused the edit, for example because a
 *   value exceeds its size limits. The document keeps the room's content.
 *
 * @public
 */
export type RefreshRefusalReason =
  | 'viewing'
  | 'protected'
  | 'collaboration-unavailable'
  | 'different-main-part'
  | 'unsupported-difference'
  | 'collaboration-refused';

/** Fields every refused {@link RefreshResult} carries. @public */
export interface RefreshRefusalFields {
  readonly ok: false;
  readonly resultId: string;
  /**
   * Why the update was refused, in English, for logs and diagnostics. Never parse it: branch
   * on `code` and `reason`. `DocumentRefreshError` from `capture()` has the same pair:
   * a stable `code` and an English `message`.
   */
  readonly message: string;
  /** For `load-failed`: whether the previous document was restored. */
  readonly recovered?: boolean;
}

/**
 * A refused update. `code` is stable; `reason` names the specific cause where one exists, and
 * narrows `code`: checking `reason === 'collaboration-refused'` implies `edit-unsupported`.
 *
 * @public
 */
export type RefreshRefusal =
  | (RefreshRefusalFields & {
      readonly code: 'edit-not-permitted';
      readonly reason: 'viewing' | 'protected';
    })
  | (RefreshRefusalFields & {
      readonly code: 'edit-unsupported';
      readonly reason: 'different-main-part' | 'unsupported-difference' | 'collaboration-refused';
    })
  | (RefreshRefusalFields & {
      readonly code: 'unavailable';
      readonly reason?: 'collaboration-unavailable';
    })
  | (RefreshRefusalFields & {
      readonly code: Exclude<
        RefreshFailureCode,
        'edit-not-permitted' | 'edit-unsupported' | 'unavailable'
      >;
      readonly reason?: undefined;
    });

/** Completion belongs to one result, including refusals and recovery failures. @public */
export type RefreshResult =
  | {
      readonly ok: true;
      readonly resultId: string;
      /** How the result was applied: an undoable edit, or a reload. */
      readonly mode: RefreshUpdateMode;
      readonly changes: readonly RefreshChange[];
      readonly changeInformation: 'available' | 'unavailable';
      readonly failures: readonly string[];
    }
  | RefreshRefusal;

/** Observable controller state. Document editing stays available during processing. @public */
export interface DocumentRefreshState {
  readonly phase:
    'idle' | 'capturing' | 'processing' | 'refreshing' | 'recovering' | 'complete' | 'failed';
  readonly result: RefreshResult | null;
  readonly changes: readonly RefreshChange[];
  /** Whether highlights are requested for available locations. False when the whole set starts dismissal. */
  readonly highlightsVisible: boolean;
  /** Offer restore and download controls when true. */
  readonly recoveryAvailable: boolean;
}

/** Opacity fade settings. Reduced motion caps fades at 125ms. @public */
export type RefreshHighlightAnimation = AnchorHighlightAnimation;

/** Presentation for temporary paragraph highlights. Each call starts from these defaults. @public */
export interface RefreshHighlightOptions extends AnchorHighlightOptions {
  /** Include earlier changes from the latest cumulative result. Default: false. */
  readonly includePrevious?: boolean;
  /** Select these change IDs instead of the recent/all filter. Unknown or unavailable IDs are skipped. Empty means none. */
  readonly changeIds?: readonly string[];
}

/** Explicit highlight dismissal. Document edits always remove stale highlights immediately. @public */
export type ClearRefreshHighlightsOptions = ClearAnchorHighlightOptions;

/** Explicit change navigation. Does not change the default scroll preservation during refresh. @public */
export interface NavigateToChangeOptions extends ScrollToAnchorOptions {
  /** Move the caret and focus to the changed range start. Default: false. */
  readonly focus?: boolean;
  /** Target alignment. Default: center. centerIfNeeded preserves scroll for an already visible target. */
  readonly block?: ScrollPlacement;
}

/**
 * External file transport stays in your application. A reload resets selection and undo
 * history; an update with `mode: 'edit'` keeps both and adds one undo step.
 * @public
 */
export interface DocumentRefresh {
  /** Finish pending input and capture bytes with their document revision. Supersedes earlier submissions. */
  capture(): Promise<RefreshSubmission>;
  /**
   * Accept cumulative output. Preserve the scroll position without moving focus. With
   * `mode: 'edit'`, apply it as one undoable edit and keep selection where it maps.
   */
  applyUpdate(update: RefreshUpdate): Promise<RefreshResult>;
  /** Cancel pending processing. An accepted result stays loaded. */
  cancel(): void;
  /** End processing when no further output will arrive. */
  finish(submission: RefreshSubmission): void;
  /** Cached state, suitable for framework external-store subscriptions. */
  snapshot(): DocumentRefreshState;
  /** Observe state changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Completion notification for every `applyUpdate()` call, including a refused result. */
  onResult(listener: (result: RefreshResult) => void): () => void;
  /** Highlight available changes and return their count, including offscreen locations. Zero means none. Always validates options. */
  highlightChanges(options?: RefreshHighlightOptions): number;
  /** Remove temporary paragraph highlights without changing document content or history. */
  clearHighlights(options?: ClearRefreshHighlightsOptions): void;
  /** Explicit navigation. Does not focus unless requested. Returns false for unavailable locations. */
  navigateToChange(id: string, options?: NavigateToChangeOptions): boolean;
  /** Return a copy for download after recovery fails. */
  recoveryBytes(): ArrayBuffer | null;
  /** Retry recovery only while the failed document session is still active. */
  recover(): Promise<boolean>;
}

/** A capture failure with a stable code. `applyUpdate()` failures use RefreshResult instead. @public */
export class DocumentRefreshError extends Error {
  /** Machine-readable reason. */
  readonly code: RefreshFailureCode;
  constructor(code: RefreshFailureCode, cause?: unknown) {
    super(`Document capture failed: ${code}.`, { cause });
    this.name = 'DocumentRefreshError';
    this.code = code;
  }
}
