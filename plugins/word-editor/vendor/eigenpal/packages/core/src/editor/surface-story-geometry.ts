// Where a line's caret geometry is measured from on a page. Body lines measure from the
// page's content box; header, footer and note lines from their own story's box on that page.
// Shared by the bookmark marks, jumps and reveals, so they agree on where a line is.

import { paragraphFragmentsOfBlocks, type LayoutBox } from '@docx-editor.dev/core/layout';
import type { SemanticLayout } from '../layout/semantic-records.ts';

type Page = SemanticLayout['pages'][number];

/** The note on this page whose lines hold the paragraph, footnotes first. */
export function noteOnPage(
  page: Page,
  paragraphId: string
): { readonly box: LayoutBox } | undefined {
  for (const area of [page.footnotes, page.endnotes]) {
    const note = area?.notes.find((entry) =>
      paragraphFragmentsOfBlocks(entry.fragments).some(
        (fragment) => fragment.paragraphId === paragraphId
      )
    );
    if (note) return note;
  }
  return undefined;
}

/**
 * The box a line's caret geometry is measured from on `page`: the header, footer or note that
 * holds the paragraph there, else the page's content box.
 */
export function storyContentBox(page: Page, paragraphId: string): LayoutBox {
  for (const story of [page.header, page.footer]) {
    if (!story) continue;
    const fragments = paragraphFragmentsOfBlocks(story.fragments);
    if (fragments.some((fragment) => fragment.paragraphId === paragraphId)) return story.box;
  }
  return noteOnPage(page, paragraphId)?.box ?? page.contentBox;
}
