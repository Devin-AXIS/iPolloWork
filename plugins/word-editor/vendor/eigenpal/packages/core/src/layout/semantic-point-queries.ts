// Point queries over a laid-out document: the caret or the content control at a point.

import { contentControlAtPoint, hitTestPage } from './semantic-hit-test.ts';
import type { CaretGeometry } from './semantic-interaction.ts';
import type { ContentControlBoundaryRecord, SemanticLayout } from './semantic-records.ts';

/**
 * The caret position nearest a point, in PAGE-CONTENT coordinates.
 *
 * Never returns null for a point inside the document: a click in the margin, past the end of
 * a line, or below the last line still has an obvious intended caret, and refusing to answer
 * would make those clicks do nothing.
 *
 * The rules live in `semantic-hit-test.ts`, which answers with the cell address and the
 * on-glyphs flag a pointer controller needs too; this keeps the geometry-only shape for
 * callers that want nothing else.
 */
export function hitTestSemantic(
  layout: SemanticLayout,
  point: { readonly x: number; readonly y: number; readonly pageIndex?: number }
): CaretGeometry | null {
  // The point is PAGE-CONTENT relative, so it only means something on one page. Scoring it
  // against every page cost a full-document walk to answer with page 0 anyway: on uniform
  // geometry each page produces an identical score and the first one wins by construction.
  // Naming page 0 outright is the same answer, honestly, in constant time.
  const pageIndex =
    point.pageIndex !== undefined && layout.pages[point.pageIndex] ? point.pageIndex : 0;
  return hitTestPage(layout, pageIndex, point)?.caret ?? null;
}

/**
 * Innermost content-control boundary at a page-content point, or null outside every control.
 *
 * Prefers the deepest nesting depth when nested boundaries share geometry.
 */
export function contentControlAtSemantic(
  layout: SemanticLayout,
  point: { readonly x: number; readonly y: number; readonly pageIndex?: number }
): ContentControlBoundaryRecord | null {
  const pageIndex =
    point.pageIndex !== undefined && layout.pages[point.pageIndex] ? point.pageIndex : 0;
  return contentControlAtPoint(layout, pageIndex, point);
}
