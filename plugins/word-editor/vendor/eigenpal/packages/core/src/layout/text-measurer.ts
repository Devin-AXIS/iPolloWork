// The injected text measurer and the outline answer it can give. Kept beside the record
// vocabulary in `semantic-records.ts`, which re-exports both.
import type { ResolvedRunStyle } from './run-style.ts';

/**
 * A string's glyphs in points, x right and y down from the pen origin on the baseline, at the
 * style's size.
 *
 * `path` is SVG path data made only of absolute `M`, `L`, `Q`, `C` and `Z` commands, or null
 * when the measurer knows the ink box but not the outlines (a canvas measurer). `ink` bounds
 * every glyph's ink in the same space.
 */
export interface TextOutline {
  readonly path: string | null;
  readonly ink: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
}

/**
 * Text measurement, injected.
 *
 * A real implementation shapes with the resolved font; the tests supply a deterministic one.
 * Layout never reads the DOM, so this is the only way width and height enter it.
 */
export interface TextMeasurer {
  /** Advance width of `text` in the resolved style. */
  measure(text: string, style: ResolvedRunStyle): number;
  /**
   * Optional whole-span logical caret advances, indexed by UTF-16 offset. Values
   * are nondecreasing, start at zero, and end at the measured advance. Ligature
   * interiors may share an edge. Undefined selects a bounded approximate fallback.
   */
  caretAdvances?(text: string, style: ResolvedRunStyle): readonly number[] | undefined;
  /**
   * Optional conservative ink bounds for one grapheme, in points from its origin.
   * Includes size and horizontal scale, but not trailing character spacing.
   * Undefined keeps layout on the advance-only path.
   */
  inkBounds?(text: string, style: ResolvedRunStyle): { left: number; right: number } | undefined;
  /**
   * Optional glyph outlines of a whole string, for text drawn as a shape (VML text art).
   * Undefined when the face cannot answer; the shape then paints nothing rather than guess.
   */
  textOutline?(text: string, style: ResolvedRunStyle): TextOutline | undefined;
  /** Whether line metrics use an admitted face instead of approximate fallback metrics. */
  hasResolvedFont?(style: ResolvedRunStyle): boolean;
  /**
   * Optional: whether the resolved face itself has a glyph for every character of `text`, with
   * no glyph fallback. Undefined when no face resolves or the measurer cannot tell.
   * @internal
   */
  faceCovers?(text: string, style: ResolvedRunStyle): boolean | undefined;
  /**
   * Optional: whether `style` is bold and its resolved face is not, so the bold is synthesized
   * and each inked character advances `SYNTHETIC_BOLD_ADVANCE_EM` further, also where the face
   * cannot shape the text. Absent means no.
   * @internal
   */
  syntheticBold?(style: ResolvedRunStyle): boolean;
  /**
   * Optional `OS/2` strikeout stroke for the resolved face, at the drawn size. Word paints
   * `w:separator` as a strikeout, so the note rule reads its thickness and offset here rather
   * than assuming one face's numbers. Undefined keeps the caller's own default.
   */
  strikeoutMetrics?(
    style: ResolvedRunStyle
  ): import('./sfnt-strikeout-metrics.ts').StrikeoutStrokePt | undefined;
  /** Line metrics for the actual text faces; omitted text measures the primary face. */
  lineMetrics(style: ResolvedRunStyle, text?: string): { height: number; baseline: number };
}
