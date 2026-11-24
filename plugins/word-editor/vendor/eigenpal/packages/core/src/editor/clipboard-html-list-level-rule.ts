// The level text, marker format, and level geometry that an `@list lN:levelM` rule states,
// for the external-HTML projection's numbering part.
//
// A rule body looks like this:
//
//   mso-level-text:"%1\)"; margin-left:54.0pt; text-indent:-27.0pt; color:red;
//   mso-ansi-font-weight:bold; font-family:Wingdings; mso-level-tab-stop:72.0pt
//
// Every value is attacker-controlled. The scan is linear and bounded by the caller's rule
// length cap, numbers are clamped, the level text is length-capped and XML-safe, and the run
// properties pass through the same allowlisted CSS reader as pasted text.

import { rPrXml } from './clipboard-html-run-xml.ts';
import { applyRunCss, parseCssLengthPt } from './clipboard-html-styles.ts';
import { xmlSafeText } from './clipboard-html-xml.ts';

/** What one `@list` level rule says beyond its number format, start, and position. */
export interface ListLevelRuleFormat {
  /** `mso-level-text`, unescaped: `%1)` for a number, the glyph for a bullet. */
  readonly text?: string;
  /** The marker run properties as a ready `w:rPr`, or absent when the rule states none. */
  readonly runXml?: string;
  /** `margin-left`, in twips. */
  readonly leftTwips?: number;
  /** `text-indent`, in twips: negative hangs, zero or positive indents the first line. */
  readonly firstLineTwips?: number;
  /** `mso-level-tab-stop`, in twips; absent for `none`. */
  readonly tabTwips?: number;
}

/** Longest level text kept; a longer value is not a list marker. */
const MAX_LEVEL_TEXT = 64;
const MAX_TWIPS = 31_680;

/**
 * The declarations of one rule body, split on `;` outside quotes and escapes, as a name to raw
 * value map. Names are lower-cased; values keep their case, because a level text or a font
 * name is case-sensitive.
 */
export function wordListRuleDeclarations(body: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const take = (declaration: string): void => {
    const colon = declaration.indexOf(':');
    if (colon <= 0) return;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (name.length === 0 || name.length > 64) return;
    out.delete(name);
    out.set(name, value);
  };
  let start = 0;
  let quote: string | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === ';') {
      take(body.slice(start, index));
      start = index + 1;
    }
  }
  take(body.slice(start));
  return out;
}

/**
 * A CSS string or bare value, unquoted and unescaped. `\)` is `)`, and `\2013 ` is the code point
 * U+2013, as CSS defines escapes.
 */
function unescapeCssValue(raw: string): string {
  let value = raw.trim();
  const first = value[0];
  if ((first === '"' || first === "'") && value.length >= 2 && value.endsWith(first)) {
    value = value.slice(1, -1);
  }
  let out = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char !== '\\') {
      out += char;
      continue;
    }
    const hex = /^[0-9a-fA-F]{1,6}/.exec(value.slice(index + 1, index + 7));
    if (hex === null) {
      if (index + 1 < value.length) out += value[index + 1]!;
      index += 1;
      continue;
    }
    const codePoint = Number.parseInt(hex[0], 16);
    index += hex[0].length;
    if (/\s/.test(value[index + 1] ?? '')) index += 1;
    if (codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff)) {
      out += String.fromCodePoint(codePoint);
    }
  }
  return out;
}

const twipsOf = (value: string | undefined, low: number): number | undefined => {
  const pt = parseCssLengthPt(value ?? '');
  if (pt === null) return undefined;
  return Math.min(MAX_TWIPS, Math.max(low, Math.round(pt * 20)));
};

/**
 * The marker format a rule states. The clipboard writes the marker's weight, style, and size with
 * `mso-ansi-` names; they read as the ordinary CSS properties.
 */
function markerRunXml(declarations: ReadonlyMap<string, string>): string | undefined {
  const css = new Map<string, string>();
  const copy = (from: string, to = from): void => {
    const value = declarations.get(from);
    if (value !== undefined) css.set(to, value);
  };
  copy('font-family');
  copy('color');
  copy('font-weight');
  copy('mso-ansi-font-weight', 'font-weight');
  copy('font-style');
  copy('mso-ansi-font-style', 'font-style');
  copy('font-size');
  copy('mso-ansi-font-size', 'font-size');
  copy('text-decoration');
  copy('text-underline');
  if (css.size === 0) return undefined;
  const xml = rPrXml(applyRunCss({}, css));
  return xml.length > 0 ? xml : undefined;
}

/** The level text, marker format, and geometry of one rule's declarations. */
export function wordListLevelFormat(
  declarations: ReadonlyMap<string, string>
): ListLevelRuleFormat | undefined {
  const rawText = declarations.get('mso-level-text');
  const text = rawText === undefined ? undefined : xmlSafeText(unescapeCssValue(rawText));
  const runXml = markerRunXml(declarations);
  const leftTwips = twipsOf(declarations.get('margin-left'), -MAX_TWIPS);
  const firstLineTwips = twipsOf(declarations.get('text-indent'), -MAX_TWIPS);
  const tabTwips = twipsOf(declarations.get('mso-level-tab-stop'), 0);
  const format: ListLevelRuleFormat = {
    ...(text !== undefined && text.length <= MAX_LEVEL_TEXT ? { text } : {}),
    ...(runXml !== undefined ? { runXml } : {}),
    ...(leftTwips !== undefined ? { leftTwips } : {}),
    ...(firstLineTwips !== undefined ? { firstLineTwips } : {}),
    ...(tabTwips !== undefined ? { tabTwips } : {}),
  };
  return Object.keys(format).length > 0 ? format : undefined;
}
