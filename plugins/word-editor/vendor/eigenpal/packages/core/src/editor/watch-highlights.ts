// A highlight set that stays current: the framework-free version of `useHighlights`.
//
// A FUNCTION source runs again after document changes: at once when a document loads, and
// after edits once typing pauses (at most one second while edits keep arriving). An array
// source applies again after a refresh or recovery, which remove every set. Between runs,
// the engine keeps each mark on its text through edits.
//
// A large document lays out its pages in the background after it opens, and a range in a
// paragraph that layout has not reached yet counts as unavailable. Each time the page total
// grows, the counts are taken again from the same ranges, without running the source again.

import type {
  Editor,
  HighlightOptions,
  HighlightRange,
  HighlightResult,
} from '../contracts/editor.ts';
import { hostElementOfEditor, hostTimers } from './host-realm.ts';

/**
 * Ranges for `watchHighlights` and `useHighlights`: an array, or a function of the editor
 * that runs again after document changes. @public
 */
export type HighlightSource =
  readonly HighlightRange[] | ((editor: Editor) => readonly HighlightRange[]);

/** Milliseconds a function source waits after an edit before it runs again. @public */
export const HIGHLIGHT_REFRESH_MS = 150;

/** Longest a function source waits while edits keep arriving, such as remote typing. */
const HIGHLIGHT_REFRESH_MAX_WAIT_MS = 1000;

/** Options for {@link watchHighlights}. @public */
export interface WatchHighlightsOptions extends HighlightOptions {
  /**
   * Called when the applied and unavailable counts change, also when background layout of a
   * large document reaches ranges that were unavailable before.
   */
  readonly onResult?: (result: HighlightResult) => void;
}

/** A highlight set that {@link watchHighlights} keeps current. @public */
export interface HighlightWatch {
  /** What the last application resolved. */
  readonly result: HighlightResult;
  /** Run the source again now. */
  refresh(): void;
  /** Replace the source or options. Applies at once and keeps the set's stacking position. */
  update(source: HighlightSource, options?: HighlightOptions): void;
  /** Remove the set and stop watching. */
  stop(): void;
}

const EMPTY_RESULT: HighlightResult = Object.freeze({ applied: 0, unavailable: 0 });

/**
 * Highlight a named set and keep it current as the document changes.
 *
 * @example
 * ```ts
 * const glossary = watchHighlights(editor, 'glossary', (editor) =>
 *   editor.findMatches(terms, { wholeWord: true }).flat()
 * );
 * // Later:
 * glossary.stop();
 * ```
 * @public
 */
export function watchHighlights(
  editor: Editor,
  name: string,
  source: HighlightSource,
  options: WatchHighlightsOptions = {}
): HighlightWatch {
  const { onResult, ...initial } = options;
  let currentSource = source;
  let currentOptions: HighlightOptions = initial;
  let result = EMPTY_RESULT;
  let stopped = false;
  // The editor's own window: an opener's timers are throttled while it is hidden.
  const timers = hostTimers(() => hostElementOfEditor(editor));
  let timer: number | undefined;
  let firstAt = 0;
  // The ranges of the last application, to count again when background layout adds pages.
  let applied: readonly HighlightRange[] = [];
  let pageTotal = -1;
  let recountTimer: number | undefined;

  const report = (next: HighlightResult) => {
    if (next.applied === result.applied && next.unavailable === result.unavailable) return;
    result = next;
    onResult?.(next);
  };
  const apply = () => {
    timers.clearTimeout(timer);
    timer = undefined;
    firstAt = 0;
    if (stopped) return;
    const ranges = typeof currentSource === 'function' ? currentSource(editor) : currentSource;
    applied = ranges;
    report(editor.setHighlights(name, ranges, currentOptions));
  };
  const recount = () => {
    recountTimer = undefined;
    if (stopped || result.unavailable === 0) return;
    report(editor.setHighlights(name, applied, currentOptions));
  };
  const schedule = () => {
    const now = Date.now();
    if (firstAt === 0) firstAt = now;
    timers.clearTimeout(timer);
    const wait = Math.min(HIGHLIGHT_REFRESH_MS, HIGHLIGHT_REFRESH_MAX_WAIT_MS - (now - firstAt));
    timer = timers.setTimeout(apply, Math.max(0, wait));
  };

  const offPages = editor.on('selectionChange', (snapshot) => {
    const total = snapshot.page.total;
    if (total === pageTotal) return;
    pageTotal = total;
    // Coalesced: background layout can add pages in many small steps.
    if (result.unavailable > 0 && recountTimer === undefined)
      recountTimer = timers.setTimeout(recount, 0);
  });
  const off = editor.on('change', (change) => {
    if (typeof currentSource === 'function') {
      if (change.source) apply();
      else schedule();
    } else if (change.source === 'refresh' || change.source === 'recovery') {
      // A refresh removes every set; ranges of the same document apply again.
      apply();
    } else if (change.source === 'load') {
      // A new document's paragraphs are not the ones fixed ranges name.
      report({ applied: 0, unavailable: currentSource.length });
    }
  });
  apply();

  return {
    get result() {
      return result;
    },
    refresh: apply,
    update(nextSource, nextOptions) {
      currentSource = nextSource;
      if (nextOptions !== undefined) currentOptions = nextOptions;
      apply();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      timers.clearTimeout(timer);
      timers.clearTimeout(recountTimer);
      off();
      offPages();
      editor.clearHighlights(name);
    },
  };
}
