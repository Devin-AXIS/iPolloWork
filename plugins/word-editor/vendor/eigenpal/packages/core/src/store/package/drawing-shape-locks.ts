// The locks a shape or group carries on itself, merged with its frame's locks.

import type { DrawingLocks, DrawingLocksInput } from './drawing-projection.ts';
import { findGraphicData } from './drawing-group-frame.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI } from './ooxml-shared.ts';
import { parseSchemaBoolean, schemaAttributeValue } from './ooxml-drawing-rules.ts';
import type { OoxmlElement } from './ooxml-tree.ts';

const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';

/** The non-visual properties and the locks element each shape payload carries them in. */
const SHAPE_LOCKS: readonly (readonly [string, string, string, string])[] = [
  [WPS, 'wsp', 'cNvSpPr', 'spLocks'],
  [WPS, 'wsp', 'cNvCnPr', 'cxnSpLocks'],
  [WPG, 'wgp', 'cNvGrpSpPr', 'grpSpLocks'],
];

function childNamed(node: OoxmlElement, namespaceUri: string, localName: string) {
  for (const child of node.children)
    if (child.kind !== 'textValue' && child.namespaceUri === namespaceUri)
      if (child.localName === localName) return child;
  return null;
}

/**
 * The locks on the shape itself: `wps:cNvSpPr/a:spLocks`, `wps:cNvCnPr/a:cxnSpLocks` or
 * `wpg:cNvGrpSpPr/a:grpSpLocks` under the anchor's graphic. Empty for any other graphic.
 */
export function shapeLocksOf(anchor: OoxmlElement): DrawingLocksInput {
  const data = findGraphicData(anchor);
  if (!data) return {};
  for (const [namespaceUri, payload, properties, locks] of SHAPE_LOCKS) {
    const shape = childNamed(data, namespaceUri, payload);
    const nonVisual = shape && childNamed(shape, namespaceUri, properties);
    const element = nonVisual && childNamed(nonVisual, DRAWINGML_MAIN_NAMESPACE_URI, locks);
    if (!element) continue;
    const locked = (name: string) =>
      parseSchemaBoolean(schemaAttributeValue(element.attributes, name)) ?? undefined;
    return {
      select: locked('noSelect'),
      move: locked('noMove'),
      resize: locked('noResize'),
      changeAspect: locked('noChangeAspect'),
    };
  }
  return {};
}

/**
 * A drawing's locks: a lock set on its frame (`a:graphicFrameLocks`) or on its shape holds.
 * `wp:anchor/@locked` (20.4.2.3) fixes only the anchor paragraph, so it is not one of them.
 */
export function mergedDrawingLocks(
  frame: DrawingLocksInput,
  shape: DrawingLocksInput
): DrawingLocks {
  return Object.freeze({
    select: !!(frame.select || shape.select),
    move: !!(frame.move || shape.move),
    resize: !!(frame.resize || shape.resize),
    changeAspect: !!(frame.changeAspect || shape.changeAspect),
  });
}
