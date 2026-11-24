// Which legacy symbol faces a measurer really has, for list-marker glyph resolution.
//
// `mapSymbolPuaText` rewrites a Word bullet's private-use codepoint (U+F0B7 in Symbol) to
// its Unicode twin because no ordinary face can draw it. The rewrite is a FALLBACK: when the
// authored face is genuinely present, the file's own codepoint must survive so the intended
// typeface draws it — and, just as importantly, so the line box is sized by that face. A
// 12 pt Symbol ascends 12.06 pt where a 12 pt text face ascends 11.52, and Word's line grows
// by the difference.
//
// The oracle is derived from the measurer rather than passed in by every host, because the
// measurer is the one thing that already knows which faces were admitted AND is already
// folded into every layout cache key through `SemanticLayoutOptions.producer`. A measurer
// with no `hasResolvedFont` (the canvas path, a fixed-metric test double) answers "nothing
// is available", which is the pre-font-resolution behaviour: translate and keep going.
//
// SCOPE: this answers "was a face admitted under this family name", not "does that face
// carry this codepoint". A host that admits a Unicode-cmap face under the name `Symbol`
// asserts it can draw Symbol's own glyphs. Even then nothing breaks apart: `lineMetrics`
// shapes the real marker text, so measurement and paint fall to the same substitute face
// together and the line stays self-consistent.

import { SYMBOL_ENCODED_FAMILIES } from './symbol-encoding.ts';
import { resolveRunStyle, type ResolvedRunStyle } from './run-style.ts';
import type { TextMeasurer } from './semantic-records.ts';

/** One probe style per symbol family; the closed family list bounds this at five. */
const probeStyles = new Map<string, ResolvedRunStyle>();

function probeStyle(family: string): ResolvedRunStyle {
  let style = probeStyles.get(family);
  if (!style) {
    style = resolveRunStyle([
      { localName: 'rFonts', attributes: { ascii: family, hAnsi: family, hint: 'default' } },
    ]);
    probeStyles.set(family, style);
  }
  return style;
}

/**
 * Oracles interned by the SET of available families, so two measurers with the same symbol
 * coverage share one function identity — `withResolvedListItems` memoizes on that identity,
 * and a font epoch that changed no symbol face must not invalidate the resolved list.
 * Bounded by the subsets of a five-name list.
 */
const oraclesByCoverage = new Map<string, (family: string) => boolean>();

/** Null means "no symbol face at all", which is indistinguishable from having no oracle. */
const oraclesByMeasurer = new WeakMap<TextMeasurer, ((family: string) => boolean) | null>();

/**
 * The `isFontAvailable` oracle for one measurer, or undefined when it has no symbol face.
 *
 * Undefined rather than a function that always answers false: an undefined oracle is the
 * value every caller that never resolved fonts already passes, so the common document —
 * one with no symbol face admitted — keeps sharing its resolved-list memo entry with the
 * save-path callers that have no measurer to offer.
 */
export function markerSymbolFontAvailability(
  measurer: TextMeasurer | undefined
): ((family: string) => boolean) | undefined {
  const hasResolvedFont = measurer?.hasResolvedFont;
  if (!measurer || !hasResolvedFont) return undefined;
  const remembered = oraclesByMeasurer.get(measurer);
  if (remembered !== undefined) return remembered ?? undefined;
  const available: string[] = [];
  for (const family of SYMBOL_ENCODED_FAMILIES) {
    let resolved = false;
    try {
      resolved = hasResolvedFont.call(measurer, probeStyle(family)) === true;
    } catch {
      // A measurer that refuses a probe is treated as not having the face.
      resolved = false;
    }
    if (resolved) available.push(family);
  }
  if (available.length === 0) {
    oraclesByMeasurer.set(measurer, null);
    return undefined;
  }
  const coverage = available.join('|');
  let oracle = oraclesByCoverage.get(coverage);
  if (!oracle) {
    const folded = new Set(available);
    oracle = (family: string): boolean => folded.has(family.toLowerCase());
    oraclesByCoverage.set(coverage, oracle);
  }
  oraclesByMeasurer.set(measurer, oracle);
  return oracle;
}
