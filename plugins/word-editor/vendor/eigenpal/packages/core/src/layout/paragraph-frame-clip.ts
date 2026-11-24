import type { LayoutBox } from './semantic-records.ts';

/** Intersect ink/selection geometry with a text frame without changing model ranges. */
export function clipParagraphBox<T extends LayoutBox>(
  value: T,
  frame: LayoutBox | undefined
): T | null {
  if (!frame) return value;
  const x = Math.max(value.x, frame.x),
    y = Math.max(value.y, frame.y);
  const right = Math.min(value.x + value.width, frame.x + frame.width);
  const bottom = Math.min(value.y + value.height, frame.y + frame.height);
  if (bottom <= y || (value.width === 0 ? right < x : right <= x)) return null;
  return { ...value, x, y, width: right - x, height: bottom - y };
}
