// One paragraph-property decision across consecutive paragraphs that changed the same way.
//
// Applying one paragraph format to a run of paragraphs leaves a `w:pPrChange` in each of them,
// often under separate ids and dates. When neighbouring paragraphs record the same author, the
// same earlier properties and the same new properties, they are one decision to the reviewer.
// A different author, a different value on either side, or any block between them keeps them
// apart. Every site stays in the item, so the decision still resolves all of them.
import { canonicalOoxmlFingerprint } from '../package/ooxml-serialize.ts';
import { stableHash } from '../comparators/canonical.ts';
import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import {
  registerRevisionSiteNodeIds,
  revisionSiteNodeIdsOf,
  type ReviewRevisionItem,
} from './review-items.ts';
import { followingFormattingParagraphs } from './review-paragraph-mark-formatting.ts';
import type { RevisionSite } from './tree-op-revisions.ts';

/** Paragraph-property children that are not paragraph properties of the change itself. */
const NOT_COMPARED = new Set(['pPrChange', 'rPr', 'sectPr']);

function propertiesFingerprint(properties: OoxmlNode | undefined): string {
  if (!properties || properties.kind === 'textValue') return '';
  const out: string[] = [];
  for (const child of properties.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      NOT_COMPARED.has(child.localName)
    ) {
      continue;
    }
    out.push(canonicalOoxmlFingerprint(child));
  }
  return out.join('\u0000');
}

/** What the change does: its new properties and the earlier ones it recorded. */
function changeSignature(site: RevisionSite): string | null {
  if (!site.parent) return null;
  const recorded = site.node.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'pPr'
  );
  return `${propertiesFingerprint(site.parent)}\u0000${propertiesFingerprint(recorded)}`;
}

export function mergeConsecutiveParagraphPropertyChanges(
  items: readonly ReviewRevisionItem[],
  part: OoxmlPart,
  sites: readonly RevisionSite[],
  order: ReadonlyMap<string, number>
): readonly ReviewRevisionItem[] {
  const isCandidate = (item: ReviewRevisionItem): boolean =>
    item.revisionKind === 'format' &&
    item.formattingKind === 'pPrChange' &&
    !item.readOnly &&
    item.ranges.length > 0 &&
    item.ranges.every((range) => range.start.paragraphId === item.ranges[0]!.start.paragraphId);
  if (items.filter(isCandidate).length < 2) return items;

  const siteById = new Map(sites.map((site) => [site.node.id, site]));
  // One signature per candidate; an item whose sites disagree is left alone.
  const byParagraph = new Map<string, { index: number; key: string }>();
  items.forEach((item, index) => {
    if (!isCandidate(item)) return;
    const signatures = new Set<string | null>();
    for (const id of revisionSiteNodeIdsOf(item)) {
      const site = siteById.get(id);
      signatures.add(site ? changeSignature(site) : null);
    }
    const [signature] = signatures;
    if (signatures.size !== 1 || signature === null || signature === undefined) return;
    const paragraphId = item.ranges[0]!.start.paragraphId;
    // NUL-separated: XML text cannot carry U+0000, so an author name cannot forge a boundary.
    const key = `${item.author}\u0000${item.nesting}\u0000${signature}`;
    // Two candidates in one paragraph (different ids or dates) are not a chain; keep both.
    if (byParagraph.has(paragraphId)) byParagraph.set(paragraphId, { index: -1, key: '' });
    else byParagraph.set(paragraphId, { index, key });
  });

  // Where a paragraph property change continues: as a paragraph mark formatting change does.
  const following = followingFormattingParagraphs(part);
  const parent = items.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }
    return index;
  };
  let joined = false;
  for (const [paragraphId, entry] of byParagraph) {
    if (entry.index < 0) continue;
    const nextId = following.get(paragraphId);
    const next = nextId === undefined ? undefined : byParagraph.get(nextId);
    if (!next || next.index < 0 || next.key !== entry.key) continue;
    parent[find(next.index)] = find(entry.index);
    joined = true;
  }
  if (!joined) return items;

  const groups = new Map<number, ReviewRevisionItem[]>();
  const result: (ReviewRevisionItem | number)[] = [];
  items.forEach((item, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) {
      group.push(item);
      return;
    }
    groups.set(root, [item]);
    result.push(root);
  });
  return result.map((entry) => {
    const group = groups.get(entry as number)!;
    if (group.length === 1) return group[0]!;
    const rank = (item: ReviewRevisionItem) => order.get(item.ranges[0]!.start.paragraphId) ?? 0;
    group.sort((a, b) => rank(a) - rank(b));
    const first = group[0]!;
    const addresses = [
      ...new Map(
        group.flatMap((item) => item.addresses).map((address) => [JSON.stringify(address), address])
      ).values(),
    ];
    return registerRevisionSiteNodeIds(
      {
        ...first,
        // The first member and a digest of every member: short however many paragraphs the
        // change covers, and different for any other set of members.
        id: `${first.id}+${stableHash(group.map((item) => item.id))}`,
        addresses,
        // Nesting is part of the chain key, so every member shares the first one's.
        ranges: group.flatMap((item) => item.ranges),
      },
      group.flatMap((item) => revisionSiteNodeIdsOf(item))
    );
  });
}
