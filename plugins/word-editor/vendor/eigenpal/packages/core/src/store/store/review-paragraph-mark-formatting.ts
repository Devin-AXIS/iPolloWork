// A run formatting change and the same change on the paragraph mark it reaches are one review
// decision. So is the mark's change and the same change at the start of the next paragraph.
// Keep every site so that one accept or reject resolves the whole group.
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import {
  registerRevisionSiteNodeIds,
  revisionSiteNodeIdsOf,
  type ReviewRevisionItem,
} from './review-items.ts';
import { followingSiblingParagraphs } from './review-paragraph-breaks.ts';
import { runFormattingSignature } from './review-run-format-groups.ts';
import { isInertMarker } from './revision-marker-content.ts';
import type { RevisionSite } from './tree-op-revisions.ts';

const isBlock = (node: OoxmlNode): boolean =>
  node.kind === 'paragraph' || node.kind === 'table' || isWrapper(node);
const blocksOf = (node: OoxmlNode | undefined): readonly OoxmlNode[] =>
  !node || node.kind === 'textValue' ? [] : node.children.filter(isBlock);
const isWrapper = (node: OoxmlNode): boolean =>
  node.kind === 'generic' && ['sdt', 'customXml'].includes(node.localName);
/** The first row or cell, unless a content control or custom XML wraps the first one. */
const firstOfKind = (node: OoxmlNode | undefined, kind: OoxmlNode['kind']) => {
  if (!node || node.kind === 'textValue') return undefined;
  const first = node.children.find((c) => c.kind === kind || isWrapper(c));
  return first?.kind === kind ? first : undefined;
};
/** A cell's first block, when that block is a paragraph. */
function firstParagraphOf(cell: OoxmlNode | undefined): string | undefined {
  const first = blocksOf(cell)[0];
  return first?.kind === 'paragraph' ? first.id : undefined;
}

/**
 * Where a formatting change at a paragraph mark continues. The next sibling paragraph; the
 * first cell of a table that follows the paragraph; and from a cell's last paragraph, the next
 * cell of the same row. A row's last cell and a table's last row end the change.
 */
export function followingFormattingParagraphs(part: OoxmlPart): ReadonlyMap<string, string> {
  const known = followingByRoot.get(part.root);
  if (known) return known;
  const following = new Map(followingSiblingParagraphs(part));
  // Block containers only: paragraphs hold no blocks of this story.
  const visit = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || node.kind === 'paragraph' || depth > 64) return;
    if (node.kind === 'tableRow') {
      // Wrapped cells keep their own decisions rather than joining the wrong neighbour.
      const cells = node.children.some(isWrapper)
        ? []
        : node.children.filter((child) => child.kind === 'tableCell');
      cells.forEach((cell, index) => {
        const last = blocksOf(cell).at(-1);
        const target = firstParagraphOf(cells[index + 1]);
        if (last?.kind === 'paragraph' && target) following.set(last.id, target);
      });
    } else {
      // The table must follow the paragraph directly; only position markers may sit between.
      const siblings = node.children.filter(
        (child) => child.kind !== 'textValue' && !isInertMarker(child)
      );
      siblings.forEach((block, index) => {
        const next = siblings[index + 1];
        if (block.kind !== 'paragraph' || next?.kind !== 'table') return;
        const target = firstParagraphOf(firstOfKind(firstOfKind(next, 'tableRow'), 'tableCell'));
        if (target) following.set(block.id, target);
      });
    }
    for (const child of node.children) visit(child, depth + 1);
  };
  visit(part.root, 0);
  followingByRoot.set(part.root, following);
  return following;
}
const followingByRoot = new WeakMap<OoxmlNode, ReadonlyMap<string, string>>();

