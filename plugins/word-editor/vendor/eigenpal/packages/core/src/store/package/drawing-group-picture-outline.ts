// The outline of a picture member of a `wpg:wgp` group. The group picture paints the raster;
// a visible `a:ln` on the member strokes above it as stroke-only vector components of the
// member's frame. The projector and transform readers come in as parameters so this module
// does not import the shape projection that calls it.

import type { ShapeSchemeColorResolver } from './drawing-shape-color.ts';
import type { VectorShapeComponent } from './drawing-shape-projection.ts';
import type { OoxmlElement } from './ooxml-tree.ts';

type Extent = Readonly<{ cx: number; cy: number }>;

export interface GroupPictureOutlineTools {
  readonly project: (
    member: OoxmlElement,
    extent: Extent,
    pointBudget: { remaining: number },
    resolveSchemeColor?: ShapeSchemeColorResolver,
    resolveStyleMatrixReference?: undefined,
    groupMember?: boolean
  ) => readonly VectorShapeComponent[] | null;
  readonly childTransform: (
    member: OoxmlElement
  ) => { readonly offset: Readonly<{ x: number; y: number }>; readonly extent: Extent } | null;
  /** Places a member-space component in the group, from the member's child-space offset. */
  readonly place: (
    component: VectorShapeComponent,
    offset: Readonly<{ x: number; y: number }>
  ) => VectorShapeComponent;
}

/**
 * The member's outline as placed stroke-only components: empty when the picture has no
 * visible outline, null when its frame or outline is outside the painted subset.
 */
export function groupPictureOutline(
  picture: OoxmlElement,
  pointBudget: { remaining: number },
  resolveSchemeColor: ShapeSchemeColorResolver | undefined,
  tools: GroupPictureOutlineTools
): VectorShapeComponent[] | null {
  const transform = tools.childTransform(picture);
  if (!transform) return null;
  const components = tools.project(
    picture,
    transform.extent,
    pointBudget,
    resolveSchemeColor,
    undefined,
    true
  );
  if (components === null) return null;
  return components
    .filter((component) => component.strokeHex !== null && component.strokeWidthEmu > 0)
    .map((component) => tools.place({ ...component, fillHex: null }, transform.offset));
}
