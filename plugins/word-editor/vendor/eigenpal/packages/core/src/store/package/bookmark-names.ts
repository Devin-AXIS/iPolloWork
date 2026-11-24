// What a bookmark may be called.
//
// A name starts with a letter, or with an underscore for a hidden bookmark, and continues with
// letters, decimal digits and underscores. Letters are any Unicode letter, so `Ünï` and `日本`
// are names; a space, a hyphen, a period or a currency sign is not part of one. Names are at
// most 40 characters and compare without regard to case: `Intro` and `INTRO` are the same
// bookmark, and setting one replaces the other.
//
// These are AUTHORING rules. A document can declare any name it likes, and the read side keeps
// reading those (see `bookmarks.ts`, which only bounds the length). Only a name the editor is
// asked to write goes through `bookmarkNameProblem`.

/** The longest name a bookmark is written with. */
export const MAX_AUTHORED_BOOKMARK_NAME_LENGTH = 40;

/**
 * Why a name cannot be written, or null when it can.
 *
 * - `empty`: no characters.
 * - `tooLong`: more than {@link MAX_AUTHORED_BOOKMARK_NAME_LENGTH} characters.
 * - `invalidStart`: the first character is not a letter or an underscore.
 * - `invalidCharacter`: a later character is not a letter, a digit or an underscore.
 *
 * @public
 */
export type BookmarkNameProblem = 'empty' | 'tooLong' | 'invalidStart' | 'invalidCharacter';

const FIRST = /^[\p{L}_]$/u;
const REST = /^[\p{L}\p{Nd}_]$/u;

/**
 * Check a name before it is written. Measured in code points, so a letter outside the Basic
 * Multilingual Plane counts once.
 *
 * @public
 */
export function bookmarkNameProblem(name: string): BookmarkNameProblem | null {
  if (typeof name !== 'string' || name.length === 0) return 'empty';
  // Bounded before the per-character walk: the input may come from a caller, not a person.
  if (name.length > MAX_AUTHORED_BOOKMARK_NAME_LENGTH * 2) return 'tooLong';
  const characters = Array.from(name);
  if (characters.length > MAX_AUTHORED_BOOKMARK_NAME_LENGTH) return 'tooLong';
  if (!FIRST.test(characters[0]!)) return 'invalidStart';
  for (let index = 1; index < characters.length; index += 1) {
    if (!REST.test(characters[index]!)) return 'invalidCharacter';
  }
  return null;
}

/**
 * Whether a bookmark is hidden: its name starts with an underscore. Hidden bookmarks are the
 * ones applications write for themselves, such as the targets of a table of contents.
 *
 * @public
 */
export function isHiddenBookmarkName(name: string): boolean {
  return name.startsWith('_');
}

/**
 * The key two names are compared by. Names are case-insensitive, so `Intro` and `intro`
 * share a key.
 *
 * @public
 */
export function bookmarkNameKey(name: string): string {
  return name.toLowerCase();
}
