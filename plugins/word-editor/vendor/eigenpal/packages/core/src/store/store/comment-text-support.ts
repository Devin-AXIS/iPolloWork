import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';

const BODY_ELEMENTS = new Set([
  'p',
  'r',
  't',
  'tab',
  'br',
  'cr',
  'noBreakHyphen',
  'softHyphen',
  'sym',
  'annotationRef',
]);

/** Refuse structures a plain-text replacement cannot represent without losing document data. */
export function commentTextEditRefusal(
  part: OoxmlPart,
  commentId: string
): 'unsupported-comment-body' | null {
  const supported = (node: OoxmlNode, properties = false): boolean => {
    if (node.kind === 'textValue') return true;
    if (node.namespaceUri !== WML_NAMESPACE_URI) return false;
    const name = node.localName;
    if (
      name.endsWith('Change') ||
      name === 'sectPr' ||
      /^(ins|del|moveFrom|moveTo|.*RangeStart|.*RangeEnd)$/.test(name)
    )
      return false;
    const inProperties = properties || name === 'pPr' || name === 'rPr';
    if (!inProperties && !BODY_ELEMENTS.has(name)) return false;
    return node.children.every((child) => supported(child, inProperties));
  };
  const visit = (node: OoxmlNode): boolean => {
    if (node.kind === 'textValue') return true;
    if (node.kind === 'comment') {
      const id = node.attributes.find(
        (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'id'
      )?.value;
      return (
        id !== commentId ||
        (node.children.some((child) => child.kind === 'paragraph') &&
          node.children.every((child) => supported(child)))
      );
    }
    return node.children.every(visit);
  };
  return visit(part.root) ? null : 'unsupported-comment-body';
}
