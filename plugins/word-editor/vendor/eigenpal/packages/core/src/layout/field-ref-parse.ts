// The REF-family grammar: `REF` / `NOTEREF` / `PAGEREF` instruction recognition and the
// modifier side channel their parses attach. Split from `field-ref.ts`, which owns the story
// scan and the resolution context, so that module stays under its line budget.
//
// The instruction is attacker-controlled and NEVER executes. Recognition is one bounded,
// quote-aware tokenize pass over a length-capped string; anything outside the supported
// grammar resolves to null and the field keeps painting its cached result.

import { MAX_FIELD_INSTRUCTION_CHARS } from './field-instruction.ts';

/** Word's own bookmark-name limit is 40; this is the fail-closed bound, not a fidelity claim. */
export const MAX_REF_BOOKMARK_NAME_CHARS = 256;

/** One recognized REF instruction: the target name and the supported switches, nothing else. */
export interface RefFieldSpec {
  readonly bookmark: string;
  /** `r` / `w` paint the target's number; `n` the same without context; null the range text. */
  readonly numberSwitch: 'r' | 'w' | 'n' | null;
  /** `\h` marks a reference whose displayed result links to its bookmark. */
  readonly hyperlink: boolean;
}

/**
 * The modifiers a parse attaches beyond the public members: `\t` (suppress the number's
 * literal text) and the NOTEREF field kind. A side channel rather than members — the same
 * idiom `ListCounterAdvance` uses, for the same reason: `RefFieldSpec` is public API, and a
 * hand-built spec without an entry must mean "no modifiers", which the default below encodes.
 * Values are the frozen singletons, so agreement between two independent parses of the same
 * instruction is an identity comparison.
 */
export interface RefSpecModifiers {
  /** `\t`: drop non-delimiter literal text from the referenced number. */
  readonly suppressNonDelimiterText: boolean;
  /** The instruction was `NOTEREF`: paint the bookmarked note reference's display number. */
  readonly noteRef: boolean;
  /** The instruction was `PAGEREF`: paint the page number of the bookmark target's page. */
  readonly pageRef: boolean;
}
const REF_MODS_NONE: RefSpecModifiers = Object.freeze({
  suppressNonDelimiterText: false,
  noteRef: false,
  pageRef: false,
});
const REF_MODS_SUPPRESS: RefSpecModifiers = Object.freeze({
  suppressNonDelimiterText: true,
  noteRef: false,
  pageRef: false,
});
const REF_MODS_NOTEREF: RefSpecModifiers = Object.freeze({
  suppressNonDelimiterText: false,
  noteRef: true,
  pageRef: false,
});
const REF_MODS_PAGEREF: RefSpecModifiers = Object.freeze({
  suppressNonDelimiterText: false,
  noteRef: false,
  pageRef: true,
});
const refSpecModifiers = new WeakMap<RefFieldSpec, RefSpecModifiers>();

export function refSpecModifiersOf(spec: RefFieldSpec): RefSpecModifiers {
  return refSpecModifiers.get(spec) ?? REF_MODS_NONE;
}

/**
 * Split a whitespace-collapsed instruction into space- or quote-delimited tokens.
 *
 * One linear pass, no regex over file-derived text. An unterminated quote fails the whole
 * parse (null) rather than guessing where the argument ends.
 */
function tokenizeInstruction(collapsed: string): string[] | null {
  const tokens: string[] = [];
  let index = 0;
  while (index < collapsed.length) {
    const char = collapsed[index]!;
    if (char === ' ') {
      index += 1;
      continue;
    }
    if (char === '"') {
      const close = collapsed.indexOf('"', index + 1);
      if (close === -1) return null;
      tokens.push(collapsed.slice(index + 1, close));
      index = close + 1;
      continue;
    }
    let end = index;
    while (end < collapsed.length && collapsed[end] !== ' ') end += 1;
    tokens.push(collapsed.slice(index, end));
    index = end;
  }
  return tokens;
}

/**
 * Recognize `REF <bookmark> [\r|\w|\n] [\t] [\h] [\* MERGEFORMAT]` or
 * `NOTEREF <bookmark> [\h] [\* MERGEFORMAT]`, or null for anything else.
 *
 * The keyword matches case-insensitively; the bookmark name keeps its authored case (it is a
 * lookup key into a Map, never an object property, so hostile names like `__proto__` are just
 * names that resolve to nothing). Any unrecognized switch fails the parse so the field falls
 * back to its cached result — never the raw instruction, never a guess. NOTEREF's `\p`
 * (above/below position text) and `\f` (note-style formatting) are unrecognized on purpose.
 */
