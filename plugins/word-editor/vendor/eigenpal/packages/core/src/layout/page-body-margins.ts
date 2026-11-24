// Signed vertical page margins (ECMA-376 §17.6.11 `w:pgMar`).
//
// `w:top` and `w:bottom` are `ST_SignedTwipsMeasure`; the other five margins are unsigned. A
// NON-negative top is a minimum: the body starts at the greater of that margin and the bottom
// of the header. A NEGATIVE top is exact: the body starts its absolute value below the sheet
// edge whatever the header's height, so a tall header overlaps the body instead of pushing it
// down. `w:top="-720" w:header="1440"` starts the text 36pt down and the header 72pt down. The
// bottom margin mirrors this against the footer.
//
// `PageGeometry.margin.top`/`.bottom` keep the authored sign, so every cache key built from the
// geometry tells a fixed margin from a minimum of the same size. Anything that places content
// against a margin reads the absolute value through here, never the signed field directly.

import type { PageGeometry } from './semantic-records.ts';

/** Distance from the sheet edge to the text extents for one signed vertical margin. */
export function marginInset(signed: number): number {
  return Math.abs(signed);
}

/** Whether a signed vertical margin is exact, so header or footer height never moves it. */
export function marginIgnoresFurniture(signed: number): boolean {
  return signed < 0;
}

/** The top and bottom text-extent insets of `geometry`, both non-negative. */
export function verticalMarginInsets(geometry: PageGeometry): {
  readonly top: number;
  readonly bottom: number;
} {
  return { top: marginInset(geometry.margin.top), bottom: marginInset(geometry.margin.bottom) };
}
