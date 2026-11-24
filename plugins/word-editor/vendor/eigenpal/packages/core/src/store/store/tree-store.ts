import { createFormsTextReplacementContext } from './forms-text-replacement.ts';
import { restoreHistoryPackage } from './history-package-index.ts';
import { reportHistoryGroup, type HistoryGroup } from './history-group.ts';
import { withFieldResultsMode } from '../package/field-result-mode.ts';
import type { TransactOptions, TreeDocumentStoreOptions } from './tree-store-options.ts';
export type { TransactOptions, TreeDocumentStoreOptions } from './tree-store-options.ts';
import { textFormFieldForEdit } from './text-form-fields.ts';
import { applyProtectedTextFormEdit } from './tree-op-field-results.ts';
// Tree-backed document store with intent-scoped semantic history (tasks 5.2, 5.4-5.6).
//
// One transaction = one atomic publication = one history entry. `apply` stages ops against
// a working part; nothing is visible until `transact` returns, so a rejected op mid-batch
// leaves revision, tree, indexes and subscribers exactly as they were.
//
// HISTORY IS SCOPED BY INTENT, NOT BY A TIMER (design D10). A wall-clock coalescing window
// is the approach D10 rejects: it cannot reliably group an IME composition, whose
// transactions span an unbounded interval, and it just as easily merges across a projection
// reconciliation that should not be an entry at all. Here the caller states the scope — a
// transaction is one entry, a composition is one entry however many transactions it
// contains, and a projection-origin commit is none.
//
// Entries retain package snapshots and share unchanged tree nodes. History restores the
// package reference and transfers its node index instead of rebuilding complete lookup maps.

import { runWithTransactionActor } from '../package/actor-scoped-ids.ts';
import { validateOoxmlPartDelta, type OoxmlPart } from '../package/ooxml-tree.ts';
import { singlePartPackage, withPart, type OoxmlPackage } from '../package/ooxml-package.ts';
import { validatePackageInvariants } from '../package/package-edit.ts';
import { settingsPartOf } from '../package/note-properties.ts';
import { placeholderTextOf } from '../package/building-blocks.ts';
import { documentProtectionRefusal, lifecycleProtectionRefusal } from './forms-protection.ts';
import { isCommentPackageEdit } from './comment-package-edit.ts';
import { isPackageEditRefusal } from './package-edit-refusal.ts';
import { ORIGIN_IDS } from '../registry/frozen-ids.ts';
import {
  formsProtectionRefusal,
  enforcesFormsProtection,
  sectionProtectsForms,
} from './tree-op-content-controls.ts';
import { nextRevisionId } from './tree-op-revision-ids.ts';
import { PROPERTY_CHANGE_WRAPPER_OF_OP } from './tree-op-tracked-properties.ts';
import type { ContentLockPolicy, TransactionRevisionIds } from '../package/ooxml-edit.ts';

import {
  IMPORTS_REVISION_IDS,
  keepsRevisionCounter,
  TRACKED_WRAPPER_OPS,
} from './tree-store-revision-counter.ts';
import { applyTreeOp } from './tree-ops.ts';
import { contentLockPolicyOf } from './content-lock-policy.ts';
import type { ImpactClass, TreeDocOp, TreeOpRejection } from './tree-op-types.ts';

/** A selection the caller wants restored when an entry is undone or redone. */
/** A selection captured with a transaction, so undo restores where the caret was. */
export interface SelectionMark {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
}

/** Returns the mark when collapsed; otherwise undefined. */
function collapsedSelection(mark: SelectionMark | null): SelectionMark | undefined {
  if (mark === null || mark.start !== mark.end) return undefined;
  return mark;
}

/**
 * Which editable story a ModelChange came from.
 *
 * Mirrors `EditorScope` for body and header/footer — `{ kind: 'headerFooter'; rId }` —
 * so package-aware mutation and the public scope contract stay one vocabulary. Body
 * commits omit `rId`; header/footer commits carry the relationship id that addressed
 * the part. Notes parts use `{ kind: 'notesPart'; noteKind }` (one store per part).
 */
/** Which story a transaction targets: the body, a header/footer part, or a notes part. */
export type TreeStoryRef =
  | { readonly kind: 'body'; readonly partName: string }
  | { readonly kind: 'headerFooter'; readonly partName: string; readonly rId: string }
  | {
      readonly kind: 'notesPart';
      readonly partName: string;
      readonly noteKind: 'footnote' | 'endnote';
    };

/**
 * What one committed transaction changed: the revision, the ids touched, and the impact class.
 *
 * The ids are what let layout and paint re-do only the affected blocks instead of the document.
 */
