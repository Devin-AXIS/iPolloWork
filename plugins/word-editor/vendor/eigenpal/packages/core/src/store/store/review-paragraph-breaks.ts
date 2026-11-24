// Word reviews adjacent text and paragraph marks as one insertion/deletion, even when
// the file gives each site a separate revision id. Keep every site for atomic resolution.
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import {
  registerRevisionSiteNodeIds,
  revisionSiteNodeIdsOf,
  type ReviewRevisionItem,
  type ReviewRange,
} from './review-items.ts';
import { isInertMarker } from './revision-marker-content.ts';
import { keepsSubtreeMemo } from '../package/subtree-memo-policy.ts';

/** Entries only for nodes `keepsSubtreeMemo` admits; leaf-only nodes answer from children. */
const paragraphBelowCache = new WeakMap<OoxmlNode, boolean>();
/** Whether a paragraph sits strictly below `node`, as in a text box inside a paragraph. */
function holdsParagraphBelow(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  const cached = paragraphBelowCache.get(node);
  if (cached !== undefined) return cached;
  const result = node.children.some(
    (child) => child.kind === 'paragraph' || holdsParagraphBelow(child)
  );
  if (keepsSubtreeMemo(node)) paragraphBelowCache.set(node, result);
  return result;
}

/**
 * Each paragraph's next SIBLING paragraph. Deep document order alone would pair paragraphs
 * across table cells, text boxes, or intervening tables. Position markers between two
 * paragraphs, such as a bookmark end, do not separate them.
 */
export function followingSiblingParagraphs(part: OoxmlPart): ReadonlyMap<string, string> {
  // One walk per root: both the break merge and the property merge of a derivation ask.
  const known = followingByRoot.get(part.root);
  if (known) return known;
  const following = new Map<string, string>();
  const visit = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    let previous: string | null = null;
    for (const child of node.children) {
      if (child.kind === 'paragraph') {
        if (previous !== null) following.set(previous, child.id);
        previous = child.id;
      } else if (!isInertMarker(child)) previous = null;
      // A subtree with no paragraph below it adds no sibling pairs.
      if (holdsParagraphBelow(child)) visit(child, depth + 1);
    }
  };
  visit(part.root, 0);
  followingByRoot.set(part.root, following);
  return following;
}

const followingByRoot = new WeakMap<OoxmlNode, ReadonlyMap<string, string>>();

export function mergeParagraphBreakEdits(
  items: readonly ReviewRevisionItem[],
  part: OoxmlPart,
  order: ReadonlyMap<string, number>,
  previewByNode: ReadonlyMap<string, { readonly range: ReviewRange; readonly text: string }>,
  /** The container an item sits in; a join across a mark stays inside one. */
  containerOf: (item: ReviewRevisionItem) => string = () => '',
  /** Move destinations with no source, which join as insertions, mark and text alike. */
  sourceless: ReadonlySet<string> = new Set()
): readonly ReviewRevisionItem[] {
  if (!items.some((item) => item.revisionKind === 'paragraphMark')) return items;
  // Only sibling paragraphs share a break.
  const following = followingSiblingParagraphs(part);
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
  // NUL-separated: XML text cannot carry U+0000, so a file's author name cannot forge a boundary.
  const moved = (item: ReviewRevisionItem): boolean =>
    sourceless.size > 0 && revisionSiteNodeIdsOf(item).every((id) => sourceless.has(id));
  const direction = (item: ReviewRevisionItem) =>
    moved(item)
      ? 'insert'
      : item.revisionKind === 'paragraphMark'
        ? item.markDirection
        : item.revisionKind;
  const key = (item: ReviewRevisionItem, paragraph: string, offset: number): string =>
    `${direction(item)}\u0000${item.author}\u0000${item.nesting}\u0000${paragraph}\u0000${offset}\u0000${containerOf(item)}`;
  const add = (map: Map<string, number[]>, at: string, index: number): void => {
    const bucket = map.get(at);
    if (bucket) bucket.push(index);
    else map.set(at, [index]);
  };
  items.forEach((item, index) => {
    if (
      item.readOnly ||
      (!['insert', 'delete', 'paragraphMark'].includes(item.revisionKind) && !moved(item))
    )
      return;
    for (const range of item.ranges) {
      add(starts, key(item, range.start.paragraphId, range.start.offset), index);
      add(ends, key(item, range.end.paragraphId, range.end.offset), index);
    }
  });
  // Dates do not separate the edits: text, the mark, and the next paragraph's leading edit by
  // one author are one decision even when the file stamps them months apart, as inline
  // adjacency already treats them.
  const join = (index: number, others: readonly number[]): void => {
    for (const other of others) parent[find(other)] = find(index);
  };
  items.forEach((item, index) => {
    if (
      item.readOnly ||
      item.revisionKind !== 'paragraphMark' ||
      !['insert', 'delete'].includes(direction(item) ?? '')
    )
      return;
    for (const range of item.ranges) {
      join(index, ends.get(key(item, range.start.paragraphId, range.start.offset)) ?? []);
      const next = following.get(range.end.paragraphId);
      if (next) join(index, starts.get(key(item, next, 0)) ?? []);
    }
  });
  const groups = new Map<number, ReviewRevisionItem[]>();
  items.forEach((item, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(item);
    else groups.set(root, [item]);
  });
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]!;
    const ranges = group
      .flatMap((item) => item.ranges)
      .sort(
        (a, b) =>
          order.get(a.start.paragraphId)! - order.get(b.start.paragraphId)! ||
          a.start.offset - b.start.offset
      );
    const preview = group
      .flatMap((item) => revisionSiteNodeIdsOf(item))
      .flatMap((id) => {
        const segment = previewByNode.get(id);
        return segment ? [segment] : [];
      })
      .sort(
        (a, b) =>
          order.get(a.range.start.paragraphId)! - order.get(b.range.start.paragraphId)! ||
          a.range.start.offset - b.range.start.offset
      );
    const first = group[0]!;
    const content = group.find((item) => item.revisionKind !== 'paragraphMark');
    const addresses = [
      ...new Map(
        group.flatMap((item) => item.addresses).map((address) => [JSON.stringify(address), address])
      ).values(),
    ];
    return registerRevisionSiteNodeIds(
      {
        ...first,
        id: group.map((item) => item.id).join('+'),
        revisionKind: content?.revisionKind ?? 'paragraphMark',
        ...(content ? { markDirection: undefined } : {}),
        addresses,
        ranges,
        text: content ? preview.map((segment) => segment.text).join('') : '',
      },
      group.flatMap((item) => revisionSiteNodeIdsOf(item))
    );
  });
}
