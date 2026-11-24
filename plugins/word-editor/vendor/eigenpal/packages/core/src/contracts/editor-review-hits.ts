import type { HighlightRect } from './editor-highlights.ts';
import type { ReviewItemPlacement, ReviewItemQuery } from './editor.ts';

/** One review item under a client point. @public */
export interface ReviewItemHit {
  /** The item, as `getReviewItems()` with the same query returns it. */
  readonly placement: ReviewItemPlacement;
  /**
   * The item's painted band on the line under the point, in client coordinates. It covers the
   * part of the item's range on that line, not the whole range. Anchor popovers to it.
   */
  readonly rect: HighlightRect;
}

/** Hit testing for hosts that draw their own review chrome. @public */
export interface EditorReviewHits {
  /**
   * The review items whose text is under a client point, innermost first.
   *
   * An item hits when the CHARACTER under the point is inside one of its ranges, so the
   * right half of a range's last character still hits, and the left half of the next
   * character does not. Ranges that cover no characters, such as a tracked paragraph mark or
   * a comment on an empty range, never hit. Items without a range never hit.
   *
   * The test covers every story the review queue lists and the pages paint: the body,
   * tables, headers, footers, footnotes, and endnotes. Only painted pages are tested, so a
   * point over a page that is not built returns no items.
   *
   * The result reports every item whose range covers the character, including replies,
   * which share their thread's range, and resolved comments. Filter on
   * `placement.parentId`, `placement.parentRevisionId`, or `placement.resolved` to find the
   * card that owns the hit. Order follows the review queue's own rule for the caret: the
   * narrowest range first, then comments before custom nodes before revisions, then the
   * most deeply nested revision.
   *
   * A point hits the glyph band of a line, the same band a text highlight marks. A point in
   * the spacing between lines hits nothing. `query` filters the items the same way it
   * filters `getReviewItems()`. Coordinates that are not finite numbers return an empty
   * array. Each call reads the whole review queue, so call it from a click, not on every
   * pointer move.
   *
   * @example
   * ```ts
   * pages.addEventListener('click', (event) => {
   *   const [hit] = editor.getReviewItemsAt(event.clientX, event.clientY);
   *   if (hit) showBalloon(hit.placement.key, hit.rect);
   * });
   * ```
   * @public
   */
  getReviewItemsAt(
    clientX: number,
    clientY: number,
    query?: ReviewItemQuery
  ): readonly ReviewItemHit[];
  /**
   * The bands one review item paints, one per line part, in client coordinates.
   *
   * `key` is a `ReviewItemPlacement.key`. Bands follow page order, and within a page the
   * body comes before headers, footers, and notes. Only painted pages contribute. An unknown
   * key, an item without a range, or an item with no text on a painted page returns an
   * empty array. Anchor a balloon to the first band, or join the bands for an outline.
   *
   * @example
   * ```ts
   * const [first] = editor.getReviewItemRects(placement.key);
   * if (first) positionBalloon(first);
   * ```
   * @public
   */
  getReviewItemRects(key: string): readonly HighlightRect[];
}
