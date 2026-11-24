// The EMU boxes a drawing anchor declares: its own extent, and the effect bleed around it.

import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { findDirectKind } from './drawing-projection-walk.ts';
import { findDirectChild, parseEmu } from './drawing-shape-projection.ts';
import { WP_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

/** The shadow, glow or reflection bleed one node declares, or null when it declares none. */
export function readEffectExtentFromNode(
  node: OoxmlElement | null,
  compatibilityMode: boolean
): Readonly<{ top: number; right: number; bottom: number; left: number }> | null {
  if (!node) return null;
  const effect =
    findDirectKind(node.children, 'drawingEffectExtent') ??
    (compatibilityMode
      ? findDirectChild(node.children, {
          namespaceUri: WP_NAMESPACE_URI,
          localName: 'effectExtent',
        })
      : null);
  if (!effect) return null;
  return Object.freeze({
    left: parseEmu(schemaAttributeValue(effect.attributes, 'l'), false) ?? 0,
    top: parseEmu(schemaAttributeValue(effect.attributes, 't'), false) ?? 0,
    right: parseEmu(schemaAttributeValue(effect.attributes, 'r'), false) ?? 0,
    bottom: parseEmu(schemaAttributeValue(effect.attributes, 'b'), false) ?? 0,
  });
}

/** The anchor's own painted size, or null when it declares none or declares it unreadably. */
export function readExtent(
  anchor: OoxmlElement,
  compatibilityMode: boolean
): Readonly<{ cx: number; cy: number }> | null {
  const extent =
    findDirectKind(anchor.children, 'drawingExtent') ??
    (compatibilityMode
      ? findDirectChild(anchor.children, { namespaceUri: WP_NAMESPACE_URI, localName: 'extent' })
      : null);
  if (!extent) return null;
  const cx = parseEmu(schemaAttributeValue(extent.attributes, 'cx'));
  const cy = parseEmu(schemaAttributeValue(extent.attributes, 'cy'));
  if (cx === null || cy === null) return null;
  return Object.freeze({ cx, cy });
}
