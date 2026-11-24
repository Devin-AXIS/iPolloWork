// Which story a review card lives in, from the part name its range carries.
import { firstReviewRange, type ReviewItem } from '../store/index.ts';
import { resolveNotesPart } from '../store/package/note-references.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

type Session = PaginatedSurface['session'];

/**
 * The header or footer a review item lives in.
 *
 * `null` means the part is not a header/footer this document's sections resolve, that is the
 * body (or an unknown part, which is treated as body rather than guessed at).
 */
export function furnitureHomeOfItem(
  session: Session | undefined,
  item: ReviewItem
): { readonly kind: 'header' | 'footer'; readonly rId: string } | null {
  const partName = firstReviewRange(item)?.partName;
  if (!partName || !session || partName === session.part().name) return null;
  for (const section of session.headerFooterResolutionBySection()) {
    for (const kind of ['header', 'footer'] as const) {
      const slots = kind === 'header' ? section.headers : section.footers;
      for (const slot of slots.values()) {
        if (slot.partName === partName) return { kind, rId: slot.rId };
      }
    }
  }
  return null;
}

/**
 * The notes PART a card lives in, for a write that must land there.
 *
 * Derived from the part NAME, not from the note: which part a write targets is a question the
 * range answers by itself, and routing it through the per-note lookup made it fail whenever that
 * lookup did, such as for a note whose `w:id` the file omits or one the layout has not painted.
 * The card was then treated as a body card, so Accept reported `unknown-revision` on a card the
 * queue itself listed as resolvable.
 */
export function noteStoryScopeOfItem(
  session: Session | undefined,
  item: ReviewItem
): { readonly kind: 'notesPart'; readonly noteKind: 'footnote' | 'endnote' } | null {
  const partName = firstReviewRange(item)?.partName;
  if (!partName || !session) return null;
  // Read from the PACKAGE, never `partFor`: resolving a notes scope opens a story store, and
  // this runs per item on read paths (`getTrackedChanges`, the review placements).
  for (const noteKind of ['footnote', 'endnote'] as const) {
    if (resolveNotesPart(session.currentPackage(), noteKind)?.name === partName) {
      return { kind: 'notesPart', noteKind };
    }
  }
  return null;
}
