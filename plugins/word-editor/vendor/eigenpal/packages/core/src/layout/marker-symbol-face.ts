// The face a symbol bullet keeps under right-to-left formatting.
//
// A list level that names a symbol face only in `w:ascii`/`w:hAnsi` writes its bullet as a
// font byte + 0xF000. When the paragraph mark carries `w:rtl`, the marker style takes its
// complex-script face, which has no glyph at that code point. The bullet still draws from
// the level's symbol face: measured in a right-to-left table whose Wingdings bullets drew on
// every item, with and without `w:rtl` on the mark.

import { isSymbolEncodedFamily } from './symbol-encoding.ts';
import type { ResolvedRunStyle } from './run-style.ts';

const SYMBOL_PUA_BASE = 0xf000;
const SYMBOL_PUA_END = 0xf0ff;

function hasSymbolByte(text: string): boolean {
  for (const glyph of text) {
    const code = glyph.codePointAt(0)!;
    if (code >= SYMBOL_PUA_BASE && code <= SYMBOL_PUA_END) return true;
  }
  return false;
}

/**
 * The marker style a bullet draws with: the Latin-lane symbol face when a complex-script
 * style would otherwise draw a symbol byte the complex face cannot show.
 */
export function bulletMarkerStyle(style: ResolvedRunStyle, markerText: string): ResolvedRunStyle {
  const latin = style.latinLane;
  if (!latin || !isSymbolEncodedFamily(latin.fontFamily) || isSymbolEncodedFamily(style.fontFamily))
    return style;
  if (!hasSymbolByte(markerText)) return style;
  return { ...style, fontFamily: latin.fontFamily, fontFamilyEastAsia: latin.fontFamilyEastAsia };
}
