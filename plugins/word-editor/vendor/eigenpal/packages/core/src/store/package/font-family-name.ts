// A run font reference is one bounded name, never a CSS fallback list.
const FONT_FAMILY_NAME = /^[\p{L}\p{N}\p{M} \-.+_,;]{1,64}$/u;

/**
 * The face a run paints in when its authored name cannot name any face: a name with a quote,
 * backslash or control character, or one past the length bound.
 */
export const UNMATCHED_FONT_FAMILY = 'Cambria';

/** Preserve the complete name while rejecting CSS-breaking characters. */
export function fontFamilyName(raw: string | undefined): string | null {
  return raw !== undefined && raw.trim().length > 0 && FONT_FAMILY_NAME.test(raw) ? raw : null;
}

/**
 * The family a run paints in for an authored `w:rFonts` name.
 *
 * A name written as a list, such as `Verdana, Geneva, sans-serif`, paints in its first item.
 * A first item that no face can carry, such as the quoted `"Open Sans"`, paints in
 * {@link UNMATCHED_FONT_FAMILY} instead of disappearing. The tree keeps the authored name.
 *
 * The result can hold a vertical-writing `@` name; a reader that hands names to a font
 * resolver or a CSS sink passes it through {@link fontFamilyName} as well.
 */
export function paintedFontFamilyName(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim().length === 0) return null;
  // Past the bound the name is never parsed: it cannot name a face either.
  if (raw.length > 1024) return UNMATCHED_FONT_FAMILY;
  const first = firstFontFamilyItem(raw);
  if (first.length === 0) return null;
  if (FONT_FAMILY_NAME.test(first)) return first;
  // A vertical-writing name (`@MS Gothic`, or the full-width `＠`) is not a stray name. Layout
  // reads it as written, and the measuring and painting sinks give it their own fallback.
  if (first.startsWith('@') || first.startsWith('＠')) return first.length <= 128 ? first : null;
  return UNMATCHED_FONT_FAMILY;
}

/**
 * The family a font table entry describes: the first item of a listed name, as runs paint it,
 * or null when that item names no face. Unlike {@link paintedFontFamilyName}, a stray name
 * never stands for {@link UNMATCHED_FONT_FAMILY}, so a hostile entry cannot describe it.
 */
export function listedFontFamilyName(raw: string | undefined): string | null {
  if (raw === undefined || raw.length > 1024) return null;
  return fontFamilyName(firstFontFamilyItem(raw));
}

function firstFontFamilyItem(raw: string): string {
  const comma = raw.indexOf(',');
  return (comma < 0 ? raw : raw.slice(0, comma)).trim();
}
