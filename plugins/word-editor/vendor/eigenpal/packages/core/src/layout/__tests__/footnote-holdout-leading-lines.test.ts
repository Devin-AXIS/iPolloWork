// The footnote hold-out keeps a reference line off the previous page, not the lines ahead
// of it. A paragraph that continues onto the next page and cites a note on a later line
// returns its earlier lines, as far as widow and orphan control allow.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { holdOutReserveNeed, type HoldOutArgs } from '../note-reserve-holdout.ts';
import type { PageRecord, ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LINE = 14;
const CONTENT = 648;

function notes(lines: number) {
  const runs = Array.from(
    { length: lines },
    (_, line) => `<w:r>${line ? '<w:br/>' : ''}<w:t>N${line + 1}</w:t></w:r>`
  ).join('');
  const result = readOoxmlPart(
    `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1"><w:p><w:pPr><w:spacing w:line="280" w:lineRule="exact"/></w:pPr>${runs}</w:p></w:footnote></w:footnotes>`,
    { name: '/word/footnotes.xml', contentType: 'application/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraph(
  id: string,
  top: number,
  count: number,
  options: { start?: number; continuation?: boolean; end?: boolean; props?: string[] } = {}
): ParagraphFragmentRecord {
  const start = options.start ?? 0;
  return {
    kind: 'paragraph',
    id: `${id}#${start}`,
    paragraphId: id,
    fragmentIndex: options.continuation ? 1 : 0,
    paragraphEnd: options.end ?? true,
    range: { start, end: start + count * 10 },
    box: { x: 0, y: top, width: 468, height: count * LINE },
    props: (options.props ?? []).map((localName) => ({
      kind: 'generic',
      localName,
      attributes: {},
      children: [],
    })),
    spacing: { before: 0, after: 0, line: null, lineRule: 'auto' },
    indent: { start: 0, end: 0, firstLine: 0, hanging: 0 },
    lines: Array.from({ length: count }, (_, index) => ({
      id: `${id}-${start}-${index}`,
      range: { paragraphId: id, start: start + index * 10, end: start + (index + 1) * 10 },
      spans: [],
      box: { x: 0, y: top + index * LINE, width: 468, height: LINE },
      contentX: 0,
      baseline: 11,
      leading: 0,
    })),
  } as ParagraphFragmentRecord;
}

function page(index: number, fragments: readonly ParagraphFragmentRecord[]): PageRecord {
  return {
    id: `page-${index}`,
    index,
    box: { x: 0, y: 0, width: 612, height: 792 },
    contentBox: { x: 72, y: 72, width: 468, height: CONTENT },
    fragments,
  };
}

/**
 * A page of 40 filler lines, then `opening` lines of the cited paragraph; the next page
 * holds the paragraph's other `rest` lines, the last of which cites a one-line note.
 */
function input(opening: number, rest: number, props: string[] = [], noteLines = 1): HoldOutArgs {
  const filler = paragraph('filler', 0, 40);
  const fragments =
    opening > 0 ? [filler, paragraph('cited', 560, opening, { end: false, props })] : [filler];
  const start = opening * 10;
  const next = paragraph('cited', 0, rest, { start, continuation: opening > 0, props });
  const bodyBottom = 560 + opening * LINE;
  return {
    bodyPage: page(0, fragments),
    nextPage: page(1, [next]),
    existingAreaHeight: 0,
    ownReservePt: 0,
    usedReservePt: CONTENT - bodyBottom - 0.5,
    pageBottomRefsOf: (candidate) =>
      candidate.index === 1
        ? [{ noteId: 1, paragraphId: 'cited', atomOffset: start + (rest - 1) * 10 + 5 }]
        : [],
    footnotesPart: notes(noteLines),
    opts: { measurer: createFixedMeasurer(6, 14), producer: 'holdout-leading-lines' },
    plainSeparatorHeight: LINE,
    noteLayoutCache: new Map(),
  };
}

/** Body lines that may return beside a hold: whole lines of the page's free space. */
function returningLines(args: HoldOutArgs): number {
  const bodyBottom = args.bodyPage.fragments.reduce(
    (bottom, fragment) => Math.max(bottom, fragment.box.y + fragment.box.height),
    0
  );
  return Math.floor((CONTENT - bodyBottom - holdOutReserveNeed(args)) / LINE);
}

describe('footnote hold-out keeps only the reference line out', () => {
  test('lines ahead of the reference return, and widow control keeps two beside it', () => {
    // Free space for four lines. The reference line and its note cannot both fit, so the
    // two lines ahead of the last pair return without it.
    expect(returningLines(input(2, 4))).toBe(2);
  });

  test('a reference on the second of two remaining lines returns nothing', () => {
    // The pair and a one-line note fit back, so nothing is held.
    expect(returningLines(input(2, 2))).toBe(4);
    // A two-line note does not fit; widow control keeps the first line with the reference.
    expect(returningLines(input(2, 2, [], 2))).toBe(0);
  });

  test('without widow control every line ahead of the reference returns', () => {
    const off = input(2, 4);
    const next = off.nextPage!.fragments[0] as ParagraphFragmentRecord;
    const free = {
      ...next,
      props: [
        {
          kind: 'generic',
          localName: 'widowControl',
          attributes: { val: '0' },
          children: [],
        },
      ],
    } as ParagraphFragmentRecord;
    expect(returningLines({ ...off, nextPage: page(1, [free]) })).toBe(3);
  });

  test('a paragraph kept together returns no line', () => {
    expect(returningLines(input(2, 4, ['keepLines']))).toBe(0);
  });

  test('a paragraph that starts on the next page returns at least two lines', () => {
    // With a one-line note the whole paragraph and its note fit, so nothing is held.
    expect(returningLines(input(0, 4))).toBe(6);
    // A two-line note does not fit beside the whole paragraph; its opening pair returns.
    expect(returningLines(input(0, 4, [], 2))).toBe(2);
  });

  test('a paragraph citing a second note on the next page keeps the full hold', () => {
    const args = input(2, 4);
    const second = { noteId: 1, paragraphId: 'cited', atomOffset: 20 + 2 * 10 + 5 };
    const refs = args.pageBottomRefsOf;
    expect(
      returningLines({
        ...args,
        pageBottomRefsOf: (candidate) => [...refs(candidate), ...(candidate.index ? [second] : [])],
      })
    ).toBe(0);
  });
});
