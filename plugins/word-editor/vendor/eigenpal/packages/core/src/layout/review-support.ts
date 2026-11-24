// The layout lane's half of the review model: GEOMETRY over layout records — where a card
// sits beside the page, which is the one question the tree cannot answer.
//
// The split is deliberate (pro-review-and-custom-nodes): deriving the queue from a document —
// walking revisions, stitching comment anchors, threading replies — is the pro review module's
// implementation and lives in `@docx-editor.dev/pro`. The review-item VOCABULARY — the typed
// item shapes, stable keys and position resolution — lives in the store lane
// (`store/store/review-items.ts`), where the binding lane can reach it too; this module
// re-exports it so `@docx-editor.dev/core/layout` keeps publishing the whole review surface,
// and adds only what needs layout records: anchor indexes and card geometry.

export {
  activeReviewItem,
  firstReviewRange,
  reviewItemKey,
  reviewItemPositionRank,
  reviewItemRanges,
  reviewItemsAt,
  reviewThreadRootOf,
  type ReviewCommentItem,
  type ReviewCustomItem,
  type ReviewItem,
  type ReviewModelInput,
  type ReviewPosition,
  type ReviewRange,
  type ReviewRevisionItem,
  type ReviewRevisionKind,
} from '../store/store/review-items.ts';

// ── Comment vocabulary (authored in `word/comments.xml` and its siblings) ──────

export {
  W15_NAMESPACE_URI,
  type CommentAnchor,
  type CommentPosition,
  type CommentRecord,
  type CommentThreadState,
} from '../store/store/comment-reads.ts';

/**
 * Re-exported rather than reimplemented: "which comment answers which tracked change" is a
 * RULE, and two copies of it drift into a reply that the queue nests and the session's local
 * patch does not. The same goes for the comment presentation helpers and the memoized
 * paragraph order, which shares nothing when copied.
 */
export {
  commentBodyText,
  commentInitials,
  linkRevisionReplies,
  paragraphOrderOfPart,
  type LinkableReviewItem,
} from '@docx-editor.dev/core/store';

import { firstReviewRange, type ReviewItem } from '../store/store/review-items.ts';

// ── Geometry over layout records ───────────────────────────────────────────────

/** Where one paragraph sits, resolved once so a card is an O(1) lookup. */
export interface ReviewParagraphAnchor {
  readonly pageIndex: number;
  /** Sheet-absolute y of the page's content box. */
  readonly contentY: number;
  /** The fragment's own y, measured from that content box. */
  readonly fragmentY: number;
  readonly lines?: readonly {
    readonly range: { readonly end: number };
    readonly box: { readonly y: number };
    /**
     * Present on a real line. A merged fragment's join line carries spans from two
     * paragraphs, and its `range` can only name one of them, so the OTHER paragraph's extent
     * on that line is readable here and nowhere else.
     */
    readonly spans?: readonly {
      readonly range: { readonly paragraphId: string; readonly end: number };
    }[];
  }[];
}

/**
 * The y of the line a position sits on, measured from the anchor's own origin.
 *
 * An ordinary line answers from its own range, exactly as it always did. On a merged
 * fragment's join line the range names one of the two paragraphs, so an offset compared
 * against it either overshot — putting a card in the absorbed half beside the wrong line —
 * or matched the first line every time.
 */
export function anchorLineY(
  anchor: ReviewParagraphAnchor,
  paragraphId: string,
  offset: number
): number {
  for (const entry of anchor.lines ?? []) {
    const spans = entry.spans;
    if (!spans) {
      if (offset < entry.range.end) return entry.box.y;
      continue;
    }
    // Counted, not filtered: every card asks this of every line above its own.
    let owned = 0;
    let lastOwnedEnd = 0;
    for (const span of spans) {
      if (span.range.paragraphId !== paragraphId) continue;
      owned += 1;
      lastOwnedEnd = span.range.end;
    }
    if (owned === spans.length ? offset < entry.range.end : owned > 0 && offset < lastOwnedEnd)
      return entry.box.y;
  }
  return anchor.fragmentY;
}

/**
 * Paragraph id to its place on the page, in ONE pass over the layout.
 *
 * Built once per layout and reused by every card. The straightforward version — scan the
 * pages until the paragraph turns up, per card — is a full-document walk per card, and a
 * contract with two hundred comments walked the document two hundred times every time the
 * caret moved. Toggling the pane was visibly slow for exactly that reason.
 */
export function reviewAnchorIndex<
  TPage extends { readonly index: number; readonly contentBox: { readonly y: number } },
