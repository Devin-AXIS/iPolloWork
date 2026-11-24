import { twips, twipsToPoints } from '@docx-editor.dev/core/store';
import type { SectionColumns } from './section-properties.ts';
import type { LayoutBox } from './semantic-records.ts';

export interface ResolvedSectionColumns {
  readonly count: number;
  readonly widths: readonly number[];
  readonly gaps: readonly number[];
  readonly lefts: readonly number[];
  readonly separator: boolean;
}

/**
 * Narrowest column text flows into: 0.01 inch. Equal columns whose gaps leave less than this
 * keep their gaps and shrink to this width, so later columns move past the page edge.
 */
const MIN_COLUMN_WIDTH_PT = 0.72;

/**
 * Resolve bounded OOXML column declarations into content-box-relative point geometry.
 *
 * Stated geometry is kept even when it does not fit. Unequal columns wider than the content
 * box are not scaled down, and equal columns keep their stated gap. Later columns may then
 * start or end past the page edge; squeezing them to fit would rewrap every line in them.
 *
 * An unequal column narrower than {@link MIN_COLUMN_WIDTH_PT} still starts the next column at
 * its stated width; only the width text flows into is raised to the minimum.
 *
 * Incomplete unequal-width declarations fall back as a unit (the parser drops them).
 */
export function resolveSectionColumns(
  columns: SectionColumns,
  contentWidth: number
): ResolvedSectionColumns {
  const width = Math.max(MIN_COLUMN_WIDTH_PT, contentWidth);
  const count = Math.max(1, Math.min(12, Math.floor(columns.count)));
  const definitions = columns.definitions ?? [];
  const unequal = columns.equalWidth === false && definitions.length === count;

  let stated: number[];
  let gaps: number[];
  if (unequal) {
    stated = definitions.map((definition) =>
      Math.max(0, twipsToPoints(twips(definition.widthTwips)))
    );
    gaps = definitions
      .slice(0, -1)
      .map((definition) => Math.max(0, twipsToPoints(twips(definition.gapTwips))));
  } else {
    const gap = Math.max(0, twipsToPoints(twips(columns.gapTwips)));
    gaps = Array.from({ length: count - 1 }, () => gap);
    // Equal columns position past their clamped width, unlike stated unequal widths.
    const columnWidth = Math.max(MIN_COLUMN_WIDTH_PT, (width - gap * (count - 1)) / count);
    stated = Array.from({ length: count }, () => columnWidth);
  }

  const lefts: number[] = [];
  let left = 0;
  for (let index = 0; index < count; index += 1) {
    lefts.push(left);
    left += Math.max(0, stated[index]!) + (gaps[index] ?? 0);
  }
  // A right-to-left section places its first column at the right edge of the content box
  // and the next ones leftward, with the same widths and gaps.
  if (columns.rightToLeft && count > 1) {
    for (let index = 0; index < count; index += 1)
      lefts[index] = width - lefts[index]! - Math.max(0, stated[index]!);
  }

  return {
    count,
    widths: stated.map((columnWidth) => Math.max(MIN_COLUMN_WIDTH_PT, columnWidth)),
    gaps,
    lefts,
    separator: columns.separator === true && count > 1,
  };
}

/** The column `index` across the height of `box`; `fallbackWidth` past the last column. */
export function columnBoxAt(
  columns: ResolvedSectionColumns,
  index: number,
  fallbackWidth: number,
  box: LayoutBox
): LayoutBox {
  const width = columns.widths[index] ?? fallbackWidth;
  return Object.freeze({ x: columns.lefts[index] ?? 0, y: box.y, width, height: box.height });
}

/** The 0.75pt rule centered in each column gap, from `top` down to the lowest placed content. */
export function columnSeparatorBoxes(
  columns: ResolvedSectionColumns,
  top: number,
  usedBottom: number
): LayoutBox[] {
  // Centered between the stated column end and the next column's start: a column narrower than
  // the minimum flow width still ends where its stated width says.
  // In a right-to-left section the next column sits to the left, so the gap ends where the
  // current column starts.
  return columns.gaps.map((gap, index) => ({
    x: Math.max(columns.lefts[index + 1]!, columns.lefts[index]!) - gap / 2 - 0.375,
    y: top,
    width: 0.75,
    height: Math.max(0, usedBottom - top),
  }));
}
