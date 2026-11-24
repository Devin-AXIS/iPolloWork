// One authoritative style-level outline rule for navigation, layout, and exporters.

import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

function element(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function child(parent: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const candidate of parent.children) {
    if (element(candidate) && candidate.localName === localName) return candidate;
  }
  return undefined;
}

function value(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/** Resolve a paragraph style's 0-based outline level; explicit outlineLvl wins over its name. */
export function styleOutlineLevel(style: OoxmlElement): number | null {
  const paragraphProperties = child(style, 'pPr');
  const explicit = paragraphProperties ? child(paragraphProperties, 'outlineLvl') : undefined;
  if (explicit) {
    const raw = value(explicit, 'val');
    return raw !== undefined && /^[0-8]$/.test(raw) ? Number(raw) : null;
  }
  const name = child(style, 'name');
  const heading = name ? /^heading\s+([1-9])$/i.exec(value(name, 'val')?.trim() ?? '') : null;
  return heading ? Number(heading[1]) - 1 : null;
}
