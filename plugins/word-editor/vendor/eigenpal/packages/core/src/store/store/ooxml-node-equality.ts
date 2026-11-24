import type { OoxmlNode } from '../package/ooxml-tree.ts';

/** OOXML equality that ignores canonical node ids, which are intentionally fresh after copies. */
export function equivalentNodes(left: readonly OoxmlNode[], right: readonly OoxmlNode[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((node, index) => equivalentNode(node, right[index]!));
}

function equivalentNode(left: OoxmlNode, right: OoxmlNode): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'textValue' || right.kind === 'textValue') {
    return left.kind === 'textValue' && right.kind === 'textValue' && left.value === right.value;
  }
  if (
    left.namespaceUri !== right.namespaceUri ||
    left.localName !== right.localName ||
    left.attributes.length !== right.attributes.length
  ) {
    return false;
  }
  for (let index = 0; index < left.attributes.length; index += 1) {
    const a = left.attributes[index]!;
    const b = right.attributes[index]!;
    if (
      a.namespaceUri !== b.namespaceUri ||
      a.localName !== b.localName ||
      a.prefix !== b.prefix ||
      a.value !== b.value
    ) {
      return false;
    }
  }
  return equivalentNodes(left.children, right.children);
}
