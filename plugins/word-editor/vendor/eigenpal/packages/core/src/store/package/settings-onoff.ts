// Reading `ST_OnOff` toggles out of `settings.xml`.
//
// Shared because the rule has a trap in it and one copy is enough: a toggle element means ON by
// its PRESENCE, but `@w:val` can spell a false, so `<w:trackRevisions w:val="0"/>` is a document
// asking for tracking to be off. Reading presence alone turns it back on — quietly, and against
// what the author wrote.

import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

export function isSettingsElement(node: OoxmlNode | null | undefined): node is OoxmlElement {
  return node !== null && node !== undefined && node.kind !== 'textValue';
}

export function settingsChildNamed(parent: OoxmlElement, localName: string): OoxmlElement | null {
  for (const child of parent.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === WML_NAMESPACE_URI && child.localName === localName) return child;
  }
  return null;
}

export function settingsAttributeValue(
  element: OoxmlElement,
  localName: string
): string | undefined {
  for (const attribute of element.attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName) {
      return attribute.value;
    }
  }
  return undefined;
}

/** An `ST_OnOff` toggle element: present means on unless `@w:val` spells a false. */
export function settingsOnOff(parent: OoxmlElement, localName: string): boolean {
  const element = settingsChildNamed(parent, localName);
  if (!element) return false;
  const value = settingsAttributeValue(element, 'val');
  if (value === undefined) return true;
  return value !== '0' && value !== 'false' && value !== 'off';
}
