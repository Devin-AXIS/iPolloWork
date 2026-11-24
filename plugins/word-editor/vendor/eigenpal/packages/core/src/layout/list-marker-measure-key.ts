import type { ResolvedRunStyle } from './run-style.ts';

/** Fields of {@link ResolvedRunStyle} that change a marker's measured width. */
export function markerMeasureToken(style: ResolvedRunStyle): string {
  return [
    style.fontFamily ?? '',
    style.fontSizePt,
    style.bold ? 1 : 0,
    style.italic ? 1 : 0,
    style.characterSpacingPt,
    style.horizontalScalePercent,
    style.verticalAlign,
    style.hidden ? 1 : 0,
    style.kerningMinPt,
    style.ligatures?.standard ? 1 : 0,
    style.ligatures?.contextual ? 1 : 0,
    style.ligatures?.historical ? 1 : 0,
    style.ligatures?.discretionary ? 1 : 0,
    style.caps ? 1 : 0,
    style.smallCaps ? 1 : 0,
  ].join(',');
}
