// Which fragments a page draws, across every story on it.
//
// Its own module because `semantic-records.ts` is at its line cap and this is a distinct
// question: that file defines the RECORDS a layout publishes, and this answers where to look
// for one when the caret could be in any story.

import { paragraphFragmentsOf, paragraphFragmentsOfBlocks } from './semantic-records.ts';
import type { PageRecord, ParagraphFragmentRecord } from './semantic-records.ts';

/**
 * Every paragraph fragment a page DRAWS, in any story.
 *
 * `page.fragments` is the body's alone. A header, a footer and each note hang their own
 * fragments off the page beside it, and a caret can be in any of them — so a walk that stops
 * at the body answers "this paragraph is not laid out" for a paragraph the user is looking at.
 *
 * BEWARE what these records carry. The fragments are attached unmodified, so a header's
 * positions are relative to its own story box and a note's to its note area, and one header
 * story object is attached to every page it applies to. This is the right walk for identity
 * questions — which fragment draws this paragraph, what marker does it have — and the wrong
 * one for geometry, until the caller also carries the story's own box.
 *
 * Memoized per page, like {@link paragraphFragmentsOfBlocks} is per blocks array. Page records
 * are identity-stable across incremental passes, and `markerOf` calls this once per touched
 * paragraph: rebuilding the array per call made a select-all indent quadratic with a bigger
 * constant than the body-only walk it replaced.
 */
const storyFragmentMemos = new WeakMap<PageRecord, ParagraphFragmentRecord[]>();

export function paragraphFragmentsOnPage(page: PageRecord): ParagraphFragmentRecord[] {
  const cached = storyFragmentMemos.get(page);
  if (cached) return cached;
  const found = [...paragraphFragmentsOf(page)];
  for (const story of [page.header, page.footer]) {
    if (story) found.push(...paragraphFragmentsOfBlocks(story.fragments));
  }
  for (const area of [page.footnotes, page.endnotes]) {
    if (!area) continue;
    for (const note of area.notes) found.push(...paragraphFragmentsOfBlocks(note.fragments));
  }
  storyFragmentMemos.set(page, found);
  return found;
}
