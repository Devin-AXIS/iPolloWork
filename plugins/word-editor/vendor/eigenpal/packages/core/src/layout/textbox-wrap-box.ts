// The wrap box of a turned legacy text box.
//
// Text keeps off both the box and the box turned about its centre. The wrap distances belong
// to the shape and turn with it, so a quarter-turned box keeps its side distances above and
// below.

import { rotatedBounds } from './drawing-text-art.ts';
import type { LayoutBox } from './semantic-records.ts';

/**
 * The wrap box of a turned box: the box itself, and the box with its wrap distances turned
 * about its centre, less those distances, which the exclusion adds back on every side.
 */
export function turnedWrapBox(
  box: LayoutBox,
  degrees: number,
  distancesEmu: Readonly<{ top: number; right: number; bottom: number; left: number }>
): LayoutBox {
  const pt = (emu: number) => emu / 12_700;
  const [top, right, bottom, left] = [
    pt(distancesEmu.top),
    pt(distancesEmu.right),
    pt(distancesEmu.bottom),
    pt(distancesEmu.left),
  ];
  const turned = rotatedBounds(
    {
      x: box.x - left,
      y: box.y - top,
      width: box.width + left + right,
      height: box.height + top + bottom,
    },
    degrees
  );
  return unionBox(box, {
    x: turned.x + left,
    y: turned.y + top,
    width: Math.max(0, turned.width - left - right),
    height: Math.max(0, turned.height - top - bottom),
  });
}

function unionBox(a: LayoutBox, b: LayoutBox): LayoutBox {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
