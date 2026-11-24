// Header and footer stories too tall to show whole (ECMA-376 §17.10 headers and footers).
//
// Furniture always pushes the body by its full height (`page-furniture-insets.ts`). What it
// PAINTS is a separate rule: while the header and footer of a page together stay within four
// fifths of the sheet height, each shows whole. Past that, each shows only the whole lines
// that fit in two fifths of the sheet, measured from its own top; the lines after them are
// not drawn. A footer cut this way sits on its footer distance by the height it keeps, so it
// starts with its first line, not with the lines that would fit at the bottom.

import type { BlockFragmentRecord } from './semantic-records.ts';

/** Share of the sheet height the header and footer may fill together and still show whole. */
const SHOWN_WHOLE_SHARE = 0.8;
/** Share of the sheet height each story keeps once the two together pass that share. */
const CLIPPED_STORY_SHARE = 0.4;
const EPSILON = 0.001;

/**
 * The height each of the page's header and footer may paint, or undefined when both show
 * whole. Heights are flow heights in points; an absent story is 0.
 */
export function furniturePaintLimit(
  pageHeight: number,
  headerHeight: number,
  footerHeight: number
): number | undefined {
  if (!(pageHeight > 0)) return undefined;
  return headerHeight + footerHeight > pageHeight * SHOWN_WHOLE_SHARE + EPSILON
    ? pageHeight * CLIPPED_STORY_SHARE
    : undefined;
}

/**
 * The fragments of a story-relative flow that show within `limit`, and the height they span.
 *
 * Paragraphs lose their lines past the limit; a fragment with none left is dropped. A table
 * that starts within the limit stays whole, and one that starts past it is dropped.
 */
export function clipFurnitureFragments(
  fragments: readonly BlockFragmentRecord[],
  limit: number
): { readonly fragments: readonly BlockFragmentRecord[]; readonly height: number } {
  const kept: BlockFragmentRecord[] = [];
  let height = 0;
  for (const fragment of fragments) {
    if (fragment.kind !== 'paragraph') {
      if (fragment.box.y + EPSILON >= limit) continue;
      kept.push(fragment);
      height = Math.max(height, fragment.box.y + fragment.box.height);
      continue;
    }
    const lines = fragment.lines.filter((line) => line.box.y + line.box.height <= limit + EPSILON);
    if (lines.length === 0) continue;
    if (lines.length === fragment.lines.length) {
      kept.push(fragment);
      height = Math.max(height, fragment.box.y + fragment.box.height);
      continue;
    }
    const last = lines[lines.length - 1]!;
    const bottom = last.box.y + last.box.height;
    // The cut fragment no longer holds the paragraph end.
    const { paragraphEnd, ...shown } = fragment;
    void paragraphEnd;
    kept.push({
      ...shown,
      lines,
      range: { ...fragment.range, end: last.range.end },
      box: { ...fragment.box, height: Math.max(0, bottom - fragment.box.y) },
    });
    height = Math.max(height, bottom);
  }
  return { fragments: Object.freeze(kept), height: Math.min(height, limit) };
}
