// Deterministic monospace measurer for tests and headless layout.

import { glyphSizeFactorOf, type ResolvedRunStyle } from './run-style.ts';
import type { TextMeasurer } from './semantic-records.ts';

/** Default advance used by the deterministic fallback, in points at 11pt. @public */
export const FIXED_MEASURER_CHAR_WIDTH = 6;

/** Default line height used by the deterministic fallback, in points at 11pt. @public */
export const FIXED_MEASURER_LINE_HEIGHT = 14;

/** Cache/diagnostic identity derived from the actual fallback defaults. @public */
export const FIXED_MEASURER_FINGERPRINT = `fixed:char-width=${FIXED_MEASURER_CHAR_WIDTH}:line-height=${FIXED_MEASURER_LINE_HEIGHT}`;

/**
 * A deterministic measurer for tests and headless use.
 *
 * Monospace by construction: every character is the same width and every line the same
 * height, scaled by `w:sz` when present. Real shaping is the HarfBuzz path; this exists so
 * layout behaviour can be asserted without a font stack deciding the answer.
 */
export function createFixedMeasurer(
  charWidth = FIXED_MEASURER_CHAR_WIDTH,
  lineHeight = FIXED_MEASURER_LINE_HEIGHT
): TextMeasurer {
  // 11pt is the size the base width and height describe; everything else scales from it.
  const scale = (style: ResolvedRunStyle): number => style.fontSizePt / 11;
  return {
    measure: (text, style) => {
      // Advance, then horizontal scaling, then character spacing — the order Word applies
      // them, and the order that makes `w:spacing` an absolute per-character addition
      // rather than something the scale multiplies.
      const advance = text.length * charWidth * scale(style) * glyphSizeFactorOf(style);
      const scaled = advance * (style.horizontalScalePercent / 100);
      return scaled + text.length * style.characterSpacingPt;
    },
    lineMetrics: (style) => {
      // Super/subscript draw smaller, so they need less line height than their nominal size.
      const shrink = glyphSizeFactorOf(style);
      const height = lineHeight * scale(style) * shrink;
      return { height, baseline: height * 0.8 };
    },
  };
}
