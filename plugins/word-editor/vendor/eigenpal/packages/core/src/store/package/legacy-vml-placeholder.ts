// The placeholder of a legacy drawing on the text line that this engine cannot paint.
//
// It keeps the drawing's box, so the line holds the same height and width as the reference
// and the text after it stays in place, and paints the labelled placeholder that an
// unsupported DrawingML graphic shows. A floating drawing that cannot paint keeps no box:
// its position and wrap are part of what could not be read.

import type { DrawingProjection } from './drawing-projection.ts';
import type { OoxmlElement } from './ooxml-tree.ts';
import { attribute as a, children, named, points, styleOf, VML } from './legacy-vml-values.ts';

const EMPTY_EDGES = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const SHAPES = ['shape', 'rect', 'roundrect', 'oval', 'line', 'polyline', 'arc', 'group'];
/** The largest box, in points, a placeholder keeps; past it the drawing keeps no box. */
const MAX_POINTS = 10_000;

/** The diagnostic detail an unsupported legacy drawing carries; layout labels it a shape. */
export const LEGACY_PLACEHOLDER_DETAIL = 'legacy-vml';

/**
 * A placeholder projection for the one shape of `node` (a `w:pict`, or `preview` of a
 * `w:object`), when it sits on the line with a readable size; null otherwise.
 */
export function legacyPlaceholderProjection(
  node: OoxmlElement,
  preview?: OoxmlElement
): DrawingProjection | null {
  const shapes = preview ? [preview] : children(node).filter((c) => !named(c, VML, 'shapetype'));
  if (shapes.length !== 1) return null;
  const root = shapes[0]!;
  if (root.namespaceUri !== VML || !SHAPES.includes(root.localName)) return null;
  const style = styleOf(root);
  if (!style || style.get('position') === 'absolute') return null;
  const width = points(style.get('width')),
    height = points(style.get('height'));
  const size = (n: number) => Number.isFinite(n) && n > 0 && n <= MAX_POINTS;
  if (!size(width) || !size(height)) return null;
  return inlineLegacyProjection(node, root, width, height, {
    hidden: style.get('visibility') === 'hidden',
    diagnostics: Object.freeze([
      Object.freeze({
        code: 'unsupported-graphic' as const,
        nodeId: root.id,
        detail: LEGACY_PLACEHOLDER_DETAIL,
      }),
    ]),
  });
}

/**
 * A read-only projection of a legacy drawing on the line, `width`×`height` points, that paints
 * only what `fields` give it.
 */
export function inlineLegacyProjection(
  node: OoxmlElement,
  root: OoxmlElement,
  width: number,
  height: number,
  fields: Pick<DrawingProjection, 'hidden' | 'diagnostics'> &
    Partial<Pick<DrawingProjection, 'horizontalRule'>>
): DrawingProjection {
  return Object.freeze({
    drawingNodeId: node.id,
    ownerPartName: '',
    kind: 'inline',
    relationshipId: null,
    docPrId: null,
    name: a(root, 'id') ?? 'Legacy graphic',
    title: a(root, 'title') ?? '',
    description: a(root, 'alt') ?? '',
    hyperlinkHref: null,
    extentEmu: Object.freeze({ cx: Math.round(width * 12700), cy: Math.round(height * 12700) }),
    effectExtentEmu: EMPTY_EDGES,
    inlineDistancesEmu: EMPTY_EDGES,
    wrap: 'inline',
    wrapGeometry: null,
    position: null,
    anchor: null,
    picture: null,
    vectorShape: null,
    groupPicture: null,
    textboxStory: null,
    locks: Object.freeze({ select: true, move: true, resize: true, changeAspect: true }),
    effects: Object.freeze({ grayscale: false, brightness: 0, contrast: 0 }),
    compatibilityBranchNodeId: null,
    ...fields,
  });
}
