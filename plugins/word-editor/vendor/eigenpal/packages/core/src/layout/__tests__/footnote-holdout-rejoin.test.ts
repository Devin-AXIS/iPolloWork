// The footnote hold-out measures a returning reference line from where the body pass would
// place it: below the closing paragraph's space after, in the column the last fragment ends.
// A release measured from the bare body end lets the line back, the line lands lower than
// measured, and the page's own eviction pushes it out again.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { holdOutReserveNeed, type HoldOutArgs, type HoldOutRef } from '../note-reserve-holdout.ts';
import type { PageRecord, ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LINE = 14;
const CONTENT_HEIGHT = 648;

/** Footnotes 1..n with `lines[i]` exact 14pt lines each; `keepLines` stops a split. */
function notes(lines: readonly number[], keepLines = false) {
  const xml = lines
    .map(
      (count, index) =>
        `<w:footnote w:id="${index + 1}"><w:p><w:pPr>${keepLines ? '<w:keepLines/>' : ''}` +
        '<w:spacing w:line="280" w:lineRule="exact"/></w:pPr>' +
        Array.from(
          { length: count },
          (_, line) => `<w:r>${line ? '<w:br/>' : ''}<w:t>N${index + 1}-${line + 1}</w:t></w:r>`
        ).join('') +
        '</w:p></w:footnote>'
    )
    .join('');
  const result = readOoxmlPart(`<w:footnotes xmlns:w="${W}">${xml}</w:footnotes>`, {
    name: '/word/footnotes.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

interface ParagraphShape {
  readonly x?: number;
  /** Applied space before; the first line starts this far below `top`. */
  readonly before?: number;
  /** Applied space after, below the last line and inside the box. */
  readonly after?: number;
}

/** A whole paragraph of `count` 14pt lines, ten atoms per line. */
function paragraph(
  id: string,
  top: number,
  count: number,
  shape: ParagraphShape = {}
): ParagraphFragmentRecord {
  const before = shape.before ?? 0;
  const after = shape.after ?? 0;
  const x = shape.x ?? 0;
  return {
    kind: 'paragraph',
    id: `${id}#0`,
    paragraphId: id,
    fragmentIndex: 0,
    paragraphEnd: true,
    range: { start: 0, end: count * 10 },
    box: { x, y: top, width: 220, height: before + count * LINE + after },
    props: [],
    spacing: { before, after, line: null, lineRule: 'auto' },
    indent: { start: 0, end: 0, firstLine: 0, hanging: 0 },
    lines: Array.from({ length: count }, (_, index) => ({
      id: `${id}-${index}`,
      range: { paragraphId: id, start: index * 10, end: (index + 1) * 10 },
      spans: [],
      box: { x, y: top + before + index * LINE, width: 220, height: LINE },
      contentX: x,
      baseline: 11,
      leading: 0,
    })),
  } as ParagraphFragmentRecord;
}

/** `fragment` with a footnote citation on its last line. */
function citing(fragment: ParagraphFragmentRecord): ParagraphFragmentRecord {
  const lines = fragment.lines.map((line, index) =>
    index === fragment.lines.length - 1
      ? {
          ...line,
          spans: [{ text: '1', noteNav: { direction: 'to-note', scopeId: 'footnote:9' } }],
        }
      : line
  );
  return { ...fragment, lines } as ParagraphFragmentRecord;
}

function page(index: number, fragments: readonly ParagraphFragmentRecord[]): PageRecord {
  return {
    id: `page-${index}`,
    index,
    box: { x: 0, y: 0, width: 612, height: 792 },
    contentBox: { x: 72, y: 72, width: 468, height: CONTENT_HEIGHT },
    fragments,
  };
}

/** The last line of a `count`-line paragraph `id` cites footnote 1. */
function closingRef(id: string, count: number): HoldOutRef {
  return { noteId: 1, paragraphId: id, atomOffset: count * 10 - 9 };
}

function args(
  body: readonly ParagraphFragmentRecord[],
  next: readonly ParagraphFragmentRecord[],
  ref: HoldOutRef,
  noteLines: number,
  area: number,
  keepLines = false
): HoldOutArgs {
  return {
    bodyPage: page(0, body),
    nextPage: page(1, next),
    existingAreaHeight: area,
    ownReservePt: area,
    usedReservePt: undefined,
    pageBottomRefsOf: (target) => (target.index === 1 ? [ref] : []),
    footnotesPart: notes([noteLines], keepLines),
    opts: { measurer: createFixedMeasurer(6, 14), producer: 'note-rejoin' },
    plainSeparatorHeight: 14,
    noteLayoutCache: new Map(),
  };
}

describe('footnote hold-out rejoins below the closing space after', () => {
  // The body ends at 560pt with no reference on the page. The next page opens with a
  // three-line paragraph whose closing line cites a one-line note, beside a 28pt area. The
  // pulled band needs 42 + 28 + 14 = 84pt, so it fits back from 564pt and not lower.
  const opening = paragraph('next', 0, 3);
  const ref = closingRef('next', 3);

  test('a paragraph without space after releases the hold', () => {
    const body = paragraph('body', 0, 40);
    expect(holdOutReserveNeed(args([body], [opening], ref, 1, 28))).toBe(0);
  });

  test('the closing space after keeps the line out where it would land too low', () => {
    // 560pt of lines and 8pt after: the band would start at 568pt, past the 564pt fit.
    const body = paragraph('body', 0, 40, { after: 8 });
    expect(holdOutReserveNeed(args([body], [opening], ref, 1, 28))).toBeCloseTo(
      CONTENT_HEIGHT - 560 - 0.5,
      6
    );
  });

  test('only the column the line returns to adds its space after', () => {
    // Two columns. The first ends lowest, at 560pt, with 24pt after; the second, where the
    // returning line lands, ends at 392pt with none. The band starts at the body end, 560pt.
    const first = paragraph('first', 0, 40, { after: 24 });
    const second = paragraph('second', 0, 28, { x: 248 });
    expect(holdOutReserveNeed(args([first, second], [opening], ref, 1, 28))).toBe(0);
  });

  test('a full page cannot seat the line below its space after and publishes no hold', () => {
    // 630pt of lines leave 18pt, enough for a 14pt line from the body end but not below 8pt
    // after. Without the space after, the line fits and the page holds it out.
    const tight = paragraph('body', 0, 45);
    const spaced = paragraph('body', 0, 45, { after: 8 });
    expect(holdOutReserveNeed(args([tight], [opening], ref, 1, 28))).toBeCloseTo(
      CONTENT_HEIGHT - 630 - 0.5,
      6
    );
    expect(holdOutReserveNeed(args([spaced], [opening], ref, 1, 28))).toBe(0);
  });

  test('leading lines return below the larger of the space after and a kept space before', () => {
    // The next page opens a continuous section: its first paragraph keeps 12pt before at the
    // page top. Returning after 8pt of space after, the gap is 12pt, not 20pt, so four of its
    // six lines return with the body ending at 392 + 12 + 56 = 460pt.
    const body = paragraph('body', 0, 28, { after: 8 });
    const kept = paragraph('next', 0, 6, { before: 12 });
    const hold = holdOutReserveNeed(args([body], [kept], closingRef('next', 6), 10, 28, true));
    expect(hold).toBeCloseTo(CONTENT_HEIGHT - 460 - 0.5, 6);
  });

  test('a page that cites a note already counts its space after once', () => {
    // The body's own note charges the 8pt after into the body end; the kept 12pt before still
    // collapses against it rather than adding.
    const body = citing(paragraph('body', 0, 28, { after: 8 }));
    const kept = paragraph('next', 0, 6, { before: 12 });
    const hold = holdOutReserveNeed(args([body], [kept], closingRef('next', 6), 10, 28, true));
    expect(hold).toBeCloseTo(CONTENT_HEIGHT - 460 - 0.5, 6);
  });

  test('spacing that adds up keeps the space after and the kept space before', () => {
    // With the HTML spacing rules off, the gap is 8 + 12pt: the four lines end at 468pt.
    const body = paragraph('body', 0, 28, { after: 8 });
    const kept = paragraph('next', 0, 6, { before: 12 });
    const input = args([body], [kept], closingRef('next', 6), 10, 28, true);
    const hold = holdOutReserveNeed({
      ...input,
      opts: {
        ...input.opts,
        styleCascade: { ...buildStyleCascadeTable(null), fixedParagraphSpacing: true },
      },
    });
    expect(hold).toBeCloseTo(CONTENT_HEIGHT - 468 - 0.5, 6);
  });
});
