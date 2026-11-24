// Text that the inline character elements stand for: `w:noBreakHyphen`, `w:softHyphen`
// and `w:sym`.
//
// Each element is one character of paragraph text: U+001E for a non-breaking hyphen, U+001F
// for an optional hyphen, and "(" for a symbol, the characters a text read of the paragraph
// returns. Text a person sees uses U+2011 and U+00AD for the hyphens; a symbol paints its glyph.

import { WML_NAMESPACE_URI, type OoxmlNode } from './ooxml-tree.ts';

/** Paragraph-text character for `w:noBreakHyphen`. */
export const NON_BREAKING_HYPHEN_TEXT = '\u001e';
/** Paragraph-text character for `w:softHyphen`. */
export const OPTIONAL_HYPHEN_TEXT = '\u001f';

/**
 * Paragraph-text character for `w:sym`. A text read returns it for every symbol, whatever
 * glyph the symbol paints, and search never matches it (`text-projection.ts`).
 */
export const SYMBOL_TEXT = '(';

/** Whether a node is a `w:sym` symbol. */
export function isSymbolElement(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' && node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'sym'
  );
}

/**
 * The paragraph-text character of an inline character element (a hyphen or a symbol), or
 * null for any other node. Every walk that measures model text counts these as one character.
 */
export function inlineCharacterTextOf(node: OoxmlNode): string | null {
  return hyphenTextOf(node) ?? (isSymbolElement(node) ? SYMBOL_TEXT : null);
}

/** The paragraph-text character of a hyphen element, or null for any other node. */
export function hyphenTextOf(node: OoxmlNode): string | null {
  if (node.kind === 'textValue' || node.namespaceUri !== WML_NAMESPACE_URI) return null;
  if (node.localName === 'noBreakHyphen') return NON_BREAKING_HYPHEN_TEXT;
  if (node.localName === 'softHyphen') return OPTIONAL_HYPHEN_TEXT;
  return null;
}

/** The character a person sees for a hyphen element, or null for any other node. */
export function hyphenDisplayText(node: OoxmlNode): string | null {
  const text = hyphenTextOf(node);
  return text === null ? null : text === NON_BREAKING_HYPHEN_TEXT ? '\u2011' : '\u00ad';
}

/**
 * The text a hyphen element contributes to text read as one string, such as a cached field
 * result or a card: U+2011 for a non-breaking hyphen, nothing for an optional one. Null for
 * any other node.
 */
export function visibleHyphenText(node: OoxmlNode): string | null {
  const text = hyphenTextOf(node);
  return text === null ? null : text === NON_BREAKING_HYPHEN_TEXT ? '\u2011' : '';
}

/**
 * Paragraph text with each hyphen as the character a person sees, one for one, so offsets
 * into the model text still apply: U+2011 and U+00AD.
 */
export function withHyphenGlyphs(text: string): string {
  if (!text.includes(NON_BREAKING_HYPHEN_TEXT) && !text.includes(OPTIONAL_HYPHEN_TEXT)) return text;
  return text
    .replaceAll(NON_BREAKING_HYPHEN_TEXT, '\u2011')
    .replaceAll(OPTIONAL_HYPHEN_TEXT, '\u00ad');
}

/**
 * The inverse of {@link withHyphenGlyphs}: U+2011 and U+00AD back to the model characters, so
 * text shown with visible hyphens writes the hyphen elements it was read from.
 */
export function fromHyphenGlyphs(text: string): string {
  if (!text.includes('\u2011') && !text.includes('\u00ad')) return text;
  return text
    .replaceAll('\u2011', NON_BREAKING_HYPHEN_TEXT)
    .replaceAll('\u00ad', OPTIONAL_HYPHEN_TEXT);
}

/** Paragraph text as a person reads it: U+2011 for a non-breaking hyphen, no optional hyphen. */
export function withDisplayedHyphens(text: string): string {
  if (!text.includes(NON_BREAKING_HYPHEN_TEXT) && !text.includes(OPTIONAL_HYPHEN_TEXT)) return text;
  return text.replaceAll(NON_BREAKING_HYPHEN_TEXT, '\u2011').replaceAll(OPTIONAL_HYPHEN_TEXT, '');
}
