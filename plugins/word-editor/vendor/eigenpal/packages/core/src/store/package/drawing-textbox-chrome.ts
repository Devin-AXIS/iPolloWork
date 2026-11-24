// The shape a top-level text box paints when its fill or outline needs more than one solid
// colour: a gradient or pattern fill, a shadow or glow, or an outline of several bands. The
// shape then paints as vector components under the story, and the story paints its text.

import {
  findWspInAnchor,
  projectShapeComponents,
  type ShapeSchemeColorResolver,
  type ShapeStyleMatrixResolver,
  type VectorShapeComponent,
  type VectorShapeProjection,
} from './drawing-shape-projection.ts';
import type { OoxmlElement } from './ooxml-tree.ts';

const MAX_CHROME_POINTS = 1024;

function needsVectorChrome(components: readonly VectorShapeComponent[]): boolean {
  const painted = components.filter((component) => !component.shadowOnly);
  return (
    painted.length > 1 ||
    components.some(
      (component) =>
        component.shadowOnly === true ||
        component.shadow !== undefined ||
        component.fillGradient !== undefined ||
        component.fillPattern !== undefined ||
        component.arrowheadsEmu !== undefined
    )
  );
}

/**
 * The text box shape as vector components, or null when its solid fill and outline paint as
 * the story's own box.
 */
export function projectTextboxChrome(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): VectorShapeProjection | null {
  if (!(extent.cx > 0 && extent.cy > 0)) return null;
  const wsp = findWspInAnchor(anchor);
  if (!wsp) return null;
  // Painted as a group member does: the story lays out the text, so the box may hold one.
  const components = projectShapeComponents(
    wsp,
    extent,
    { remaining: MAX_CHROME_POINTS },
    resolveSchemeColor,
    resolveStyleMatrixReference,
    true
  );
  if (!components?.length || !needsVectorChrome(components)) return null;
  return {
    extentEmu: { cx: extent.cx, cy: extent.cy },
    subpathsEmu: components.flatMap((component) => component.subpathsEmu),
    fillHex: null,
    strokeHex: null,
    strokeWidthEmu: 0,
    components,
  };
}
