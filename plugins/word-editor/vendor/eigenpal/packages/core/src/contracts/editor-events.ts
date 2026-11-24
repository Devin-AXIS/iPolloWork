import type { EditorDropEvent } from './editor-drop.ts';
import type { ResolvedRevisionMarkup } from './revision-markup.ts';
import type { EditorError, EditorSnapshot } from './editor.ts';
import type { HistoryDiagnostic } from './editor-scope.ts';
import type { EditorDiagnostic } from './diagnostics.ts';
import type { RevisionBatchSkipDetail } from './types.ts';

/**
 * What `editor.on(...)` can be subscribed to, and what each handler receives.
 *
 * These are PUSH notifications and are not interchangeable with reading `snapshot()`: a snapshot
 * read cannot observe an event that was never emitted, which is why adapter behaviour is asserted
 * against these rather than against the snapshot.
 */
export interface EditorEvents {
  /** Accept a custom drag with synchronous `event.preventDefault()`. */
  dragOver: (event: EditorDropEvent) => void;
  /** Handle a custom drop with synchronous `event.preventDefault()` before asynchronous work. */
  drop: (event: EditorDropEvent) => void;
  /** Local viewer preferences changed through the API or review dialog. */
  revisionMarkupChange: (settings: ResolvedRevisionMarkup) => void;
  /** A document mutation committed, with the ids it touched. */
  change: (change: DocumentChange) => void;
  /**
   * A committed change added, changed, or deleted paragraphs. The ids are the `blockId`s that
   * `getParagraphs()` lists, across every story: body, tables, content controls, headers,
   * footers, notes, and text boxes. Re-check only these paragraphs instead of the whole
   * document.
   *
   * It fires once per commit, after the `change` event of the same commit, and only when at
   * least one list is not empty. It never fires for a selection, view, or highlight change.
   * `source` is `'remote'` for a change applied from a collaboration peer, and `'local'` for
   * every other commit, including undo and redo.
   *
   * The `replaceDocument` command is an undoable edit, so it fires: the paragraphs it removes
   * are in `deleted`, and the paragraphs it brings are in `added` or `changed`. `load()`, a
   * refresh, and a recovery do not fire it: the `change` event reports them with `source`,
   * and every paragraph needs a check then.
   *
   * @example
   * ```ts
   * editor.on('paragraphsChange', ({ added, changed, deleted }) => {
   *   for (const id of deleted) results.delete(id);
   *   for (const id of [...added, ...changed]) {
   *     const paragraph = editor.getParagraphText(id);
   *     if (paragraph) results.set(id, check(paragraph.acceptedText));
   *   }
   * });
   * ```
   */
  paragraphsChange: (event: ParagraphsChangeEvent) => void;
  /**
   * Observable editor state moved without a document change: the selection or its derived
   * formatting, the armed typing format, the open header or footer, the collaboration
   * session's status, or the page count when pages finish laying out in the background.
   */
  selectionChange: (snapshot: EditorSnapshot) => void;
  error: (error: EditorError) => void;
  historyDiagnostic: (diagnostic: HistoryDiagnostic) => void;
  /**
   * An anonymous diagnostic: a document opened or failed to open, an edit or a tracked change
   * was refused, a font failed. Carries stable codes and bucketed numbers, never document
   * content, so a handler may send it to an error tracker as it is.
   *
   * A document passed at construction opens before a host can subscribe. To see that open,
   * register a module with `onDiagnostic` instead.
   *
   * @example
   * ```ts
   * editor.on('diagnostic', (event) => {
   *   if (event.kind === 'edit.rejected') console.warn(explainDiagnostic(event.code).hint);
   * });
   * ```
   */
  diagnostic: (event: EditorDiagnostic) => void;
  /**
   * An explicit request landed on a review item, and its card or balloon should open.
   *
   * Fires each time Next Change or Previous Change lands (`source: 'navigate'`), and each time
   * `setActiveReviewItem(key, { announce: true })` succeeds (`source: 'host'`). It fires again
   * when the item was already active, so a card the reader closed can open again.
   *
   * It does not fire for a caret move, a click in the page, a dismissal (`key` of `null`), a
   * refused activation, or `setActiveReviewItem(key)` without `announce: true`. A remote edit in a
   * collaboration session never fires it: it is a local view event.
   *
   * @example
   * ```ts
   * editor.on('reviewItemReveal', ({ key, source }) => {
   *   openMyBalloon(key); // `source` is 'navigate' or 'host'
   * });
   * ```
   */
  reviewItemReveal: (event: ReviewItemRevealEvent) => void;
  /**
   * An accept-all or reject-all decision committed: from the toolbar, the menu, or
   * `exec()` with `resolveAllReviewChanges`, `acceptAllRevisions`, or `rejectAllRevisions`.
   * `action` is `'accept'` or `'reject'` for all three. `skipped` names the changes it left pending,
   * so a host can say why they stay. A remote decision in a collaboration session never fires
   * it: it is a local event.
   *
   * @example
   * ```ts
   * editor.on('reviewChangesResolved', ({ skipped }) => {
   *   if (skipped.length) showNotice(`${skipped.length} changes stay pending`);
   * });
   * ```
   */
  reviewChangesResolved: (event: ReviewChangesResolvedEvent) => void;
  /**
   * The editor's pages are now in another document: it was attached for the first time, moved
   * into another element or window, detached (`document` is `null`), or found its element
   * moved to another window by the host. Custom chrome that listens on the editor's document
   * or measures its window re-binds here.
   *
   * @example
   * ```ts
   * editor.on('hostChange', ({ document }) => {
   *   stopShortcuts?.();
   *   stopShortcuts = document ? listenForShortcuts(document) : undefined;
   * });
   * ```
   */
  hostChange: (event: EditorHostChange) => void;
}

