// The shape around a DrawingML text box (`wps:wsp` with `wps:txbx`): the outline of its
// preset or custom geometry, the text rectangle that geometry names, its turn, and its text
// flow. It reuses the frame a legacy text box paints with, so layout and both painters treat
// the two the same way.

import type { TextboxLegacyFrame } from './drawing-shape-projection.ts';
import { readShapeGeometry, shapeRotationDegrees } from './drawing-shape-geometry.ts';
import { findDirectChild } from './drawing-shape-readers.ts';
import { schemaFlagIsSet } from './drawing-group-frame.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
/** An outline with more points than this keeps the plain box. */
const MAX_OUTLINE_POINTS = 1024;

/**
 * The frame of a top-level text box, or null when it is an upright rectangle with horizontal
 * text, which paints as the plain box. Null too when the geometry does not evaluate.
 */
export function drawingTextboxFrame(
  spPr: OoxmlElement,
  bodyPr: OoxmlElement | null,
  extent: Readonly<{ cx: number; cy: number }>
): TextboxLegacyFrame | null {
  const xfrm = findDirectChild(spPr.children, { namespaceUri: A, localName: 'xfrm' });
  const turn = shapeRotationDegrees(xfrm);
  if (turn === null) return null;
  const rotationDegrees = ((turn % 360) + 360) % 360;
  const vert = bodyPr ? schemaAttributeValue(bodyPr.attributes, 'vert') : undefined;
  const flow: TextboxLegacyFrame['flow'] =
    vert === 'vert' || vert === 'eaVert'
      ? 'vertical'
      : vert === 'vert270'
        ? 'verticalBottomToTop'
        : 'horizontal';
  const prstGeom = findDirectChild(spPr.children, { namespaceUri: A, localName: 'prstGeom' });
  const custGeom = findDirectChild(spPr.children, { namespaceUri: A, localName: 'custGeom' });
  const preset = prstGeom ? schemaAttributeValue(prstGeom.attributes, 'prst') : undefined;
  const rectangle = !custGeom && (preset === undefined || preset === 'rect');
  if (rectangle && rotationDegrees === 0 && flow === 'horizontal') return null;

  const { cx, cy } = extent;
  let outline: TextboxLegacyFrame['outline'] = null;
  let textAreaEmu = { top: 0, right: 0, bottom: 0, left: 0 };
  if (!rectangle) {
    const geometry = readShapeGeometry(spPr, extent);
    if (!geometry) return null;
    const flipH = xfrm !== null && schemaFlagIsSet(schemaAttributeValue(xfrm.attributes, 'flipH'));
    const flipV = xfrm !== null && schemaFlagIsSet(schemaAttributeValue(xfrm.attributes, 'flipV'));
    const subpaths: { x: number; y: number }[][] = [];
    let points = 0;
    for (const path of geometry.paths) {
      if (path.fill === 'none') continue;
      for (const subpath of path.subpaths) {
        points += subpath.points.length;
        if (points > MAX_OUTLINE_POINTS) return null;
        subpaths.push(
          subpath.points.map((point) => ({
            x: flipH ? 1 - point.x / cx : point.x / cx,
            y: flipV ? 1 - point.y / cy : point.y / cy,
          }))
        );
      }
    }
    if (!subpaths.length) return null;
    outline = { kind: 'polygon', subpaths };
    const rect = geometry.textRect;
    // The text rectangle follows the geometry, not its flip.
    const left = flipH ? cx - rect.right : rect.left;
    const right = flipH ? rect.left : cx - rect.right;
    const top = flipV ? cy - rect.bottom : rect.top;
    const bottom = flipV ? rect.top : cy - rect.bottom;
    textAreaEmu = {
      top: Math.max(0, top),
      right: Math.max(0, right),
      bottom: Math.max(0, bottom),
      left: Math.max(0, left),
    };
  }
  const upright = bodyPr ? schemaAttributeValue(bodyPr.attributes, 'upright') : undefined;
  return {
    textAreaEmu,
    outline,
    rotationDegrees,
    textTurnsWithShape: !schemaFlagIsSet(upright),
    flow,
    ...(outline
      ? {
          textAreaRule: {
            kind: 'share' as const,
            top: textAreaEmu.top / cy,
            right: textAreaEmu.right / cx,
            bottom: textAreaEmu.bottom / cy,
            left: textAreaEmu.left / cx,
          },
        }
      : {}),
  };
}
