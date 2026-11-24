// Deletions an input method asks for, rather than a key (paginated-surface seam).
//
// A hardware key, and a keyboard that sends real key events, deletes through the keymap. A
// keyboard that deletes through the platform's text service instead (on Android,
// `InputConnection.deleteSurroundingText`) reaches the page only as `beforeinput`, with the
// characters it means named by `getTargetRanges()`. Two things make that range more than a
// formality:
//
//   - A keyboard that falls behind batches its presses: one event names two or more
//     characters. Deleting one per event loses the rest, and the next presses then land in
//     the middle of the word.
//   - The keyboard keeps its own copy of the text and of the caret. When that copy drifts, the
//     range names characters somewhere else entirely, so its POSITION cannot be trusted where
//     it disagrees with the caret.
//
// So the range is believed for HOW MUCH to delete, and only where it is anchored at a caret:
// the model's, or the browser's own (where they differ — a paint a commit behind, a caret the
// keyboard parked — both endpoints map through the same page, so their distance still holds,
// while their position does not). The deletion runs as that many ordinary Backspace (or Delete) steps at the MODEL caret. Every
// rule those keys follow — fields, content controls, list numbers and indents before a join,
// table cells, tracked changes — applies unchanged, exactly as the same presses on a hardware
// key would, and a step the document refuses ends the run rather than being retried. A range
// that is not anchored deletes one step at the caret, which is what the key the user pressed
// means. The single exception is a range the browser itself SELECTS: a keyboard can select a
// word and then delete it, and that selection deletes as a selection.

import type { SemanticPosition, SemanticSelection } from '@docx-editor.dev/core/layout';
import {
  positionFromDomPoint,
  selectionsEqual,
  semanticSelectionFromDom,
} from './dom-selection.ts';
import type { HostTimers } from './host-realm.ts';
import { PAINTED_FURNITURE } from './surface-composition-readback.ts';
import {
  createBrowserMutationRepair,
  type BrowserMutationRepair,
} from './surface-browser-mutation-repair.ts';
import type { SurfaceSelectionSync } from './surface-selection-sync.ts';

/**
 * The most steps one input event deletes. A keyboard names a few characters, or a word; the
 * bound only keeps a malformed range from turning one event into a long run of commits.
 */
export const MAX_IME_DELETION_STEPS = 256;

/** How one deletion event is carried out. */
export type ImeDeletionPlan =
  /** `count` Backspace (or Delete) steps at the caret. */
  | { readonly kind: 'steps'; readonly count: number }
  /** Select this range, which the browser already shows selected, and delete it. */
  | { readonly kind: 'selection'; readonly selection: SemanticSelection };

const ONE_STEP: ImeDeletionPlan = { kind: 'steps', count: 1 };

/** What the planner reads from the surface. */
export interface ImeDeletionContext {
  readonly root: Element;
  readonly selection: SemanticSelection;
  textOf(paragraphId: string): string;
  /** The paragraph before `paragraphId` in its story, or undefined at the story start. */
  previousParagraph(paragraphId: string): string | undefined;
  /** False while an input method may still be correcting the browser's selection. */
  readonly browserSelectionTrusted: boolean;
  /** Whether the painted DOM shows the model's revision, with no typing still queued. */
  readonly paintCurrent: boolean;
}

function samePosition(a: SemanticPosition, b: SemanticPosition): boolean {
  return a.paragraphId === b.paragraphId && a.offset === b.offset;
}

/** The most paragraph breaks one range is followed back through, in story order. */
const MAX_BREAKS = 64;

/**
 * How many single steps `[start, end)` holds in the model: one per UTF-16 unit, the unit one
 * Backspace removes, and one per paragraph break between them, which one Backspace joins. The
 * paragraphs are followed back through the story order, so a range whose start is not in the
 * same story before its end (a header painted between two pages, a note) is not counted.
 */
function stepsBetween(
  start: SemanticPosition,
  end: SemanticPosition,
  context: ImeDeletionContext
): number | null {
  if (start.paragraphId === end.paragraphId) return end.offset - start.offset;
  let steps = end.offset;
  let paragraph = end.paragraphId;
  for (let breaks = 0; breaks < MAX_BREAKS; breaks += 1) {
    const previous = context.previousParagraph(paragraph);
    if (previous === undefined) return null;
    steps += 1;
    if (previous === start.paragraphId)
      return steps + context.textOf(previous).length - start.offset;
    steps += context.textOf(previous).length;
    paragraph = previous;
  }
  return null;
}

/** `NodeFilter.SHOW_ELEMENT | SHOW_TEXT`; `NodeFilter` itself is not read from any window. */
const SHOW_ELEMENT_AND_TEXT = 0x1 | 0x4;

/**
 * The document characters the range paints, or null when it cannot be read. Model offsets
 * also count what never paints — a hidden run, a struck revision a resolved view hides — and
 * the keyboard cannot have meant those: it names what it was shown. Furniture glyphs inside
 * the range (a tab leader's dots, a picture's label) are not document characters either. A
 * painted line break is: a paragraph end (and an empty paragraph's line) paints one `<br>`,
 * and a break a resolved view merged away paints none.
 */
