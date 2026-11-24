/**
 * The white space a `w:t` or `w:delText` shows.
 *
 * Without `xml:space="preserve"` on the element itself, or on the root of its part, the text
 * loses its leading and trailing white space and a tab in it shows as a space. The value on a
 * paragraph or run between them does not count. A line break in any text shows as a space.
 */
import type { OoxmlAttribute, OoxmlNode } from './ooxml-tree.ts';

/** An element's own `xml:space`: true to preserve, false for default, undefined when unset. */
export function ownXmlSpace(attributes: readonly OoxmlAttribute[]): boolean | undefined {
  const space = attributes.find((attribute) => attribute.kind === 'xmlSpace');
  return space ? space.value === 'preserve' : undefined;
}

/** A text element's children as they show; the same array when nothing changes. */
export function displayedText(
  children: readonly OoxmlNode[],
  preserve: boolean
): readonly OoxmlNode[] {
  if (children.length === 0 || children.some((child) => child.kind !== 'textValue'))
    return children;
  let changed = false;
  const out = children.map((child, index) => {
    if (child.kind !== 'textValue') return child;
    let value = child.value.replace(/\r\n?|\n/g, ' ');
    if (!preserve) {
      value = value.replace(/\t/g, ' ');
      if (index === 0) value = value.replace(/^ +/, '');
      if (index === children.length - 1) value = value.replace(/ +$/, '');
    }
    if (value === child.value) return child;
    changed = true;
    return { ...child, value };
  });
  if (!changed) return children;
  return out.filter((child) => child.kind !== 'textValue' || child.value !== '');
}
