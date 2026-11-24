// `w:sym` (§17.3.3.30) styles for layout.
//
// A symbol is one model character; layout paints its glyph (`store/package/symbol-glyph.ts`)
// over that one offset in the face the symbol names.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { resolveRunStyle, type ResolvedRunStyle, type ThemeFonts } from './run-style.ts';
import type { SymbolGlyph } from '../store/package/symbol-glyph.ts';

export {
  isRenderableCodePoint,
  isSymbolRunChild,
  MAX_SYMBOL_FONT_LENGTH,
  SYMBOL_PUA_BASE,
  SYMBOL_PUA_END,
  symbolDisplayText,
  symbolGlyphOf,
  type SymbolGlyph,
} from '../store/package/symbol-glyph.ts';

/**
 * The glyph's resolved style: the run's own properties with `rFonts` overridden to
 * `@w:font`. No font keeps the run font unchanged.
 */
/**
 * The run a symbol's own face overrides, keyed by the symbol's property list. A caret beside a
 * symbol reports the face it types in, which is the run's, not the symbol's.
 */
const symbolRuns = new WeakMap<readonly OoxmlProperty[], SymbolRun>();

interface SymbolRun {
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
}

/** The run a symbol glyph's properties override, or null for any other property list. */
export function symbolRunOf(props: readonly OoxmlProperty[]): SymbolRun | null {
  return symbolRuns.get(props) ?? null;
}

export function symbolRunStyle(
  runProps: readonly OoxmlProperty[],
  glyph: SymbolGlyph,
  themeFonts?: ThemeFonts
): { readonly props: readonly OoxmlProperty[]; readonly style: ResolvedRunStyle } {
  if (!glyph.font) return { props: runProps, style: resolveRunStyle(runProps, themeFonts) };
  // The glyph names its own font. Reset the hint and override the East Asian and complex
  // script slots too, because neighboring Han or a right-to-left run selects them on its own.
  const props: readonly OoxmlProperty[] = [
    ...runProps,
    {
      localName: 'rFonts',
      attributes: {
        ascii: glyph.font,
        hAnsi: glyph.font,
        eastAsia: glyph.font,
        cs: glyph.font,
        hint: 'default',
      },
    },
  ];
  symbolRuns.set(props, { props: runProps, style: resolveRunStyle(runProps, themeFonts) });
  return { props, style: resolveRunStyle(props, themeFonts) };
}

/**
 * The span a collapsed caret beside a symbol reports, or null when no symbol is beside it.
 * Just before a symbol the face box shows the symbol's own face; just after it, the run's
 * face, which is also the face text typed there takes.
 */
export function spanBesideSymbol<
  T extends { readonly props: readonly OoxmlProperty[]; readonly style: ResolvedRunStyle },
>(leftward: T | null, rightward: T | null): T | null {
  if (rightward && symbolRunOf(rightward.props)) return rightward;
  const run = leftward ? symbolRunOf(leftward.props) : null;
  return leftward && run ? { ...leftward, props: run.props, style: run.style } : null;
}

/** Property projection preserves the source run used by symbol caret readback. */
export function carrySymbolRun(
  source: readonly OoxmlProperty[],
  target: readonly OoxmlProperty[]
): void {
  const run = symbolRuns.get(source);
  if (run) symbolRuns.set(target, run);
}
