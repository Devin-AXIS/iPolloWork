// The facade's revision-colour state, extracted from `docx-editor.ts` (composition root,
// at its line cap): the current option, and the resolved-roster cache behind
// `getReviewAuthors`.

import {
  revisionAuthorStylesOf,
  reviewAuthorsOf,
  type ReviewAuthorInfo,
  type RevisionAuthorStyle,
  type RevisionStyles,
} from '../output/revision-presentation.ts';

/** The detached answer: no surface, no authors. One instance, so caching stays valid. */
export const EMPTY_AUTHOR_SLOTS: ReadonlyMap<string, number> = new Map();

/** See {@link createRevisionStyleState}. */
export interface RevisionStyleState {
  /** The colours a (re)mounting surface opens with — the latest, not construction-time. */
  current(): RevisionStyles | undefined;
  set(colors: RevisionStyles | undefined): void;
  /** The resolved roster for a surface's author→slot map. See `getReviewAuthors`. */
  authorsFor(slots: ReadonlyMap<string, number>): readonly ReviewAuthorInfo[];
  /** The style declared for one author, whether or not the DOCUMENT carries them. */
  styleFor(author: string): RevisionAuthorStyle | undefined;
}

/**
 * Holds how tracked changes are coloured, replaceable live through `setRevisionStyles`,
 * and resolves the author roster against it.
 *
 * `authorsFor` is cached on the SLOT MAP's identity (the surface mints one per layout)
 * plus the colours reference, so repeated reads return the same array until either moves —
 * the reference stability `useSyncExternalStore` consumers rely on.
 */
export function createRevisionStyleState(initial: RevisionStyles | undefined): RevisionStyleState {
  let colors = initial;
  let cache: {
    slots: ReadonlyMap<string, number>;
    colors: RevisionStyles | undefined;
    value: readonly ReviewAuthorInfo[];
  } | null = null;
  // Normalised declarations, cached on the option's identity. Independent of the document:
  // a style declared for someone who only COMMENTED still resolves, which is what lets the
  // review chrome draw their card in their colour.
  let declared: {
    colors: RevisionStyles | undefined;
    value: ReadonlyMap<string, RevisionAuthorStyle>;
  } | null = null;
  return {
    current: () => colors,
    set: (next) => {
      colors = next;
    },
    authorsFor: (slots) => {
      if (cache && cache.slots === slots && cache.colors === colors) return cache.value;
      const value = reviewAuthorsOf(slots, colors);
      cache = { slots, colors, value };
      return value;
    },
    styleFor: (author) => {
      if (!declared || declared.colors !== colors) {
        declared = { colors, value: revisionAuthorStylesOf(colors) };
      }
      return declared.value.get(author);
    },
  };
}
