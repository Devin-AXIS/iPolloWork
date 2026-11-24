import type { LayoutBox, ParagraphFragmentRecord } from './semantic-records.ts';

/** Include hanging markers and tabbed text outside the paragraph's wrapping column. */
export function paragraphContentBounds(fragment: ParagraphFragmentRecord): LayoutBox {
  if (fragment.clipToBox) return fragment.box;
  let left = fragment.box.x;
  let right = left + fragment.box.width;
  const include = (box: LayoutBox): void => {
    left = Math.min(left, box.x);
    right = Math.max(right, box.x + box.width);
  };
  if (fragment.marker) include(fragment.marker.box);
  for (const line of fragment.lines) {
    for (const span of line.spans) include(span.box);
    for (const drawing of line.drawings ?? []) include(drawing);
  }
  return left === fragment.box.x && right === fragment.box.x + fragment.box.width
    ? fragment.box
    : { ...fragment.box, x: left, width: right - left };
}
