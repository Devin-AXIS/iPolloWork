import type { ResolvedRunStyle } from './run-style.ts';
import { lineBandText } from './pending-line.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { styleForFontSlot, type FontSlot } from './script-itemization.ts';

/** A character that draws text: not a space, tab, break, or object placeholder. */
const TEXT_GLYPH = /[^ \t\n\r\f\v\uFFFC]/u;

/**
 * Grow a line that holds super- or subscript text to each script run's full-size metrics.
 *
 * A script run draws at its smaller glyph size, raised or lowered, but its line keeps the
 * run's full-size ascent above the baseline and full-size descent below it, as if the run sat
 * on the baseline at its own size. Superscript and subscript count the same, on every line of
 * the paragraph. A superscript or subscript mark (`markVerticalAlign`) keeps the smaller glyph
 * size. Returns how far the baseline moved down, so the caller can move the glyph band with it.
 *
 * A paragraph mark never grows a line that holds content, whether its size is direct or comes
 * from its character style; only a line with nothing on it takes the mark's height, and the
 * caller sizes that line from the mark. The paragraph's run cascade is no floor either: 8pt
 * text with an 8pt superscript keeps the 8pt line under a 12pt cascade.
 */
export function growScriptLineMetrics(
  line: {
    height: number;
    baseline: number;
    readonly spans: readonly (Pick<StyleSpanRecord, 'noteSeparator' | 'fieldAtom'> & {
      readonly text: string;
      readonly style: ResolvedRunStyle;
      readonly fontSlot?: FontSlot;
    })[];
  },
  markVerticalAlign: ResolvedRunStyle['verticalAlign'],
  measurer: Pick<TextMeasurer, 'lineMetrics'>
): number {
  let ascent = line.baseline;
  let descent = line.height - line.baseline;
  for (const span of line.spans) {
    if (span.style.verticalAlign === 'baseline' || !TEXT_GLYPH.test(span.text)) continue;
    const fullSize = { ...span.style, verticalAlign: markVerticalAlign };
    const metrics = measurer.lineMetrics(
      styleForFontSlot(fullSize, span.fontSlot),
      lineBandText(span, span.text)
    );
    ascent = Math.max(ascent, metrics.baseline);
    descent = Math.max(descent, metrics.height - metrics.baseline);
  }
  const raised = ascent - line.baseline;
  line.baseline = ascent;
  line.height = ascent + descent;
  return raised;
}
