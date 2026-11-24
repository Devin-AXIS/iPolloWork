// Where a destructive or replacing gesture acts, and what it takes (paginated-surface seam).
//
// One lane for the two questions every edit asks before it writes: which range the selection
// really covers at this revision, and — once a tracked strike has had its say — where content
// replacing that range belongs. `surface-selection-ops.ts` holds the pure half (document
// order, coverage, the deletion planner itself); this holds the BOUND half, the part that
// needs the session, the editing mode and the caret-format rules to answer.
//
// It lives here rather than in `surface-selection-ops.ts` because that module promises to be
// a plain input-to-output computation with no session and no DOM, and these functions read
// `session`, the editing mode and the configured author. Two shapes in one file would
// falsify that promise, which is what makes the pure half cheap to test.
//
// EVERY MUTABLE MOUNT LOCAL ARRIVES AS A GETTER, never as a captured value. `selection`,
// `currentLayout`, `cellSelection` and `editingMode` all move during a gesture, and
// `deleteSelectionPlan` is called from inside a commit whose head nulls the rectangle — so a
// snapshot taken at factory time would answer for a state the plan was not built from.
//
// The getters are also called AT THE ORIGINAL READ POINTS, not hoisted to the top of a
// function. `orderedRange()` flushes pending input, which republishes the layout, so a
// `deps.layout()` lifted above a flush would hand the caller the pre-flush revision — the
// stale-oracle bug this lane's own comments are about.

