import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { holdOutReserveNeed, type HoldOutArgs, type HoldOutRef } from '../note-reserve-holdout.ts';
import type { PageRecord, ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LINE = 14;

function notes(counts: readonly number[], keepLines = false) {
  const xml = counts
    .map(
      (count, index) =>
        `<w:footnote w:id="${index + 1}"><w:p><w:pPr>${keepLines ? '<w:keepLines/>' : ''}<w:spacing w:line="280" w:lineRule="exact"/></w:pPr>` +
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

function paragraph(
  id: string,
  top: number,
  count: number,
  options: { start?: number; continuation?: boolean; end?: boolean; keepNext?: boolean } = {}
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
    props: options.keepNext
      ? [{ kind: 'generic', localName: 'keepNext', attributes: {}, children: [] }]
      : [],
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
    contentBox: { x: 72, y: 72, width: 468, height: 648 },
    fragments,
  };
}

function args(
  body: ParagraphFragmentRecord,
  next: readonly ParagraphFragmentRecord[],
  refs: readonly HoldOutRef[],
  counts: readonly number[],
  area: number
): HoldOutArgs {
  return {
    bodyPage: page(0, [body]),
    nextPage: page(1, next),
    existingAreaHeight: area,
    ownReservePt: area,
    usedReservePt: 648 - body.box.y - body.box.height - 0.5,
    pageBottomRefsOf: () => refs,
    footnotesPart: notes(counts),
    opts: { measurer: createFixedMeasurer(6, 14), producer: 'note-frontier' },
    plainSeparatorHeight: 14,
    noteLayoutCache: new Map(),
  };
}

describe('footnote hold-out uses the returning paragraph opening', () => {
  test('a continuation prices later references from the earlier fragment top', () => {
    const earlier = paragraph('body', 112, 8, { end: false });
    const later = paragraph('body', 0, 9, { start: 80, continuation: true });
    const input = args(
      earlier,
      [later],
      [
        { noteId: 1, paragraphId: 'body', atomOffset: 101 },
        { noteId: 2, paragraphId: 'body', atomOffset: 161 },
      ],
      [3, 30],
      56
    );
    // The short reference returns. The later note exceeds its new whole-note budget and
    // may split there, so its whole height must not prevent the earlier reference returning.
    expect(holdOutReserveNeed(input)).toBe(0);
    expect(holdOutReserveNeed(input)).toBe(0);
    expect(holdOutReserveNeed({ ...input, noteLayoutCache: new Map() })).toBe(0);
  });

  test('a returning reference without a positive note budget keeps its unjoined demand', () => {
    const input = args(
      paragraph('body', 0, 40, { end: false }),
      [paragraph('body', 0, 7, { start: 400, continuation: true })],
      [{ noteId: 1, paragraphId: 'body', atomOffset: 451 }],
      [1],
      14
    );
    // The joined reference ends at 644pt. The separator and minimum body band take 28pt.
    // The reference line stays out; the five lines ahead of it return, and widow control
    // keeps the last line with it.
    for (const height of [648, 672]) {
      const bodyPage = { ...input.bodyPage, contentBox: { ...input.bodyPage.contentBox, height } };
      const nextPage = {
        ...input.nextPage!,
        contentBox: { ...input.nextPage!.contentBox, height },
      };
      for (const usedReservePt of [undefined, height - 560 - 0.5]) {
        const hold = holdOutReserveNeed({ ...input, bodyPage, nextPage, usedReservePt });
        expect(hold).toBeCloseTo(height - 560 - 5 * 14 - 0.5, 6);
      }
    }
    // A positive budget can require splitting a taller note; retain that existing release.
    const height = 682;
    expect(
      holdOutReserveNeed({
        ...input,
        bodyPage: { ...input.bodyPage, contentBox: { ...input.bodyPage.contentBox, height } },
        nextPage: { ...input.nextPage!, contentBox: { ...input.nextPage!.contentBox, height } },
      })
    ).toBe(0);
    // Note growth that exceeds even the unjoined budget must still use the split policy.
    expect(
      holdOutReserveNeed({ ...input, footnotesPart: notes([50]), noteLayoutCache: new Map() })
    ).toBe(0);
  });

  test('an unrelated earlier paragraph does not extend the reference paragraph', () => {
    const input = args(
      paragraph('earlier', 112, 8),
      [paragraph('body', 0, 9)],
      [
        { noteId: 1, paragraphId: 'body', atomOffset: 21 },
        { noteId: 2, paragraphId: 'body', atomOffset: 81 },
      ],
      [3, 30],
      56
    );
    expect(holdOutReserveNeed({ ...input, footnotesPart: notes([3, 30], true) })).toBeGreaterThan(
      400
    );
  });

  test('a kept reference includes notes in its mandatory successor opening', () => {
    const input = args(
      paragraph('earlier', 128, 8),
      [paragraph('head', 0, 1, { keepNext: true }), paragraph('next', 28, 4)],
      [
        { noteId: 1, paragraphId: 'head', atomOffset: 1 },
        { noteId: 2, paragraphId: 'next', atomOffset: 11 },
        { noteId: 3, paragraphId: 'next', atomOffset: 12 },
      ],
      [7, 6, 3],
      122
    );
    expect(holdOutReserveNeed(input)).toBeCloseTo(407.5, 4);
    expect(holdOutReserveNeed({ ...input, noteLayoutCache: new Map() })).toBeCloseTo(407.5, 4);
  });

  test('a kept successor without a reference does not create a note hold', () => {
    const input = args(
      paragraph('earlier', 128, 17),
      [paragraph('head', 0, 1, { keepNext: true }), paragraph('next', 28, 4)],
      [{ noteId: 1, paragraphId: 'head', atomOffset: 1 }],
      [7],
      122
    );
    expect(holdOutReserveNeed(input)).toBe(0);
    expect(holdOutReserveNeed(input)).toBe(0);
    expect(holdOutReserveNeed({ ...input, noteLayoutCache: new Map() })).toBe(0);
  });

  test('a later successor reference outside its mandatory opening adds no opening demand', () => {
    const input = args(
      paragraph('earlier', 128, 17),
      [paragraph('head', 0, 1, { keepNext: true }), paragraph('next', 28, 12)],
      [
        { noteId: 1, paragraphId: 'head', atomOffset: 1 },
        { noteId: 2, paragraphId: 'next', atomOffset: 111 },
      ],
      [7, 3],
      122
    );
    expect(holdOutReserveNeed(input)).toBe(0);
  });

  test('a kept paragraph that can split before its last line does not pull its successor', () => {
    const head = paragraph('head', 0, 2, { keepNext: true });
    const splittable = {
      ...head,
      props: [
        ...head.props,
        { kind: 'generic', localName: 'widowControl', attributes: { val: '0' }, children: [] },
      ],
    } as ParagraphFragmentRecord;
    const input = args(
      paragraph('earlier', 128, 8),
      [splittable, paragraph('next', 42, 4)],
      [
        { noteId: 1, paragraphId: 'head', atomOffset: 1 },
        { noteId: 2, paragraphId: 'next', atomOffset: 11 },
      ],
      [7, 25],
      122
    );
    expect(holdOutReserveNeed(input)).toBe(0);
  });

  test('later notes outside a long successor opening do not hold the kept head', () => {
    const input = args(
      paragraph('earlier', 128, 8),
      [paragraph('head', 0, 1, { keepNext: true }), paragraph('next', 28, 12)],
      [
        { noteId: 1, paragraphId: 'head', atomOffset: 1 },
        { noteId: 2, paragraphId: 'next', atomOffset: 111 },
      ],
      [3, 30],
      56
    );
    expect(holdOutReserveNeed(input)).toBe(0);
  });
});

test('a split opening does not release a later unsatisfied note in the same pulled band', () => {
  const input = args(
    paragraph('earlier', 0, 35),
    [paragraph('next', 0, 1)],
    [
      { noteId: 1, paragraphId: 'next', atomOffset: 1 },
      { noteId: 2, paragraphId: 'next', atomOffset: 2 },
    ],
    [30, 3],
    14
  );
  // The first note can split. Its head leaves too little room for the second note.
  expect(holdOutReserveNeed(input)).toBeCloseTo(157.5, 6);
  expect(holdOutReserveNeed({ ...input, noteLayoutCache: new Map() })).toBeCloseTo(157.5, 6);
});

test('a settled continuation admits its complete reference opening before later notes', () => {
  const input = args(
    paragraph('body', 480, 3, { end: false }),
    [paragraph('body', 0, 10, { start: 30, continuation: true })],
    [
      { noteId: 1, paragraphId: 'body', atomOffset: 51 },
      { noteId: 2, paragraphId: 'body', atomOffset: 61 },
      { noteId: 3, paragraphId: 'body', atomOffset: 91 },
      { noteId: 4, paragraphId: 'body', atomOffset: 92 },
      { noteId: 5, paragraphId: 'body', atomOffset: 93 },
    ],
    [2, 2, 2, 2, 2],
    14
  );
  expect(holdOutReserveNeed(input)).toBe(0);
  expect(holdOutReserveNeed({ ...input, noteLayoutCache: new Map() })).toBe(0);
  // The returning opening is priced the same way in every compatibility mode.
  for (const compatibilityMode of [11, 12, 14, 15, 16])
    expect(holdOutReserveNeed({ ...input, opts: { ...input.opts, compatibilityMode } })).toBe(0);
  const owner = input.nextPage!.fragments[0] as ParagraphFragmentRecord;
  for (const localName of ['keepLines', 'keepNext']) {
    const kept = {
      ...owner,
      props: [{ kind: 'generic', localName, attributes: {}, children: [] }],
    } as ParagraphFragmentRecord;
    expect(holdOutReserveNeed({ ...input, nextPage: page(1, [kept]) })).toBeGreaterThan(0);
  }
  // A fresh note layout after growth must make the same refusal as a cold calculation.
  const grown = {
    ...input,
    footnotesPart: notes([8, 2, 2, 2, 2], true),
    noteLayoutCache: new Map(),
  };
  expect(holdOutReserveNeed(grown)).toBeGreaterThan(0);
  expect(holdOutReserveNeed(grown)).toBe(
    holdOutReserveNeed({ ...grown, noteLayoutCache: new Map() })
  );
  // Every note on the returning line must fit, even after a reserve settles.
  const sameLine = input.pageBottomRefsOf(input.nextPage!).map((ref) => ({
    ...ref,
    atomOffset: 51,
  }));
  expect(holdOutReserveNeed({ ...input, pageBottomRefsOf: () => sameLine })).toBeGreaterThan(0);
});
