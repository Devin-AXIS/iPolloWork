// The letter a keyboard chord names, read the same way by the engine keymap and the
// adapters' own shortcuts.

import { isApplePlatform } from '@docx-editor.dev/i18n';

/** A single Latin letter, which is what every chord in this keymap is named by. */
const CHORD_LETTER = /^[a-z]$/;

/**
 * Which LETTER a chord names, for the accelerators held with Alt.
 *
 * The CHARACTER first. A user reaching for Ctrl+Alt+F presses the key that types `f`,
 * wherever their layout puts it, and Windows resolves accelerators the same way — so reading
 * the physical position first sent Dvorak's footnote chord to the key that types `u`.
 *
 * `event.code` is the fallback, for the case that makes `key` unreadable: a modifier that
 * COMPOSES. macOS turns Option+F into `ƒ`, Option+C into `ç` and Option+D into `∂`, none of
 * them a letter — so falling through to the keycap is the only way those chords work there,
 * and it costs nothing, because a `key` that IS a letter has already answered.
 *
 * Never both for one event: consulting `code` as well would claim a second chord wherever
 * the two disagree, which is every remapped layout.
 *
 * Shared with the adapters, whose Find shortcut reads letters the same way.
 *
 * @internal
 */
export function chordLetter(event: KeyboardEvent): string {
  const typed = event.key.toLowerCase();
  if (CHORD_LETTER.test(typed)) return typed;
  // Defaulted: a synthesised event — this repo's own keymap
  // tests build several — carries no `code`, and reading `.length` off it would throw out of
  // the keydown handler.
  const physical = event.code ?? '';
  return physical.length === 4 && physical.startsWith('Key') ? physical[3]!.toLowerCase() : '';
}

/**
 * The Go To chord: Ctrl+G, or Cmd+Option+G on Apple platforms. F5 is not used: browsers
 * reload on it. Cmd+G alone is left to the browser's find-next on macOS.
 *
 * @public
 */
export function isGoToChord(event: KeyboardEvent, apple = isApplePlatform()): boolean {
  if (event.shiftKey || event.isComposing) return false;
  if (apple) {
    if (!event.metaKey || !event.altKey || event.ctrlKey) return false;
  } else if (!event.ctrlKey || event.metaKey || event.altKey) return false;
  return chordLetter(event) === 'g';
}
