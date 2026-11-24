/** The engine-owned identity of one gesture. Create it with `Editor.beginHistoryGroup()`. @public */
declare const historyGroupBrand: unique symbol;
export interface HistoryGroup {
  readonly [historyGroupBrand]: true;
  /** Closed after `end()`, document replacement, detach, or destruction. */
  readonly state: 'open' | 'closed';
  /**
   * The outcome of the latest write that named this handle, or `null` before the first one.
   *
   * Every grouped write reports here. A browser runtime `run({ historyGroup }, callback)` is
   * ONE write, whatever number of syncs it makes: it has no `ExecResult`, and it settles here
   * once, after the callback finishes. A split anywhere in the run makes its outcome `split`. Read it
   * after a write to learn whether the write started, extended, or split the group.
   *
   * @example
   * ```ts
   * await runtime.run({ historyGroup: decision }, async (context) => {
   *   context.document.body.insertParagraph('Revised terms follow.', 'End');
   *   await context.sync();
   * });
   * if (decision.lastOutcome?.kind === 'split') console.warn(decision.lastOutcome.reason);
   * ```
   */
  readonly lastOutcome: HistoryGroupOutcome | null;
  /** End this gesture without reverting any edits. Safe to call more than once. */
  end(): void;
}

/** The history authority's result for this frame. @public */
export interface HistoryGroupOutcome {
  readonly kind: 'started' | 'extended' | 'split' | 'none';
  readonly reason?:
    | 'history-boundary'
    | 'undo-redo'
    | 'no-history'
    /** @deprecated No longer reported: writes that span document parts now extend the group. */
    | 'package-unit'
    | 'composition';
}

/**
 * The editor is N+1 editing views: one body plus one per header/footer relationship, plus
 * footnotes, text boxes, and other addressable regions. Commands must name their target.
 *
 * This set is open-ended. Treat it as non-exhaustive as more regions become addressable.
 */
export type EditorScope =
  | { kind: 'body' }
  | { kind: 'headerFooter'; rId: string }
  /**
   * A footnote/endnote region.
   *
   * `id` encodes kind and signed note id as `footnote:<id>` or `endnote:<id>`. Use
   * `formatNoteScopeId` or `parseNoteScopeId` from the store package.
   */
  | { kind: 'note'; id: string }
  | {
      /**
       * A text box or floating frame with its own content.
       *
       * Addressing one takes the drawing that hosts it as well as the story root: a frame is
       * reached THROUGH its drawing, and nothing can reveal or select it from `id` alone.
       */
      kind: 'frame';
      id: string;
      /** The drawing that hosts this frame. */
      drawingNodeId: string;
      /** The paragraph that anchors that drawing. */
      hostParagraphId: string;
      /**
       * Furniture or note story that owns this frame. Absence means the body story. Entering a
       * frame owned by a header or footer opens that story around it; a note-owned frame cannot
       * be entered.
       */
      owner?: { kind: 'headerFooter'; rId: string } | { kind: 'note'; id: string };
    }
  /** Read-only aggregate across every view. Valid for queries, not for writes. */
  | { kind: 'all' };

/** A concrete editing view. */
export type ViewScope = Exclude<EditorScope, { kind: 'all' }>;

/**
 * Options for a review write that can join an explicit history group.
 *
 * Every write that names one open handle becomes part of one undo step, across commands,
 * review methods, and browser automation runs. A closed handle, or a handle from another
 * editor, refuses the write with `code: 'unsupported'` and changes nothing.
 *
 * @example
 * ```ts
 * const decision = editor.beginHistoryGroup();
 * // Reply first: the card's key no longer exists after the change is accepted.
 * const reply = editor.replyToReviewItem(key, 'Accepted with one change.', {
 *   historyGroup: decision,
 * });
 * const accepted = editor.acceptReviewItem(key, { historyGroup: decision });
 * decision.end();
 * if (!reply.ok || !accepted.ok) throw new Error('the review card was refused');
 * editor.exec({ type: 'undo' }); // reverts both writes
 * ```
 * @public
 */
export interface HistoryGroupOptions {
  /**
   * An open handle from {@link Editor.beginHistoryGroup} on this editor.
   *
   * Undo, redo, and an ungrouped write close the group, so a later frame starts a new undo
   * step. Inspect `ExecResult.history` to see whether a write started, extended, or split it.
   */
  readonly historyGroup?: HistoryGroup;
}

/** Options for a command's editing view and explicit gesture. @public */
export interface EditorExecOptions extends HistoryGroupOptions {
  /** Omitted, the command addresses the current selection. */
  readonly scope?: EditorScope;
  /**
   * An open handle from this editor. Supported for synchronous formatting commands, tracked
   * proposals (`proposeInsertion`, `proposeDeletion`, `proposeReplacement`), `replaceMatch`,
   * `resolveAllReviewChanges`, and `setReviewChangesAuthor`. Other commands refuse a handle
   * with `code: 'unsupported'`.
   * Intervening writes and undo/redo can split a gesture; inspect `ExecResult.history`.
   * Read-only commands do not close a gesture. Ungrouped collaboration uses timed capture.
   * See the core history grouping guide for gesture bindings and boundary rules.
   */
  readonly historyGroup?: HistoryGroup;
}

/** Optional diagnostic notification; subscribing does not change history behavior. @public */
export interface HistoryDiagnostic {
  readonly kind: 'split' | 'possible-ungrouped-gesture' | 'possible-fragmented-gesture';
  readonly reason: string;
}

/** Options for replacing a comment body without overwriting a newer edit. @public */
export interface CommentTextOptions extends HistoryGroupOptions {
  /**
   * The exact displayed text read when editing started. A mismatch refuses the write with
   * `invalidArgs` and reason `comment-text-changed`. Omit to replace the current body.
   */
  readonly expectedText?: string;
}
