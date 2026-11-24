// Shared WordprocessingML name helpers for table store modules.

import { findNode, parentNodeOf } from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';

export { WML_NAMESPACE_URI };

export function isWmlElement(node: OoxmlNode, localName: string): node is OoxmlElement {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

export function isWmlGridCol(node: OoxmlNode): node is OoxmlElement {
  return isWmlElement(node, 'gridCol');
}

export function wmlChildNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (isWmlElement(child, localName)) return child;
  }
  return undefined;
}

export function wmlAttributeValue(node: OoxmlElement, localName: string): string | undefined {
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName) {
      return attribute.value;
    }
  }
  return undefined;
}

export function expandedNameMatches(
  node: OoxmlElement,
  localName: string,
  namespaceUri: string = WML_NAMESPACE_URI
): boolean {
  return node.localName === localName && node.namespaceUri === namespaceUri;
}

/** The nearest `w:tbl` at or above `nodeId`, or null outside a table. */
export function tableAncestorOf(part: OoxmlPart, nodeId: string): OoxmlElement | null {
  const node = findNode(part, nodeId);
  if (!node || node.kind === 'textValue') return null;
  let current: OoxmlElement | null = node;
  while (current && current.kind !== 'table') current = parentNodeOf(part, current.id);
  return current;
}