export interface TreeModelChange {
  readonly change: 'model-change';
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly commitId: string;
  readonly origin: string;
  /** Stable collaboration actor attribution, when the caller supplied it. */
  readonly actorId?: string;
  /** Stable collaboration operation identity, when the caller supplied it. */
  readonly operationId?: string;
  readonly dirty: readonly string[];
  readonly created: readonly string[];
  readonly deleted: readonly string[];
  readonly splitJoin: readonly (
    | { readonly split: { readonly from: string; readonly tail: string } }
    | { readonly join: { readonly kept: string; readonly removed: string } }
  )[];
  readonly dependencyKeys: readonly string[];
  /** The widest impact among the transaction's ops — what layout must scope to. */
  readonly impact: ImpactClass;
  /**
   * Story that published this change. Absent on body-only store publishes that predate
   * package-aware targeting; `TreePackageStore` always sets it.
   */
  readonly story?: TreeStoryRef;
  /**
   * Committed collapsed caret for this transaction, when one exists.
   * Matches history `selectionAfter` when that mark is collapsed; absent for explicit
   * null, non-collapsed explicit selection, or when no caret was committed.
   */
  readonly caret?: SelectionMark;
}

/** Whether a transaction committed, or the typed reason it was refused. */
export type TransactResult =
  | { readonly ok: true; readonly change: TreeModelChange | null }
  | { readonly ok: false; readonly reason: TreeOpRejection; readonly detail?: string };

/** What a transaction body is handed: the working tree, and the means to stage ops against it. */
export interface TransactionContext {
  /** Stage one op against the STORY part. Returns false once the transaction has failed. */
  apply(op: TreeDocOp): boolean;
  /**
   * Stage one op against a named part.
   *
   * A comment body lives in `comments.xml` and is edited by the same ops that edit the story,
   * so this is `apply` with the target named rather than a second vocabulary.
   */
  applyTo(partName: string, op: TreeDocOp): boolean;
  /**
   * Stage a whole-package edit: a new part, a relationship, a content-type override.
   *
   * The edit is a pure function of the working package, so a rejected transaction discards it
   * with everything else. Returning the SAME package is a no-op, not a failure — a primitive
   * that finds nothing to do says so that way.
   *
   * Engine package edits refuse by throwing the internal `PackageEditRefusal`
   * (`package-edit-refusal.ts`): the transaction is refused with its reason, `package-changed`
   * by default, and nothing is applied. Any other throw escapes `transact` as a crash.
   */
  applyPackage(edit: (pkg: OoxmlPackage) => OoxmlPackage): boolean;
  /** The selection to restore when this entry is undone. */
  selectionBefore(selection: SelectionMark | null): void;
  /** The selection to restore when this entry is redone. */
  selectionAfter(selection: SelectionMark | null): void;
}

interface HistoryEntry {
  /**
   * The whole package as it was, not just the story part.
   *
   * Affordable for the same reason a part snapshot was: parts are immutable and deep-frozen, so
   * a package snapshot is a Map of references and every part the transaction did not touch is
   * object-identical to the one before it. Undo stays a pointer swap, and it now reverses every
   * part one intent wrote rather than only the story.
   */
  readonly pkg: OoxmlPackage;
  readonly revision: number;
  readonly selectionBefore: SelectionMark | null;
  readonly selectionAfter: SelectionMark | null;
  /**
   * The gesture this entry is still collecting, while it is the newest entry and nothing
   * has closed it. Only ever set on the top of the undo stack: {@link closeHistoryGroup}
   * strips it, and undo and redo never copy it onto the entries they push.
   */
  readonly group?: HistoryGroup;
}

const IMPACT_RANK: Record<ImpactClass, number> = {
  'text-local': 0,
  'paragraph-local': 1,
  'flow-structural': 2,
  global: 3,
};

/**
 * Opaque document+history checkpoint for package-coordinator rollback.
 * Used when a story mutation may promote to a package undo unit (note-ref cascade).
 */
/** A restorable point in history — one entry of the intent-scoped undo stack. */
export interface TreeDocumentCheckpoint {
  /**
   * The whole package, not one part. The store owns the package so a transaction spanning
   * several parts is one publication — a checkpoint of only the story part could not roll
   * back the comment or numbering part the same transaction wrote.
   */
  readonly pkg: OoxmlPackage;
  readonly revision: number;
  readonly undoStack: readonly HistoryEntry[];
  readonly redoStack: readonly HistoryEntry[];
  readonly composition: {
    readonly entry: HistoryEntry;
    readonly committed: boolean;
  } | null;
}

const openTransactions = new WeakMap<TreeDocumentStore, () => OoxmlPart>();

/** @internal The story part as the open transaction has left it so far, else the published one. */
export function transactionStoryPart(store: TreeDocumentStore): OoxmlPart {
  return openTransactions.get(store)?.() ?? store.part;
}

/**
 * The document store: one transaction is one atomic publication and one history entry.
 *
 * `apply` STAGES ops against a working part and nothing is visible until `transact` returns, so a
 * batch rejected halfway leaves the revision, the tree, the indexes and every subscriber exactly
 * as they were. That all-or-nothing property is what lets a caller compose ops without having to
 * reason about partial application.
 */
