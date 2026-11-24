// The seam between a host and whatever owns the document.
//
// INTERNAL. Not part of the public automation surface: a consumer gets a host, never a port.
// It exists so the headless host and the browser host differ in exactly one place — who owns
// the canonical package — and share every read, every validation and every batch rule.
//
// The port is deliberately the smallest thing that can carry a document: the canonical
// package to read, one ordered-ops transaction to write, bytes to save, and a change signal.
// Note what is NOT here — no per-paragraph read, no text accessor, no offset arithmetic.
// Those live above the port so both hosts cannot answer the same question two ways, which is
// the failure mode a second host implementation always ends in.

import type { FormattingDisplayMode } from '../store/store/formattable-runs.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { InsertCustomNodeWrite } from '../store/store/custom-node-writes.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { StoryScope } from '../store/store/tree-package-store.ts';
import type { AutomationStoryId } from './stories.ts';

export type { InsertCustomNodeWrite };

/** What a comment write asks for: a root, reply, thread state, or one lifecycle deletion. */
export type AutomationCommentWrite =
  | {
      readonly kind: 'create';
      readonly anchor: {
        readonly paragraphId: string;
        readonly start: number;
        readonly end: number;
        readonly endParagraphId?: string;
      };
      readonly text: string;
      readonly author: string;
      readonly date?: string;
    }
  | {
      readonly kind: 'reply';
      readonly parentCommentId: string;
      readonly anchor: {
        readonly paragraphId: string;
        readonly start: number;
        readonly end: number;
        readonly endParagraphId?: string;
      };
      readonly text: string;
      readonly author: string;
      readonly date?: string;
    }
  | { readonly kind: 'edit'; readonly commentId: string; readonly text: string }
  | { readonly kind: 'resolve'; readonly commentId: string; readonly resolved: boolean }
  | {
      readonly kind: 'delete';
      readonly commentId: string;
      /** Replies are removed alone; roots remove the whole thread and its story anchors. */
      readonly parentCommentId?: string;
      /**
       * When the comment lives in one note of a shared notes part, that note's `w:id`.
       * StoryScope names the part; this names the note inside it.
       */
      readonly noteId?: number;
    };

export type AutomationCommentWriteResult =
  | { readonly ok: true; readonly changed: boolean; readonly commentId?: string }
  | { readonly ok: false; readonly reason: string };

export type AutomationPortApplyResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * A batch's ops, built at the moment the owner is about to commit them.
 *
 * A FUNCTION rather than an array because of one op: an external hyperlink names a relationship, and
 * a relationship is a package fact that outlives a refusal — it sits beside the trees, outside the
 * undo stack. Minting one while planning left a `Relationship` behind for a link the batch never
 * got, including on a document open for reading. So the planner validates the target and the owner
 * calls this AFTER its write gate has passed: `relate` mints (or reuses) the relationship for a
 * target, answering null for one the engine will not author.
 *
 * Answering null means "these ops cannot be built" and must leave the document untouched.
 */
export type AutomationStagedOps = (
  relate: (url: string) => string | null
) => readonly TreeDocOp[] | null;

/** Pure package updates committed atomically with the batch's tree operations. */
export type AutomationPackageEdit = (pkg: OoxmlPackage) => OoxmlPackage;

/** The outcome of a whole-document replacement, with a refusal already in protocol terms. */
export type AutomationDocumentReplaceResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly error: import('./protocol.ts').AutomationError };

