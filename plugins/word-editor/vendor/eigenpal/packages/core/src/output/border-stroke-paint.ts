// `ST_Border` → painted CSS, shared by every border a document draws.
//
// One mapping, two callers today: the paragraph rules of `w:pBdr` and the page frame of
// `w:pgBorders`. They are the same complex type in the schema (`CT_Border`) and the same ink on
// the page, so a second copy of this switch would be a second place for `dotDotDash` to quietly
// become a solid line on one surface only.
//
// THICKNESS IS NOT DECIDED HERE. Layout publishes the stroke box, already inflated for the
// compound styles (`border-metrics.ts`), and these functions only choose how to fill it.

import { compoundBorderStrokesForExtentPt } from '../layout/border-metrics.ts';
import { borderDashPatternPt, borderLineStrokesForExtentPt } from '../layout/border-line-styles.ts';
import {
  applyDashBackground,
  applyHatchBackground,
  applyParallelBands,
} from './border-pattern-css.ts';

/** Compound `ST_Border` values that layout already inflated — do not hairline-snap. */
export function isCompoundParagraphBorder(val: string): boolean {
  return (
    val === 'double' ||
    val === 'triple' ||
    val === 'doubleWave' ||
    val.startsWith('thinThick') ||
    val.startsWith('thickThin')
  );
}

/**
 * Map authored `ST_Border` onto the painted rule.
 *
 * CSS gives `double` / `dashed` / `dotted` / `groove` / `ridge` / `inset` / `outset` almost
 * for free. Decorative art borders (apples, bats, …) stay solid — a deliberate approximation.
 */
export function applyParagraphBorderStyle(
  rule: HTMLElement,
  val: string,
  color: string,
  vertical: boolean,
  thicknessPx: number,
  scale: number
): void {
  switch (val) {
    case 'dotted':
    case 'dashed':
    case 'dashSmallGap':
    case 'dotDash':
    case 'dotDotDash': {
      // The measured dash lengths of each style, in multiples of the band. The gaps are the
      // gradient's transparent stops. Both callers fill the rule with the ink colour first, so
      // that fill must go, or every gap shows the same colour and the rule reads solid.
      const dashes = scale > 0 ? borderDashPatternPt(val, thicknessPx / scale) : null;
      if (dashes) applyDashBackground(rule, color, dashes, vertical, scale);
      return;
    }
    case 'dashDotStroked':
      applyHatchBackground(rule, color, scale);
      return;
    case 'triple': {
      // Three equal strokes with equal gaps fill the five-stroke band layout published.
      const line = thicknessPx / 5;
      const ink = `#${color}`;
      const band = (from: number, to: number, fill: string) =>
        `${fill} ${from * line}px, ${fill} ${to * line}px`;
      const stops = [
        band(0, 1, ink),
        band(1, 2, 'transparent'),
        band(2, 3, ink),
        band(3, 4, 'transparent'),
        band(4, 5, ink),
      ];
      rule.style.backgroundColor = 'transparent';
      rule.style.backgroundImage = `linear-gradient(to ${vertical ? 'right' : 'bottom'}, ${stops.join(', ')})`;
      return;
    }
    case 'double':
    case 'doubleWave':
    case 'thinThickSmallGap':
    case 'thickThinSmallGap':
    case 'thinThickThinSmallGap':
    case 'thinThickMediumGap':
    case 'thickThinMediumGap':
    case 'thinThickThinMediumGap':
    case 'thinThickLargeGap':
    case 'thickThinLargeGap':
    case 'thinThickThinLargeGap': {
      // Fill the published band without CSS border-width snapping. A subpixel
      // stroke must not grow to a whole CSS pixel at small zoom levels.
      rule.style.backgroundColor = 'transparent';
      const strokes = scale > 0 ? compoundBorderStrokesForExtentPt(val, thicknessPx / scale) : null;
      if (strokes) {
        const stops = strokes.flatMap((stroke) => {
          const from = stroke.offsetPt * scale;
          const to = from + stroke.widthPt * scale;
          return [
            `transparent ${from}px`,
            `#${color} ${from}px`,
            `#${color} ${to}px`,
            `transparent ${to}px`,
          ];
        });
        rule.style.backgroundImage = `linear-gradient(to ${vertical ? 'right' : 'bottom'}, ${stops.join(', ')})`;
        return;
      }
      const line = thicknessPx / 3;
      rule.style.backgroundImage = `linear-gradient(to ${vertical ? 'right' : 'bottom'}, #${color} 0px, #${color} ${line}px, transparent ${line}px, transparent ${line * 2}px, #${color} ${line * 2}px)`;
      return;
    }
    case 'threeDEmboss':
    case 'threeDEngrave': {
      // Three toned strokes across the band layout published, as in the PDF.
      const strokes =
        scale > 0 ? borderLineStrokesForExtentPt(val, thicknessPx / scale, color) : null;
      if (strokes)
        applyParallelBands(
          rule,
          strokes.map((stroke) => ({ ...stroke, color: stroke.color ?? color })),
          vertical,
          scale
        );
      return;
    }
    case 'ridge': {
      rule.style.backgroundColor = 'transparent';
      const side = vertical ? 'borderLeft' : 'borderTop';
      rule.style[side] = `${Math.max(1, thicknessPx)}px ridge #${color}`;
      if (vertical) rule.style.width = '0px';
      else rule.style.height = '0px';
      return;
    }
    case 'groove': {
      rule.style.backgroundColor = 'transparent';
      const side = vertical ? 'borderLeft' : 'borderTop';
      rule.style[side] = `${Math.max(1, thicknessPx)}px groove #${color}`;
      if (vertical) rule.style.width = '0px';
      else rule.style.height = '0px';
      return;
    }
    case 'inset': {
      rule.style.backgroundColor = 'transparent';
      const side = vertical ? 'borderLeft' : 'borderTop';
      rule.style[side] = `${Math.max(1, thicknessPx)}px inset #${color}`;
      if (vertical) rule.style.width = '0px';
      else rule.style.height = '0px';
      return;
    }
    case 'outset': {
      rule.style.backgroundColor = 'transparent';
      const side = vertical ? 'borderLeft' : 'borderTop';
      rule.style[side] = `${Math.max(1, thicknessPx)}px outset #${color}`;
      if (vertical) rule.style.width = '0px';
      else rule.style.height = '0px';
      return;
    }
    case 'single':
    case 'thick':
    case 'wave':
    default:
      // Solid fill already set. Art borders and unrecognised vals stay solid.
      return;
  }
}
