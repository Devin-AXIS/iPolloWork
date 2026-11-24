// Body text-box drawings on one laid-out page, anchored or inline.
//
// Both kinds carry their story at `drawing + story.contentOffset` in page-content
// coordinates: an anchored record is placed there, and an inline record's extent is placed
// there by the line that holds it, including a line in a table cell.

import type { AnchoredDrawingRecord, InlineDrawingRecord } from './drawing-layout.ts';
import type { PageRecord } from './semantic-records.ts';
import { paragraphFragmentsOfBlocks } from './semantic-record-queries.ts';

/** A drawing that carries a laid-out text-box story. */
export type TextboxDrawingRecord = (InlineDrawingRecord | AnchoredDrawingRecord) & {
  readonly textboxStory: NonNullable<InlineDrawingRecord['textboxStory']>;
};

const byPage = new WeakMap<PageRecord, readonly TextboxDrawingRecord[]>();

/** Every visible body text-box drawing on a page: anchored first, then inline in order. */
export function textboxDrawingsOnPage(page: PageRecord): readonly TextboxDrawingRecord[] {
  const cached = byPage.get(page);
  if (cached) return cached;
  const found: TextboxDrawingRecord[] = [];
  const add = (drawing: InlineDrawingRecord | AnchoredDrawingRecord): void => {
    if (drawing.textboxStory && !drawing.accessibility.hidden) {
      found.push(drawing as TextboxDrawingRecord);
    }
  };
  for (const drawing of page.anchoredDrawings ?? []) add(drawing);
  for (const fragment of paragraphFragmentsOfBlocks(page.fragments, true)) {
    for (const line of fragment.lines) {
      for (const drawing of line.drawings ?? []) add(drawing);
    }
  }
  const frozen = Object.freeze(found);
  byPage.set(page, frozen);
  return frozen;
}

/** The body text-box drawing with this id on a page, or undefined. */
export function textboxDrawingOnPage(
  page: PageRecord,
  drawingNodeId: string
): TextboxDrawingRecord | undefined {
  return textboxDrawingsOnPage(page).find((drawing) => drawing.drawingNodeId === drawingNodeId);
}
