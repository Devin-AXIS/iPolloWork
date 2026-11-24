// Find results inside text boxes the layout does not show.
//
// The search walk reads the tree and cannot resolve everything that hides a drawing, such as
// a character style with `w:vanish`. Layout is the authority: a text-box match counts only
// when its drawing has a laid-out record that selecting the match can reveal.

import type { HighlightRange } from '../contracts/editor-highlights.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { drawingSelectionPosition } from './surface-drawing-selection.ts';

/** Drop text-box matches whose drawing is not laid out; other matches pass unchanged. */
export function withoutUnplacedFrameMatches<T extends HighlightRange>(
  surface: PaginatedSurface,
  matches: readonly T[]
): readonly T[] {
  if (!matches.some((match) => match.scope?.kind === 'frame')) return matches;
  // The published layout: Find must never force a layout pass. While it lags the document,
  // frame matches stay, and selecting one still checks the current layout.
  const layout = surface.publishedLayout();
  if (layout.revision !== surface.session.packageRevision()) return matches;
  const placed = new Map<string, boolean>();
  return matches.filter((match) => {
    const scope = match.scope;
    if (scope?.kind !== 'frame') return true;
    const key = `${scope.drawingNodeId}\0${scope.hostParagraphId}`;
    let found = placed.get(key);
    if (found === undefined) {
      found = !!drawingSelectionPosition(layout, scope.drawingNodeId, scope.hostParagraphId);
      placed.set(key, found);
    }
    return found;
  });
}
