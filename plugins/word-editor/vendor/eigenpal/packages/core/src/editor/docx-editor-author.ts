/** Normalize an editor author for storage and comparison. */
export function normalizeEditorAuthor(author: string | undefined): string | undefined {
  return author?.trim() || undefined;
}

/** Initials from a name, for a revision — `CT_TrackChange` carries no `@w:initials`. */
/** Initials per author name: a review rail asks once per card, for the same few authors. */
const initialsByAuthor = new Map<string, string>();

export function initialsOfAuthor(author: string): string {
  const known = initialsByAuthor.get(author);
  if (known !== undefined) return known;
  const words = author.trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length === 0
      ? '?'
      : words
          .slice(0, 2)
          .map((word) => word[0]!.toUpperCase())
          .join('');
  // Bounded: a document names few authors, and a hostile one gains nothing past this.
  if (initialsByAuthor.size < 256) initialsByAuthor.set(author, initials);
  return initials;
}

/** Surface refusals whose missing-author precondition a configured author resolves. */
export function isMissingAuthorRefusal(reason: string | null): boolean {
  return (
    reason === 'suggesting needs an author before it can propose a change' ||
    reason === 'tracked changes need a non-empty author'
  );
}
