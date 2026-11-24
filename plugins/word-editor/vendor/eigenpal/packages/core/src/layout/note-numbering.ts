// Derived footnote/endnote display numbers.
//
// Numbers are never stored on note or reference nodes. Callers pass document-order
// references plus resolved numbering properties; this module returns stable id → mark
// maps using the shared `formatNumFmt` (no forked ST_NumberFormat).

import { formatNumFmt } from './numbering-format.ts';
import type { NoteKind } from '../store/package/note-nodes.ts';
import type {
  ResolvedEndnoteProperties,
  ResolvedFootnoteProperties,
} from '../store/package/note-properties.ts';

/**
 * Where one note is referenced from — what per-page and per-section restart rules are computed
 * against.
 */
export interface NoteReferenceSite {
  /** Stable note id (`w:id`). */
  readonly noteId: number;
  /** Section index of the reference (0-based). */
  readonly sectionIndex: number;
  /**
   * Page index of the reference when known (0-based). Required for `eachPage` restart;
   * when omitted, `eachPage` behaves like `continuous` for that site.
   */
  readonly pageIndex?: number;
  /** When true, consumes no automatic number (`customMarkFollows`). */
  readonly customMarkFollows?: boolean;
}

/**
 * The mark a note reference paints.
 *
 * `null` where `w:customMarkFollows` suppresses it: the document supplies its own glyph, and
 * painting an automatic number too would show the note twice.
 */
export interface NoteDisplayMark {
  readonly noteId: number;
  /** Formatted mark, or `null` when suppressed by customMarkFollows. */
  readonly mark: string | null;
  /** 1-based automatic sequence number when assigned; absent when suppressed. */
  readonly displayNumber?: number;
}

type ResolvedNoteProperties = ResolvedFootnoteProperties | ResolvedEndnoteProperties;

/**
 * Derive display marks for references of one note kind in document order.
 *
 * A note's number is its section's `numStart` plus the note's index in its numbering domain:
 * - `continuous` — the domain is the whole document, so the index counts every earlier
 *   numbered note, in any section
 * - `eachSect` — the domain is the reference's section
 * - `eachPage` — the domain is the reference's page (continuous when the page is unknown)
 *
 * So a later section that sets only `numStart` 10, after two notes, numbers its notes 12 and
 * 13, and a section without its own `numStart` continues from 1 plus the index.
 *
 * IDs are stable; only display numbers change. Non-mutating.
 */
export function deriveNoteDisplayMarks(
  noteKind: NoteKind,
  references: readonly NoteReferenceSite[],
  properties: ResolvedNoteProperties
): readonly NoteDisplayMark[] {
  return deriveNoteDisplayMarksResolved(noteKind, references, () => properties);
}

/**
 * Derive marks using per-reference-section resolved properties (`numFmt` / `numStart` /
 * `numRestart`). Each site uses its own section's properties: the format, the start value, and
 * the restart rule that picks its numbering domain (see {@link deriveNoteDisplayMarks}).
 */
export function deriveNoteDisplayMarksResolved(
  _noteKind: NoteKind,
  references: readonly NoteReferenceSite[],
  resolveProps: (sectionIndex: number) => ResolvedNoteProperties
): readonly NoteDisplayMark[] {
  const marks: NoteDisplayMark[] = [];
  // Numbered notes so far: in the document, in the current section, on the current page.
  let inDocument = 0;
  let inSection = 0;
  let inPage = 0;
  let lastSection: number | null = null;
  let lastPage: number | null = null;

  for (const site of references) {
    const properties = resolveProps(site.sectionIndex);
    if (site.customMarkFollows) {
      marks.push({ noteId: site.noteId, mark: null });
      continue;
    }
    if (site.sectionIndex !== lastSection) {
      lastSection = site.sectionIndex;
      inSection = 0;
    }
    const page = site.pageIndex ?? null;
    if (page !== lastPage) {
      lastPage = page;
      inPage = 0;
    }

    const index =
      properties.numRestart === 'eachSect'
        ? inSection
        : properties.numRestart === 'eachPage' && site.pageIndex !== undefined
          ? inPage
          : inDocument;
    const displayNumber = properties.numStart + index;
    inDocument += 1;
    inSection += 1;
    inPage += 1;
    marks.push({
      noteId: site.noteId,
      mark: formatNumFmt(properties.numFmt, displayNumber),
      displayNumber,
    });
  }

  return marks;
}

/** Map noteId → formatted mark for quick lookup (last site wins if duplicated). */
export function noteDisplayMarkMap(
  marks: readonly NoteDisplayMark[]
): ReadonlyMap<number, string | null> {
  const map = new Map<number, string | null>();
  for (const entry of marks) map.set(entry.noteId, entry.mark);
  return map;
}