export class TreeDocumentStore {
  private current: OoxmlPackage;
  /** The part `apply` targets and `part` returns: the story this store is editing. */
  private readonly storyPartName: string;
  private rev = 0;
  private commitCounter = 0;
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private pushCount = 0;
  private readonly subscribers = new Set<(change: TreeModelChange) => void>();
  private readonly historyLimit: number;
  /** See {@link TreeDocumentStoreOptions.settingsPart}. */
  private readonly settingsPartOverride: (() => OoxmlPart | null | undefined) | undefined;
  private readonly placeholderTextOverride: ((docPart: string) => string | undefined) | undefined;
  /** See {@link TreeDocumentStoreOptions.contentLockPolicy}. */
  private readonly contentLockPolicy: ContentLockPolicy | undefined;
  /** Package-aware story tag applied to publishes (including undo/redo). */
  private storyRef: TreeStoryRef | null = null;

  /** Open composition, if any. While set, transactions extend one entry (task 5.5). */
  private composition: {
    readonly entry: HistoryEntry;
    /** Whether any transaction inside the composition actually committed. */
    committed: boolean;
  } | null = null;

  /**
   * Open a store over a package, editing the named story part.
   *
   * A bare part is accepted and wrapped in a single-part package, so callers that never open a
   * real package — tests, headless tooling — are unaffected by the widening.
   */
  constructor(
    source: OoxmlPart | OoxmlPackage,
    storyPartNameOrOptions?: string | TreeDocumentStoreOptions,
    maybeOptions: TreeDocumentStoreOptions = {}
  ) {
    const isPart = 'root' in source;
    // The story name was added in front of the options, so the two-argument form that predates
    // it still means what it always did. Overloading on the argument's type keeps every
    // existing call site — `new TreeDocumentStore(part, { historyLimit })` — working.
    const storyPartName =
      typeof storyPartNameOrOptions === 'string' ? storyPartNameOrOptions : undefined;
    const options =
      typeof storyPartNameOrOptions === 'object' && storyPartNameOrOptions !== null
        ? storyPartNameOrOptions
        : maybeOptions;
    this.current = isPart ? singlePartPackage(source) : source;
    this.storyPartName = storyPartName ?? (isPart ? source.name : source.mainDocumentPart);
    this.historyLimit = options.historyLimit ?? 200;
    this.settingsPartOverride = options.settingsPart;
    this.placeholderTextOverride = options.placeholderText;
    this.contentLockPolicy = contentLockPolicyOf(options.contentLockPolicy);
  }

  /**
   * Stamp story identity onto subsequent publishes for this store (including undo/redo).
   * Used by the package coordinator so history navigation keeps the same scope tag.
   */
  setStoryRef(story: TreeStoryRef | null): void {
    this.storyRef = story;
  }

  /** The story part being edited. Unchanged for every caller that predates the widening. */
  get part(): OoxmlPart {
    const story = this.current.parts.get(this.storyPartName);
    if (!story) throw new Error(`story part missing: ${this.storyPartName}`);
    return story;
  }

