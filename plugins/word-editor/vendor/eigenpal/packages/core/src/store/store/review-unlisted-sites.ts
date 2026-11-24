// The records a review queue leaves out, in the shape paint reads them.

import { revisionSiteNodeIdsOf, type ReviewItem } from './review-items.ts';

/**
 * Change-element node ids of the items left out, and for each paragraph an item touches, the
 * sorted site ids of every left-out item that touches it. An item can span paragraphs and is
 * left out only when all its sites are, so a paragraph's key can change while the paragraph
 * itself does not: the key says when its painted markup must be laid out again.
 */
export function unlistedSitesOf(items: readonly ReviewItem[]): {
  readonly sites: string[];
  readonly paragraphs: Map<string, string>;
  /**
   * Paragraphs an item touches that also touches another paragraph. A paragraph-property group
   * is not counted: a text-local edit leaves every member's properties as they were, so its
   * members stay left out together, and a patch of one member keeps that answer.
   */
  readonly spanning: string[];
} {
  const sites: string[] = [];
  const spanning: string[] = [];
  const byParagraph = new Map<string, string[]>();
  for (const item of items) {
    if (item.kind !== 'revision') continue;
    const own = revisionSiteNodeIdsOf(item);
    for (const id of own) sites.push(id);
    const touched = new Set(item.ranges.map((range) => range.start.paragraphId));
    const propertyGroup = item.revisionKind === 'format' && item.formattingKind === 'pPrChange';
    if (touched.size > 1 && !propertyGroup) for (const id of touched) spanning.push(id);
    for (const range of item.ranges) {
      const list = byParagraph.get(range.start.paragraphId) ?? [];
      for (const id of own) list.push(id);
      byParagraph.set(range.start.paragraphId, list);
    }
  }
  const paragraphs = new Map<string, string>();
  for (const [paragraphId, list] of byParagraph) {
    paragraphs.set(paragraphId, [...new Set(list)].sort().join('\u0000'));
  }
  return { sites, paragraphs, spanning };
}

/** The paragraphs `items` touch, for replacing their entries in a patched map. */
export function paragraphsTouchedBy(items: readonly ReviewItem[]): string[] {
  return items.flatMap((item) =>
    item.kind === 'revision' ? item.ranges.map((range) => range.start.paragraphId) : []
  );
}

const rootIds = new WeakMap<object, number>();
let nextRootId = 1;
const NO_ROOT = {};

function rootId(root: object | null): number {
  const key = root ?? NO_ROOT;
  let id = rootIds.get(key);
  if (id === undefined) {
    id = nextRootId++;
    rootIds.set(key, id);
  }
  return id;
}

/** A key that changes exactly when the styles or numbering root does. */
export function stylesAndNumberingKey(
  stylesRoot: object | null,
  numberingRoot: object | null
): string {
  return `${rootId(stylesRoot)}:${rootId(numberingRoot)}`;
}
