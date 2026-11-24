import { findNode, parentNodeOf } from '../store/package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../store/package/ooxml-tree.ts';

/** Only the author of a pending inserted wrapper can configure its tag and title. */
export function ownsInsertedControl(part: OoxmlPart, id: string, author: string): boolean {
  const control = findNode(part, id);
  if (!control || control.kind !== 'contentControl') return false;
  const clean = (node: OoxmlNode): boolean =>
    node.kind === 'textValue' ||
    (!node.kind.startsWith('revision') &&
      !node.localName.endsWith('Change') &&
      node.children.every(clean));
  if (!clean(control)) return false;
  const parent = parentNodeOf(part, id);
  return (
    parent?.kind === 'revisionInsert' &&
    parent.attributes.some(
      (attribute) =>
        attribute.namespaceUri === WML_NAMESPACE_URI &&
        attribute.localName === 'author' &&
        attribute.value === author
    )
  );
}
