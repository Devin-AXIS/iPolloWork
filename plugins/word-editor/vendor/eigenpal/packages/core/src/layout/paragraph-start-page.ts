// Where a paragraph's text starts when the paragraph opens with a page break (layout lane,
// DOM-free).
//
// The break lays out as its own fragment at the end of the previous page, and the text starts
// in the next fragment. Every consumer that names "the page of a heading" reads it here: table
// of contents rows, PAGEREF results, link and bookmark jumps, PDF destinations, and Markdown
// pages. One rule keeps them on the same page.

import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';
import type { PageRecord, ParagraphFragmentRecord } from './semantic-records.ts';
import { paragraphFragmentsOf } from './semantic-record-queries.ts';

/** The text a column break lays out as (`hardBreakText`). */
const COLUMN_BREAK_TEXT = '\n';

/**
 * Whether a paragraph fragment holds only page or column breaks.
 *
 * Each line ends in such a break, holds no drawing, and its spans are empty or the break's
 * own character: `\f` for a page break, `\n` for a column break. A column break in a
 * one-column section, or in the last column, moves the text to the next page the same way.
 */
export function isBreakOnlyFragment(fragment: ParagraphFragmentRecord): boolean {
  if (fragment.lines.length === 0) return false;
  return fragment.lines.every((line) => {
    if (line.breakAfter === undefined || line.drawings?.length) return false;
    const breakText = line.breakAfter === 'page' ? PAGE_BREAK_CHAR : COLUMN_BREAK_TEXT;
    return line.spans.every((span) => span.text === '' || span.text === breakText);
  });
}

/** Where the text of a paragraph that opens with page or column breaks starts. @internal */
export interface LeadingBreakTextStart {
  /** The index of the paragraph's first fragment that is not break-only. */
  readonly fragmentIndex: number;
  /** The model offset where that fragment starts. */
  readonly offset: number;
}

const textStartMemos = new WeakMap<
  readonly PageRecord[],
  ReadonlyMap<string, LeadingBreakTextStart>
>();

/**
 * The text start of every body paragraph that opens with page or column breaks, by paragraph id.
 *
 * A paragraph without a leading page break, or one made only of breaks, has no entry. Built
 * once per page list, so a caller can ask for many paragraphs without walking the layout again.
 *
 * @internal
 */
export function leadingBreakTextStarts(
  pages: readonly PageRecord[]
): ReadonlyMap<string, LeadingBreakTextStart> {
  const memo = textStartMemos.get(pages);
  if (memo) return memo;
  const starts = new Map<string, LeadingBreakTextStart>();
  const opened = new Set<string>();
  for (const page of pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      const id = fragment.paragraphId;
      if (opened.has(id) || isBreakOnlyFragment(fragment)) continue;
      opened.add(id);
      if (fragment.fragmentIndex > 0) {
        starts.set(id, { fragmentIndex: fragment.fragmentIndex, offset: fragment.range.start });
      }
    }
  }
  textStartMemos.set(pages, starts);
  return starts;
}

/**
 * Move a position inside a paragraph's leading breaks to the start of its text.
 *
 * A bookmark at the front of a heading that opens with a page break sits before the break, at
 * the bottom of the previous page. A jump to it shows the heading text instead. Any other
 * position comes back unchanged.
 */
export function pastLeadingBreaks(
  pages: readonly PageRecord[],
  position: { readonly paragraphId: string; readonly offset: number }
): { readonly paragraphId: string; readonly offset: number } {
  const start = leadingBreakTextStarts(pages).get(position.paragraphId);
  return start && position.offset < start.offset
    ? { paragraphId: position.paragraphId, offset: start.offset }
    : position;
}

/**
 * The page on which each wanted paragraph starts, in page order.
 *
 * That is the page of the paragraph's first fragment that is not break-only, so a heading
 * that opens with a page break starts on the page of its text. A paragraph whose fragments
 * are all break-only keeps the page of its first fragment.
 */
export function paragraphStartPages(
  pages: readonly PageRecord[],
  wanted: ReadonlySet<string>
): ReadonlyMap<string, PageRecord> {
  const textStarts = leadingBreakTextStarts(pages);
  const result = new Map<string, PageRecord>();
  for (const page of pages) {
    if (result.size >= wanted.size) break;
    for (const fragment of paragraphFragmentsOf(page)) {
      const id = fragment.paragraphId;
      if (!wanted.has(id) || result.has(id)) continue;
      // Skip the break-only fragments in front of the text.
      const textStart = textStarts.get(id);
      if (textStart && fragment.fragmentIndex < textStart.fragmentIndex) continue;
      result.set(id, page);
    }
  }
  return result;
}
