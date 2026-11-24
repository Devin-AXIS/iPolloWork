// A tree a concurrent merge leaves, which a file read from XML never holds.

import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';

/**
 * `part` with its first `localName` element repeated beside itself under a fresh id, as two
 * collaborators who each give one row or cell a property at once leave it. The reader merges
 * such copies, so a test of what edits do over them builds the tree here.
 */
export function withRepeated(part: OoxmlPart, localName: string): OoxmlPart {
  let done = false;
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue' || done) return node;
    const at = node.children.findIndex(
      (child) => child.kind !== 'textValue' && child.localName === localName
    );
    const found = node.children[at];
    if (found && found.kind !== 'textValue') {
      done = true;
      // Every node of the copy takes a fresh id, as a peer's own write mints them.
      const fresh = (at: OoxmlNode): OoxmlNode =>
        at.kind === 'textValue'
          ? { ...at, id: `${at.id}-copy` }
          : ({ ...at, id: `${at.id}-copy`, children: at.children.map(fresh) } as OoxmlNode);
      const copy = fresh(found);
      return {
        ...node,
        children: [...node.children.slice(0, at + 1), copy, ...node.children.slice(at + 1)],
      };
    }
    return { ...node, children: node.children.map(visit) };
  };
  return { ...part, root: visit(part.root) as OoxmlElement };
}
