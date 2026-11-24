// What an output reads to label a drawing, and whether it paints at all.

import type { DrawingAccessibility, DrawingProjection } from './drawing-projection.ts';

export function drawingAccessibility(projection: DrawingProjection): DrawingAccessibility {
  const label =
    projection.description.length > 0
      ? projection.description
      : projection.title.length > 0
        ? projection.title
        : null;
  return Object.freeze({
    // A wrap footprint reserves space only: no output paints, selects or exports it.
    hidden: projection.hidden || projection.footprintOnly === true,
    decorative: label === null,
    label,
  });
}
