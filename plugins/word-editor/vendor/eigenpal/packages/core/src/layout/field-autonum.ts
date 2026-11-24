// AUTONUM / AUTONUMLGL / AUTONUMOUT legacy auto-number fields (§17.16.5.7-9).
//
// Unlike REF or PAGEREF, these complex fields carry NO separator and NO cached result runs —
// Word computes the number at display time and never stores it. The engine's inert-field
// handling therefore painted the region between `begin` and `end` as empty, and the paragraph
// lost its number outright. There is no cache to fall back to, so the value is synthesized:
// one counter per kind, advanced in document order by the shared story scan in `field-ref.ts`,
// formatted here through the same bounded ST_NumberFormat resolver list markers use.
//
// The instruction is attacker-controlled and NEVER executes. Recognition is one bounded
// tokenize pass; anything outside the supported grammar — an unknown switch (`\s`, …), an
// unknown `\*` format — fails the parse and the field paints nothing, exactly as before.
//
// DEVIATION: Word restarts these counters per heading context (AUTONUMOUT follows the outline
// numbering). This engine numbers each kind sequentially in document order, which reproduces
// the annex/rider idiom the fields are used for; a restart scheme can layer on later.
//
// Save behavior: Word stores no results for these fields, so serialization stays untouched.

import { normalizeFieldInstruction } from './field-instruction.ts';
import { formatNumFmt } from './numbering-format.ts';

export type AutonumFieldKind = 'AUTONUM' | 'AUTONUMLGL' | 'AUTONUMOUT';

/** One recognized AUTONUM-family instruction: the kind and its supported switches. */
export interface AutonumFieldSpec {
  readonly kind: AutonumFieldKind;
  /** ST_NumberFormat resolved from the `\*` switch; null paints decimal. */
  readonly numFmt: string | null;
  /** `\e`: display the number without its trailing period. */
  readonly suppressPeriod: boolean;
}

/**
 * Map a `\*` general-format switch onto the shared ST_NumberFormat vocabulary.
 *
 * The keyword matches case-insensitively; for the alphabetic and roman forms the switch's OWN
 * case picks the variant, which is how Word reads `\* ALPHABETIC` (A, B) against
 * `\* alphabetic` (a, b). Anything unrecognized returns null and fails the whole parse — the
 * field paints nothing rather than a number in the wrong form.
 */
function numFmtOfFormatSwitch(token: string): string | null {
  const upper = token.toUpperCase();
  const uppercase = token[0] === token[0]?.toUpperCase();
  switch (upper) {
    case 'ARABIC':
      return 'decimal';
    case 'ALPHABETIC':
      return uppercase ? 'upperLetter' : 'lowerLetter';
    case 'ROMAN':
      return uppercase ? 'upperRoman' : 'lowerRoman';
    case 'ORDINAL':
      return 'ordinal';
    case 'CARDTEXT':
      return 'cardinalText';
    case 'ORDTEXT':
      return 'ordinalText';
    case 'HEX':
      return 'hex';
    default:
      return null;
  }
}

/**
 * Recognize `AUTONUM | AUTONUMLGL | AUTONUMOUT [\* <format>] [\e] [\* MERGEFORMAT]`, or null
 * for anything else. Any unrecognized switch fails the parse so the field stays inert (paints
 * nothing — its historical rendering), never the raw instruction, never a guessed number.
 */
export function parseAutonumInstruction(raw: string): AutonumFieldSpec | null {
  // The shared normalizer bounds the length, collapses whitespace, uppercases, and strips a
  // trailing `\* MERGEFORMAT`. Case never matters here: the format variant is re-read from
  // the raw token below.
  const normalized = normalizeFieldInstruction(raw);
  if (normalized === null) return null;
  const tokens = raw.replace(/\s+/g, ' ').trim().split(' ');
  const keyword = tokens[0]?.toUpperCase();
  if (keyword !== 'AUTONUM' && keyword !== 'AUTONUMLGL' && keyword !== 'AUTONUMOUT') return null;
  let numFmt: string | null = null;
  let suppressPeriod = false;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const upper = token.toUpperCase();
    if (upper === '\\E') {
      suppressPeriod = true;
      continue;
    }
    if (upper === '\\*') {
      const argument = tokens[index + 1];
      if (argument === undefined) return null;
      index += 1;
      if (argument.toUpperCase() === 'MERGEFORMAT') continue;
      numFmt = numFmtOfFormatSwitch(argument);
      if (numFmt === null) return null;
      continue;
    }
    return null;
  }
  return { kind: keyword, numFmt, suppressPeriod };
}

/**
 * The text one AUTONUM-family field displays for its sequential `value`.
 *
 * Word paints the number with a trailing period (`1.`, `A.`) unless `\e` drops it. The value
 * comes from the story scan's own counter, never from the file, so no clamp is needed beyond
 * what the shared resolver applies.
 */
export function autonumDisplayText(spec: AutonumFieldSpec, value: number): string {
  const text = formatNumFmt(spec.numFmt ?? 'decimal', value);
  if (text.length === 0) return '';
  return spec.suppressPeriod ? text : `${text}.`;
}
