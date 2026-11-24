/**
 * Which story a table belongs to, and what that means for its chrome.
 *
 * Table interaction reaches every story the page draws, and three separate questions follow
 * from that: which part holds the table (planning reads its tree), which box its coordinates
 * are relative to (chrome is painted from that origin), and whether the reader is standing in
 * that story at all (a write commits under the open scope).
 *
 * Extracted from `surface-table-interaction.ts` to keep it under the line cap. These are pure
 * functions over ids and records, with no DOM and no host.
 */

import type { OoxmlPart } from '@docx-editor.dev/core/store';
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { SemanticLayout } from '@docx-editor.dev/core/layout';
import type {
  BlockFragmentRecord,
  LayoutBox,
  TableFragmentRecord,
} from '../layout/semantic-records.ts';
import type { TableInteractionHit } from '../layout/semantic-table-interaction.ts';
import { partOfNodeId, sameStoryPart } from './surface-scope.ts';

/** The session reads that find the story part of a node id. */
type StoryPartLookup = Pick<TreeDocxSessionView, 'currentPackage' | 'part' | 'storyParts'>;

/**
 * The part a table lives in, for planning.
 *
 * Planning used to read `session.part()` — the body's — while the hit test resolved tables in
 * headers and footers. `readEditableTableTopology` then found no such table and the drag never
 * started, and `planTableCommand` refused with "the table target is no longer valid": chrome
 * offered, then a refusal. A loaded table's id names its part, so this is a map lookup, not a
 * story open. A table created during a collaboration session has a logical id with no part
 * name, so it is found in the story indexes, which open no story store either.
 */
export function partOfTableIn(session: StoryPartLookup, tableId: string): OoxmlPart {
  return partOfNodeId(session, tableId) ?? session.part();
}

/**
 * The hit worth painting chrome for, or `null`.
 *
 * Only the story the reader is IN. A write commits under the open scope, so a drag started
 * from the body on a header table would plan against the header part and then be refused by
 * the store: the reader enters the header before resizing a table in it. Painting chrome that
 * cannot act is the failure this lane keeps producing.
 *
 * `openParagraphId` is the caret's paragraph. Two loaded ids carry their part names, so the
 * usual case costs a string scan rather than a session read on every pointer move.
 */
export function offeredHit(
  session: StoryPartLookup,
  hit: TableInteractionHit | null,
  openParagraphId: string
): TableInteractionHit | null {
  if (!hit || hit.kind === 'tableBody') return null;
  return sameStoryPart(session, hit.tableId, openParagraphId) ? hit : null;
}

/**
 * A table on a page, with the box its coordinates are relative to.
 *
 * The origin is the reason this returns a pair rather than a record. Body fragments are laid
 * out from `page.contentBox`; a header's are laid out from the header's own box, which sits
 * ABOVE it, and a footer's from a box past the bottom of it. Returning the table alone let
 * every caller reach for `page.contentBox`, which drew a header's chrome down in the body text
 * and a footer's up at the top of it.
 */
export interface TableOnPage {
  readonly table: TableFragmentRecord;
  readonly origin: LayoutBox;
}

export function findTableOnPage(
  layout: SemanticLayout,
  tableId: string,
  pageIndex: number
): TableOnPage | null {
  const visit = (blocks: readonly BlockFragmentRecord[]): TableFragmentRecord | null => {
    for (const block of blocks) {
      if (block.kind !== 'table') continue;
      if (block.tableId === tableId) return block;
      for (const row of block.rows) {
        for (const cell of row.cells) {
          const nested = visit(cell.blocks);
          if (nested) return nested;
        }
      }
    }
    return null;
  };
  const page = layout.pages[pageIndex];
  if (!page) return null;
  const inBody = visit(page.fragments);
  if (inBody) return { table: inBody, origin: page.contentBox };
  // The header and footer stories. A table in one was never found here, so the drag preview
  // bailed even once the hit test resolved it. Each carries its OWN box as the origin.
  for (const story of [page.header, page.footer]) {
    if (!story) continue;
    const found = visit(story.fragments);
    if (found) return { table: found, origin: story.box };
  }
  return null;
}
