import type { LayoutSteps } from './layout-steps.ts';
import type { SemanticLayout } from './semantic-records.ts';
import type { NoteMarkContext } from './note-projection.ts';
import type { NotesLayoutInput } from './note-pagination.ts';

/** The options a notes pass reads from its caller's body options. */
export type NotesBodyOptions = Pick<NotesLayoutInput, 'styleCascade' | 'numberingIndex'> & {
  noteMarks?: NoteMarkContext;
  pageBottomReserves?: ReadonlyMap<number, number>;
  pageBottomReservesFromPreviousPass?: boolean;
  pageBottomReservesFollowFlow?: boolean;
  noteRoundBlockLimit?: number;
  session?: {
    previous: SemanticLayout | null;
    multi: unknown;
    notes: unknown;
    notePageBottomReserves?: ReadonlyMap<number, number> | null;
  };
};

/**
 * Passes a body run's progress through with note areas on the pages it completed. The pages
 * after them come from the published layout and already carry theirs. A host puts a paused
 * pass back with `snapshotLayoutSession`, which covers the search memo.
 */
export function* withNoteAreasOnProgress(
  steps: LayoutSteps<SemanticLayout>,
  attachNotes: (layout: SemanticLayout) => SemanticLayout,
  wrapUp: () => void
): LayoutSteps<SemanticLayout> {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    const progress = next.value;
    if (!progress) {
      yield progress;
      continue;
    }
    const inner = progress.finalize;
    const count = progress.pages.length;
    yield {
      ...progress,
      wrapUp,
      ...(inner
        ? {
            finalize: (pages) => {
              const base = inner(pages);
              const head = attachNotes({ ...base, pages: base.pages.slice(0, count) });
              return {
                ...base,
                pages: [...head.pages.slice(0, count), ...base.pages.slice(count)],
              };
            },
          }
        : {}),
    };
  }
}
