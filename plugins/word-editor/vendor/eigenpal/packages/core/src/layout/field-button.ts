// MACROBUTTON / GOTOBUTTON (§17.16.5.36, §17.16.5.31) display-text parsing.
//
// `MACROBUTTON MacroName display text` and `GOTOBUTTON target display text` DISPLAY everything
// after their first argument. Word paints that text, and real files carry no cached result for
// these fields, so without synthesis they paint nothing. The macro name / jump target is
// consumed and DISCARDED: this module produces display strings only — nothing here executes a
// macro, resolves a target, or navigates, and no caller may wire a click to one.
//
// The instruction is attacker-controlled: tokenization is one bounded pass over a
// length-capped string and every failure resolves to null (the caller falls back to cached
// text or nothing, exactly as before this module existed).

/**
 * Local parser bound: a legitimate button field is a keyword, one argument, and short display
 * text — anything near this length is garbage, and the display it caps must stay paintable.
 * Deliberately NOT the shared machine cap (`MAX_FIELD_INSTRUCTION_CHARS`), which is sized for
 * full-length HYPERLINK targets; this grammar's rejection threshold must not move when that
 * bound does.
 */
export const MAX_BUTTON_INSTRUCTION_CHARS = 256;

/** One parsed MACROBUTTON / GOTOBUTTON instruction: the text Word paints, nothing else. */
export interface ButtonFieldSpec {
  /**
   * The display text: the raw remainder after the first argument, end-trimmed, surrounding
   * quotes removed when the whole remainder is one quoted token. Internal whitespace and
   * quotes survive verbatim — Word preserves them. Never empty.
   */
  readonly display: string;
}

const WHITESPACE = ' \t\n\r';

/**
 * A TRAILING formatting switch: `\*` plus its argument (`MERGEFORMAT`, `Upper`, …), quoted or
 * bare. Anchored at the end so a backslash INSIDE legitimate display text is never eaten —
 * only a tail that is nothing but the switch matches. Each piece is a distinct character
 * class, so the match is linear.
 */
const TRAILING_FORMAT_SWITCH = /[ \t\n\r]*\\\*[ \t\n\r]*(?:"[^"]*"|[^ \t\n\r"\\]+)?[ \t\n\r]*$/;

function skipWhitespace(raw: string, index: number): number {
  let i = index;
  while (i < raw.length && WHITESPACE.includes(raw[i]!)) i += 1;
  return i;
}

/** End index just past one token; a quote opens a token that runs to the closing quote (or the end). */
function skipToken(raw: string, index: number): number {
  if (raw[index] === '"') {
    let j = index + 1;
    while (j < raw.length && raw[j] !== '"') j += 1;
    return j < raw.length ? j + 1 : j;
  }
  let j = index;
  while (j < raw.length && !' \t\n\r"'.includes(raw[j]!)) j += 1;
  return j;
}

/**
 * Parse a raw MACROBUTTON / GOTOBUTTON instruction, or null when it is not one (or is
 * hostile).
 *
 * Recognition is the first token equalling either keyword case-insensitively — the exact
 * token, so `MACROBUTTONX` is not one. The first argument (macro name / jump target, one
 * quoted or bare token) is consumed and discarded, never stored. The display text is the raw
 * remainder, end-trimmed, with any trailing `\*` formatting switch stripped and surrounding
 * quotes removed when the whole remainder is one quoted token. An empty display, an
 * over-cap instruction (which also caps the display — the `w:fldSimple` attribute path has no
 * upstream bound), or a missing argument is null.
 */
export function parseButtonInstruction(raw: string): ButtonFieldSpec | null {
  if (raw.length === 0 || raw.length > MAX_BUTTON_INSTRUCTION_CHARS) return null;
  const keywordStart = skipWhitespace(raw, 0);
  if (raw[keywordStart] === '"') return null;
  const keywordEnd = skipToken(raw, keywordStart);
  const keyword = raw.slice(keywordStart, keywordEnd).toUpperCase();
  if (keyword !== 'MACROBUTTON' && keyword !== 'GOTOBUTTON') return null;

  const argumentStart = skipWhitespace(raw, keywordEnd);
  if (argumentStart >= raw.length) return null;
  // The macro name / jump target: consumed and DISCARDED — display is all these fields do.
  const argumentEnd = skipToken(raw, argumentStart);

  let display = raw.slice(argumentEnd).trim();
  // Strip trailing formatting switches one at a time (`… \* Upper \* MERGEFORMAT`); each pass
  // shortens the string, so this terminates.
  for (;;) {
    const stripped = display.replace(TRAILING_FORMAT_SWITCH, '').trimEnd();
    if (stripped === display) break;
    display = stripped;
  }
  // Whole-remainder quote removal, on the tokenizer's own terms: the quote runs to the closing
  // quote or the end. A close quote anywhere earlier means the quotes are PART of the display.
  if (display[0] === '"') {
    const close = display.indexOf('"', 1);
    if (close === -1) display = display.slice(1);
    else if (close === display.length - 1) display = display.slice(1, -1);
  }
  if (display.length === 0) return null;
  return { display };
}