>(
  layout: { readonly pages: readonly TPage[] },
  paragraphFragments: (page: TPage) => readonly {
    readonly paragraphId: string;
    readonly box: { readonly y: number };
    readonly lines?: readonly {
      readonly range: { readonly end: number };
      readonly box: { readonly y: number };
      /** Present on a real line; a merged one carries spans from more than one paragraph. */
      readonly spans?: readonly {
        readonly range: { readonly paragraphId: string; readonly end: number };
      }[];
    }[];
  }[]
): Map<string, ReviewParagraphAnchor> {
  const index = new Map<string, ReviewParagraphAnchor>();
  for (const page of layout.pages) {
    for (const [paragraphId, anchor] of pageAnchors(page, paragraphFragments)) {
      // FIRST page wins, for the same reason the first fragment does below.
      if (index.has(paragraphId)) continue;
      index.set(paragraphId, anchor);
    }
  }
  return index;
}

/**
 * One page's anchors, remembered on the PAGE record.
 *
 * The rail re-derives its geometry on every commit, and an untouched page comes back from
 * incremental layout as the same object — so a keystroke walks the fragments of the page it
 * landed on, not of the whole document.
 *
 * Keyed on the PROJECTION as well as the page: a caller reading a different set of fragments
 * off the same page must not be handed the other caller's answer. A caller that builds its
 * projection inline gets a fresh cache each call, which is a miss, never a stale read.
 */
const pageAnchorCache = new WeakMap<
  object,
  WeakMap<object, ReadonlyMap<string, ReviewParagraphAnchor>>
>();

function pageAnchors<
  TPage extends { readonly index: number; readonly contentBox: { readonly y: number } },
>(
  page: TPage,
  paragraphFragments: (page: TPage) => readonly {
    readonly paragraphId: string;
    readonly box: { readonly y: number };
    readonly lines?: readonly {
      readonly range: { readonly end: number };
      readonly box: { readonly y: number };
      readonly spans?: readonly {
        readonly range: { readonly paragraphId: string; readonly end: number };
      }[];
    }[];
  }[]
): ReadonlyMap<string, ReviewParagraphAnchor> {
  let byPage = pageAnchorCache.get(paragraphFragments);
  if (!byPage) {
    byPage = new WeakMap();
    pageAnchorCache.set(paragraphFragments, byPage);
  }
  const cached = byPage.get(page);
  if (cached) return cached;
  const anchors = new Map<string, ReviewParagraphAnchor>();
  for (const fragment of paragraphFragments(page)) {
    // Every paragraph whose content this fragment HOLDS. A resolved view lays a merged
    // group out as one fragment named after the survivor, and a card anchored in any other
    // member would have no geometry and drop out of the rail.
    const held = new Set<string>([fragment.paragraphId]);
    for (const line of fragment.lines ?? []) {
      for (const span of line.spans ?? []) held.add(span.range.paragraphId);
    }
    for (const paragraphId of held) {
      // FIRST fragment wins: a paragraph split across a page break is anchored where it
      // starts, which is where its comment marker was written.
      if (anchors.has(paragraphId)) continue;
      anchors.set(paragraphId, {
        pageIndex: page.index,
        contentY: page.contentBox.y,
        fragmentY: fragment.box.y,
        ...(fragment.lines ? { lines: fragment.lines } : {}),
      });
    }
  }
  byPage.set(page, anchors);
  return anchors;
}

/**
 * Where a card belongs beside the page, from LAYOUT RECORDS.
 *
 * The one question the tree cannot answer, and the one a surface must not answer for itself:
 * measuring painted DOM puts the sidebar a repaint behind the document and breaks outright
 * while pagination is in flight.
 *
 * Returns null when the item has no resolvable range, or when its paragraph is not in this
 * layout — a comment anchored in a header belongs to a story the body layout never saw.
 */
export function reviewItemGeometry(
  item: ReviewItem,
  index: ReadonlyMap<string, ReviewParagraphAnchor>
): { readonly pageIndex: number; readonly y: number } | null {
  const range = firstReviewRange(item);
  if (!range) return null;
  const anchor = index.get(range.start.paragraphId);
  if (!anchor) return null;
  // An untouched page hands back the same anchor, so its cards keep their geometry.
  const cached = geometries.get(item);
  if (cached?.anchor === anchor) return cached.geometry;
  // TWO coordinate spaces meet here. A fragment's box is relative to the page CONTENT box;
  // a page's content box is absolute in the sheet stack. Using the fragment's own y alone
  // put every card from page two onwards at the top of the rail, all of them claiming to
  // annotate the first inch of the document.
  //
  // The LINE the range starts on, not the paragraph's top: a comment on the last line of a
  // twelve-line paragraph belongs beside that line, which is where Word puts it.
  const geometry = {
    pageIndex: anchor.pageIndex,
    y: anchor.contentY + anchorLineY(anchor, range.start.paragraphId, range.start.offset),
  };
  geometries.set(item, { anchor, geometry });
  return geometry;
}

const geometries = new WeakMap<
  ReviewItem,
  {
    readonly anchor: ReviewParagraphAnchor;
    readonly geometry: { readonly pageIndex: number; readonly y: number };
  }
>();
