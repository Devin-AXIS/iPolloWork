import { carryPageOrder } from './document-order.ts';
import { carryBodyReviewAnchors } from './body-review-anchors.ts';
import { carryLayoutReadCaches } from './layout-read-caches.ts';
import { fragmentParagraphs, lineSegments } from './line-segments.ts';
import { carryPageParagraphNames } from './paragraph-lines.ts';
import { carryPageTableContributions } from './table-caret-context.ts';
import type { HeaderFooterStoryRecord, SemanticLayout } from './semantic-records.ts';

// Keep membership bits only, never the story's geometry. Tables require a separate proof.
const storyMembership = new WeakMap<HeaderFooterStoryRecord, ReadonlyMap<string, number> | null>();
const empty = new Map<string, number>();

function membership(
  story: HeaderFooterStoryRecord | undefined
): ReadonlyMap<string, number> | null {
  if (!story) return empty;
  const known = storyMembership.get(story);
  if (known !== undefined) return known;
  const members = new Map<string, number>();
  const add = (id: string, bit: number) => members.set(id, (members.get(id) ?? 0) | bit);
  for (const block of story.fragments) {
    if (block.kind !== 'paragraph') {
      storyMembership.set(story, null);
      return null;
    }
    add(block.paragraphId, 1);
    for (const id of fragmentParagraphs(block)) add(id, 2);
    for (const line of block.lines) {
      add(line.range.paragraphId, 4);
      for (const span of line.spans) add(span.range.paragraphId, 4);
      for (const drawing of line.drawings ?? []) add(drawing.paragraphId, 4);
      for (const segment of lineSegments(line)) add(segment.paragraphId, 8);
    }
  }
  storyMembership.set(story, members);
  return members;
}

function sameMembership(
  a: HeaderFooterStoryRecord | undefined,
  b: HeaderFooterStoryRecord | undefined
): boolean {
  if (a === b) return true;
  const before = membership(a);
  const after = membership(b);
  if (!before || !after || before.size !== after.size) return false;
  for (const [id, bits] of before) if (after.get(id) !== bits) return false;
  return true;
}

/** Preserve geometry-free reads when only header/footer projection changes. */
export function carryFurnitureReadCaches(previous: SemanticLayout, next: SemanticLayout): void {
  if (previous.pages.length !== next.pages.length) return;
  let all = true;
  for (const [index, page] of next.pages.entries()) {
    const before = previous.pages[index]!;
    if (before === page) continue;
    if (
      before.index !== page.index ||
      before.fragments !== page.fragments ||
      before.footnotes !== page.footnotes ||
      before.endnotes !== page.endnotes ||
      before.contentBox !== page.contentBox
    ) {
      all = false;
      continue;
    }
    carryBodyReviewAnchors(before, page);
    carryPageOrder(before, page);
    if (
      !sameMembership(before.header, page.header) ||
      !sameMembership(before.footer, page.footer)
    ) {
      all = false;
      continue;
    }
    carryPageParagraphNames(before, page);
    carryPageTableContributions(before, page);
  }
  if (all) carryLayoutReadCaches(previous, next);
}