  /** Every part, including the ones a multi-part transaction wrote. */
  get package(): OoxmlPackage {
    return this.current;
  }
  get revision(): number {
    return this.rev;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  /** Retained entries — the unit `undo()` reverses, so tests can assert grouping. */
  get historyDepth(): number {
    return this.undoStack.length;
  }
  /**
   * How many entries this store has ever pushed. Monotonic, unlike `historyDepth`, which
   * stands still at the history limit because the oldest entry is shifted out.
   * @internal
   */
  get historyPushCount(): number {
    return this.pushCount;
  }
  get compositionActive(): boolean {
    return this.composition !== null;
  }

  /**
   * Replace the package OUTSIDE the transaction and history lanes.
   *
   * For package writes that are not a user intent and publish no revision: grafting
   * `numbering.xml` into a document that never had one, which the caller performs as a
   * precondition of the list op that follows. Those edits were previously kept in a package
   * variable beside the store, which meant two owners of one value and, predictably, two
   * values — a graft written to one and a save read from the other.
   *
   * Deliberately narrow and deliberately awkward to reach for: anything a user did belongs in
   * `transact`, where it gets a revision, an undo entry and the invariant checks.
   */
  graftPackage(edit: (pkg: OoxmlPackage) => OoxmlPackage): void {
    this.current = edit(this.current);
  }

  /**
   * Replace the current part without recording history, but advance the revision so
   * revision-keyed projections cannot survive a package snapshot install.
   */
  replacePart(part: OoxmlPart): void {
    const existing = this.current.parts.get(part.name);
    if (part === existing) return;
    this.current = withPart(this.current, part);
    this.rev += 1;
  }

  /**
   * Snapshot part, revision, and undo/redo stacks so the package coordinator can roll
   * back a story transaction that fails after commit (e.g. note-reference cascade) or
   * discard a local history entry when promoting to a package undo unit.
   */
  checkpoint(): TreeDocumentCheckpoint {
    return {
      pkg: this.current,
      revision: this.rev,
      undoStack: this.undoStack.slice(),
      redoStack: this.redoStack.slice(),
      composition: this.composition
        ? { entry: { ...this.composition.entry }, committed: this.composition.committed }
        : null,
    };
  }

  /** Full restore — part, revision, history stacks, and composition. */
  restoreCheckpoint(checkpoint: TreeDocumentCheckpoint): void {
    this.current = checkpoint.pkg;
    this.rev = checkpoint.revision;
    this.undoStack.length = 0;
    this.undoStack.push(...checkpoint.undoStack);
    this.redoStack.length = 0;
    this.redoStack.push(...checkpoint.redoStack);
    this.composition = checkpoint.composition
      ? { entry: { ...checkpoint.composition.entry }, committed: checkpoint.composition.committed }
      : null;
  }

  /**
   * Restore undo/redo stacks only, keeping the current part and revision.
   * Used when a story mutation is promoted to a package history pointer so the local
   * orphan entry does not steal a later undo.
   */
  restoreHistoryStacks(checkpoint: TreeDocumentCheckpoint): void {
    this.undoStack.length = 0;
    this.undoStack.push(...checkpoint.undoStack);
    this.redoStack.length = 0;
    this.redoStack.push(...checkpoint.redoStack);
  }

  subscribe(listener: (change: TreeModelChange) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /**
   * Run one atomic transaction.
   *
   * Ops are staged against a working copy. On the first rejection the whole transaction is
   * abandoned: no revision, no history entry, no notification. On success exactly one
   * revision is published and exactly one history entry is recorded — unless a composition
   * is open, in which case the entry already exists and this transaction joins it.
   */
  transact(
    build: (ctx: TransactionContext) => void,
    options: TransactOptions = {}
  ): TransactResult {
    return runWithTransactionActor(options.actorId, () =>
      withFieldResultsMode(options.fieldResults, () => this.commitTransaction(build, options))
    );
  }

  private commitTransaction(
    build: (ctx: TransactionContext) => void,
    options: TransactOptions
  ): TransactResult {
    const origin = options.origin ?? ORIGIN_IDS.mutationHuman;
    // A PROJECTION-origin commit reconciles the view with state the store already holds.
    // It publishes a revision so consumers can re-derive, but it is not a user intent, so
    // it must not become an undo step (task 5.6).
    const recordsHistory =
      options.recordsHistory ??
      (origin !== ORIGIN_IDS.projection && origin !== ORIGIN_IDS.awareness);
    // An intent naming another gesture (or none) closes the open one HERE, whether it goes
    // on to land, to change nothing or to be refused: the same input class, one rule. A
    // frame of the same gesture leaves it open for the extension below.
    const top = this.undoStack[this.undoStack.length - 1];
    if (recordsHistory && !this.composition && top?.group !== options.historyGroup) {
      this.closeHistoryGroup();
    }
    const before = this.current;
    const beforeRevision = this.rev;

    let working = this.current;
    let failure: { reason: TreeOpRejection; detail?: string } | null = null;
    let applied = 0;
    /** Parts this transaction rewrote, so the commit validates those and no others. */
    const touched = new Set<string>();
    const dirty = new Set<string>();
    const created = new Set<string>();
    const deleted = new Set<string>();
    const dependencyKeys = new Set<string>();
    const splitJoin: TreeModelChange['splitJoin'][number][] = [];
    let impact: ImpactClass = options.minimumImpact ?? 'text-local';
    let selectionBefore: SelectionMark | null = null;
    let selectionAfterExplicit = false;
    let explicitSelectionAfter: SelectionMark | null = null;
    let opCaret: SelectionMark | null = null;

    /**
     * ONE `@w:id` for the format records of this transaction, per part and per WRAPPER NAME.
     *
     * Two problems, one answer. `nextRevisionId` walks the whole part, and a formatting write
     * emits an op per RUN — so a Select All + Bold in suggesting mode paid a document-wide
     * walk thousands of times over, quadratic in document size. And one press is ONE decision:
     * cards group on `localName` plus the address, so a fresh id per record turned a two-
     * paragraph Bold into seven cards the reviewer had to answer one at a time, where Word
     * writes one. A revision spanning many elements that share an id is the shape this module
     * is built around.
     *
     * PER WRAPPER NAME because the grouping is, and the CARD is not. `w:rPrChange` and
     * `w:pPrChange` are both `format` revisions, so two cards built from one address carry the
     * same key — one of them unreachable in the rail, both matched by `setActiveReviewItem`,
     * and React handed two children under one key. Worse, `resolveRevisions` matches on the
     * address alone unless the op names an element, and the chrome path never does: answering
     * the run's card silently answered a paragraph-property change the reviewer never saw.
     *
     * Shared only across the property ops, and dropped the moment anything else runs —
     * including `applyPackage`. Those ops MINT ids and never import one, so an id taken before
     * the first of them is still free when the last lands. A paste carries its own revision
     * ids, so an id that survived one would be an address the document had just started using.
     * The id itself comes from the per-part minter below, which every tracked lane shares.
     */
    const revisionIdOfGroup = new Map<string, { id: string | null }>();
    /**
     * ONE `nextRevisionId` walk per part per transaction, shared by every tracked lane. The
     * property groups above and the text ops below draw from the same counter, so an id a
     * `w:rPrChange` took is never handed to the `w:ins` written next — two counters, each
     * walking the part for itself, did exactly that once one of them cached its walk. What it
     * hands out is remembered, which is the other half of `TransactionRevisionIds`.
     */
    const revisionIdsOfPart = new Map<
      string,
      { mint: (() => string) | null; readonly written: Set<string> }
    >();
    /**
     * The bookkeeping for one part, bound to the part AS IT STANDS FOR THIS OP.
     *
     * The counter is memoized in the map, the closure over it is not: an applier is handed a
     * new part after every op, and a walk that captured the first one it ever saw re-walked
     * that stale snapshot whenever the counter was dropped — handing back an id the same
     * transaction had already used, which is the very collision this is here to prevent.
     */
    const revisionIdsFor = (part: OoxmlPart): TransactionRevisionIds => {
      let held = revisionIdsOfPart.get(part.name);
      if (!held) {
        held = { mint: null, written: new Set<string>() };
        revisionIdsOfPart.set(part.name, held);
      }
      const state = held;
      return {
        // The walk itself is LAZY: an untracked transaction never pays for one.
        mint: (): string => (state.mint ??= nextRevisionId(part))(),
        wrote: (key: string): void => void state.written.add(key),
        wroteUnder: (key: string): boolean => state.written.has(key),
      };
    };
    /** Drop the counters; the next mint walks the part it is given. The record stays. */
    const resetRevisionCounters = (): void => {
      for (const held of revisionIdsOfPart.values()) held.mint = null;
    };
    const sharedRevisionIds = (op: TreeDocOp, part: OoxmlPart): (() => string) | null => {
      const wrapper = PROPERTY_CHANGE_WRAPPER_OF_OP.get(op.op);
      if (wrapper === undefined) {
        revisionIdOfGroup.clear();
        return null;
      }
      const key = `${part.name}\u0000${wrapper}`;
      let group = revisionIdOfGroup.get(key);
      if (!group) {
        group = { id: null };
        revisionIdOfGroup.set(key, group);
      }
      // Taken LAZILY on the first record actually written, so an untracked format — the
      // common case — never pays the walk at all.
      const held = group;
      return (): string => (held.id ??= revisionIdsFor(part).mint());
    };

    /**
     * The tracked TEXT ops' bookkeeping. The COUNTER is dropped, like the property group, the
     * moment anything else runs (`applyPackage` included): a paste re-mints the ids it carries
     * against the part as it stands, and a walk taken before it would hand out an id the paste
     * just used. Only `keepsRevisionCounter` ops, which add no id, leave it standing. What this
     * transaction WROTE survives all of it — a record of the past cannot go stale, and the
     * replacement rule reads it after ops that mint nothing.
     */
    const trackedRevisionIdsFor = (
      op: TreeDocOp,
      part: OoxmlPart
    ): TransactionRevisionIds | null => {
      const writes = TRACKED_WRAPPER_OPS.has(op.op);
      // A property op keeps the counter: its group takes one id and imports none.
      if (!writes && PROPERTY_CHANGE_WRAPPER_OF_OP.get(op.op) !== undefined) return null;
      if (writes ? IMPORTS_REVISION_IDS.has(op.op) : !keepsRevisionCounter(op)) {
        resetRevisionCounters();
      }
      return writes ? revisionIdsFor(part) : null;
    };

    const retainFormControl = createFormsTextReplacementContext();
    let fillingField: { partName: string; paragraphId: string; fieldNodeId: string } | null = null;
    const applyToPart = (partName: string, op: TreeDocOp): boolean => {
      if (failure) return false;
      const target = working.parts.get(partName);
      if (!target) {
        failure = { reason: 'unknown-part', detail: partName };
        return false;
      }
      op = retainFormControl(target, this.settingsPartOverride?.() ?? settingsPartOf(working), op);
      // Forms protection lives in `settings.xml`, one part up from the op, so it is resolved
      // HERE rather than in the per-part applier: a part alone cannot see whether the document
      // it belongs to is protected.
      const protection =
        documentProtectionRefusal(this.settingsPartOverride?.() ?? settingsPartOf(working), op) ??
        formsProtectionRefusal(
          target,
          this.settingsPartOverride?.() ?? settingsPartOf(working),
          op,
          fillingField?.partName === partName &&
            'paragraphId' in op &&
            fillingField.paragraphId === op.paragraphId
            ? fillingField.fieldNodeId
            : undefined
        );
      if (protection) {
        failure = { reason: protection };
        return false;
      }
      // Validation of the whole part is DEFERRED to the commit below: per-op it made a
      // many-op transaction quadratic in document size, and nothing between here and the
      // commit can observe the intermediate parts. Op-level input validation still runs
      // inside `applyTreeOp` before any tree work.
      const revisionIds = sharedRevisionIds(op, target);
      const trackedRevisionIds = trackedRevisionIdsFor(op, target);
      const settings = this.settingsPartOverride?.() ?? settingsPartOf(working);
      const formField =
        enforcesFormsProtection(settings) &&
        'paragraphId' in op &&
        sectionProtectsForms(target, op.paragraphId)
          ? textFormFieldForEdit(
              target,
              op,
              fillingField?.partName === partName && fillingField.paragraphId === op.paragraphId
                ? fillingField.fieldNodeId
                : undefined
            )
          : null;
      fillingField =
        formField && 'paragraphId' in op
          ? { partName, paragraphId: op.paragraphId, fieldNodeId: formField.fieldNodeId }
          : null;
      const editOptions = {
        deferValidation: true,
        placeholderText:
          this.placeholderTextOverride ??
          ((docPart: string) => placeholderTextOf(working, docPart)),
        ...(this.contentLockPolicy ? { contentLockPolicy: this.contentLockPolicy } : {}),
        ...(revisionIds ? { revisionIds } : {}),
        ...(trackedRevisionIds ? { trackedRevisionIds } : {}),
      };
      const result = formField
        ? applyProtectedTextFormEdit(target, op, formField, editOptions)
        : applyTreeOp(target, op, editOptions);
      if (!result.ok) {
        failure = { reason: result.reason, ...(result.detail ? { detail: result.detail } : {}) };
        return false;
      }
      // AFTER an importing op, not only before it: the op writes a wrapper of its own, so it
      // re-establishes the counter while it runs — against the part as it stood before its
      // own content arrived. Left standing, the next op would mint from a walk that never saw
      // the ids that came in with it.
      if (IMPORTS_REVISION_IDS.has(op.op)) resetRevisionCounters();
      working = withPart(working, result.part);
      const identityNoOp =
        result.part === target &&
        result.effect.dirty.length === 0 &&
        result.effect.created.length === 0 &&
        result.effect.deleted.length === 0 &&
        result.effect.split === undefined &&
        (result.effect.splits === undefined || result.effect.splits.length === 0) &&
        result.effect.join === undefined &&
        result.effect.caret === undefined;
      if (identityNoOp) return true;
      touched.add(partName);
      applied += 1;
      for (const id of result.effect.dirty) dirty.add(id);
      for (const id of result.effect.created) created.add(id);
      for (const id of result.effect.deleted) deleted.add(id);
      for (const key of result.effect.dependencyKeys) dependencyKeys.add(key);
      if (result.effect.split) splitJoin.push({ split: result.effect.split });
      for (const split of result.effect.splits ?? []) splitJoin.push({ split });
      if (result.effect.join) splitJoin.push({ join: result.effect.join });
      if (IMPACT_RANK[result.effect.impact] > IMPACT_RANK[impact]) impact = result.effect.impact;
      if (result.effect.caret) {
        const at = result.effect.caret.offset ?? 0;
        opCaret = { paragraphId: result.effect.caret.paragraphId, start: at, end: at };
      }
      return true;
    };

    // Gates outside the store read the working story: each op moves the node index to its
    // new root, so a lookup on the published root after the first op re-walked the part.
    const outer = openTransactions.get(this);
    openTransactions.set(this, () => working.parts.get(this.storyPartName) ?? this.part);
    try {
      build({
        apply: (op) => applyToPart(this.storyPartName, op),
        applyTo: (partName, op) => applyToPart(partName, op),
        applyPackage: (edit) => {
          if (failure) return false;
          // The package channel imports and rewrites whole parts, so it needs the document-wide
          // refusal as much as the per-op one does: comment deletion and thread resolution reach
          // the story's own `w:commentRangeStart` through here, and nothing else would stop them
          // in a document protected read-only.
          // `documentProtectionRefusal`, NOT the lifecycle one: forms protection is not
          // document-scoped here. A story transaction carries a package edit whenever it
          // touches resources, and the collaboration and automation lanes append one
          // unconditionally — judging those document-scoped refused every collaborative and
          // scripted fill of the very fields forms protection exists to permit.
          const settings = this.settingsPartOverride?.() ?? settingsPartOf(working);
          const packageProtection = isCommentPackageEdit(edit)
            ? lifecycleProtectionRefusal(settings, { op: 'comment' })
            : documentProtectionRefusal(settings);
          if (packageProtection) {
            failure = { reason: packageProtection };
            return false;
          }
          // The SECOND write channel, and it imports whole parts — a pasted fragment carries
          // its own revision ids. The shared id is taken from the part it first saw, so it goes
          // here for the same reason a non-property op drops it.
          revisionIdOfGroup.clear();
          resetRevisionCounters();
          let next: OoxmlPackage;
          try {
            next = edit(working);
          } catch (error) {
            if (!isPackageEditRefusal(error)) throw error;
            failure = { reason: error.reason, detail: error.message };
            return false;
          }
          if (next === working) return true;
          for (const [name, part] of next.parts) {
            if (working.parts.get(name) !== part) touched.add(name);
          }
          working = next;
          applied += 1;
          // A new or removed part re-flows nothing by itself, but the caller pairs it with the
          // story edit that references it, and that edit reports its own impact.
          if (IMPACT_RANK['flow-structural'] > IMPACT_RANK[impact]) impact = 'flow-structural';
          return true;
        },
        selectionBefore: (selection) => {
          selectionBefore = selection;
        },
        selectionAfter: (selection) => {
          selectionAfterExplicit = true;
          explicitSelectionAfter = selection;
        },
      });
    } finally {
      if (outer) openTransactions.set(this, outer);
      else openTransactions.delete(this);
    }

    if (failure) {
      const rejection = failure as { reason: TreeOpRejection; detail?: string };
      return {
        ok: false,
        reason: rejection.reason,
        ...(rejection.detail ? { detail: rejection.detail } : {}),
      };
    }
    if (applied === 0) return { ok: true, change: null };

    const selectionAfter = selectionAfterExplicit ? explicitSelectionAfter : opCaret;

    const committedCaret = selectionAfterExplicit
      ? collapsedSelection(explicitSelectionAfter)
      : (opCaret ?? undefined);

    // The commit boundary is where fail-closed lives now: the SAME invariant rules the
    // primitives used to run each, applied once to the final tree. Validated as a DELTA
    // against the tree this transaction started from — that tree was validated when it was
    // published, and structural sharing means everything the ops did not touch is object-
    // identical to it, so only the changed subtrees need walking. An invalid result
    // abandons the whole transaction — no revision, no history entry, no notification —
    // exactly as a per-op rejection would have, so nothing invalid is ever published.
    for (const name of touched) {
      const previous = before.parts.get(name);
      const next = working.parts.get(name);
      if (next === undefined) continue;
      // A part this transaction CREATED has no previous tree to diff against, so it is
      // validated whole; an edited part is validated as a delta, because everything the ops
      // did not touch is object-identical to a tree that was already validated.
      const validation = previous
        ? validateOoxmlPartDelta(previous, next)
        : validateOoxmlPartDelta(next, next);
      if (!validation.ok) {
        return {
          ok: false,
          reason: 'tree-invariant',
          detail: JSON.stringify(validation.issues),
        };
      }
    }

    // Package invariants are checked HERE and nowhere else, for the same reason part
    // validation moved to the commit: a transaction may pass through a package that has a
    // relationship to a part it has not created yet, as long as nothing can observe it. What
    // must never be published is a package Word refuses to open.
    const packageValidation = validatePackageInvariants(working);
    if (!packageValidation.ok) {
      return {
        ok: false,
        reason: 'package-invariant',
        detail: JSON.stringify(packageValidation.issues),
      };
    }

    if (recordsHistory) {
      if (this.composition) {
        // Inside a composition every transaction folds into the entry opened at
        // compositionstart — however many transactions the IME emits (task 5.5).
        reportHistoryGroup(options.historyGroup, 'split', 'composition');
        this.composition.committed = true;
        this.composition = {
          ...this.composition,
          entry: { ...this.composition.entry, selectionAfter },
        };
      } else {
        const group = options.historyGroup;
        const top = this.undoStack[this.undoStack.length - 1];
        if (group !== undefined && top !== undefined && top.group === group) {
          // Same gesture, still open: the entry keeps its `pkg` and `selectionBefore` — the
          // state before the FIRST frame — and takes this frame's selection as its end.
          this.undoStack[this.undoStack.length - 1] = {
            ...top,
            selectionAfter: selectionAfter ?? top.selectionAfter,
          };
        } else {
          this.pushUndo({
            pkg: before,
            revision: beforeRevision,
            selectionBefore,
            selectionAfter,
            group,
          });
        }
        reportHistoryGroup(group, top?.group === group ? 'extended' : 'started');
        this.redoStack.length = 0;
      }
    }

    this.current = working;
    this.rev += 1;
    if (options.story) this.storyRef = options.story;
    if (options.minimumImpact && IMPACT_RANK[options.minimumImpact] > IMPACT_RANK[impact]) {
      impact = options.minimumImpact;
    }
    return {
      ok: true,
      change: this.publish(
        origin,
        beforeRevision,
        {
          dirty,
          created,
          deleted,
          dependencyKeys,
          splitJoin,
          impact,
          caret: committedCaret,
        },
        options.story ?? this.storyRef ?? undefined,
        options.actorId,
        options.operationId
      ),
    };
  }

  /**
   * Open one history entry for an IME composition.
   *
   * Everything committed until `endComposition` collapses into this single entry, which is
   * what makes a composed word one undo step rather than one per intermediate transaction.
   */
  beginComposition(selectionBefore: SelectionMark | null = null): void {
    if (this.composition) return; // already open; nested starts are a no-op, not an error
    this.composition = {
      entry: {
        pkg: this.current,
        revision: this.rev,
        selectionBefore,
        selectionAfter: null,
      },
      committed: false,
    };
  }

  /** Close the composition, recording its entry only if anything actually committed. */
  endComposition(): void {
    const open = this.composition;
    this.composition = null;
    if (!open || !open.committed) return;
    this.pushUndo(open.entry);
    this.redoStack.length = 0;
  }

  /**
   * Cancel an open composition without recording an entry, leaving whatever it committed
   * in place. An IME cancel is not an undo request; the caller decides what to revert.
   */
  cancelComposition(): void {
    this.composition = null;
  }

  /**
   * Close the open history group, if any: the next transaction records its own entry.
   * The store does this itself for another token, none, undo and redo; the package
   * coordinator does it for history moving ABOVE the store (a package unit, another
   * story's pointer), which the store cannot see.
   */
  closeHistoryGroup(): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top === undefined || top.group === undefined) return;
    this.undoStack[this.undoStack.length - 1] = { ...top, group: undefined };
  }

