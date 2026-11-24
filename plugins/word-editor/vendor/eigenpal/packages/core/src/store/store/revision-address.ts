/**
 * The address a WordprocessingML revision element carries (`w:id`, `w:author`, `w:date`),
 * and the key revisions are grouped under.
 */
import { WML_NAMESPACE_URI, type OoxmlElement } from '../package/ooxml-tree.ts';
import type { RevisionAddress } from './tree-op-types.ts';

export function wmlAttribute(node: OoxmlElement, localName: string): string | undefined {
  for (const attribute of node.attributes) {
    if (attribute.localName !== localName) continue;
    if (attribute.namespaceUri !== WML_NAMESPACE_URI) continue;
    return attribute.value;
  }
  return undefined;
}

export function addressOf(node: OoxmlElement): RevisionAddress | null {
  const id = wmlAttribute(node, 'id');
  const author =
    wmlAttribute(node, 'author') ?? (node.localName === 'tblGridChange' ? '' : undefined);
  if (id === undefined || author === undefined) return null;
  const date = wmlAttribute(node, 'date');
  return date === undefined ? { id, author } : { id, author, date };
}

export function sameRevision(a: RevisionAddress, b: RevisionAddress): boolean {
  return a.id === b.id && a.author === b.author && (a.date ?? null) === (b.date ?? null);
}

/**
 * The key a revision is grouped under: its address PLUS the element it is written on.
 *
 * `@w:id` carries no uniqueness constraint, and Word writes one `w:date` for a whole editing
 * burst — so an insertion and a deletion can legally share all three. Grouping on the triple
 * alone showed them as one card reading `insert` with both texts concatenated, and Accept
 * then deleted the half the card said it was inserting.
 */
export function revisionGroupKey(address: RevisionAddress, localName: string): string {
  return `${localName}\u0000${address.id}\u0000${address.author}\u0000${address.date ?? ''}`;
}