export function parseRefInstruction(raw: string): RefFieldSpec | null {
  if (raw.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  const tokens = tokenizeInstruction(collapsed);
  if (tokens === null || tokens.length < 2) return null;
  const keyword = tokens[0]!.toUpperCase();
  if (keyword !== 'REF' && keyword !== 'NOTEREF' && keyword !== 'PAGEREF') return null;
  const bookmark = tokens[1]!;
  if (
    bookmark.length === 0 ||
    bookmark.length > MAX_REF_BOOKMARK_NAME_CHARS ||
    bookmark.startsWith('\\')
  ) {
    return null;
  }
  if (keyword === 'NOTEREF') return parseNoteRefSwitches(tokens, bookmark);
  if (keyword === 'PAGEREF') return parsePageRefSwitches(tokens, bookmark);
  let sawN = false;
  let sawR = false;
  let sawW = false;
  let sawT = false;
  let hyperlink = false;
  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index]!.toUpperCase();
    if (token === '\\R') sawR = true;
    else if (token === '\\W') sawW = true;
    else if (token === '\\N') sawN = true;
    else if (token === '\\T') sawT = true;
    else if (token === '\\H') hyperlink = true;
    else if (token === '\\*' && tokens[index + 1]?.toUpperCase() === 'MERGEFORMAT') index += 1;
    else if (token === '\\*MERGEFORMAT') continue;
    else return null;
  }
  // Several number switches in one instruction: `\n` outranks `\r` outranks `\w`. Real
  // documents write `\w \n \h` and cache the `\n`-shaped value; calibration guards the rest.
  const numberSwitch: RefFieldSpec['numberSwitch'] = sawN ? 'n' : sawR ? 'r' : sawW ? 'w' : null;
  const spec: RefFieldSpec = { bookmark, numberSwitch, hyperlink };
  if (sawT) refSpecModifiers.set(spec, REF_MODS_SUPPRESS);
  return spec;
}

/** The NOTEREF switch arm: `\h` inert, `\* MERGEFORMAT` inert, anything else fails closed. */
function parseNoteRefSwitches(tokens: readonly string[], bookmark: string): RefFieldSpec | null {
  let hyperlink = false;
  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index]!.toUpperCase();
    if (token === '\\H') hyperlink = true;
    else if (token === '\\*' && tokens[index + 1]?.toUpperCase() === 'MERGEFORMAT') index += 1;
    else if (token === '\\*MERGEFORMAT') continue;
    else return null;
  }
  const spec: RefFieldSpec = { bookmark, numberSwitch: null, hyperlink };
  refSpecModifiers.set(spec, REF_MODS_NOTEREF);
  return spec;
}

/**
 * The PAGEREF switch arm: `\h` inert, `\* MERGEFORMAT` inert, anything else fails closed.
 *
 * `\p` (the "above/below" relative form) is unrecognized ON PURPOSE — such a field keeps its
 * cached result, never a guessed position word. The value itself is a property of pagination,
 * so the projection paints the cache and marks the span for the document finalize pass
 * (`finalizePageFieldProjection`) to substitute the target's page number.
 */
function parsePageRefSwitches(tokens: readonly string[], bookmark: string): RefFieldSpec | null {
  let hyperlink = false;
  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index]!.toUpperCase();
    if (token === '\\H') hyperlink = true;
    else if (token === '\\*' && tokens[index + 1]?.toUpperCase() === 'MERGEFORMAT') index += 1;
    else if (token === '\\*MERGEFORMAT') continue;
    else return null;
  }
  const spec: RefFieldSpec = { bookmark, numberSwitch: null, hyperlink };
  refSpecModifiers.set(spec, REF_MODS_PAGEREF);
  return spec;
}

/**
 * A plain REF: its result is the target's text or number, which pagination never changes.
 * PAGEREF shows a page number and NOTEREF a note number that can restart on each page.
 */
export function plainRefSpec(spec: RefFieldSpec): boolean {
  const modifiers = refSpecModifiersOf(spec);
  return !modifiers.pageRef && !modifiers.noteRef;
}
