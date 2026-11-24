// The width an inline object asks of a line beside a wrapping float.
//
// In legacy compatibility modes an inline object that opens its line stays on that line beside
// a float even when it is wider than the gap there: it sits at the start of the first gap and
// runs on, past the margin or over the float. Modern modes move it below the float. Only the
// opening object of an empty line is measured this way; text keeps its wrapping rules.

import type { ExclusionZone } from './drawing-exclusion.ts';

/**
 * The width to place an inline object of `width` with: a token width that the first gap holds
 * when the legacy rule applies, or `width` itself.
 */
export function besideFloatWidth(
  width: number,
  flow: { readonly inlineObjectsBesideFloats?: boolean } | undefined,
  lineHoldsContent: boolean,
  zones: () => readonly ExclusionZone[]
): number {
  if (!flow?.inlineObjectsBesideFloats || lineHoldsContent) return width;
  if (zones().length === 0) return width;
  return Math.min(width, 1);
}
