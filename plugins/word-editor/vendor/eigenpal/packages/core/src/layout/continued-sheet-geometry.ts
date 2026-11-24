// A section that starts with `w:type="continuous"` (ECMA-376 Part 1, 17.6.22) continues on the
// sheet of the section before it. That sheet keeps the earlier section's bottom margin (17.6.11):
// body text stops above it, and a page- or margin-positioned table (17.4.57) that reaches below
// it breaks there, not at the continued section's own margin.

import type { PageContentInsets } from './page-furniture-insets.ts';

interface SheetGeometry {
  readonly width: number;
  readonly height: number;
  readonly margin: { readonly left: number; readonly right: number; readonly bottom: number };
}

/**
 * `geometry` with the bottom margin of the host sheet, whose content insets are `continued`,
 * when the sheet being filled is a continued section's first one; `geometry` otherwise.
 */
export function hostSheetGeometry<T extends SheetGeometry>(
  geometry: T,
  continued: PageContentInsets | undefined
): T {
  if (!continued || continued.bottom === geometry.margin.bottom) return geometry;
  return { ...geometry, margin: { ...geometry.margin, bottom: continued.bottom } };
}
