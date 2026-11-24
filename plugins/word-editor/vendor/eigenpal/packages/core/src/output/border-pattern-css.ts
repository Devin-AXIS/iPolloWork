// CSS backgrounds for the patterned `ST_Border` line styles (ECMA-376 §17.18.2).
//
// Layout decides the band and the pattern lengths (`layout/border-line-styles.ts`); these
// helpers only turn them into gradients, so a rule reads the same on screen as in the PDF.

import { DASH_DOT_STROKED_HATCH } from '../layout/border-line-styles.ts';

/** Format one gradient stop position in CSS pixels. */
function px(value: number): string {
  return `${Number(value.toFixed(3))}px`;
}

/**
 * Fill `element` with the dash pattern `dashPt` (points, ink first) along its length.
 * The gaps stay transparent.
 */
export function applyDashBackground(
  element: HTMLElement,
  color: string,
  dashPt: readonly number[],
  vertical: boolean,
  scale: number
): void {
  const period = dashPt.reduce((sum, length) => sum + length, 0) * scale;
  if (!(period > 0)) return;
  const stops: string[] = [];
  let at = 0;
  dashPt.forEach((length, index) => {
    const end = at + length * scale;
    const fill = index % 2 === 0 ? `#${color}` : 'transparent';
    stops.push(`${fill} ${px(at)}`, `${fill} ${px(end)}`);
    at = end;
  });
  element.style.backgroundColor = 'transparent';
  element.style.backgroundImage = `linear-gradient(to ${vertical ? 'bottom' : 'right'}, ${stops.join(', ')})`;
  element.style.backgroundSize = vertical ? `100% ${px(period)}` : `${px(period)} 100%`;
  element.style.backgroundRepeat = 'repeat';
}

/** Fill `element` with the `dashDotStroked` hatch: hairlines rising at 45 degrees. */
export function applyHatchBackground(element: HTMLElement, color: string, scale: number): void {
  const { pitchPt, lineWidthPt, slots } = DASH_DOT_STROKED_HATCH;
  // Lines along x + y = c sit pitch / √2 apart across the 135° gradient axis.
  const step = (pitchPt / Math.SQRT2) * scale;
  const line = Math.max(lineWidthPt * scale, 0.5);
  const stops: string[] = [];
  slots.forEach((present, index) => {
    const from = index * step;
    if (present)
      stops.push(
        `#${color} ${px(from)}`,
        `#${color} ${px(from + line)}`,
        `transparent ${px(from + line)}`,
        `transparent ${px(from + step)}`
      );
    else stops.push(`transparent ${px(from)}`, `transparent ${px(from + step)}`);
  });
  element.style.backgroundColor = 'transparent';
  element.style.backgroundImage = `repeating-linear-gradient(135deg, ${stops.join(', ')})`;
}

/** Fill `element` with parallel bands across it, each `{offsetPt, widthPt, color}`. */
export function applyParallelBands(
  element: HTMLElement,
  bands: readonly { readonly offsetPt: number; readonly widthPt: number; readonly color: string }[],
  vertical: boolean,
  scale: number
): void {
  const stops = bands.flatMap((band) => {
    const from = band.offsetPt * scale;
    const to = from + band.widthPt * scale;
    return [
      `transparent ${px(from)}`,
      `#${band.color} ${px(from)}`,
      `#${band.color} ${px(to)}`,
      `transparent ${px(to)}`,
    ];
  });
  element.style.backgroundColor = 'transparent';
  element.style.backgroundImage = `linear-gradient(to ${vertical ? 'right' : 'bottom'}, ${stops.join(', ')})`;
}
