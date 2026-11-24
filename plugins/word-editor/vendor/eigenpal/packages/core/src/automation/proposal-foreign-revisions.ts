// Tracked edits beside or inside another author's pending TEXT revision.
//
// The store already writes these as nested revisions: a strike over another author's
// inserted words becomes a deletion inside their insertion, and new words go beside struck
// text, never into it. Each author's decision stays separate, so accepting or rejecting one
// leaves the other pending. Structural, paragraph mark, formatting, and move revisions keep
// refusing, and so does a strike that would cover nothing but already struck text.
import { findNode } from '../store/package/ooxml-edit.ts';
import { isInlineRunContainer } from '../store/package/ooxml-shared.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { insertionAuthor } from '../store/store/tree-op-retraction.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import type { ReviewRevisionItem } from '../store/store/review-items.ts';
import { trackedInsertionLanding } from '../store/store/tree-op-tracked-adjacency.ts';
import type { AutomationStoryReads } from './reads.ts';

interface Span {
  readonly start: number;
  readonly end: number;
}

/** The item's ranges clipped to one paragraph, each flagged when it is struck text. */
function rangesIn(
  story: AutomationStoryReads,
  item: ReviewRevisionItem,
  paragraphId: string
): (Span & { readonly struck: boolean })[] {
  const index = story.indexOf(paragraphId);
  const out: (Span & { readonly struck: boolean })[] = [];
  item.ranges.forEach((range, position) => {
    const first = story.indexOf(range.start.paragraphId);
    const last = story.indexOf(range.end.paragraphId);
    if (first < 0 || last < 0 || index < first || index > last) return;
    const struck =
      item.revisionKind === 'delete' ||
      item.revisionKind === 'moveFrom' ||
      (item.revisionKind === 'replace' && position < (item.replacedRangeCount ?? Infinity));
    out.push({
      start: index === first ? range.start.offset : 0,
      end: index === last ? range.end.offset : Infinity,
      struck,
    });
  });
  return out;
}

/** True when part of `[start, end)` is not struck by any pending revision. */
function coversLiveText(
  story: AutomationStoryReads,
  items: readonly ReviewRevisionItem[],
  paragraphId: string,
  start: number,
  end: number
): boolean {
  const struck = items
    .flatMap((item) => rangesIn(story, item, paragraphId).filter((range) => range.struck))
    .sort((a, b) => a.start - b.start);
  let cursor = start;
  for (const range of struck) {
    if (range.start > cursor) break;
    cursor = Math.max(cursor, range.end);
    if (cursor >= end) return false;
  }
  return cursor < end;
}

/** Why a tracked edit cannot touch another author's pending text revision. */
export type ForeignTextRefusal = 'deleted-text-only';

/**
 * Why a tracked edit of `[start, end)` cannot touch or overlap `item`, which belongs to
 * another author, or null when it can.
 *
 * Their inserted text, including the inserted half of a replacement, admits any edit. Their
 * struck text admits an insertion inside or at its edge, which the store places after or
 * beside the deletion, and a strike that also covers live text or the paragraph mark. The
 * same rules hold in a collaboration session: shared text keeps each revision apart, so a
 * peer's concurrent decision on their revision reaches all of it and only it.
 */
export function foreignTextRefusal(
  story: AutomationStoryReads,
  items: readonly ReviewRevisionItem[],
  item: ReviewRevisionItem,
  paragraphId: string,
  start: number,
  end: number,
  options: { readonly strikesMark?: boolean } = {}
): ForeignTextRefusal | null {
  const ranges = rangesIn(story, item, paragraphId);
  if (item.revisionKind === 'insert') return null;
  const struckContact = ranges.some(
    (range) => range.struck && start <= range.end && end >= range.start
  );
  // A range that also strikes this paragraph's mark changes more than the deleted text.
  if (!struckContact || start === end || options.strikesMark) return null;
  return coversLiveText(story, items, paragraphId, start, end) ? null : 'deleted-text-only';
}

/**
 * Where tracked words aimed at `aim` land, from the store's own placement rule.
 *
 * `struck` is the range the same transaction strikes, or null for an insertion that strikes
 * nothing. An insertion moves only out of a deletion that strictly contains its aim. A
 * replacement also lands after a deletion its strike joins.
 */
export function trackedLandingOffset(
  story: AutomationStoryReads,
  paragraphId: string,
  struck: Span | null,
  aim: number,
  revision: { readonly author: string; readonly date: string }
): number {
  const paragraph = findNode(story.part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return aim;
  const { past, landing } = trackedInsertionLanding(
    paragraph,
    struck ?? { start: aim, end: aim },
    aim,
    revision.author,
    revision.date
  );
  return struck && struck.end > struck.start ? landing : past;
}

/**
 * Whether tracked words aimed at `landing` would land inside a link, a content control, or
 * another container that sits inside another author's pending insertion.
 *
 * The store splits another author's insertion around new words that land directly in it, so
 * each stays a separate decision. A container inside it cannot split, and the new words would
 * become part of the other author's proposal, so such an edit refuses.
 */
export function landsInForeignInsertionContainer(
  story: AutomationStoryReads,
  paragraphId: string,
  landing: number,
  author: string
): boolean {
  const paragraph = findNode(story.part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return false;
  const offsets = paragraphOffsetIndex(paragraph);
  let foreign = false;
  let nodes: readonly OoxmlNode[] = paragraph.children;
  for (let depth = 0; depth < 64; depth++) {
    const inside = nodes.find((node) => {
      if (node.kind === 'textValue' || node.kind === 'run') return false;
      const span = offsets.spanOf(node);
      return span !== null && span.start < landing && landing < span.end;
    });
    if (!inside || inside.kind === 'textValue') return false;
    const descends =
      (isInlineRunContainer(inside) &&
        inside.kind !== 'revisionDelete' &&
        inside.kind !== 'revisionMoveFrom') ||
      inside.kind === 'contentControl' ||
      inside.kind === 'contentControlContent';
    if (!descends) return false;
    if (foreign && inside.kind !== 'contentControlContent') return true;
    if (inside.kind === 'revisionInsert' && (insertionAuthor([inside]) ?? author) !== author)
      foreign = true;
    nodes = inside.children;
  }
  return false;
}