// The VIEW, not the concrete binding session: `paginated-surface.ts` is the only file in
// this lane allowed to name that one (`store/__tests__/prosemirror-isolation.test.ts`).
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import {
  findNode,
  formsProtectionEnabled,
  inlineControlEndingAt,
  inlineControlStartingAt,
  parentNodeOf,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import {
  paragraphTextFromLayout,
  paragraphsInCells,
  positionPastDeletion,
  type CellSelection,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core/layout';
import { directParagraphsInCells } from '../layout/semantic-cell-selection.ts';
import { retractedLengthOf, retractedRangesOf } from '../store/store/tree-op-retraction.ts';
import { trackedReplacementLanding } from './surface-tracked-ops.ts';
import { retractsOwnParagraphMark } from '../store/store/tree-op-tracked-marks.ts';
import { contentControlPropertiesOf } from '../store/package/content-control-nodes.ts';
import { findContentControl } from '../store/store/tree-op-nodes.ts';
import { enclosedBookmarkDeletions } from '../store/store/tree-op-bookmarks.ts';
import type { RevisionView } from './hidden-mark-joins.ts';
import { partOfNodeId } from './surface-scope.ts';
import {
  orderedRangeOf,
  planRangeDeletion,
  selectionMarkOf,
  type RangeDeletionPlan,
} from './surface-selection-ops.ts';
import type { SurfaceEditingMode } from './paginated-surface-contract.ts';
import {
  atomicControlDeletion as planAtomicControlDeletion,
  type AtomicControlDeletion,
  type InlineControlBesideCaret,
} from './surface-locked-control-delete.ts';
import {
  keepPromptsWhole,
  promptRemoval,
  promptSelected,
  promptsIn,
  selectionOverPrompts,
  type PlannedDeletion,
  type Prompt,
} from './surface-prompt-deletion.ts';

/** What this lane borrows from the mount closure. Mutable state arrives as a getter. */
export interface SurfaceRangeEditDeps {
  session: TreeDocxSessionView;
  /** The PUBLISHED layout, which is the text oracle every offset here is counted against. */
  layout(): SemanticLayout;
  selection(): SemanticSelection;
  /** The cell rectangle, or null. A rectangle is not the linear range it stands in for. */
  cellSelection(): CellSelection | null;
  editingMode(): SurfaceEditingMode;
  /** The configured tracked-change author, unnormalized — each reader trims its own. */
  author(): string | undefined;
  /** The stamp a tracked edit made now would carry; see `sameEditingMoment`. */
  trackedDate(): string;
  storyScope(): StoryScope;
  /** Scoped document order: a header/footer or note selection orders within its own story. */
  paragraphOrder(): readonly string[];
  /**
   * Land queued typing and any deferred layout pass.
   *
   * Every range consumer must see the selection and layout the typed text produced, or a
   * plan built from the pre-buffer selection edits beside text the user has already typed.
   */
  flushPendingInputAndLayout(): void;
  /** The author a tracked edit is attributed to, or undefined when the edit lands direct. */
  trackedAuthorOrNone(): string | undefined;
  /** `w:next` lane: whether an offset sits at the end of a paragraph's MODEL text. */
  atParagraphEnd(paragraphId: string, offset: number): boolean;
  /** The revision view the page is laid out in, which decides what a join may absorb. */
  revisionView(): RevisionView;
}

export interface SurfaceRangeEditOps {
  /** The current selection as a history mark — one paragraph or nothing. */
  selectionMark(): { paragraphId: string; start: number; end: number } | null;
  /** The selection in DOCUMENT order, whichever way the user dragged it. */
  orderedRange(): { from: SemanticPosition; to: SemanticPosition };
  orderedStart(): SemanticPosition;
  /** Model text of a paragraph, read back from the layout records. */
  textOf(paragraphId: string): string;
  inlineControlBeside(
    position: { readonly paragraphId: string; readonly offset: number },
    side: 'before' | 'after'
  ): InlineControlBesideCaret | null;
  /**
   * Backspace / Delete beside or over an atomic inline control (see `atomicControlDeletion`),
   * or into a prompt. `reach` is where a word deletion from a caret ends; it asks only about
   * prompts.
   */
  atomicControlDeletion(
    direction: 'backward' | 'forward',
    shown: (position: SemanticPosition) => SemanticPosition,
    reach?: number
  ): AtomicControlDeletion | null;
  /** The selection grown over every prompt it holds part of, or null; copy and cut read it. */
  selectionOverPrompts(): SemanticSelection | null;
  /** Whether the selection is exactly one prompt: a word deletion then leaves it as it is. */
  promptIsSelected(): boolean;
  splitEndsTheParagraph(position: SemanticPosition): boolean;
  deleteSelectionPlan(trackedAuthor?: string): RangeDeletionPlan;
  /** Typing keeps an ending prompt when the range starts outside that prompt. */
  typingSelectionPlan(): RangeDeletionPlan & { readonly outsidePromptId?: string };
  retainPromptBoundary(controlId?: string): void;
  clearPromptBoundary(): void;
  promptBoundary(): string | undefined;
  deleteSelectionOps(): readonly TreeDocOp[];
  /** The plan for an explicit range of the active story; the selection does not move. */
  deleteRangePlan(range: SemanticSelection): {
    readonly ops: readonly TreeDocOp[];
    readonly replaceAt: SemanticPosition;
  };
  replacementOffset(from: SemanticPosition, to: SemanticPosition, trackedAuthor?: string): number;
}

export function createSurfaceRangeEditOps(deps: SurfaceRangeEditDeps): SurfaceRangeEditOps {
  const { session } = deps;
  /**
   * The range a plan is built for in place of the selection, set only inside
   * {@link deleteRangePlan}. The selection itself never moves, so nothing is published.
   */
  let rangeOverride: SemanticSelection | null = null;
  const planSelection = (): SemanticSelection => rangeOverride ?? deps.selection();
  const planCells = (): CellSelection | null => (rangeOverride ? null : deps.cellSelection());

  /** The current selection as a history mark — one paragraph or nothing. */
  function selectionMark(): { paragraphId: string; start: number; end: number } | null {
    return selectionMarkOf(deps.selection());
  }

  /** The selection in DOCUMENT order, whichever way the user dragged it. */
  function orderedRange(): { from: SemanticPosition; to: SemanticPosition } {
    // Queued typing lands first: every range consumer must see the selection
    // and layout the typed text produced — including a layout pass a commit
    // deferred under input pressure. (No-op mid-flush and when empty.)
    deps.flushPendingInputAndLayout();
    const selection = planSelection();
    // One paragraph is ordered by offset alone; skip the document-wide order walk.
    const order =
      selection.anchor.paragraphId === selection.head.paragraphId
        ? undefined
        : deps.paragraphOrder();
    return orderedRangeOf(deps.layout(), selection, order);
  }

  function orderedStart(): SemanticPosition {
    return orderedRange().from;
  }

  /** Model text of a paragraph, read back from the layout records. */
  function textOf(paragraphId: string): string {
    return paragraphTextFromLayout(deps.layout(), paragraphId);
  }

  /**
   * The inline content control whose content ends (Backspace) or starts (Delete) exactly
   * at the caret, in the ACTIVE story part. Consulted so the key takes the node as ONE
   * unit (pro-review-and-custom-nodes 4.6): deleting into a chip character-by-character
   * would either strip letters from a content-locked label — refused, a dead key — or
   * leave a half-deleted node whose tag still claims the full payload.
   */
  function inlineControlBeside(
    position: { readonly paragraphId: string; readonly offset: number },
    side: 'before' | 'after'
  ): InlineControlBesideCaret | null {
    const part = session.partFor(deps.storyScope()) ?? session.part();
    const paragraph = findNode(part, position.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') return null;
    const span =
      side === 'before'
        ? inlineControlEndingAt(paragraph, position.offset)
        : inlineControlStartingAt(paragraph, position.offset);
    if (!span) return null;
    // Only an ATOM goes as one unit: a content-locked chip (custom nodes), a checkbox glyph, a
    // picture. A text, date or list control is typed into, so the key at its edge takes one
    // character, as in Word, and a control emptied that way shows its prompt again instead of
    // vanishing with its wrapper.
    const control = findContentControl(part, span.controlId);
    const summary = control ? contentControlPropertiesOf(control) : null;
    if (!summary) return null;
    const contentLocked = summary.lock === 'contentLocked' || summary.lock === 'sdtContentLocked';
    const atom = contentLocked || summary.type === 'checkbox' || summary.type === 'picture';
    if (!atom || !control) return null;
    // A control already proposed for deletion is struck text the key steps over, not a unit
    // to select again: selecting it would leave the caret where it was, press after press.
    // Only while tracking: an untracked press removes struck content outright, as it does text.
    let struck = false;
    const tracked = deps.trackedAuthorOrNone() !== undefined;
    for (
      let node = tracked ? parentNodeOf(part, control.id) : null;
      node;
      node = parentNodeOf(part, node.id)
    ) {
      if (node.kind === 'revisionDelete') struck = true;
      if (struck || node.kind === 'paragraph') break;
    }
    return { ...span, contentLocked, ...(struck ? { struck } : {}) };
  }

  function atomicControlDeletion(
    direction: 'backward' | 'forward',
    shown: (position: SemanticPosition) => SemanticPosition,
    reach?: number
  ): AtomicControlDeletion | null {
    // Queued typing lands first, so the caret and the layout are the ones the reader sees.
    deps.flushPendingInputAndLayout();
    if (deps.cellSelection()) return null;
    const prompt = promptDeletion(direction, shown, reach);
    if (prompt && prompt.kind !== 'plan') return prompt;
    if (reach !== undefined) return null;
    const atomic = planAtomicControlDeletion({
      layout: deps.layout(),
      selection: deps.selection(),
      direction,
      shown,
      controlBeside: inlineControlBeside,
      tracked: deps.trackedAuthorOrNone() !== undefined,
    });
    // The range plan the prompt rule already read is the deletion: hand it on, not rebuilt.
    const plan = prompt?.plan;
    if (atomic || !plan || plan.ops.length === 0) return atomic;
    return { kind: 'remove', ops: plan.ops, collapseTo: plan.collapseTo };
  }

  /**
   * What the press does under the prompt rule (`surface-prompt-deletion.ts`), or a `plan`
   * result when the rule leaves the press alone. A range's plan travels with that result, so
   * the caller does not build it a second time.
   */
  function promptDeletion(
    direction: 'backward' | 'forward',
    shown: (position: SemanticPosition) => SemanticPosition,
    reach: number | undefined
  ): AtomicControlDeletion | { readonly kind: 'plan'; readonly plan?: PlannedDeletion } | null {
    const layout = deps.layout();
    if (!layout.contentControls?.some((control) => control.placeholder)) return null;
    const selection = deps.selection();
    const tracked = deps.trackedAuthorOrNone() !== undefined;
    // A pure read: `partOfNodeId`, never `partFor`, which would retain a story store.
    const part = partOfNodeId(session, selection.head.paragraphId) ?? session.part();
    // A press the rule refuses keeps the selection, as the press that cannot remove does.
    const unchanged = { kind: 'select', selection } as const;
    const ranged =
      selection.anchor.paragraphId !== selection.head.paragraphId ||
      selection.anchor.offset !== selection.head.offset;
    const selected = ranged ? promptSelected(part, selection) : null;
    if (selected) {
      const removal = removalOf(selected, tracked, direction);
      return removal ? { kind: 'remove', ...removal } : unchanged;
    }
    let plan: PlannedDeletion;
    if (ranged) {
      plan = deleteSelectionPlan();
    } else {
      // One character, or a word when `reach` names where the word ends.
      const caret = reach === undefined ? shown(selection.head) : selection.head;
      const far = reach ?? caret.offset + (direction === 'backward' ? -1 : 1);
      if (far < 0 || far === caret.offset || far > textOf(caret.paragraphId).length) return null;
      const [start, end] = far < caret.offset ? [far, caret.offset] : [caret.offset, far];
      const { paragraphId } = caret;
      plan = {
        ops: [{ op: 'deleteText', paragraphId, start, end }],
        collapseTo: { paragraphId, offset: start },
      };
    }
    const press = keepPromptsWhole(part, plan, tracked);
    if (!press) return ranged ? { kind: 'plan', plan } : { kind: 'plan' };
    if (press.kind === 'refused') return unchanged;
    if (press.kind === 'plan') return { kind: 'remove', ...press.plan };
    return reachedPrompt(press.prompt, direction, tracked);
  }

  /** A press from a caret that reached only `prompt`: select it, or propose its deletion. */
  function reachedPrompt(
    prompt: Prompt,
    direction: 'backward' | 'forward',
    tracked: boolean
  ): AtomicControlDeletion {
    const start = { paragraphId: prompt.paragraphId, offset: prompt.start };
    const end = { paragraphId: prompt.paragraphId, offset: prompt.end };
    const backward = direction === 'backward';
    if (tracked && prompt.struck) {
      // Already proposed for deletion: the key steps over it.
      const past = backward ? start : end;
      return { kind: 'select', selection: { anchor: past, head: past } };
    }
    const removal = tracked ? removalOf(prompt, true, direction) : null;
    if (removal) return { kind: 'remove', ...removal };
    return {
      kind: 'select',
      selection: backward ? { anchor: end, head: start } : { anchor: start, head: end },
    };
  }

  /**
   * The ops a press removes a prompt's control with, or null. Under forms protection the
   * control is a field to fill, which no press removes, so the press keeps the selection rather
   * than reporting the store's refusal for an ordinary key.
   */
  function removalOf(
    prompt: Prompt,
    tracked: boolean,
    direction: 'backward' | 'forward'
  ): PlannedDeletion | null {
    if (formsProtectionEnabled(session.settingsRoot())) return null;
    return promptRemoval(prompt, tracked, direction);
  }

  /** The selection grown over every prompt it holds part of, or null; copy and cut read it. */
  function selectionOverPromptsNow(): SemanticSelection | null {
    deps.flushPendingInputAndLayout();
    if (deps.cellSelection()) return null;
    if (!deps.layout().contentControls?.some((control) => control.placeholder)) return null;
    const selection = deps.selection();
    const { from, to } = orderedRange();
    if (from.paragraphId === to.paragraphId && from.offset === to.offset) return null;
    const part = partOfNodeId(session, selection.head.paragraphId) ?? session.part();
    return selectionOverPrompts(part, selection, { from, to });
  }

  /** Whether the selection is exactly one prompt: a word deletion then leaves it as it is. */
  function promptIsSelected(): boolean {
    deps.flushPendingInputAndLayout();
    if (!deps.layout().contentControls?.some((control) => control.placeholder)) return false;
    const selection = deps.selection();
    const part = partOfNodeId(session, selection.head.paragraphId) ?? session.part();
    return promptSelected(part, selection) !== null;
  }

  /**
   * Whether this Enter ends the paragraph it leaves behind, so Word's follower style applies
   * to the one it starts.
   *
   * A REPLACING Enter has two positions, not one: the split point, and the end of the text
   * the same transaction deletes. Everything between them goes — including whole paragraphs,
   * which the plan joins into the first — so what survives after the break is whatever
   * followed the range's END. Select a heading's last word and press Enter, and Word gives
   * you a body paragraph; reading only the split point said "not at the end" and gave a
   * second heading.
   *
   * Declines outright for a SUGGESTED break and for a CELL RECTANGLE. A suggested break
   * proposes a `w:ins` mark on the head, and rejecting it merges the paragraphs back keeping
   * the SURVIVING tail's `w:pPr` — a tail in the follower style would demote the heading the
   * reviewer took the break back from. Word records a `w:pPrChange` for that case, and this
   * engine has no tracked paragraph-property write. A rectangle is not the range it stands
   * in for, so its ends do not describe what the plan deletes.
   */
  function splitEndsTheParagraph(position: SemanticPosition): boolean {
    if (deps.trackedAuthorOrNone() !== undefined || deps.cellSelection()) return false;
    const range = orderedRange();
    const collapsed =
      range.from.paragraphId === range.to.paragraphId && range.from.offset === range.to.offset;
    // A collapsed caret may have been relocated past struck text on its way into the plan,
    // so the split point is the plan's position rather than the selection's.
    return collapsed
      ? deps.atParagraphEnd(position.paragraphId, position.offset)
      : deps.atParagraphEnd(range.to.paragraphId, range.to.offset);
  }

  /**
   * The plan that removes the current selection, or an empty one when it is collapsed.
   *
   * `collapseTo` rather than `orderedStart()` is what every caller must address afterwards:
   * a plan that removes a table takes its cell paragraphs with it, so a range beginning in
   * one has no start left to insert at, and an op naming a paragraph the same transaction
   * deleted vetoes the whole transaction.
   */
  function deleteSelectionPlan(trackedAuthor?: string): RangeDeletionPlan {
    // Every replacing lane reads `replaceAt` from the plan it already holds, so the landing
    // rule cannot be skipped by a lane that never heard of it — that is how tabs, breaks and
    // the PAGE field each kept landing in FRONT of the words a suggestion strikes.
    // `trackedAuthor` is the automation lane's: its deletion is tracked whatever the editing
    // mode is, and under an author who may not be the configured one. Normalized here so
    // every reader below sees either a non-empty author or undefined, never a blank.
    const author = trackedAuthor?.trim() || undefined;
    const plan = withEnclosedBookmarks(
      rangeDeletionPlan(author !== undefined || deps.trackedAuthorOrNone() !== undefined),
      !author && deps.editingMode() !== 'suggest'
    );
    // A GETTER, so delete-only lanes — Backspace, Delete, proposeDeletion — never pay for a
    // landing they do not read. Replacing lanes read it once, before the ops apply, which is
    // the only window where the pre-edit layout it consults is the right oracle. The
    // rectangle is captured NOW, not read at getter time: `commit` nulls `cellSelection` at
    // its head, so a late read would answer for a selection the plan was not built from.
    const rectangle = planCells();
    let landing: SemanticPosition | null = null;
    return {
      ...plan,
      get replaceAt(): SemanticPosition {
        landing ??= replacementTarget(plan, author, rectangle);
        return landing;
      },
    };
  }

  let outsidePromptId: string | undefined;
  function typingOutsidePrompt(): boolean {
    const selection = deps.selection();
    if (
      selection.anchor.paragraphId !== selection.head.paragraphId ||
      selection.anchor.offset !== selection.head.offset ||
      !outsidePromptId
    )
      return false;
    const part = partOfNodeId(session, selection.head.paragraphId) ?? session.part();
    return promptsIn(part, selection.head.paragraphId).some(
      (prompt) =>
        prompt.control.id === outsidePromptId &&
        prompt.start === selection.head.offset &&
        !prompt.struck
    );
  }

  function typingSelectionPlan(): RangeDeletionPlan & { readonly outsidePromptId?: string } {
    const { from, to } = orderedRange();
    if (planCells()) return deleteSelectionPlan();
    if (typingOutsidePrompt()) return { ...deleteSelectionPlan(), outsidePromptId };
    const part = partOfNodeId(session, to.paragraphId) ?? session.part();
    const prompt = promptsIn(part, to.paragraphId).find(
      (item) => to.offset > item.start && to.offset < item.end
    );
    if (!prompt || prompt.locked || prompt.struck) return deleteSelectionPlan();
    if (from.paragraphId === to.paragraphId && from.offset >= prompt.start) {
      return deleteSelectionPlan();
    }
    // Keep the prompt outside the replacement and retain that side for later keystrokes.
    const outer = rangeOverride;
    rangeOverride = { anchor: from, head: { ...to, offset: prompt.start } };
    try {
      const plan = deleteSelectionPlan();
      return {
        ...plan,
        replaceAt: plan.replaceAt ?? plan.collapseTo,
        outsidePromptId: prompt.control.id,
      };
    } finally {
      rangeOverride = outer;
    }
  }

  /**
   * An untracked deletion across paragraphs takes the bookmarks it encloses with it, the way a
   * deletion inside one paragraph does (`tree-op-bookmark-edits.ts`). A tracked one keeps them.
   */
  function withEnclosedBookmarks(plan: RangeDeletionPlan, untracked: boolean): RangeDeletionPlan {
    if (!untracked || plan.ops.length === 0 || planCells()) return plan;
    const { from, to } = orderedRange();
    if (from.paragraphId === to.paragraphId) return plan;
    // A pure ancestry read: `partOfNodeId`, never `partFor`, which would retain a story store.
    const part = partOfNodeId(session, from.paragraphId) ?? session.part();
    const drops = enclosedBookmarkDeletions(part, from, to, deps.paragraphOrder());
    return drops.length === 0 ? plan : { ...plan, ops: [...drops, ...plan.ops] };
  }

  function rangeDeletionPlan(
    tracked = deps.trackedAuthorOrNone() !== undefined
  ): RangeDeletionPlan {
    // Every edit op builds its plan from here first, so this is where queued
    // typing must land: a plan computed against the pre-buffer selection would
    // edit beside text the user has already typed. The plan reads `currentLayout`
    // as its text oracle, so a deferred layout pass lands with it. (No-op
    // mid-flush.)
    deps.flushPendingInputAndLayout();
    const rectangle = planCells();
    // A RECTANGLE is not the range it stands in for. Rows one and two of column one, read as
    // a range, run through every cell between them — so deleting through the range empties
    // cells the drag never covered, which is the exact failure the rectangle exists to
    // prevent. Clear each selected cell's own paragraphs instead, and join nothing: Word
    // empties the cells and never merges them.
    if (rectangle) {
      const ops: TreeDocOp[] = [];
      for (const paragraphId of paragraphsInCells(deps.layout(), rectangle.cellIds)) {
        const length = paragraphTextFromLayout(deps.layout(), paragraphId).length;
        if (length > 0) ops.push({ op: 'deleteText', paragraphId, start: 0, end: length });
      }
      // Nothing structural goes, so the range start is still there to collapse onto.
      return { ops, collapseTo: orderedStart() };
    }
    const selection = planSelection();
    if (
      selection.anchor.paragraphId === selection.head.paragraphId &&
      selection.anchor.offset === selection.head.offset
    ) {
      // The caret may rest anywhere in struck text — Word's rule — but new content must
      // never land INSIDE the `w:del`, so an insert aimed at an interior offset relocates
      // past the deletion. The store enforces the same rule; adjusting here as well lands
      // the post-edit caret beside the typed text instead of back among the struck words.
      return { ops: [], collapseTo: positionPastDeletion(deps.layout(), selection.head) };
    }
    const { from, to } = orderedRange();
    return planRangeDeletion(
      deps.layout(),
      session.partFor(deps.storyScope()) ?? session.part(),
      from,
      to,
      deps.paragraphOrder(),
      deps.revisionView(),
      tracked
    );
  }

  function deleteSelectionOps(): readonly TreeDocOp[] {
    return deleteSelectionPlan().ops;
  }

  /**
   * {@link deleteSelectionPlan} for an explicit range of the active story, with the landing
   * resolved now. The selection stays where the reader left it: a host replacing a found match
   * must not move the caret or scroll the page.
   */
  function deleteRangePlan(range: SemanticSelection): {
    readonly ops: readonly TreeDocOp[];
    readonly replaceAt: SemanticPosition;
  } {
    const outer = rangeOverride;
    rangeOverride = range;
    try {
      const plan = deleteSelectionPlan();
      // Read INSIDE the override: the getter orders the range it lands after.
      return { ops: plan.ops, replaceAt: plan.replaceAt ?? plan.collapseTo };
    } finally {
      rangeOverride = outer;
    }
  }

  /**
   * Where a replacement for `[from, to)` belongs, once the tracked strike has had its say.
   *
   * The struck characters STAY, so the new text goes after them — minus whatever of the range
   * was the acting author's own pending insertion, which leaves the paragraph entirely.
   * Identity in editing mode, where the range simply goes. Every lane that replaces a range
   * has to ask: `type()` was fixed first, and the paste, the IME readback and the note
   * reference each landed in front of the words they were replacing until they asked it too.
   */
  function replacementOffset(
    from: SemanticPosition,
    to: SemanticPosition,
    trackedAuthor?: string
  ): number {
    // `trackedAuthor` marks a deletion that is tracked regardless of the editing mode — the
    // automation lane's — so the after-the-strike rule applies under that author instead.
    const tracked = trackedAuthor !== undefined || deps.editingMode() === 'suggest';
    if (!tracked || from.paragraphId !== to.paragraphId) return from.offset;
    // NOTHING TO REPLACE, nothing to land after. A zero-width range strikes no words, and
    // mapping it out of a deletion it merely touches carried a scripted insert past struck
    // text the operation never named — further than the same text inserted at that point.
    if (to.offset <= from.offset) return from.offset;
    // A range end INSIDE a pre-existing deletion aims the insert at the interior of that
    // `w:del`: the store relocates it past the deletion, and the caret math has to hear about
    // it or the next keystroke lands before the previous one. That mapping, the adjacency
    // question and the strike's end all come from the paragraph's OWN tree — one rule, the
    // store's, so the surface cannot predict a landing the store will not use.
    const author = (trackedAuthor ?? deps.author())?.trim();
    if (!author) return positionPastDeletion(deps.layout(), to).offset;
    const part = partOfNodeId(session, to.paragraphId) ?? session.part();
    const paragraph = findNode(part, to.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') {
      return positionPastDeletion(deps.layout(), to).offset;
    }
    return trackedReplacementLanding(paragraph, from.offset, to.offset, author, deps.trackedDate());
  }

  /**
   * Where a replacement for the current selection lands, as a full position.
   *
   * In editing mode the range simply goes and `collapseTo` is the spot. In suggesting the
   * struck characters STAY, so the replacement belongs after them — past the range END,
   * minus whatever of the range was this author's own pending insertion, which leaves. A
   * range spanning paragraph marks keeps every paragraph (the marks become merge
   * proposals), so the end lives in the LAST paragraph, after its struck head.
   *
   * Falling back to the range START for a spanning selection put the insert on the front
   * edge of the fresh `w:del`, where the store relocates it past the deletion — but the
   * caret math never heard about the relocation, so the caret came to rest INSIDE the
   * struck words, and the next keystroke relocated to the same spot, landing BEFORE the
   * previous one: a typed replacement came out reversed, parked after the first struck
   * paragraph instead of the last.
   */
  function replacementTarget(
    plan: RangeDeletionPlan,
    trackedAuthor: string | undefined,
    rectangle: CellSelection | null
  ): SemanticPosition {
    const start = plan.collapseTo;
    if (trackedAuthor === undefined && deps.editingMode() !== 'suggest') return start;
    if (rectangle) {
      // A RECTANGLE strikes every selected cell in place and, as Word does, hands the
      // replacement to the FIRST cell — after that cell's struck content, like every other
      // tracked replacement. Nothing merges, so the landing is simply the first cell's last
      // paragraph, past its struck text. Landing at `collapseTo` (offset 0 of the first
      // paragraph) aimed the insert at the front edge of the fresh `w:del`, where the store
      // relocates it past the strike — a relocation the caret math never heard about, so
      // typed characters came out reversed: the linear-range misplacement all over again.
      //
      // The first cell with a paragraph, not blindly `cellIds[0]`: a vertical merge split
      // across pages can re-open as a placed cell with no blocks at all, and a landing that
      // silently fell back to `collapseTo` would be the front-of-strike misplacement again.
      for (const cellId of rectangle.cellIds) {
        // The cell's OWN paragraphs: the recursive walk drifted the landing into a nested
        // table whenever one sat past the cell's last direct paragraph. A cell with no
        // direct paragraph at all (schema-edge) falls back to whatever it does hold.
        const direct = directParagraphsInCells(deps.layout(), [cellId]);
        const cellParagraphs =
          direct.length > 0 ? direct : paragraphsInCells(deps.layout(), [cellId]);
        if (cellParagraphs.length === 0) continue;
        const offsets = new Map<string, number>();
        const landingOffset = (id: string): number => {
          let value = offsets.get(id);
          if (value === undefined) {
            value = replacementOffset(
              { paragraphId: id, offset: 0 },
              { paragraphId: id, offset: textOf(id).length },
              trackedAuthor
            );
            offsets.set(id, value);
          }
          return value;
        };
        // Whether at least one non-whitespace character SURVIVES the plan's strike: the
        // LAYOUT text — the same visibility oracle every offset here reads, so an image's
        // object character and a painted field result count as content — minus the ranges
        // this author's own pending insertion retracts. Judging the raw text let a
        // paragraph whose words were all pending insertion win over a worded one, and no
        // length arithmetic can tell a surviving word from retracted whitespace.
        const author = (trackedAuthor ?? deps.author())?.trim();
        const survivesWorded = (id: string): boolean => {
          const text = textOf(id);
          // No author: nothing retracts, the same bail the retraction helpers take.
          if (!author) return /\S/.test(text);
          // A pure ancestry read: `partOfNodeId`, never `partFor`, which would permanently
          // retain a story store for what is only a lookup.
          const node = findNode(partOfNodeId(session, id) ?? session.part(), id);
          if (!node || node.kind !== 'paragraph') return /\S/.test(text);
          let surviving = '';
          let cursor = 0;
          for (const range of retractedRangesOf(node, 0, text.length, author)) {
            surviving += text.slice(cursor, Math.max(cursor, range.start));
            cursor = Math.max(cursor, range.end);
          }
          surviving += text.slice(cursor);
          return /\S/.test(surviving);
        };
        // ADJACENT to the struck words, so the pane can fold strike and insert into one
        // card: the last paragraph whose SURVIVING text is more than whitespace. A trailing
        // empty or spacer paragraph — or one holding only this author's own pending
        // insertion, which the plan retracts — would strand the replacement a line below
        // the strike. When no paragraph qualifies, RELAX rather than jump to the blind
        // last: whitespace-only content still beats an empty paragraph as a neighbour, and
        // only a cell with nothing surviving at all keeps its last paragraph. The linear
        // branch below needs none of this: a spanning range proposes its marks away, so
        // accepting the merge restores adjacency — a rectangle never merges anything.
        let landing: string | null = null;
        for (let index = cellParagraphs.length - 1; index >= 0; index -= 1) {
          const id = cellParagraphs[index]!;
          if (!survivesWorded(id)) continue;
          landing = id;
          break;
        }
        if (landing === null) {
          for (let index = cellParagraphs.length - 1; index >= 0; index -= 1) {
            const id = cellParagraphs[index]!;
            if (landingOffset(id) === 0) continue;
            landing = id;
            break;
          }
        }
        landing ??= cellParagraphs[cellParagraphs.length - 1]!;
        return { paragraphId: landing, offset: landingOffset(landing) };
      }
      return start;
    }
    const { from, to } = orderedRange();
    // Collapsed: `collapseTo` already sits past any deletion the caret rested in.
    if (from.paragraphId === to.paragraphId && from.offset === to.offset) return start;
    if (from.paragraphId === to.paragraphId) {
      return { paragraphId: to.paragraphId, offset: replacementOffset(from, to, trackedAuthor) };
    }
    // A fully covered table is REMOVED, not struck, so a last paragraph INSIDE one does not
    // survive the transaction — an insert naming it would veto the whole edit. The
    // replacement then belongs after the struck TAIL of the surviving start paragraph, the
    // last struck text still standing. Falling back to `collapseTo` itself aimed the insert
    // at the front edge of that fresh strike, where the store relocates it — the reversed
    // caret misplacement again, this time only for ranges ending inside a removed block. A
    // removed block elsewhere in the range leaves the last paragraph standing, so only its
    // own ancestry decides.
    const removedBlocks = new Set(
      plan.ops.flatMap((op) => (op.op === 'deleteBlock' ? [op.blockId] : []))
    );
    // A pure ancestry read: `partOfNodeId`, not `partFor`, which would retain a story store.
    const part = partOfNodeId(session, to.paragraphId) ?? session.part();
    if (removedBlocks.size > 0) {
      for (
        let node = parentNodeOf(part, to.paragraphId);
        node;
        node = parentNodeOf(part, node.id)
      ) {
        if (!removedBlocks.has(node.id)) continue;
        const endOfStart = {
          paragraphId: start.paragraphId,
          offset: textOf(start.paragraphId).length,
        };
        return {
          paragraphId: start.paragraphId,
          offset: replacementOffset(start, endOfStart, trackedAuthor),
        };
      }
    }
    // A planned join whose mark is this author's OWN pending insertion REALLY joins — the
    // break retracts and the second paragraph leaves the tree (`tree-op-apply.ts`), so an
    // insert naming it would veto the whole transaction: typing over a selection spanning
    // your own pending Enter did nothing at all. Walk back to the paragraph that survives
    // as the merged host, and count each folded member's struck length into its offsets.
    // The merged mark is always the SECOND paragraph's (`withSectionMarkOf`), so each
    // member's ORIGINAL mark decides whether the member after it folds in.
    const author = (trackedAuthor ?? deps.author())?.trim();
    if (!author) return start;
    const joinedSecondIds = new Set(
      plan.ops.flatMap((op) => (op.op === 'joinParagraphs' ? [op.secondId] : []))
    );
    const order = deps.paragraphOrder();
    const fromIndex = order.indexOf(from.paragraphId);
    const toIndex = order.indexOf(to.paragraphId);
    if (fromIndex === -1 || toIndex === -1) return start;
    const markRetracts = (paragraphId: string): boolean => {
      const node = findNode(part, paragraphId);
      return node?.kind === 'paragraph' && retractsOwnParagraphMark(node, author);
    };
    let hostIndex = toIndex;
    while (
      hostIndex > fromIndex &&
      joinedSecondIds.has(order[hostIndex]!) &&
      markRetracts(order[hostIndex - 1]!)
    ) {
      hostIndex -= 1;
    }
    let offset = 0;
    for (let index = hostIndex; index <= toIndex; index += 1) {
      const id = order[index]!;
      const coveredFrom = {
        paragraphId: id,
        offset: id === from.paragraphId ? from.offset : 0,
      };
      const coveredTo =
        id === to.paragraphId
          ? positionPastDeletion(deps.layout(), to)
          : { paragraphId: id, offset: textOf(id).length };
      if (index === hostIndex) offset += coveredFrom.offset;
      offset +=
        coveredTo.offset -
        coveredFrom.offset -
        retractedByInsertionAuthor(coveredFrom, coveredTo, author);
    }
    return { paragraphId: order[hostIndex]!, offset };
  }

  function retractedByInsertionAuthor(
    from: SemanticPosition,
    to: SemanticPosition,
    authorValue?: string
  ): number {
    const author = authorValue?.trim();
    if (!author) return 0;
    if (from.paragraphId !== to.paragraphId) return 0;
    // The paragraph's OWN part, by its id: a scripted replacement addresses the body while
    // the reader has a header open, and the reader's story would answer no paragraph and no
    // retraction, landing the copy past its own pending text. `partOfNodeId` is a pure
    // ancestry read; `partFor` would retain a story store for what is only a lookup.
    const part =
      partOfNodeId(session, to.paragraphId) ?? session.partFor(deps.storyScope()) ?? session.part();
    const paragraph = findNode(part, to.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') return 0;
    return retractedLengthOf(paragraph, from.offset, to.offset, author);
  }

  return {
    selectionMark,
    orderedRange,
    orderedStart,
    textOf,
    inlineControlBeside,
    atomicControlDeletion,
    selectionOverPrompts: selectionOverPromptsNow,
    promptIsSelected,
    splitEndsTheParagraph,
    deleteSelectionPlan,
    typingSelectionPlan,
    retainPromptBoundary: (controlId) => {
      outsidePromptId = controlId;
    },
    clearPromptBoundary: () => {
      outsidePromptId = undefined;
    },
    promptBoundary: () => (typingOutsidePrompt() ? outsidePromptId : undefined),
    deleteSelectionOps,
    deleteRangePlan,
    replacementOffset,
  };
}
