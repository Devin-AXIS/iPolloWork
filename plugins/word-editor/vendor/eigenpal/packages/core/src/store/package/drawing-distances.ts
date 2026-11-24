import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { MAX_EMU } from './drawing-shape-readers.ts';
import type { OoxmlElement } from './ooxml-tree.ts';

/**
 * One text distance in EMU. `ST_WrapDistance` is `xsd:unsignedInt`, but writers store a small
 * negative distance as its two's-complement bits (`4294967291` is -5 EMU). Any value above the
 * signed 32-bit maximum is therefore negative, and a negative distance leaves no gap, so it
 * reads as 0. A value that is not an unsigned integer also reads as 0; it never becomes a
 * clamped maximum distance that would push text off the page.
 */
function wrapDistanceEmu(value: string): number {
  if (!/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  return parsed <= MAX_EMU ? parsed : 0;
}

export function readDistances(
  node: OoxmlElement,
  fallback?: OoxmlElement
): Readonly<{ top: number; right: number; bottom: number; left: number }> {
  // An explicit wrap-side value, including zero, overrides only that anchor side.
  const distance = (name: string): number => {
    const value =
      schemaAttributeValue(node.attributes, name) ??
      (fallback ? schemaAttributeValue(fallback.attributes, name) : undefined);
    return value === undefined ? 0 : wrapDistanceEmu(value);
  };
  return Object.freeze({
    top: distance('distT'),
    right: distance('distR'),
    bottom: distance('distB'),
    left: distance('distL'),
  });
}
