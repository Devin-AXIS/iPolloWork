import { noteIdOf } from '../store/package/note-nodes.ts';
import { WML_NAMESPACE_URI, type OoxmlNode } from '../store/package/ooxml-tree.ts';

/** Note collections follow reference order within their body, including table cells. */
export function referencedNoteIds(root: OoxmlNode, kind: 'footnote' | 'endnote'): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  const visit = (node: OoxmlNode) => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === `${kind}Reference`) {
      const value = noteIdOf(node) ?? Number.NaN;
      if (!seen.has(value)) {
        ids.push(value);
        seen.add(value);
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return ids;
}
