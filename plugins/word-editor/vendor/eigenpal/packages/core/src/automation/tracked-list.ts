import { findNode } from '../store/package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlNode } from '../store/package/ooxml-tree.ts';
import type { AutomationStoryReads } from './reads.ts';

function child(node: OoxmlNode | undefined, name: string): OoxmlNode | undefined {
  return node && 'children' in node
    ? node.children.find(
        (n) =>
          n.kind !== 'textValue' && n.namespaceUri === WML_NAMESPACE_URI && n.localName === name
      )
    : undefined;
}
function attr(node: OoxmlNode | undefined, name: string) {
  return node && 'attributes' in node
    ? node.attributes.find((a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === name)
        ?.value
    : undefined;
}

/** Definition edits can accompany a proposed list only when rejection removes every membership. */
export function isProposedList(
  story: AutomationStoryReads,
  paragraphIds: readonly string[],
  numId: string,
  author: string
): boolean {
  return (
    paragraphIds.length > 0 &&
    paragraphIds.every((id) => {
      const pPr = child(findNode(story.part, id) ?? undefined, 'pPr');
      if (attr(child(child(pPr, 'rPr'), 'ins'), 'author') === author) return true;
      const change = child(pPr, 'pPrChange');
      const prior = child(change, 'pPr');
      return (
        attr(change, 'author') === author &&
        attr(child(child(prior, 'numPr'), 'numId'), 'val') !== numId
      );
    })
  );
}
