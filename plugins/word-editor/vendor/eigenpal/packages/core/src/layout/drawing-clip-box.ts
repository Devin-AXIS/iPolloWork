import type { LayoutBox } from './semantic-records.ts';

export function clipBoxHorizontally(
  box: LayoutBox,
  contentLeft: number,
  contentRight: number
): LayoutBox {
  const left = Math.max(box.x, contentLeft);
  const right = Math.min(box.x + box.width, contentRight);
  if (right <= left) {
    return Object.freeze({ x: left, y: box.y, width: 0, height: box.height });
  }
  return Object.freeze({
    x: left,
    y: box.y,
    width: right - left,
    height: box.height,
  });
}

/** A drawing's hit box: its paint box, or a separate copy when the paint box is empty. */
export function hitBoundsOf(paintBounds: LayoutBox): LayoutBox {
  return paintBounds.width > 0 && paintBounds.height > 0
    ? paintBounds
    : Object.freeze({ ...paintBounds });
}

/** Clip `box` to a rectangular region on both axes. */
export function clipBoxToRegion(box: LayoutBox, region: LayoutBox): LayoutBox {
  const x = Math.max(box.x, region.x);
  const y = Math.max(box.y, region.y);
  const right = Math.min(box.x + box.width, region.x + region.width);
  const bottom = Math.min(box.y + box.height, region.y + region.height);
  // A box with no width (or height) of its own, such as a straight vertical line, stays when
  // it lies inside the region; a box that had size and lost it all is empty.
  const emptyX = box.width > 0 ? right <= x : right < x;
  const emptyY = box.height > 0 ? bottom <= y : bottom < y;
  if (emptyX || emptyY) {
    return Object.freeze({ x, y, width: 0, height: 0 });
  }
  return Object.freeze({ x, y, width: right - x, height: bottom - y });
}