export function mergeParagraphMarkFormatting(
  items: readonly ReviewRevisionItem[],
  part: OoxmlPart,
  sites: readonly RevisionSite[],
  order: ReadonlyMap<string, number>
): readonly ReviewRevisionItem[] {
  // Most documents hold no formatting change on a paragraph mark: skip the signature pass.
  if (!sites.some((site) => site.paragraphMark && site.node.localName === 'rPrChange'))
    return items;
  const byId = new Map(sites.map((site) => [site.node.id, site]));
  // The delta, with the author: one change by one author, whatever the dates or ids. An
  // enclosing insertion or deletion does not separate the records.
  const signatureOf = (item: ReviewRevisionItem): { key: string; mark: boolean } | undefined => {
    if (item.readOnly || item.revisionKind !== 'format' || item.formattingKind !== 'rPrChange')
      return;
    const ids = revisionSiteNodeIdsOf(item);
    const owned = ids.map((id) => byId.get(id));
    if (!owned.length || owned.some((site) => !site)) return;
    const signatures = new Set(owned.map((site) => runFormattingSignature(site!, true)));
    const [signature] = signatures;
    if (signatures.size !== 1 || signature === undefined) return;
    if (item.ranges.some((range) => range.start.paragraphId !== range.end.paragraphId)) return;
    // A paragraph outside the story order, such as a text box's, keeps its own card.
    if (item.ranges.some((range) => !order.has(range.start.paragraphId))) return;
    const marks = owned.filter((site) => site!.paragraphMark).length;
    // A mark's card holds its mark alone; anything else is text.
    if (marks && (marks !== owned.length || item.ranges.length !== 1)) return;
    // NUL-separated: XML text cannot carry U+0000, so an author name cannot forge a boundary.
    return { key: `${item.author}\u0000${signature}`, mark: marks > 0 };
  };
  const eligible = items.map(signatureOf);
  if (!eligible.some((entry) => entry?.mark)) return items;
  const following = followingFormattingParagraphs(part);
  const parent = items.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }
    return index;
  };
  const starts = new Map<string, number[]>();
  const ends = new Map<string, number[]>();
  const at = (key: string, paragraph: string, offset: number) =>
    `${key}\u0000${paragraph}\u0000${offset}`;
  const add = (map: Map<string, number[]>, where: string, index: number): void => {
    const bucket = map.get(where);
    if (bucket) bucket.push(index);
    else map.set(where, [index]);
  };
  eligible.forEach((entry, index) => {
    if (!entry) return;
    for (const range of items[index]!.ranges) {
      add(starts, at(entry.key, range.start.paragraphId, range.start.offset), index);
      add(ends, at(entry.key, range.end.paragraphId, range.end.offset), index);
    }
  });
  const join = (index: number, others: readonly number[] | undefined): void => {
    for (const other of others ?? []) if (other !== index) parent[find(other)] = find(index);
  };
  eligible.forEach((entry, index) => {
    if (!entry?.mark) return;
    const range = items[index]!.ranges[0]!;
    // The mark sits at the paragraph end, so text ending there reaches it.
    join(index, ends.get(at(entry.key, range.start.paragraphId, range.start.offset)));
    const next = following.get(range.start.paragraphId);
    if (next !== undefined) join(index, starts.get(at(entry.key, next, 0)));
  });
  const groups = new Map<number, number[]>();
  items.forEach((_, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(index);
    else groups.set(root, [index]);
  });
  const rank = (item: ReviewRevisionItem): [number, number] => {
    const start = item.ranges[0]!.start;
    // A paragraph outside the story order, such as a text box paragraph, sorts last.
    return [order.get(start.paragraphId) ?? Number.MAX_SAFE_INTEGER, start.offset];
  };
  const merged = new Map<number, ReviewRevisionItem>();
  const consumed = new Set<number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const members = group
      .map((index) => items[index]!)
      .sort((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1]);
    const first = members[0]!;
    const addresses = [
      ...new Map(
        members
          .flatMap((item) => item.addresses)
          .map((address) => [
            JSON.stringify([address.id, address.author, address.date ?? null]),
            address,
          ])
      ).values(),
    ];
    // The card takes the place of its earliest member in the queue.
    const host = group.find((index) => items[index] === first)!;
    merged.set(
      host,
      registerRevisionSiteNodeIds(
        {
          ...first,
          addresses,
          ranges: members.flatMap((item) => item.ranges),
          text: members.map((item) => item.text).join(''),
        },
        members.flatMap(revisionSiteNodeIdsOf)
      )
    );
    for (const index of group) if (index !== host) consumed.add(index);
  }
  if (!merged.size) return items;
  return items.flatMap((item, index) => (consumed.has(index) ? [] : [merged.get(index) ?? item]));
}