/**
 * The payload of the `paragraphsChange` event. Each id appears in at most one list.
 *
 * @public
 */
export interface ParagraphsChangeEvent {
  /** Paragraphs that the change created, such as the new half of a split paragraph. */
  readonly added: readonly string[];
  /**
   * Paragraphs that still exist with the same id and whose text, properties, or content can
   * differ. A paragraph that holds a changed text box can be listed with the text box
   * paragraph. A change to the document styles lists every paragraph.
   */
  readonly changed: readonly string[];
  /** Paragraphs that the change removed, such as the second paragraph of a merge. */
  readonly deleted: readonly string[];
  /** `'remote'` for a change from a collaboration peer, `'local'` for every other commit. */
  readonly source: 'local' | 'remote';
  /** Package revision after the change, the same number as the `change` event's `revision`. */
  readonly revision: number;
}

/**
 * The payload of the `hostChange` event.
 *
 * @public
 */
export interface EditorHostChange {
  /** The document the pages are mounted in now, or `null` while the editor is detached. */
  readonly document: EditorHostDocument | null;
}

/**
 * The DOM `Document`, wherever DOM types are loaded (every browser host).
 *
 * Read from `globalThis` rather than named, so this contract also compiles in the engine's
 * DOM-free lanes and on servers, where it falls back to `object`.
 *
 * @public
 */
export type EditorHostDocument = typeof globalThis extends { readonly document: infer D }
  ? D
  : object;

/**
 * The payload of the `reviewItemReveal` event.
 *
 * @public
 */
export interface ReviewItemRevealEvent {
  /**
   * The key of the review item to open, as `getReviewItems({ pairReplacements: false })`
   * lists it, so for a replacement this is the key of its deletion or its insertion. Next
   * Change and Previous Change stop once on a replacement and report its deletion's key,
   * with the pair's key in {@link ReviewItemRevealEvent.pairKey}. `setActiveReviewItem`
   * reports the key it was given, so a call with a pair's key reports that key here and in
   * {@link ReviewItemRevealEvent.pairKey}.
   */
  readonly key: string;
  /**
   * The key that `getReviewItems()` gives the replacement this item belongs to, since it
   * pairs replacements by default. Present only when the item is a paired replacement or one
   * half of one. A host that reads the default list opens `pairKey ?? key`.
   */
  readonly pairKey?: string;
  /**
   * What asked for the item. `'navigate'` is Next Change or Previous Change, from the menu,
   * the toolbar, a shortcut, or `exec({ type: 'navigateReviewChange' })`. `'host'` is a call
   * to `setActiveReviewItem` (and so `useReview().setActive`) with `announce: true`.
   */
  readonly source: ReviewItemRevealSource;
}

/**
 * The payload of the `reviewChangesResolved` event.
 *
 * @public
 */
export interface ReviewChangesResolvedEvent {
  /** Whether the decision accepted or rejected the changes. */
  readonly action: 'accept' | 'reject';
  /** How many listed changes it resolved. The `exec` result lists them in `revisions.resolved`. */
  readonly resolvedCount: number;
  /**
   * The listed changes it left pending, with why: `'retained-structure'` for a row that stays
   * to keep a nested table, `'incomplete-group'` for a change that would also resolve one the
   * selection leaves out, `'unsupported-revision'` for a structure the engine cannot resolve,
   * and `'unknown-revision'` for a key that no longer names a change. `reviewCodeOfSkip(skip)`
   * gives each entry's review code, with its `detail`.
   */
  readonly skipped: readonly {
    /** The skipped change's key, as `getReviewItems({ pairReplacements: false })` lists it. */
    readonly key: string;
    /** The key of the replacement it is one half of, as the default `getReviewItems()` lists it. */
    readonly pairKey?: string;
    readonly reason:
      'unsupported-revision' | 'incomplete-group' | 'retained-structure' | 'unknown-revision';
    /** Which condition kept it, such as `'locked-content'` (a content lock) or `'bound-content'` (a data binding). */
    readonly detail?: RevisionBatchSkipDetail;
  }[];
}

/** What asked to reveal a review item. See {@link ReviewItemRevealEvent.source}. @public */
export type ReviewItemRevealSource = 'navigate' | 'host';

/**
 * The payload of the `change` event / `onChange`. It carries revision + identity
 * deltas, NOT serialized bytes: serializing a whole DOCX on every keystroke would
 * be prohibitive for large documents. Call `save()` to get bytes on demand.
 */
export interface DocumentChange {
  /** Replacement events must not start another external processing request. Absent for edits. */
  readonly source?: 'load' | 'refresh' | 'recovery';
  /** Package revision after this change — `getDocumentHandle()`'s number, monotonic. */
  readonly revision: number;
  /** Block ids created/deleted/edited by this change, when the engine reports them. */
  readonly created?: readonly string[];
  readonly deleted?: readonly string[];
  readonly dirty?: readonly string[];
}
