import type { OoxmlElement, OoxmlNode } from '../package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-tree.ts';

/** Table rows/cells may be wrapped in content controls or custom-XML containers. */
export function isTableWrapper(node: OoxmlNode): node is OoxmlElement {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    ['sdt', 'sdtContent', 'customXml'].includes(node.localName)
  );
}
export function tableChildren(node: OoxmlElement, kind: 'tableRow' | 'tableCell'): OoxmlElement[] {
  const out: OoxmlElement[] = [];
  const visit = (parent: OoxmlElement): void => {
    for (const child of parent.children) {
      if (child.kind === kind) out.push(child);
      else if (isTableWrapper(child)) visit(child);
    }
  };
  visit(node);
  return out;
}
export function replaceTableChildren(
  node: OoxmlElement,
  replacements: ReadonlyMap<string, OoxmlElement>
): OoxmlElement {
  return {
    ...node,
    children: node.children.map(
      (child) =>
        replacements.get(child.id) ??
        (isTableWrapper(child) ? replaceTableChildren(child, replacements) : child)
    ),
  } as OoxmlElement;
}
