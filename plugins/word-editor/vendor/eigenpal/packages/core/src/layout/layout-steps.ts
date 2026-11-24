// Layout work that can pause between units, as generators.
//
// A long table is one block, and laying it out took seconds in one task while a large document
// opened. The table paginator and the layout functions above it are generators: each yield is
// a point where an opening slice may stop and give the page a turn. Every synchronous caller
// drains them, so outside an opening nothing pauses and the answer is the same.

import type { PageRecord, SemanticLayout } from './semantic-records.ts';
import { withFieldResultsMode, type FieldResultsMode } from '../store/package/field-result-mode.ts';

/** Body rows a table paginator places between two pause points. */
export const TABLE_ROWS_PER_STEP = 8;

/**
 * The pages a body pass has completed so far, reported between blocks. `finalize` turns a page
 * list into a publishable layout (page fields, list labels) without touching the session, for
 * a host that shows these pages before the pass ends.
 */
export interface LayoutProgress {
  readonly pages: readonly PageRecord[];
  readonly finalize?: (pages: readonly PageRecord[]) => SemanticLayout;
  /**
   * False when the pass advances state that `snapshotLayoutSession` does not cover, so a host
   * that pauses it must finish it before laying out again; it cannot put it back.
   */
  readonly restorable?: boolean;
  /**
   * Asks a pass that is not restorable to end at its next consistent point, for a newer edit
   * that replaces its answer. The pass still returns a layout that matches its session; the
   * next pass continues from there.
   */
  readonly wrapUp?: () => void;
  /**
   * The pass has written its end state to the session and only finishes its answer (the
   * headers and footers off the screen, `surface-furniture-later.ts`): a host that pauses it
   * drops it for a newer edit without putting anything back, and shows `pages` as they are.
   */
  readonly settled?: boolean;
}

/** Steps that end with a `T`, reporting progress at some pause points. */
export type LayoutSteps<T> = Generator<LayoutProgress | void, T, void>;

/** Run `steps` to the end. */
export function drainLayoutSteps<T>(steps: LayoutSteps<T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/**
 * `steps` with `mode` installed around every resume, and around the `finalize` of each report,
 * so a pass that pauses reads the same field offsets as one that runs straight through.
 */
export function* stepsInFieldResultsMode<T>(
  mode: FieldResultsMode | undefined,
  steps: LayoutSteps<T>
): LayoutSteps<T> {
  if (mode === undefined) return yield* steps;
  for (;;) {
    const next = withFieldResultsMode(mode, () => steps.next());
    if (next.done) return next.value;
    const progress = next.value;
    const finalize = progress?.finalize;
    yield finalize
      ? { ...progress, finalize: (pages) => withFieldResultsMode(mode, () => finalize(pages)) }
      : progress;
  }
}
