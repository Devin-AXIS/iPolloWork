// The cascade a lowered DrawingML text story lays out under.
//
// Shape text in a diagram has no paragraph styles and no document defaults: every property
// it uses is stated on the lowered paragraphs and runs. It keeps the document's theme fonts
// (its runs name theme font slots) and typography settings, and turns on the DrawingML line
// rule. The cache token is distinct, so its line breaks never share a key with body text.

import { buildStyleCascadeTable, type StyleCascadeTable } from './style-cascade.ts';

/**
 * A cascade flagged for DrawingML text: proportional lines keep their descent at the bottom
 * of the box (`cascadeLineSpacingFlags` reads the flag).
 */
export type DrawingTextCascade = StyleCascadeTable & { readonly drawingTextLines: true };

const derived = new WeakMap<StyleCascadeTable, DrawingTextCascade>();
let standalone: StyleCascadeTable | undefined;

/** The DrawingML story cascade derived from the host story's cascade. */
export function drawingTextCascade(base: StyleCascadeTable | undefined): DrawingTextCascade {
  const source = base ?? (standalone ??= buildStyleCascadeTable(null));
  const cached = derived.get(source);
  if (cached) return cached;
  const cascade: DrawingTextCascade = Object.freeze({
    cacheToken: `${source.cacheToken}|drawing-text`,
    ...(source.disableOptionalLigatures ? { disableOptionalLigatures: true as const } : {}),
    ...(source.typography ? { typography: source.typography } : {}),
    drawingTextLines: true as const,
    docDefaultsRun: [],
    docDefaultsParagraph: [],
    docDefaultsParagraphNode: undefined,
    defaultParagraphStyleId: null,
    defaultCharacterStyleId: null,
    defaultTableStyleId: null,
    themeFonts: source.themeFonts,
    styles: new Map(),
  });
  derived.set(source, cascade);
  return cascade;
}
