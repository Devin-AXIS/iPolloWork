// One-shot review derivation scope for exporter publication.

import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { commentAnchorsOfStoryTransient } from './comment-reads.ts';
import { collectReviewItemsWith, type ReviewDerivationDependencies } from './review-reads.ts';
import { locateSitesTransient } from './review-site-locations.ts';
import { collectRevisionSitesTransient } from './tree-op-revisions.ts';
import type { ReviewItem, ReviewModelInput } from './review-items.ts';

/** A bounded iterative walk that does not populate interactive subtree memos. */
function coldDeepParagraphOrderOfPart(part: OoxmlPart): ReadonlyMap<string, number> {
  const order = new Map<string, number>();
  const pending: Array<{ readonly node: OoxmlNode; readonly depth: number }> = [
    { node: part.root, depth: 0 },
  ];
  while (pending.length > 0) {
    const { node, depth } = pending.pop()!;
    if (node.kind === 'textValue' || depth > 64) continue;
    if (node.kind === 'paragraph' && !order.has(node.id)) order.set(node.id, order.size);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: node.children[index]!, depth: depth + 1 });
    }
  }
  return order;
}

/** One projection-scoped cold review derivation for exporter publication. @internal */
export function createExportReviewDerivationScope(): {
  readonly collectReviewItems: (input: ReviewModelInput) => ReviewItem[];
  readonly deepParagraphOrderOfPart: (part: OoxmlPart) => ReadonlyMap<string, number>;
} {
  const orders = new Map<OoxmlNode, ReadonlyMap<string, number>>();
  const deepOrder = (part: OoxmlPart): ReadonlyMap<string, number> => {
    const cached = orders.get(part.root);
    if (cached) return cached;
    const order = coldDeepParagraphOrderOfPart(part);
    orders.set(part.root, order);
    return order;
  };
  const dependencies: ReviewDerivationDependencies = {
    retainRevisionItems: false,
    revisionSites: collectRevisionSitesTransient,
    locations: locateSitesTransient,
    commentAnchors: commentAnchorsOfStoryTransient,
    deepOrder,
  };
  return Object.freeze({
    collectReviewItems: (input: ReviewModelInput) => collectReviewItemsWith(input, dependencies),
    deepParagraphOrderOfPart: deepOrder,
  });
}
