// Re-resolving page shells once the notes pass has inserted every overflow sheet.
//
// A sheet resolves its shell when it lands, and a body page resolves its own in the body pass.
// An insertion in front of either can change the page number that picks its variant.

import { overflowPageShellAt, type OverflowPageShell } from './page-furniture-insets.ts';
import { layoutUsesEvenAndOddHeaders } from './page-parity-sheet.ts';
import type { LayoutBox, NoteAreaRecord, PageRecord, SemanticLayout } from './semantic-records.ts';

/**
 * Re-resolve the shell of every minted sheet that later insertions slid along.
 *
 * A sheet resolves its shell when it is minted, from where it lands at that moment. That is
 * final for a sheet inserted inside its own section, but not for the footnote drain: the drain
 * appends at the document's end BEFORE the section loop runs, because that is the document
 * order Word uses, and an earlier section's `sectEnd` insertion then moves every drain sheet
 * one position along for each sheet it adds. Under `w:evenAndOddHeaders` an odd number of them
 * leaves each drain sheet showing the other variant's header over the other variant's box.
 *
 * Runs BEFORE `reindexAndFinalizeFields`, while a body-pass page still carries the index the
 * layout gave it — that is what a section lookup reads. From here an array position IS the
 * final page index, so the two inputs the resolver wants are both in hand.
 *
 * The comparison is on the FURNITURE as well as the insets. Two variants routinely resolve to
 * the same height — a one-line `default` header against a one-line `even` header is the common
 * shape — so equal insets say nothing about whether the sheet is showing the right story, and
 * an inset-only test would leave exactly the sheets this exists for untouched.
 *
 * A `pageBottom` note area hangs from the content box's BOTTOM, so it travels with that edge
 * when a footer variant moves it; every other area is measured from the top and travels with
 * that. A sheet whose area cannot sit inside the new box after the shift KEEPS the shell it was
 * minted with: its notes were fitted to the old box's HEIGHT and this pass cannot re-fit them,
 * and a sheet that is wrong about its variant beats one whose own notes fall outside it.
 */
export function resettleMintedSheets(
  pages: readonly PageRecord[],
  layout: SemanticLayout
): PageRecord[] {
  let sectionAnchorIndex: number | null = null;
  let changed = false;
  const next = pages.map((page, position) => {
    if (page.noteStream === undefined) {
      sectionAnchorIndex = page.index;
      return page;
    }
    if (sectionAnchorIndex === null) return page;
    const shell = overflowPageShellAt(layout, sectionAnchorIndex, position, page.box);
    if (!shell) return page;
    const top = page.box.y + shell.insets.top;
    const settled =
      top === page.contentBox.y &&
      shell.insets.height === page.contentBox.height &&
      shell.header?.variant === page.header?.variant &&
      shell.footer?.variant === page.footer?.variant;
    if (settled) return page;
    const contentBox = { ...page.contentBox, y: top, height: shell.insets.height };
    const bottom = top + contentBox.height;
    const oldBottom = page.contentBox.y + page.contentBox.height;
    const shifted = shiftNoteAreas(page, top - page.contentBox.y, bottom - oldBottom);
    if (!shifted.fits(top, bottom)) return page;
    changed = true;
    return withShellFurniture(
      {
        ...page,
        contentBox,
        ...(shifted.footnotes ? { footnotes: shifted.footnotes } : {}),
        ...(shifted.endnotes ? { endnotes: shifted.endnotes } : {}),
      },
      shell
    );
  });
  return changed ? next : [...pages];
}

/** The page with the shell's header and footer in place of its own. */
function withShellFurniture(page: PageRecord, shell: OverflowPageShell): PageRecord {
  const { header: _header, footer: _footer, ...rest } = page;
  return {
    ...rest,
    ...(shell.header ? { header: shell.header } : {}),
    ...(shell.footer ? { footer: shell.footer } : {}),
  };
}

/** Translate one note area and everything inside it by `dy`. */
function shiftNoteArea(area: NoteAreaRecord, dy: number): NoteAreaRecord {
  if (dy === 0) return area;
  const shiftBox = (box: LayoutBox): LayoutBox => ({ ...box, y: box.y + dy });
  return {
    ...area,
    box: shiftBox(area.box),
    ...(area.separator
      ? { separator: { ...area.separator, box: shiftBox(area.separator.box) } }
      : {}),
    ...(area.continuationNotice
      ? {
          continuationNotice: {
            ...area.continuationNotice,
            box: shiftBox(area.continuationNotice.box),
          },
        }
      : {}),
    notes: area.notes.map((note) => ({ ...note, box: shiftBox(note.box) })),
  };
}

