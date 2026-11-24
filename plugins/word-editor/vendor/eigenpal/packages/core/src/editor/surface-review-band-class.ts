// The class a review band paints in: comment, custom node, or revision, faint until its card
// is the active one. Pure, so the surface and its tests share one rule.

import type { ReviewItem, ReviewRevisionKind } from '@docx-editor.dev/core/layout';

/** Separates a decision's key from its per-range index. A NUL cannot occur in either. */
export const RANGE_SUFFIX = '\u0000range\u0000';

/** The class a band draws in, or null when this range should not be drawn at all. */
export function bandClassFor(
  key: string,
  activeKeys: ReadonlySet<string>,
  byKey: ReadonlyMap<string, ReviewItem>
): string | null {
  // A revision's key is suffixed per range when one decision covers several sites, so the
  // active test compares the DECISION, not the site. Split on NUL, which an author name
  // cannot contain — `#` can, and an author called `A#b` never saw their band light up.
  const parts = key.split(RANGE_SUFFIX);
  const decision = parts[0]!;
  const isActive = activeKeys.has(decision);
  if (key.startsWith('comment-')) {
    const item = byKey.get(decision);
    const resolved = item?.kind === 'comment' && item.resolved;
    if (resolved && !isActive) return null;
    return isActive
      ? `docx-comment-band docx-comment-band--active${resolved ? ' docx-comment-band--resolved-active' : ''}`
      : 'docx-comment-band';
  }
  // A custom node's band only while its card is open: the chip tint already marks the
  // node persistently, and the comment band is the right weight for "this is the one".
  if (key.startsWith('custom-')) {
    return isActive ? 'docx-comment-band docx-comment-band--active' : null;
  }
  const item = byKey.get(decision);
  if (!item || item.kind !== 'revision') return null;
  // In the revision's OWN colour — green for text arriving, red for text leaving — so the
  // band never contradicts the decoration beneath it. A REPLACEMENT is one decision in two
  // colours: its leading ranges are the struck half, the rest is what took their place, and
  // painting the pair one neutral grey said "something changed here" about an edit whose
  // two halves the page is already colouring.
  const index = parts.length > 1 ? Number(parts[1]) : 0;
  const kindOf = (revisionKind: ReviewRevisionKind): 'delete' | 'insert' | 'other' => {
    if (revisionKind === 'delete' || revisionKind === 'moveFrom') return 'delete';
    if (revisionKind === 'insert' || revisionKind === 'moveTo') return 'insert';
    if (revisionKind === 'replace' && item.replacedRangeCount !== undefined) {
      return index < item.replacedRangeCount ? 'delete' : 'insert';
    }
    return 'other';
  };
  const kind = kindOf(item.revisionKind);
  // Every pending change carries a band, faint until it is the open one. A tracked page
  // with no tint at all made "which of these is selected" a question about a 1px margin
  // bar; a page where only the active one tints made the others look resolved.
  return `docx-revision-band docx-revision-band--${kind}${isActive ? ' docx-revision-band--active' : ''}`;
}
