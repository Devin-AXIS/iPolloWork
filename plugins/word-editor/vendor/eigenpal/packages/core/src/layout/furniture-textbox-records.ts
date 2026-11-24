// Header and footer text-box drawings on one laid-out page, placed in page-content coordinates.
//
// A header or footer story is laid out story-relative: its anchored drawings sit relative to the
// story box unless they are page-relative, and its inline drawings sit on the story's lines. The
// editor places a caret and lays a story out in the page's content coordinates, so each record
// comes with the content-space origin of its extent.

import type { AnchoredDrawingRecord, InlineDrawingRecord } from './drawing-layout.ts';
import { headerFooterAnchoredDrawingOrigin } from './header-footer-drawing-origin.ts';
import type { PageRecord } from './semantic-records.ts';
import { paragraphFragmentsOfBlocks } from './semantic-record-queries.ts';
import type { TextboxDrawingRecord } from './textbox-drawing-records.ts';

/** A header or footer text-box drawing and where its extent sits on the page content box. */
export interface FurnitureTextboxDrawing {
  readonly drawing: TextboxDrawingRecord;
  readonly kind: 'header' | 'footer';
  /** Relationship id of the story, when the furniture source named it. */
  readonly rId?: string;
  /** Top-left of the drawing extent in page-content coordinates. */
  readonly origin: Readonly<{ x: number; y: number }>;
}

const byPage = new WeakMap<PageRecord, readonly FurnitureTextboxDrawing[]>();

/** Every visible text-box drawing of the page's header and footer: anchored, then inline. */
export function furnitureTextboxDrawingsOnPage(
  page: PageRecord
): readonly FurnitureTextboxDrawing[] {
  const cached = byPage.get(page);
  if (cached) return cached;
  const found: FurnitureTextboxDrawing[] = [];
  const content = page.contentBox;
  for (const story of [page.header, page.footer]) {
    if (!story) continue;
    const add = (
      drawing: InlineDrawingRecord | AnchoredDrawingRecord,
      sheet: Readonly<{ x: number; y: number }>
    ): void => {
      if (!drawing.textboxStory || drawing.accessibility.hidden) return;
      found.push(
        Object.freeze({
          drawing: drawing as TextboxDrawingRecord,
          kind: story.kind,
          ...(story.rId !== undefined ? { rId: story.rId } : {}),
          origin: Object.freeze({ x: sheet.x - content.x, y: sheet.y - content.y }),
        })
      );
    };
    for (const drawing of story.anchoredDrawings ?? [])
      add(drawing, headerFooterAnchoredDrawingOrigin(drawing, story.box, page.box));
    for (const fragment of paragraphFragmentsOfBlocks(story.fragments, true)) {
      for (const line of fragment.lines) {
        for (const drawing of line.drawings ?? [])
          add(drawing, { x: story.box.x + drawing.x, y: story.box.y + drawing.y });
      }
    }
  }
  const frozen = Object.freeze(found);
  byPage.set(page, frozen);
  return frozen;
}