/**
 * Move a resettled sheet's note areas onto the edge each one is measured from, and say whether
 * they still sit inside the new box.
 *
 * A `pageBottom` footnote area hangs from the content bottom, so a footer variant that moves
 * that edge must move the area with it — leaving it where it was would paint the notes over the
 * footer band. Everything else is placed from the content top.
 */
function shiftNoteAreas(
  page: PageRecord,
  topDelta: number,
  bottomDelta: number
): {
  readonly footnotes?: NoteAreaRecord;
  readonly endnotes?: NoteAreaRecord;
  fits(top: number, bottom: number): boolean;
} {
  const deltaFor = (area: NoteAreaRecord): number =>
    area.placement === 'pageBottom' ? bottomDelta : topDelta;
  const footnotes = page.footnotes
    ? shiftNoteArea(page.footnotes, deltaFor(page.footnotes))
    : undefined;
  const endnotes = page.endnotes
    ? shiftNoteArea(page.endnotes, deltaFor(page.endnotes))
    : undefined;
  return {
    ...(footnotes ? { footnotes } : {}),
    ...(endnotes ? { endnotes } : {}),
    fits(top: number, bottom: number): boolean {
      const inside = (area: NoteAreaRecord | undefined): boolean =>
        area === undefined ||
        (area.box.y >= top - 0.001 && area.box.y + area.box.height <= bottom + 0.001);
      return inside(footnotes) && inside(endnotes);
    },
  };
}

/** Each body page's displayed number, by body-pass index, before any sheet moved it. */
export function bodyPageNumbers(pages: readonly PageRecord[]): ReadonlyMap<number, number> {
  const numbers = new Map<number, number>();
  for (const page of pages) {
    const pageNumber = page.pageFieldSource?.pageNumber;
    if (page.noteStream === undefined && !page.parityBlank && pageNumber !== undefined)
      numbers.set(page.index, pageNumber);
  }
  return numbers;
}

/** Points; well under any visible step, well over float error from offset sums. */
const BOX_TOLERANCE = 0.001;

function hasAnchoredDrawings(story: PageRecord['header']): boolean {
  return (story?.anchoredDrawings?.length ?? 0) > 0;
}

/**
 * Give a body page the header and footer of its new page number.
 *
 * A `sectEnd` sheet inserted in front of a later section moves every unrestarted page number
 * after it. Under `w:evenAndOddHeaders` an odd move also changes the variant those pages show.
 * The section's shell resolver answers for the page at its own index with its number moved,
 * so its place in the section and its running header values stay its own.
 *
 * Only the furniture changes. The body was laid out in the body pass against the content box
 * and the furniture wrap zones of the old variant, so a page whose new variant needs a
 * different box, or whose old or new furniture holds anchored drawings, keeps its old shell:
 * moving either would put body lines under the furniture.
 *
 * Runs before reindexing, while a body page still carries its body-pass index.
 */
export function resettleBodyFurniture(
  pages: readonly PageRecord[],
  numbersBefore: ReadonlyMap<number, number>,
  layout: SemanticLayout
): PageRecord[] {
  // Without alternating variants no page number picks a variant.
  if (!layoutUsesEvenAndOddHeaders(layout)) return [...pages];
  let changed = false;
  const next = pages.map((page) => {
    if (page.noteStream !== undefined || page.parityBlank) return page;
    const before = numbersBefore.get(page.index);
    const after = page.pageFieldSource?.pageNumber;
    if (before === undefined || after === undefined) return page;
    const shift = after - before;
    // An even move keeps every page on its parity, so no variant changes.
    if (shift % 2 === 0) return page;
    // Anchored furniture drawings can sit in the body's way; such a page keeps its shell.
    // Checked before the resolver, which lays the new variant out.
    if (hasAnchoredDrawings(page.header) || hasAnchoredDrawings(page.footer)) return page;
    const shell = overflowPageShellAt(layout, page.index, page.index, page.box, shift);
    if (!shell) return page;
    if (
      shell.header?.variant === page.header?.variant &&
      shell.footer?.variant === page.footer?.variant
    )
      return page;
    // The body pass placed this content box through section-local offsets, so it can sit
    // a rounding step away from the same edge computed here.
    const top = page.box.y + shell.insets.top;
    if (
      Math.abs(top - page.contentBox.y) > BOX_TOLERANCE ||
      Math.abs(shell.insets.height - page.contentBox.height) > BOX_TOLERANCE
    )
      return page;
    if (hasAnchoredDrawings(shell.header) || hasAnchoredDrawings(shell.footer)) return page;
    changed = true;
    return withShellFurniture(page, shell);
  });
  return changed ? next : [...pages];
}