export interface AutomationDocumentPort {
  prepare?(request: import('./protocol.ts').AutomationBatchRequest): Promise<void>;
  fieldPageContext?(
    story: import('./stories.ts').AutomationStoryId,
    paragraphId: string,
    fieldNodeId: string
  ): { pageNumber: number; pageNumberText?: string; pageCount: number } | null;
  /** This owner supports host-local Office-shaped tracking independently of browser UI modes. */
  readonly localChangeTracking?: true;
  /** True when a live collaboration session replicates package edits. */
  readonly collaborative?: () => boolean;
  /** The document compare engine a review module provides, when one is installed. */
  readonly compareDocuments?: import('../contracts/document-compare.ts').CompareDocumentsEngine;
  /**
   * True when this owner commits document setup (a built-in style a link needs) outside
   * shared undo in a collaboration session, so a collaborative write may add it.
   */
  readonly setupOutsideUndo?: () => boolean;
  /**
   * The collaboration actor this owner's commits mint ids under, or undefined when it has none.
   *
   * Return exactly the actor that `apply` binds for its transaction (`TransactOptions.actorId`
   * or `runWithTransactionActor`). The host plans each operation under it, because a planner
   * previews package allocations (a picture's `wp:docPr/@id`, relationship id and media part
   * name) that the commit then makes again. A different actor makes those commits refuse as
   * `package-changed`.
   */
  readonly allocationActor?: () => string | undefined;
  /** False when concurrent character insertion cannot retain tracked replacement coverage. */
  readonly trackedRangeReplacement?: () => boolean;
  /** The owner UI requires edits to be tracked even when this automation runtime is Off. */
  readonly suggesting?: () => boolean;
  /**
   * Monotonic document revision. One committed batch moves it exactly once.
   *
   * Package-wide rather than per-story: a host answers for a document, and a consumer's
   * `expectedRevision` has to be invalidated by any edit to it.
   */
  revision(): number;
  /**
   * The canonical package, or null when the owner currently has none (a browser host between
   * mounts). Every read the protocol answers is derived from this and nothing else — never
   * from a projection, a layout, or painted DOM.
   */
  currentPackage(): OoxmlPackage | null;
  /**
   * Which revision halves the owner's reader is LOOKING at, when there is a reader.
   *
   * The FORMATTING lanes need it, and only this port can supply it: a range's offsets cover
   * every revision half whatever the view does with them, so "which runs does this span
   * format" has a different answer in All Markup than in the resolved result. A browser host
   * answers with the surface's own mode, so the object model and the toolbar agree over the
   * same selection instead of drifting the moment the review module turns markup on.
   *
   * Absent on a headless owner, which has no reader and therefore no view: the lane then reads
   * the proposed result — the text that survives — which is what a caller with no opinion means.
   */
  revisionDisplayMode?(): FormattingDisplayMode;
  /**
   * Where a replacement for `[start, end)` of a paragraph lands under the owner's editing
   * mode, or null when the edit would not be tracked — the surface's own landing rule.
   *
   * A scripted `Replace` in suggesting mode strikes the words and must put the new text after
   * them, as typing does; the planner has no editing mode of its own, so it asks. Absent on a
   * headless owner, which writes nothing tracked.
   */
  replacementLanding?(paragraphId: string, start: number, end: number): number | null;
  /**
   * Commit ops as ONE transaction against ONE story.
   *
   * Ordered and atomic is the port's contract, not the caller's convention: on any rejection
   * the owner must leave revision, tree and subscribers exactly as they were.
   *
   * The scope is the caller's, because the caller is the only one who knows which story the
   * batch addressed. A port that assumed the body would silently refuse every header and note
   * op — the ids are not in the body's index — and a port that guessed from the ops would be a
   * second story resolver disagreeing with the reads.
   *
   * The ops arrive as {@link AutomationStagedOps} so the relationship an external hyperlink needs is
   * minted here, INSIDE the owner's write gate, rather than while the batch was still being planned.
   */
  apply(
    staged: AutomationStagedOps,
    scope: StoryScope,
    packageEdits?: readonly AutomationPackageEdit[],
    requiresReview?: boolean
  ): AutomationPortApplyResult;
  /**
   * Commit ONE package-level op — a note or furniture lifecycle — as its own transaction.
   *
   * Separate from `apply` because it is a different transaction: the store rewrites several parts
   * at once and publishes one package undo unit, which cannot be staged inside a story's
   * transaction. The planner has already refused the op any company, so a batch reaching here
   * holds exactly this one command and atomicity still means what it says.
   */
  applyLifecycle(op: TreeDocOp): AutomationPortApplyResult;
  /**
   * Commit comment writes as one package transaction.
   *
   * A third path rather than an op, because a comment is not a tree edit: a reply writes the story
   * markers AND `comments.xml` AND `commentsExtended.xml` AND their relationships AND their
   * content types, and the engine already spells that as one package transaction (`addComment`).
   * Expressing it as `TreeDocOp`s would mean a second implementation of the same write, and the
   * two would diverge on the part a document happens not to have.
   *
   * Reply and resolve writes are solitary. Delete writes may be batched with other deletes, so one
   * `sync()` that removes several objects remains atomic and produces one undo unit.
   */
  applyCommentWrites(
    writes: readonly AutomationCommentWrite[],
    scope: StoryScope
  ): AutomationCommentWriteResult;
  /**
   * Commit ONE custom-node write — the data part, the node in it, and the bound control.
   *
   * A fourth path for the same reason as the third: a payload is not a tree edit. It is a part
   * this document may not have yet, a relationship, a content-type override and a `w:sdt` that
   * quotes the id the part was given, and the store already spells that as one transaction. A
   * batch that expressed it as `TreeDocOp`s would need a second implementation of the same
   * write, and the two would disagree on the document that arrives with no store.
   *
   * Solitary, like the comment path: the planner refuses it any company, so a batch reaching
   * here is exactly one write and atomicity still means what it says.
   */
  applyCustomNodeWrite(write: InsertCustomNodeWrite, scope: StoryScope): AutomationPortApplyResult;
  /**
   * Replace the whole document with a DOCX file as ONE undoable package update.
   *
   * OPTIONAL: an owner without it refuses the operation. The owner opens the bytes as a load
   * opens them, aligns node ids with the open document, and records the difference as an ordinary
   * edit, so a collaboration session shares it. Every refusal leaves the document and its
   * history unchanged. Solitary: the planner refuses it any company.
   */
  replaceDocument?(docx: Uint8Array): AutomationDocumentReplaceResult;
  /** DOCX bytes through the normalizing serializer, or null when there is no document. */
  save(): Uint8Array | null;
  /**
   * Put a reader's selection or caret on a stretch of the body.
   *
   * OPTIONAL, and the one thing about a host that is genuinely not portable: a headless host
   * has no caret to move, so it omits this and reports `selection: false` rather than
   * pretending. Called AFTER the batch's transaction, never during it. Positions are canonical
   * paragraph ids and model offsets — the same vocabulary the ops take, so there is no second
   * coordinate space to keep in step.
   */
  select?(
    range: {
      readonly start: { readonly paragraphId: string; readonly offset: number };
      readonly end: { readonly paragraphId: string; readonly offset: number };
    },
    mode: 'select' | 'start' | 'end'
  ): boolean;
  /**
   * Why `select` cannot place a caret at this paragraph of this story now, or null. A host that
   * cannot open a header, footer or note (a read-only editor, or one no page shows) answers
   * here, so the sync refuses with a reason rather than moving nothing.
   */
  selectRefusal?(story: AutomationStoryId, paragraphId: string): string | null;
  /** Fires once per committed change. */
  subscribe(listener: () => void): () => void;
  /** Release what the port holds. Idempotent. */
  dispose(): void;
}
