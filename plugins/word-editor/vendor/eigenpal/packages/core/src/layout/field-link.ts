// HYPERLINK field (§17.16.5.25) instruction parsing.
//
// `HYPERLINK "target" [switches]` is how Word writes a link as a FIELD rather than as a typed
// `w:hyperlink` element. The instruction is attacker-controlled: tokenization is one bounded
// pass over a length-capped string, every captured value is length-capped again, and every
// failure resolves to null (the caller paints the cached result as plain text, exactly as it
// did before this module existed).
//
// THIS MODULE PRODUCES STRINGS, NEVER HREFS. Sanitization policy lives at the surface trust
// boundary (`sanitizeHref` inside the projector the surface injects), so layout never decides
// what a browser may follow. Nothing here fetches, resolves, or interprets a target — the
// grammar is recognized and the raw pieces are handed over verbatim, case and
// percent-encoding preserved.

import { MAX_FIELD_INSTRUCTION_CHARS } from './field-instruction.ts';

/**
 * Longest raw instruction even considered — room for a full-length target plus switches.
 * The shared complex-field machine cap IS this bound, so a `HYPERLINK` instruction that fits
 * a `w:fldSimple` attribute also fits the complex lane's instruction buffer.
 */
export const MAX_HYPERLINK_INSTRUCTION_CHARS: number = MAX_FIELD_INSTRUCTION_CHARS;
/** Longest target captured — the bound the package puts on a relationship target. */
export const MAX_HYPERLINK_TARGET_CHARS = 2048;
/** Longest `\l` anchor or `\o` tooltip captured. */
export const MAX_HYPERLINK_SWITCH_ARG_CHARS = 256;

/**
 * One parsed `HYPERLINK` instruction: the raw, unsanitized pieces.
 *
 * `target` and `anchor` are verbatim from the instruction — the projector at the trust
 * boundary decides what, if anything, they become in a DOM sink.
 */
export interface HyperlinkFieldSpec {
  /** The target as authored (first quoted or bare non-switch token), or null. */
  readonly target: string | null;
  /** `\l` — a bookmark name in this document, or null. */
  readonly anchor: string | null;
  /** `\o` — the hover tooltip, or null. */
  readonly tooltip: string | null;
}

interface InstructionToken {
  readonly value: string;
  readonly quoted: boolean;
}

/** One bounded pass; a quote opens a token that runs to the closing quote (or the end). */
function tokenize(raw: string): InstructionToken[] {
  const tokens: InstructionToken[] = [];
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < raw.length && raw[j] !== '"') j += 1;
      tokens.push({ value: raw.slice(i + 1, j), quoted: true });
      i = j < raw.length ? j + 1 : j;
      continue;
    }
    let j = i;
    while (j < raw.length && !' \t\n\r"'.includes(raw[j]!)) j += 1;
    tokens.push({ value: raw.slice(i, j), quoted: false });
    i = j;
  }
  return tokens;
}

/**
 * Switches that CONSUME the token after them. `\l` (anchor) and `\o` (tooltip) keep theirs;
 * `\t` (target frame), `\m` (image-map coordinates) and `\n` (new window) are consumed and
 * ignored; the generic formatting switches `\*` / `\#` / `\@` take a format argument that
 * must not be mistaken for the target.
 */
const ARGUMENT_SWITCHES = new Set(['\\l', '\\o', '\\t', '\\m', '\\n', '\\*', '\\#', '\\@']);

/**
 * Parse a raw HYPERLINK instruction, or null when it is not one (or is hostile).
 *
 * Recognition is the first token equalling `HYPERLINK` case-insensitively. The target is the
 * first quoted or bare token that is neither a switch nor a switch's argument; switches may
 * appear on either side of it. Duplicates: FIRST wins, for target and switches alike, which
 * is what Word does with a malformed double instruction — so an INVALID first target (empty
 * quotes, or past the cap) forfeits the target rather than promoting a later token to it; an
 * `\l` anchor may still make an internal link. No target and no `\l` anchor is not a link at
 * all. Values are passed through verbatim — embedded whitespace inside a quoted
 * target survives; stripping smuggled control characters is the sanitizer's job, not the
 * parser's.
 */
export function parseHyperlinkInstruction(raw: string): HyperlinkFieldSpec | null {
  if (raw.length === 0 || raw.length > MAX_HYPERLINK_INSTRUCTION_CHARS) return null;
  const tokens = tokenize(raw);
  if (tokens.length < 2) return null;
  const first = tokens[0]!;
  if (first.quoted || first.value.toUpperCase() !== 'HYPERLINK') return null;

  let target: string | null = null;
  let targetTaken = false;
  let anchor: string | null = null;
  let anchorTaken = false;
  let tooltip: string | null = null;
  let tooltipTaken = false;
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (!token.quoted && token.value.startsWith('\\')) {
      const name = token.value.toLowerCase();
      if (!ARGUMENT_SWITCHES.has(name)) continue; // unknown switch: inert, takes nothing
      const arg = tokens[i + 1];
      // A switch's argument is the next token unless that token is itself a switch — the
      // same guard `field-symbol.ts` applies, so `\l \o "tip"` cannot eat the `\o`.
      if (!arg || (!arg.quoted && arg.value.startsWith('\\'))) continue;
      i += 1;
      const withinCap = arg.value.length > 0 && arg.value.length <= MAX_HYPERLINK_SWITCH_ARG_CHARS;
      // First `\l` / `\o` CONSUMES the switch even when its argument is invalid (over-cap), so a
      // later duplicate cannot win — the same first-wins rule the target token follows. An
      // invalid first argument means the switch contributes nothing, not that it forfeits its
      // slot to a later occurrence.
      if (name === '\\l') {
        if (!anchorTaken) {
          anchorTaken = true;
          if (withinCap) anchor = arg.value;
        }
      } else if (name === '\\o') {
        if (!tooltipTaken) {
          tooltipTaken = true;
          if (withinCap) tooltip = arg.value;
        }
      }
      // `\t` / `\m` / `\n` / `\*` / `\#` / `\@`: argument consumed and ignored.
      continue;
    }
    if (!targetTaken) {
      // The first target-position token CONSUMES target-hood even when it is invalid, so a
      // hostile decoy (`""` or an over-cap blob) cannot promote a later token Word ignores.
      targetTaken = true;
      if (token.value.length > 0 && token.value.length <= MAX_HYPERLINK_TARGET_CHARS) {
        target = token.value;
      }
    }
    // A second bare/quoted token is a duplicate target: first wins.
  }
  if (target === null && anchor === null) return null;
  return { target, anchor, tooltip };
}
