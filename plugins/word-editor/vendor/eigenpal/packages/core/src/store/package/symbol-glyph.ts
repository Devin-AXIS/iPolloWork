// `w:sym` (§17.3.3.30) glyph resolution.
//
// A symbol is one model character that reads as "(" (`hyphen-text.ts`); the glyph is what it
// shows. Word stores a symbol font's byte as 0xF000 + byte (the same encoding
// `symbol-encoding.ts` handles for list bullets); it also accepts the bare byte. Both
// attributes are attacker-controlled, so parsing fails closed to "no glyph": strict bounded
// hex, no surrogates, no noncharacters, capped family length.

import { WML_NAMESPACE_URI, type OoxmlNode } from './ooxml-tree.ts';
import { isSymbolEncodedFamily, mapSymbolPuaText } from './symbol-encoding.ts';

/** PUA page Word adds to a symbol font's byte value (mirrors `symbol-encoding.ts`). */
export const SYMBOL_PUA_BASE = 0xf000;
export const SYMBOL_PUA_END = 0xf0ff;

/** `resolveRunStyle` ignores longer family names; match its cap so the override can land. */
export const MAX_SYMBOL_FONT_LENGTH = 128;

/** One resolved `w:sym` glyph. */
export interface SymbolGlyph {
  /** Exactly one code point. */
  readonly text: string;
  /** `@w:font` when present and sane; null keeps the run's own font. */
  readonly font: string | null;
  /**
   * True when {@link text} is a real Unicode character rather than a symbol-font PUA
   * codepoint — the only kind a plain collected string (which cannot carry a font switch)
   * may absorb.
   */
  readonly unicode: boolean;
}

/** Typed check for a generic `w:sym` run child. */
export function isSymbolRunChild(node: OoxmlNode): boolean {
  return (
    node.kind === 'generic' && node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'sym'
  );
}

function wmlAttribute(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  for (const entry of node.attributes) {
    if (entry.localName !== localName) continue;
    // Unprefixed attributes on WML elements are common in authored packages.
    if (entry.namespaceUri === WML_NAMESPACE_URI || entry.namespaceUri === '') return entry.value;
  }
  return undefined;
}

/** ST_ShortHexNumber, parsed strictly: 1–4 hex digits, anything else is no glyph. */
function parseSymbolChar(value: string | undefined): number | null {
  if (!value || value.length > 4 || !/^[0-9A-Fa-f]{1,4}$/.test(value)) return null;
  return Number.parseInt(value, 16);
}

/**
 * A codepoint no glyph should ever be: controls, lone surrogates, noncharacters — and
 * U+FFFC, because paragraph flow uses the object replacement character as its inline-object
 * sentinel, so a file-supplied one would be swallowed as a phantom drawing.
 *
 * Shared by `w:sym` resolution and SYMBOL field rendering (`field-symbol.ts`); both feed it
 * attacker-controlled numbers, so it answers for the full Unicode range, not just the BMP.
 */
export function isRenderableCodePoint(code: number): boolean {
  if (!Number.isInteger(code) || code < 0x20 || code > 0x10ffff) return false;
  if (code >= 0x7f && code <= 0x9f) return false;
  if (code >= 0xd800 && code <= 0xdfff) return false;
  if (code >= 0xfdd0 && code <= 0xfdef) return false;
  if ((code & 0xfffe) === 0xfffe) return false;
  if (code === 0xfffc) return false;
  return true;
}

/**
 * Resolve a `w:sym` node to the single glyph it should paint, or null for no glyph.
 *
 * Symbol-encoded fonts (Symbol, Wingdings, …) resolve through `mapSymbolPuaText` so a
 * Word-authored checkbox or bullet gets its real Unicode equivalent; an unmapped code keeps
 * the PUA character with the symbol font, which the shaper may still resolve. A bare byte
 * (`@w:char="46"`) on a symbol font is normalized to the 0xF000 page first, because Word
 * accepts both encodings.
 *
 * DELIBERATE DIVERGENCE from list markers: `mapSymbolPuaText` takes an `isFontAvailable`
 * oracle so an INSTALLED symbol font keeps its authentic PUA glyph, and `list-resolve.ts`
 * accepts one — but no oracle is passed here (nor by `field-symbol.ts`). The parameter is a
 * public affordance of `withResolvedListItems` that no engine call site supplies today:
 * `SemanticLayoutOptions` does not carry it, so wiring it into `piecesOfParagraph` means a
 * new public layout option threaded through paragraph flow AND folded into the fragment
 * signature / layout cache keys (a font finishing to load must invalidate painted glyphs).
 * Until a host actually supplies the oracle, both symbol paths always map to the Unicode
 * equivalent, which every font can draw. Revisit when the list path gains a real producer.
 */
export function symbolGlyphOf(node: OoxmlNode): SymbolGlyph | null {
  if (!isSymbolRunChild(node)) return null;
  const code = parseSymbolChar(wmlAttribute(node, 'char'));
  if (code === null) return null;
  const rawFont = wmlAttribute(node, 'font');
  const font = rawFont && rawFont.length <= MAX_SYMBOL_FONT_LENGTH ? rawFont : null;

  const symbolEncoded = isSymbolEncodedFamily(font);
  const effective =
    symbolEncoded && code <= 0xff && code + SYMBOL_PUA_BASE <= SYMBOL_PUA_END
      ? code + SYMBOL_PUA_BASE
      : code;
  if (symbolEncoded && effective >= SYMBOL_PUA_BASE && effective <= SYMBOL_PUA_END) {
    const mapped = mapSymbolPuaText(String.fromCodePoint(effective), font);
    const unicode = mapped.codePointAt(0)! < SYMBOL_PUA_BASE;
    return { text: mapped, font, unicode };
  }
  if (!isRenderableCodePoint(code)) return null;
  return { text: String.fromCodePoint(code), font, unicode: code < 0xe000 || code > 0xf8ff };
}

/**
 * The text a symbol shows where a reader sees plain text, such as a review card or a search
 * result: its glyph when that is a real Unicode character, else nothing. A private-use glyph
 * means something only in its own face, which plain text cannot carry.
 */
export function symbolDisplayText(node: OoxmlNode): string {
  const glyph = symbolGlyphOf(node);
  return glyph?.unicode ? glyph.text : '';
}
