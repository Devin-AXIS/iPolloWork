// Composed text the page already shows commits on a later task, as batched typing does.
//
// An input method writes each finished syllable into the painted DOM before `compositionend`
// fires, so at that point the page already shows the text the readback commits. Committing it
// inside `compositionend` ran the transaction, the layout pass, the paint and every host
// listener's state read in that task, once per syllable. An input method that composes syllable
// by syllable (Hangul) also starts the next composition in the SAME task, so all of it landed
// between two compositions and delayed every key event in the frame.
//
// So a plain insertion is read back at `compositionend` and QUEUED: it commits on a zero-delay
// task, like a typed burst, or at the next flush point before anything else edits or reads the
// document. Each queued insertion is its own history entry, as each composition was. Until it
// commits, and until its paint lands, the page shows text the paint did not produce, and a
// composition that starts over it reads it with two texts:
//
//   - `read`, the text of the PAINTED layout. The page's spans publish offsets from that
//     layout, so the readback fills its gaps from it.
//   - `text`, what the page shows: the model's text with the queued insertions applied. The
//     next composed edit is the difference from it.
//
// Only an edit the page shows exactly takes this lane: one insertion at the caret, no change
// from anyone else since, no control or prompt landing. Anything else commits and paints at
// once. A queued insertion the store places elsewhere (past a tracked deletion it aimed into),
// or refuses, is caught when it lands, and the caller repaints from the model.

