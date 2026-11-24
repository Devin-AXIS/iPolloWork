// What colour a remote collaborator draws in — the two answers, and why they are two.
//
// A caret's colour has three possible sources, and they rank: the colour the HOST declared
// for that author, then the colour the PEER published for itself, then an allocated slot from
// the review ramp. The middle one is remote input and the first is the app's own record, so a
// declaration outranks it — otherwise a peer could make their caret disagree with their own
// comment cards, and a host that declared "Rosa draws in green" would be overruled by anyone
// claiming to be Rosa.
//
// That ordering is why this module answers TWICE rather than once. `declaredFor` is the
// host's record and outranks the published colour; `forAuthor` is the ramp fallback and does
// not. Collapsing them into one lookup would either let the ramp beat a published colour, or
// let a published colour beat a declaration.

import { safeParticipantColor } from '../collaboration/participant-color.ts';
import {
  reviewAuthorSlotColor,
  revisionAuthorStylesOf,
  type ReviewAuthorInfo,
  type RevisionAuthorStyle,
  type RevisionStyles,
  type StableReviewAuthorSlots,
} from '../output/revision-presentation.ts';

/** The surface state these lookups read, passed as accessors so they stay live. */
export interface PresenceColorInput {
  /** The document's resolved author roster, as the surface derives it per layout. */
  readonly roster: () => {
    readonly value: ReadonlyMap<string, number>;
    readonly resolved: ReadonlyMap<string, ReviewAuthorInfo>;
  };
  /** The host's current per-author declaration. */
  readonly styles: () => RevisionStyles | undefined;
  /** The surface's stable allocator, so a presence-only name keeps its slot for the session. */
  readonly slots: StableReviewAuthorSlots;
}

/** The two presence-colour answers. @see PresenceColorInput */
export interface PresenceColors {
  /**
   * The roster's colour for one author, or a newly allocated ramp slot.
   *
   * A name the roster does not carry reserves a slot exactly as an authoring author would, so
   * when they later make a tracked change or comment they keep this colour. A presence-only
   * reservation never joins `revisionAuthors()`: the roster still derives from the layout and
   * the review queue alone.
   *
   * Sanitized AT THE RESOLUTION: a declared style colour is host input in any CSS shape, and
   * the paint sink refuses what `safeParticipantColor` refuses. Refusing it here — falling to
   * the author's slot token — keeps the painted caret and any chrome reading this answer on
   * one colour instead of splitting them at the sink.
   */
  forAuthor(name: string): string | undefined;
  /**
   * The colour the HOST declared for one author, or undefined.
   *
   * Answers for an author the document has never seen, which in a live room is most
   * collaborators — the roster only holds people who have already written something.
   */
  declaredFor(name: string): string | undefined;
}

export function createPresenceColors(input: PresenceColorInput): PresenceColors {
  // Rebuilt only when the declaration changes: `declaredFor` runs once per remote caret per
  // paint, and `revisionAuthorStylesOf` walks the whole declaration each call.
  let cache: {
    styles: RevisionStyles | undefined;
    resolved: ReadonlyMap<string, RevisionAuthorStyle>;
  } | null = null;

  return {
    forAuthor(name) {
      const roster = input.roster();
      const known = roster.resolved.get(name);
      if (known) return safeParticipantColor(known.color) ?? reviewAuthorSlotColor(known.slot);
      const slot = input.slots.resolve(roster.value, [name]).get(name);
      return slot === undefined ? undefined : reviewAuthorSlotColor(slot);
    },
    declaredFor(name) {
      const styles = input.styles();
      if (cache === null || cache.styles !== styles) {
        cache = { styles, resolved: revisionAuthorStylesOf(styles) };
      }
      return safeParticipantColor(cache.resolved.get(name)?.color);
    },
  };
}
