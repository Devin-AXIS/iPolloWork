// Idle pre-warm of the store derivations a structural edit reads.
//
// The first Enter or Backspace after a document opens pays a one-time population of the
// per-subtree memos behind `usedParaIds`, the deep paragraph order and the revision-site
// walk — on a very large document that is a visible hitch on exactly the first structural
// keystroke. Every one of those derivations is a pure function of the opened tree, so
// running them once in an idle task after first paint moves the population off the
// keystroke without changing any answer: the memos are keyed on immutable nodes, so a
// pre-warmed entry can never be stale — an edit publishes new nodes and misses naturally.

import { usedParaIds } from '../store/package/para-id.ts';
import { deepParagraphOrderOfPart } from '../store/store/review-reads.ts';
import { collectRevisionSites } from '../store/store/tree-op-revisions.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';

/** One derivation per idle task, so no single warm chunk exceeds the largest derivation. */
export function createDerivationPrewarmSteps(part: () => OoxmlPart): readonly (() => void)[] {
  return [
    () => void usedParaIds(part().root),
    () => void deepParagraphOrderOfPart(part()),
    () => void collectRevisionSites(part()),
  ];
}

export interface DerivationPrewarmOptions {
  readonly steps: readonly (() => void)[];
  /** Re-checked before every step: view mode, a destroyed surface or an edit stops the warm. */
  readonly shouldRun: () => boolean;
  /** Real input outranks warming: a pending-input answer defers the step, never runs it. */
  readonly hasPendingInput: () => boolean;
  /** Injectable timer for tests; returns a cancel. Defaults to `setTimeout`. */
  readonly schedule?: (run: () => void, delayMs: number) => () => void;
}

/** How often a step yields to pending input before the warm gives up entirely. A user who
 * types continuously from the first frame pays the population on their first structural
 * edit, exactly as before the warm existed — giving up is the pre-existing behavior. */
const MAX_INPUT_DEFERRALS = 50;
const INPUT_DEFERRAL_DELAY_MS = 16;

/**
 * Run the steps one per macrotask, yielding to pending input, and stop the moment
 * `shouldRun` says no. Returns a cancel for teardown. Never throws into the scheduler: a
 * failing derivation would fail identically — but user-visibly — on the first structural
 * edit, so the warm only forfeits its head start.
 */
export function scheduleDerivationPrewarm(options: DerivationPrewarmOptions): () => void {
  const schedule =
    options.schedule ??
    ((run: () => void, delayMs: number): (() => void) => {
      const handle = globalThis.setTimeout(run, delayMs);
      return () => globalThis.clearTimeout(handle);
    });

  let cancelled = false;
  let cancelPending: (() => void) | null = null;
  let deferrals = 0;
  let index = 0;

  const arm = (delayMs: number): void => {
    cancelPending = schedule(() => {
      cancelPending = null;
      if (cancelled || index >= options.steps.length || !options.shouldRun()) return;
      if (options.hasPendingInput()) {
        deferrals += 1;
        if (deferrals > MAX_INPUT_DEFERRALS) return;
        arm(INPUT_DEFERRAL_DELAY_MS);
        return;
      }
      try {
        options.steps[index]!();
      } catch {
        return;
      }
      index += 1;
      if (index < options.steps.length) arm(0);
    }, delayMs);
  };

  arm(0);
  return () => {
    cancelled = true;
    if (cancelPending) cancelPending();
    cancelPending = null;
  };
}
