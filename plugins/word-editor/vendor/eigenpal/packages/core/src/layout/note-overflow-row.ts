// Footnotes of a whole table row that runs past the bottom margin.
//
// Before mode 15 a row that cannot split stays whole on its page even when it is taller than
// the page band (`tallRowStaysWhole`). No reserve can make room below such a row. The page
// keeps the first line of the first note the row references, at the page bottom over the row;
// that note's other lines and every later note continue on the next page. Where the reference
// sits in the row does not matter, also past the bottom margin.
//
// Only a row taller than the page qualifies. A row that fits a fresh page but runs past the
// margin below repeated header rows (`repeatKeepsWholeRow`) keeps none of its notes: each one
// moves whole, with its mark, to the next page. A note carried from an earlier page that waits
// for room also keeps the row's notes off the page, so the notes stay in order.

import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import type { NoteReferenceLineBand } from './note-fragment-geometry.ts';
import type { NoteStoryLayout } from './note-layout.ts';
import { splitNoteFragments, type NoteSplitReasons } from './note-splitting.ts';
import type { BlockFragmentRecord, NoteStoryRecord, PageRecord } from './semantic-records.ts';

/** Whether `band` is a table row taller than its page's content band, placed whole. */
export function referenceRowOverflowsPage(
  band: NoteReferenceLineBand,
  compatibilityMode: number | undefined
): boolean {
  return (
    band.rowOverflowsPage === true && hasCompatibilityRule(compatibilityMode, 'tallRowStaysWhole')
  );
}

/**
 * Story-relative bottom of a note's first line: the part that stays on the page of an
 * overflowing row. Zero when the note does not open with a line of text.
 */
function firstNoteLineBottomPt(laid: NoteStoryLayout): number {
  const first = laid.fragments[0];
  const line = first?.kind === 'paragraph' ? first.lines[0] : undefined;
  return line ? line.box.y + line.box.height : 0;
}

/**
 * Split one note referenced in an overflowing row. The page's `first` note keeps its first line
 * (`note`); everything else continues (`carry`), with the mark when nothing of it was placed.
 */
export function overflowRowNote(
  laid: NoteStoryLayout,
  mark: string | null,
  first: boolean,
  page: PageRecord,
  reasons: NoteSplitReasons
): {
  readonly note?: NoteStoryRecord;
  readonly carry?: {
    fragments: readonly BlockFragmentRecord[];
    height: number;
    mark: string | null;
  };
} {
  const keep = first ? firstNoteLineBottomPt(laid) : 0;
  const split = splitNoteFragments(laid, keep, { fullContentHeight: keep, reasons });
  const placed = split.head.length > 0;
  return {
    ...(placed
      ? {
          note: {
            noteKind: 'footnote',
            noteId: laid.noteId,
            scopeId: laid.scopeId,
            mark,
            box: {
              x: page.contentBox.x,
              y: 0,
              width: page.contentBox.width,
              height: split.headHeight,
            },
            fragments: split.head,
          },
        }
      : {}),
    ...(split.tail.length > 0
      ? {
          carry: { fragments: split.tail, height: split.tailHeight, mark: placed ? null : mark },
        }
      : {}),
  };
}