function paintedLength(range: StaticRange): number | null {
  const doc = range.startContainer.ownerDocument;
  if (!doc) return null;
  let live: Range;
  try {
    live = doc.createRange();
    live.setStart(range.startContainer, range.startOffset);
    live.setEnd(range.endContainer, range.endOffset);
  } catch {
    return null;
  }
  const common = live.commonAncestorContainer;
  const scope = common.nodeType === Node.ELEMENT_NODE ? common : common.parentNode;
  if (!scope) return null;
  const walker = doc.createTreeWalker(scope, SHOW_ELEMENT_AND_TEXT);
  // From the range's own start, not the top of a common ancestor that can be the whole layer.
  walker.currentNode = range.startContainer;
  let length = 0;
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
    // Past the end: every later node in document order is too.
    if (node !== range.endContainer && live.comparePoint(node, 0) > 0) break;
    if (!live.intersectsNode(node)) continue;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as Element).localName === 'br') length += 1;
      continue;
    }
    if (node.parentElement?.closest(PAINTED_FURNITURE)) continue;
    const text = node as Text;
    const from = node === live.startContainer ? live.startOffset : 0;
    const to = node === live.endContainer ? live.endOffset : text.data.length;
    length += Math.max(0, to - from);
  }
  return length;
}

/** The range ordered start-first, whichever way the user extended it. */
function ordered(selection: SemanticSelection, start: SemanticPosition): SemanticSelection {
  return samePosition(selection.anchor, start)
    ? selection
    : { anchor: selection.head, head: selection.anchor };
}

/** Decide how one `deleteContentBackward` / `deleteContentForward` event deletes. */
export function imeDeletionPlan(
  event: InputEvent,
  context: ImeDeletionContext,
  direction: 'backward' | 'forward'
): ImeDeletionPlan {
  const { root, selection } = context;
  // A selection deletes as itself; the range only restates it.
  if (!samePosition(selection.anchor, selection.head)) return ONE_STEP;
  if (typeof event.getTargetRanges !== 'function') return ONE_STEP;
  const ranges = event.getTargetRanges();
  if (ranges.length !== 1) return ONE_STEP;
  const range = ranges[0]!;
  if (!range.startContainer.isConnected || !range.endContainer.isConnected) return ONE_STEP;
  const start = positionFromDomPoint(range.startContainer, range.startOffset, root);
  const end = positionFromDomPoint(range.endContainer, range.endOffset, root);
  if (!start || !end || samePosition(start, end)) return ONE_STEP;
  const anchor = direction === 'backward' ? end : start;
  const shown = semanticSelectionFromDom(root, root.ownerDocument.getSelection());
  const atBrowserCaret =
    shown !== null && samePosition(shown.anchor, shown.head) && samePosition(shown.head, anchor);
  if (samePosition(anchor, selection.head) || atBrowserCaret) {
    const steps = stepsBetween(start, end, context);
    const painted = paintedLength(range);
    if (steps === null || painted === null) return ONE_STEP;
    const count = Math.min(steps, painted, MAX_IME_DELETION_STEPS);
    return count < 1 ? ONE_STEP : { kind: 'steps', count };
  }
  // The browser can select the range it deletes before it says so, and a keyboard can select a
  // word to delete it. Either way it is the browser's selection. Read from a paint behind the
  // model, or ahead of typing still queued, its offsets would name the wrong characters.
  const rangeShown =
    shown !== null &&
    !samePosition(shown.anchor, shown.head) &&
    selectionsEqual(ordered(shown, start), { anchor: start, head: end });
  if (rangeShown && context.browserSelectionTrusted && context.paintCurrent)
    return { kind: 'selection', selection: shown! };
  return ONE_STEP;
}

/**
 * Run `count` deletion steps, stopping at the first one that changes nothing: the document
 * refused it, or there was nothing left to delete. `revision` is the document's edit clock.
 */
export function runDeletionSteps(
  revision: () => number,
  selection: () => SemanticSelection,
  count: number,
  step: () => void
): void {
  for (let index = 0; index < count; index += 1) {
    const before = revision();
    const caret = selection();
    step();
    if (index + 1 < count && revision() === before && selectionsEqual(selection(), caret)) return;
  }
}

/**
 * The input method lane of the `beforeinput` handler: its deletion hooks, over the surface's
 * live state, and the repair of an edit the browser applied anyway.
 */
export function createInputMethodLane(deps: {
  readonly pagesLayer: HTMLElement;
  selection(): SemanticSelection;
  textOf(paragraphId: string): string;
  /** The active story's paragraphs in document order. */
  paragraphOrder(): readonly string[];
  /** The document's edit clock. */
  revision(): number;
  /** Whether the painted DOM shows the model's revision, with no typing still queued. */
  paintCurrent(): boolean;
  /**
   * Land any paint the deletion deferred, so the next event of a held Backspace maps its
   * range through a page that shows the model.
   */
  flushToPaint(): void;
  render(notifyChange: boolean): void;
  readonly timers: HostTimers;
  readonly sync: Pick<SurfaceSelectionSync, 'browserSelectionTrusted' | 'noteInputMethodEdit'>;
}): {
  readonly hooks: {
    deletionPlan(event: InputEvent, direction: 'backward' | 'forward'): ImeDeletionPlan;
    runDeletionSteps(count: number, step: () => void): void;
    onInputMethodDeletion(): void;
  };
  readonly repair: BrowserMutationRepair;
} {
  return {
    hooks: {
      deletionPlan: (event, direction) => {
        // Read once per event: in a header or note scope the order is a walk of the pages.
        let order: readonly string[] | undefined;
        return imeDeletionPlan(
          event,
          {
            root: deps.pagesLayer,
            selection: deps.selection(),
            textOf: deps.textOf,
            previousParagraph: (id) => {
              order ??= deps.paragraphOrder();
              return order[order.indexOf(id) - 1];
            },
            browserSelectionTrusted: deps.sync.browserSelectionTrusted(),
            paintCurrent: deps.paintCurrent(),
          },
          direction
        );
      },
      runDeletionSteps: (count, step) =>
        runDeletionSteps(deps.revision, deps.selection, count, step),
      onInputMethodDeletion: () => {
        deps.flushToPaint();
        deps.sync.noteInputMethodEdit();
      },
    },
    repair: createBrowserMutationRepair(deps),
  };
}
