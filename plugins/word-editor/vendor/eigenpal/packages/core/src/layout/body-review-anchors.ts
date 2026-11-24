import { paragraphFragmentsOf } from './semantic-records.ts';
import type { PageRecord } from './semantic-records.ts';
import { reviewAnchorIndex, type ReviewParagraphAnchor } from './review-support.ts';

// Tokens retain neither prior pages nor the geometry used to create their anchors.
const identities = new WeakMap<PageRecord, object>();
const anchors = new WeakMap<object, ReadonlyMap<string, ReviewParagraphAnchor>>();

function identity(page: PageRecord): object {
  let key = identities.get(page);
  if (!key) identities.set(page, (key = {}));
  return key;
}

/** Caller proves unchanged body paragraph ranges, order, and vertical geometry. */
export function carryBodyReviewAnchors(before: PageRecord, after: PageRecord): void {
  if (before.index === after.index && before.contentBox.y === after.contentBox.y)
    identities.set(after, identity(before));
}

/** Body projection only: arbitrary reviewAnchorIndex projections keep their own caches. */
export function bodyReviewAnchors(page: PageRecord): ReadonlyMap<string, ReviewParagraphAnchor> {
  const key = identity(page);
  const known = anchors.get(key);
  if (known) return known;
  const result = new Map<string, ReviewParagraphAnchor>();
  for (const [id, anchor] of reviewAnchorIndex({ pages: [page] }, paragraphFragmentsOf)) {
    result.set(id, {
      pageIndex: anchor.pageIndex,
      contentY: anchor.contentY,
      fragmentY: anchor.fragmentY,
      ...(anchor.lines
        ? {
            lines: anchor.lines.map((line) => ({
              range: { end: line.range.end },
              box: { y: line.box.y },
              // When every span belongs to this paragraph, anchorLineY uses range.end.
              // Mixed paragraphs retain their individual extents, including empty arrays.
              ...(line.spans?.some((span) => span.range.paragraphId !== id)
                ? {
                    spans: line.spans.map((span) => ({
                      range: { paragraphId: span.range.paragraphId, end: span.range.end },
                    })),
                  }
                : {}),
            })),
          }
        : {}),
    });
  }
  anchors.set(key, result);
  return result;
}
