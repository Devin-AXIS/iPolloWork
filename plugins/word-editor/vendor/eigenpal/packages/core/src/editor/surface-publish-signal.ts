// Which surface publishes are worth telling a host about (editor seam).
//
// The surface reports on every commit, every caret move and every chrome toggle, and most of
// those tell a host nothing new. The facade's two signals are `change` (a document revision
// moved) and `selectionChange` (everything else observable), and the second one has no
// revision to compare — so it compares KEYS, one per piece of observable state that moves
// without moving the caret.
//
// It lives in its own file because the list only ever grows: every feature that keeps state
// on the surface rather than in the document — the armed typing format, the open furniture
// story, how a drawing came to be selected, the format painter's arming — has to be added
// here or its chrome sleeps through it. Kept beside the facade, that list was five
// interleaved `let`s reset from three places, and the omission had no obvious home.

import type { PaginatedSurface, PaginatedSurfaceState } from './paginated-surface-contract.ts';
import type { SemanticSelection as SurfaceSelection } from '@docx-editor.dev/core/layout';
import { drawingSelectionIntentKey } from './group-member-selection.ts';
import { selectionsMatch } from './docx-editor-support.ts';

/** The observable surface state one publish reported, reduced to comparable keys. */
interface PublishKeys {
  selection: SurfaceSelection | null;
  /**
   * The armed typing format (Word's stored marks).
   *
   * Arming moves NO document revision and NO caret, so neither of the facade's two change
   * signals fires for it — and a host that only ever hears events would leave its Bold
   * button unpressed while the engine had it armed. Reference-compared: the surface hands
   * back the same array while the armed set is unchanged.
   */
  pendingFormat: PaginatedSurfaceState['pendingFormat'];
  /** Furniture scope — chrome must wake even when caret text offsets did not move. */
  headerFooter: string | null;
  /** A press on a drawing can re-set the SAME selection value; the intent key reports it. */
  drawingIntent: string;
  /**
   * Format painter arming and level.
   *
   * The same shape as the armed typing format above, and the same reason: a press captures
   * and arms without touching the document or the caret. Its whole affordance IS its mode —
   * armed, locked, or off — so a control that never hears about the change is a control that
   * never lights up.
   */
  formatPainter: string;
  /**
   * The collaboration session's status.
   *
   * A session that connects or drops moves no revision and no caret either, so a snapshot
   * reader, or a notice waiting for the session, slept through it until something else moved.
   */
  collaborationStatus: PaginatedSurfaceState['collaborationStatus'];
  /**
   * How many pages the layout has.
   *
   * Pages laid out after an edit or an open, in background tasks, move no revision and no
   * caret, so a page counter kept the partial total until something else moved.
   */
  pageCount: number;
}

const EMPTY: PublishKeys = {
  selection: null,
  pendingFormat: null,
  headerFooter: null,
  drawingIntent: 'none',
  formatPainter: 'off/none',
  collaborationStatus: 'inactive',
  pageCount: 0,
};

function keysOf(state: PaginatedSurfaceState, surface: PaginatedSurface): PublishKeys {
  const hf = surface.headerFooterState?.();
  return {
    selection: state.selection,
    pendingFormat: state.pendingFormat,
    headerFooter: hf?.editing && hf.rId ? `${hf.editing}:${hf.rId}` : null,
    drawingIntent: drawingSelectionIntentKey(surface.drawingSelectionIntent()),
    formatPainter: `${state.formatPainter.mode}/${state.formatPainter.level}`,
    collaborationStatus: state.collaborationStatus,
    pageCount: state.pageCount,
  };
}

/** What a publish moved. @internal */
export type PublishMove = 'nothing' | 'pages' | 'state';

/**
 * Tracks what the last emitted tick reported, and answers whether this one differs.
 *
 * @internal
 */
export interface PublishSignal {
  /**
   * What this publish moved — nothing, only the page count, or other observable state — and
   * adopt it as the new baseline either way: a publish that is not emitted is still the most
   * recent truth, so the NEXT one must be compared against it rather than against the last
   * one a host happened to hear.
   */
  moved(state: PaginatedSurfaceState, surface: PaginatedSurface): PublishMove;
  /** Adopt a freshly mounted surface as the baseline, without emitting. */
  adopt(surface: PaginatedSurface): void;
  /** Forget everything — the surface it described is gone. */
  reset(): void;
}

export function createPublishSignal(): PublishSignal {
  let last: PublishKeys = { ...EMPTY };
  return {
    moved(state, surface) {
      const next = keysOf(state, surface);
      const quiet =
        selectionsMatch(next.selection, last.selection) &&
        next.pendingFormat === last.pendingFormat &&
        next.headerFooter === last.headerFooter &&
        next.drawingIntent === last.drawingIntent &&
        next.formatPainter === last.formatPainter &&
        next.collaborationStatus === last.collaborationStatus;
      const pages = next.pageCount !== last.pageCount;
      last = next;
      return !quiet ? 'state' : pages ? 'pages' : 'nothing';
    },
    adopt(surface) {
      last = keysOf(surface.state(), surface);
    },
    reset() {
      last = { ...EMPTY };
    },
  };
}
