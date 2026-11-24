import type { OoxmlAttribute, OoxmlElement } from '../package/ooxml-tree.ts';

export function schemaAttributeValue(
  attributes: readonly OoxmlAttribute[],
  localName: string
): string | undefined {
  for (const attribute of attributes) {
    if (attribute.localName === localName && attribute.namespaceUri === '') return attribute.value;
  }
  return undefined;
}

export type DistanceTexts = { top: string; right: string; bottom: string; left: string };

/**
 * Copied text distances keep their `xsd:unsignedInt` spelling, including the two's-complement
 * form of a negative distance. A malformed value becomes 0, which is how it reads; a missing
 * one is undefined.
 */
export function readDistanceTexts(element: OoxmlElement): Partial<DistanceTexts> {
  const read = (name: string): string | undefined => {
    const value = schemaAttributeValue(element.attributes, name);
    if (value === undefined) return undefined;
    return /^\d+$/.test(value) && Number(value) <= 0xffff_ffff ? value : '0';
  };
  return { top: read('distT'), right: read('distR'), bottom: read('distB'), left: read('distL') };
}

/** `wp:anchor` and `wp:inline` have no fallback, so a missing distance is written as 0. */
export function readRootDistanceTexts(element: OoxmlElement): DistanceTexts {
  const { top = '0', right = '0', bottom = '0', left = '0' } = readDistanceTexts(element);
  return { top, right, bottom, left };
}