  undo(): TreeModelChange | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    // Undo is a boundary: the entry now on top must not collect a gesture that resumes
    // after it, and the one pushed to redo carries no group either.
    this.closeHistoryGroup();
    const beforeRevision = this.rev;
    this.redoStack.push({
      pkg: this.current,
      revision: this.rev,
      selectionBefore: entry.selectionBefore,
      selectionAfter: entry.selectionAfter,
    });
    this.current = restoreHistoryPackage(this.current, entry.pkg);
    this.rev += 1;
    return this.publish(ORIGIN_IDS.mutationUndo, beforeRevision, null, this.storyRef ?? undefined);
  }

  redo(): TreeModelChange | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.closeHistoryGroup();
    const beforeRevision = this.rev;
    this.undoStack.push({
      pkg: this.current,
      revision: this.rev,
      selectionBefore: entry.selectionBefore,
      selectionAfter: entry.selectionAfter,
    });
    this.current = restoreHistoryPackage(this.current, entry.pkg);
    this.rev += 1;
    return this.publish(ORIGIN_IDS.mutationRedo, beforeRevision, null, this.storyRef ?? undefined);
  }

  /** The selection to restore for the entry `undo()` would reverse next. */
  selectionForUndo(): SelectionMark | null {
    return this.undoStack[this.undoStack.length - 1]?.selectionBefore ?? null;
  }

  /** The selection to restore for the entry `redo()` would reapply next. */
  selectionForRedo(): SelectionMark | null {
    return this.redoStack[this.redoStack.length - 1]?.selectionAfter ?? null;
  }

  /**
   * Remove the newest undo entry and answer its selections, for the package coordinator
   * when a package history group absorbs the story pointer that entry belonged to.
   * @internal
   */
  discardNewestUndoEntry(): Pick<HistoryEntry, 'selectionBefore' | 'selectionAfter'> | null {
    const entry = this.undoStack.pop();
    return entry
      ? { selectionBefore: entry.selectionBefore, selectionAfter: entry.selectionAfter }
      : null;
  }

  private pushUndo(entry: HistoryEntry): void {
    this.pushCount += 1;
    this.undoStack.push(entry);
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
  }

  private publish(
    origin: string,
    fromRevision: number,
    effects: {
      dirty: Set<string>;
      created: Set<string>;
      deleted: Set<string>;
      dependencyKeys: Set<string>;
      splitJoin: TreeModelChange['splitJoin'][number][];
      impact: ImpactClass;
      caret?: SelectionMark;
    } | null,
    story?: TreeStoryRef,
    actorId?: string,
    operationId?: string
  ): TreeModelChange {
    this.commitCounter += 1;
    const change: TreeModelChange = {
      change: 'model-change',
      fromRevision,
      toRevision: this.rev,
      commitId: `commit-${this.commitCounter}`,
      origin,
      ...(actorId ? { actorId } : {}),
      ...(operationId ? { operationId } : {}),
      dirty: effects ? [...effects.dirty] : [],
      created: effects ? [...effects.created] : [],
      deleted: effects ? [...effects.deleted] : [],
      splitJoin: effects ? effects.splitJoin : [],
      dependencyKeys: effects ? [...effects.dependencyKeys] : [],
      // Undo and redo restore a whole previous tree, so their reach is not knowable from
      // one op's effect — treat them as structural and let layout re-derive. Header/footer
      // story undos stay `global` so shared furniture cannot go stale.
      impact: effects
        ? effects.impact
        : story?.kind === 'headerFooter'
          ? 'global'
          : 'flow-structural',
      ...(effects?.caret ? { caret: effects.caret } : {}),
      ...(story ? { story } : {}),
    };
    // Subscribers are outside the store call: they read in the default mode, never in the
    // transaction's editable field-result mode.
    withFieldResultsMode('atomic', () => {
      for (const listener of this.subscribers) listener(change);
    });
    return change;
  }
}
