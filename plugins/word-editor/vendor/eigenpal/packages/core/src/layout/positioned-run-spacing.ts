// Auto multiple line spacing on a line that holds raised or lowered (`w:position`) text.

import { applyLineSpacing, type ParagraphLineSpacing } from './paragraph-style.ts';
import { isHeightlessWhitespace, lineBandText } from './pending-line.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import { styleForFontSlot, type FontSlot } from './script-itemization.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/**
 * Apply an auto multiple to a line whose text is moved by `w:position`.
 *
 * The multiple scales the line's text band as it would stand without the authored offsets,
 * and the offsets add their height unscaled: 12pt text with a 14pt run raised 4.5pt at 1.5
 * spacing grows by half of the 14pt line, not by half of the raised line. Lines without
 * positioned text, grid lines, other rules and multiples up to single keep `spaced` as is.
 */
export function withPositionedRunSpacing(
  spaced: { readonly height: number; readonly baseline: number; readonly trailing?: number },
  spacing: ParagraphLineSpacing,
  naturalHeight: number,
  spans: readonly (Pick<StyleSpanRecord, 'noteSeparator' | 'fieldAtom'> & {
    readonly text: string;
    readonly style: ResolvedRunStyle;
    readonly fontSlot?: FontSlot;
  })[],
  measurer: Pick<TextMeasurer, 'lineMetrics'>
): { readonly height: number; readonly baseline: number; readonly trailing?: number } {
  if (spacing.rule !== 'auto' || spacing.gridPitch !== undefined || spacing.value <= 240) {
    return spaced;
  }
  const visible = spans.filter((span) => span.text && !isHeightlessWhitespace(span.text));
  if (!visible.some((span) => span.style.baselineShiftPt)) return spaced;
  let ascent = 0;
  let descent = 0;
  for (const span of visible) {
    const unshifted = { ...span.style, baselineShiftPt: 0 };
    const metrics = measurer.lineMetrics(
      styleForFontSlot(unshifted, span.fontSlot),
      lineBandText(span, span.text)
    );
    ascent = Math.max(ascent, metrics.baseline);
    descent = Math.max(descent, metrics.height - metrics.baseline);
  }
  const band = Math.min(naturalHeight, ascent + descent);
  if (!(band > 0)) return spaced;
  return { ...spaced, height: naturalHeight + band * (spacing.value / 240 - 1) };
}

/** {@link applyLineSpacing} for a laid-out line, with {@link withPositionedRunSpacing} applied. */
export function spacedLine(
  spacing: ParagraphLineSpacing,
  naturalHeight: number,
  naturalBaseline: number,
  spans: Parameters<typeof withPositionedRunSpacing>[3],
  measurer: Pick<TextMeasurer, 'lineMetrics'>
): ReturnType<typeof applyLineSpacing> {
  const spaced = applyLineSpacing(spacing, naturalHeight, naturalBaseline);
  return withPositionedRunSpacing(spaced, spacing, naturalHeight, spans, measurer);
}