import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { SemanticPosition, SemanticSelection } from '@docx-editor.dev/core/layout';
import { paintedSpanRange, semanticSelectionFromDom } from './dom-selection.ts';
import type { StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import type { HostTimers } from './host-realm.ts';
import { runWithHistoryGroup } from './history-group-scope.ts';
import { rebaseOffset } from './surface-composition-rebase.ts';

/** How long a hidden window, which paints nothing, waits before the task runs anyway. */
const UNPAINTED_WINDOW_MS = 100;

/**
 * Run `task` in the first task after the next paint.
 *
 * The frame after a syllable is the one that shows it, and the work of committing it would
 * hold that frame back: a frame callback runs before its paint, so the task is queued from it.
 */
export function afterNextPaint(
  timers: Pick<
    HostTimers,
    'setTimeout' | 'clearTimeout' | 'requestAnimationFrame' | 'cancelAnimationFrame'
  >,
  task: () => void
): void {
  const fallback = timers.setTimeout(() => {
    timers.cancelAnimationFrame(frame);
    task();
  }, UNPAINTED_WINDOW_MS);
  const frame = timers.requestAnimationFrame(() => {
    timers.clearTimeout(fallback);
    timers.setTimeout(task, 0);
  });
}

/** Runs one land at a time: `wrap`ped tasks do nothing while one runs. */
export function landingGuard(): { active(): boolean; wrap(task: () => void): () => void } {
  let active = false;
  return {
    active: () => active,
    wrap: (task) => () => {
      if (active) return;
      active = true;
      try {
        task();
      } finally {
        active = false;
      }
    },
  };
}

/** Text the page shows that its paint did not produce: queued, or committed but unpainted. */
export interface UnpaintedComposition {
  readonly paragraphId: string;
  /** What the page shows for the paragraph. */
  readonly text: string;
  /** The caret offset just past the composed text, in `text`. */
  readonly caret: number;
  /** The model revision this describes. */
  readonly revision: number;
  /** Where the model's caret is meanwhile: before the queued text, else at `caret`. */
  readonly modelCaret: number;
  /** Whether the model does not hold the text yet. */
  readonly queued: boolean;
}

/** What the page shows for the composing paragraph under the input method's text. */
export interface ComposingBase {
  readonly text: string;
  /**
   * The text of the PAINTED layout, when the page shows text its paint did not produce: its
   * spans publish offsets from that layout, so the readback fills gaps from this.
   */
  readonly read?: string;
  /** The caret offset, when the composition is at a collapsed caret. */
  readonly caret: number | null;
  /** The package revision that text is from. */
  readonly revision: number;
}

/** What `composingBaseOf` reads. */
export interface ComposingBaseDeps {
  selection(): SemanticSelection;
  textOf(paragraphId: string): string;
  paintedText?(paragraphId: string): { readonly text: string; readonly revision: number };
  packageRevision(): number;
}

/**
 * What the page shows for the composing paragraph now.
 *
 * Text the last composition left unpainted, while the caret is still just past it. Otherwise
 * the painted text, unless it is from the model's own revision, when the two must agree and
 * the model is taken.
 */
export function composingBaseOf(
  deps: ComposingBaseDeps,
  paragraphId: string,
  unpainted: UnpaintedComposition | null
): ComposingBase {
  const revision = deps.packageRevision();
  const shown = deps.paintedText?.(paragraphId);
  const { anchor, head } = deps.selection();
  const inParagraph = anchor.paragraphId === paragraphId && head.paragraphId === paragraphId;
  if (
    unpainted &&
    shown &&
    inParagraph &&
    unpainted.paragraphId === paragraphId &&
    unpainted.revision === revision &&
    anchor.offset === unpainted.modelCaret &&
    head.offset === unpainted.modelCaret &&
    (unpainted.queued || shown.revision === -1)
  ) {
    return { text: unpainted.text, read: shown.text, caret: unpainted.caret, revision };
  }
  const model = { text: deps.textOf(paragraphId), revision };
  const painted = !shown || shown.revision === revision ? model : shown;
  const collapsed = painted.revision !== -1 && inParagraph && anchor.offset === head.offset;
  return { ...painted, caret: collapsed ? head.offset : null };
}

/**
 * The composed text when `painted` is `modelText` with one insertion at `caret`, else null.
 *
 * Placed at the caret rather than at the diff's longest common prefix: `에` composed before
 * `에서` diffs as an insert after the first `에`, which gives the same text and the wrong caret.
 */
export function insertionAtCaret(
  modelText: string,
  painted: string,
  caret: number | null
): string | null {
  if (caret === null || caret > modelText.length) return null;
  const grown = painted.length - modelText.length;
  if (grown <= 0) return null;
  const text = painted.slice(caret, caret + grown);
  return modelText.slice(0, caret) + text + modelText.slice(caret) === painted ? text : null;
}

/**
 * A position read from the page, in the text the page shows.
 *
 * Painted spans publish offsets from the painted layout, which lacks the unpainted text. A
 * point in the node the input method wrote into is read from that node; a point past the
 * insertion in any other span shifts by it.
 */
export function shownPosition(
  position: SemanticPosition,
  node: Node | null,
  nodeOffset: number,
  unpainted: UnpaintedComposition | null,
  read: string | undefined
): SemanticPosition {
  if (!unpainted || read === undefined || position.paragraphId !== unpainted.paragraphId) {
    return position;
  }
  const { text, caret } = unpainted;
  const grown = text.length - read.length;
  const at = caret - grown;
  if (grown <= 0 || at < 0 || text.slice(0, at) + text.slice(caret) !== read) return position;
  const span = node ? paintedSpanRange(node) : null;
  if (span && span.paragraphId !== position.paragraphId) return position;
  // The run the input method wrote into is longer than its range by the insertion.
  const length = span ? span.end - span.start : 0;
  if (span && span.start <= at && at <= span.end && node!.textContent?.length === length + grown) {
    // A text node's offset is a character; an element's (the run itself) is a child index.
    if (node!.nodeType !== TEXT_NODE)
      return { ...position, offset: nodeOffset > 0 ? span.end + grown : span.start };
    return { ...position, offset: span.start + Math.max(0, Math.min(nodeOffset, length + grown)) };
  }
  // A point between runs (a line end, a seat, a child index) at the insertion is after it.
  const past = position.offset > at || (position.offset === at && (!span || span.start >= at));
  return past ? { ...position, offset: position.offset + grown } : position;
}

/** `Node.TEXT_NODE`, without the global of one window. */
const TEXT_NODE = 3;

/** One composed insertion the page shows and the model does not hold yet. */
interface QueuedInsertion {
  readonly paragraphId: string;
  /** The text it applies to: the model's, with the insertions queued before it. */
  readonly modelText: string;
  readonly caret: number;
  readonly text: string;
}

/** What the lane needs from the IME lane's composition root. */
export interface ComposedLaneDeps {
  readonly session: Pick<
    TreeDocxSessionView,
    'packageRevision' | 'beginComposition' | 'endComposition'
  >;
  pendingFormatOps?(paragraphId: string, offset: number, length: number): TreeDocOp[];
  applyOps(
    ops: readonly TreeDocOp[],
    mark: { paragraphId: string; start: number; end: number } | null,
    scope: StoryScope
  ): TreeApplyResult;
  selectionMark(): { paragraphId: string; start: number; end: number } | null;
  storyScope(): StoryScope;
  /** The paragraph's text through the current layout, which `flushLayout` makes current. */
  textOf(paragraphId: string): string;
  flushLayout(): boolean;
  flushToPaint(): boolean;
  render(): void;
  holdPaint?(hold: boolean): void;
  discardPaint?(): void;
  hasPendingInput?(): boolean;
  /**
   * Commit with the caret landed after it. Without `publish`, the layout pass and the paint
   * are left to the next commit's publish, so a queue of several lays out once.
   */
  commitComposed?(
    run: () => TreeApplyResult,
    caret: SemanticSelection,
    publish: boolean
  ): string | null;
  /** The paragraph's text in the model's op offsets, read from the tree. */
  modelTextOf?(paragraphId: string): string | null;
  /** Run `task` on a later task: after the next paint (`afterNextPaint`). */
  later?(task: () => void): void;
  /** The painted layout's text of a paragraph (`ComposingBaseDeps`). */
  paintedText?(paragraphId: string): { readonly text: string; readonly revision: number };
}

export interface ComposedLane {
  /**
   * Queue a composition's edit when it is one insertion at the caret of `base`, over a page
   * nobody else wrote on and outside a control. True when it was queued.
   */
  queue(paragraphId: string, base: ComposingBase | null, owned: boolean, read: string): boolean;
  /**
   * Commit everything queued, each as its own history entry. `writing` says an input method
   * is writing on the page, which keeps it held. False when an insertion did not land where
   * the page shows it; the page has then been repainted from the model.
   */
  land(writing: boolean): boolean;
  pending(): boolean;
  /** The base at the caret when it is text the last composition left unpainted, else null. */
  carried(baseOf: (paragraphId: string) => ComposingBase): ComposingBase | null;
  /** Text the page shows that its paint did not produce, or null. */
  unpainted(): UnpaintedComposition | null;
  /** The page was repainted: nothing it shows is unpainted any more. */
  painted(): void;
  /** The page's selection, in the text the page shows (`shownPosition`). */
  read(dom: Selection | null): SemanticSelection | null;
  /**
   * Whether the page's selection is the caret the browser leaves just past
   * unpainted composed text. The paint that follows mirrors it, and adopting it would land
   * the text before that frame; any other selection is the user's.
   */
  echo(dom: Selection | null): boolean;
}

/** A composition over queued text, once the queue has landed: `clean` keeps it described. */
export function landedBase(base: ComposingBase, clean: boolean, revision: number): ComposingBase {
  // Not landed as shown: an impossible revision sends the composition's end to the rebase.
  return base.read === undefined ? base : { ...base, revision: clean ? revision : -2 };
}

/**
 * The queue of composed insertions. `land` is what the zero-delay task runs; without
 * `commitComposed`, `modelTextOf` and `later`, nothing is ever queued.
 */
export function createComposedLane(
  deps: ComposedLaneDeps,
  land: () => void,
  pages: Element
): ComposedLane {
  const { session, commitComposed, modelTextOf, later } = deps;
  let queued: QueuedInsertion[] = [];
  let shown: UnpaintedComposition | null = null;

  /** Commit one insertion at `caret`. True when the tree holds exactly that afterwards. */
  function commitOne(item: QueuedInsertion, caret: number, publish: boolean): boolean {
    const { paragraphId, text } = item;
    const before = session.packageRevision();
    const treeBefore = modelTextOf!(paragraphId);
    const ops: TreeDocOp[] = [{ op: 'insertText', paragraphId, offset: caret, text }];
    // The armed caret format, as typed text takes it; a refused format op does not take the
    // composed text down with it.
    const formatOps = deps.pendingFormatOps?.(paragraphId, caret, text.length) ?? [];
    const scope = deps.storyScope();
    const landed = { paragraphId, offset: caret + text.length };
    session.beginComposition(scope);
    let refused: string | null;
    try {
      // A land is typing: it never joins the group a command bound (`history-group-scope.ts`),
      // whose owner a group-less binding ignores.
      refused = runWithHistoryGroup(deps, undefined, () =>
        commitComposed!(
          () => {
            const result = deps.applyOps([...ops, ...formatOps], deps.selectionMark(), scope);
            if (formatOps.length === 0 || !result.rejected) return result;
            return deps.applyOps(ops, deps.selectionMark(), scope);
          },
          { anchor: landed, head: landed },
          publish
        )
      );
    } finally {
      session.endComposition();
    }
    if (refused !== null || session.packageRevision() === before || treeBefore === null) {
      return false;
    }
    return (
      modelTextOf!(paragraphId) === treeBefore.slice(0, caret) + text + treeBefore.slice(caret)
    );
  }

  const lane: ComposedLane = {
    queue(paragraphId, base, owned, read) {
      if (!commitComposed || !modelTextOf || !later || owned || base?.caret == null) return false;
      if (base.revision !== session.packageRevision()) return false;
      // Text queued for another composition is only described by a base carried over it.
      if (base.read === undefined && queued.length > 0) return false;
      const { caret, text: modelText } = base;
      const text = insertionAtCaret(modelText, read, caret);
      if (text === null) return false;
      if (queued.length === 0) later(land);
      queued.push({ paragraphId, modelText, caret, text });
      shown = {
        paragraphId,
        text: modelText.slice(0, caret) + text + modelText.slice(caret),
        caret: caret + text.length,
        revision: session.packageRevision(),
        modelCaret: shown?.queued ? shown.modelCaret : caret,
        queued: true,
      };
      // Until it lands the page holds it: a collaborator's paint would erase it.
      deps.holdPaint?.(true);
      return true;
    },

    land(writing) {
      const items = queued;
      if (items.length === 0) return true;
      queued = [];
      if (!writing) deps.holdPaint?.(false);
      // Nobody else may have written since the readback, or the offsets are not the model's.
      let clean = shown?.revision === session.packageRevision();
      for (const [index, item] of items.entries()) {
        let caret = item.caret;
        if (!clean) {
          // Carried onto the model as it is now, by the rule a remote caret moves by.
          deps.flushLayout();
          caret = rebaseOffset(item.modelText, deps.textOf(item.paragraphId), item.caret);
        }
        clean = commitOne(item, caret, !clean || index === items.length - 1) && clean;
      }
      shown =
        clean && shown
          ? {
              ...shown,
              revision: session.packageRevision(),
              modelCaret: shown.caret,
              queued: false,
            }
          : null;
      if (!clean) {
        // The page shows text the model does not hold where it shows it: rebuild it.
        deps.discardPaint?.();
        if (!deps.flushToPaint()) deps.render();
      }
      return clean;
    },

    pending: () => queued.length > 0,
    carried(baseOf) {
      if (!shown || deps.hasPendingInput?.()) return null;
      const base = baseOf(shown.paragraphId);
      return base.read === undefined ? null : base;
    },
    unpainted: () => shown,
    painted() {
      if (queued.length === 0) shown = null;
    },
    echo(dom) {
      const mapped = shown ? lane.read(dom) : null;
      if (!shown || !mapped) return false;
      const at = (position: SemanticPosition) =>
        position.paragraphId === shown!.paragraphId && position.offset === shown!.caret;
      return at(mapped.anchor) && at(mapped.head);
    },
    read(dom) {
      const selection = semanticSelectionFromDom(pages, dom);
      if (!selection || !dom || !shown) return selection;
      const read = deps.paintedText?.(shown.paragraphId).text;
      return {
        anchor: shownPosition(selection.anchor, dom.anchorNode, dom.anchorOffset, shown, read),
        head: shownPosition(selection.head, dom.focusNode, dom.focusOffset, shown, read),
      };
    },
  };
  return lane;
}
