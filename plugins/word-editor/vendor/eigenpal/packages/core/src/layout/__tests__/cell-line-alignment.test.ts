import { placeOrdinaryCellLine } from '../ordinary-cell-line.ts';
import { describe, expect, test } from 'bun:test';
import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { alignCellLine, type CellLineAlignment } from '../cell-line-alignment.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { frozenLine, type PendingLine } from '../pending-line.ts';
import {
  alignSpans,
  boxLineSetsLikeLastLine,
  lineAlignOffset,
  setsLikeLastLine,
  type Alignment,
} from '../paragraph-alignment.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import type { StyleSpanRecord } from '../semantic-records.ts';

// Advances that are not whole points, so a changed order of arithmetic shows in the bits.
const measurer = createFixedMeasurer(5.37, 13.9);

const jc = (val: string): OoxmlProperty =>
  ({ localName: 'jc', attributes: { val } }) as unknown as OoxmlProperty;

/** Spans laid end to end from `x`, as the breaker leaves them. */
function lineOf(
  paragraphId: string,
  texts: readonly string[],
  options: { rtl?: boolean; closing?: Partial<PendingLine> } = {}
): PendingLine {
  let x = 1.25;
  let start = 0;
  const spans = texts.map((text): StyleSpanRecord => {
    const width = measurer.measure(text, DEFAULT_RUN_STYLE);
    const level = options.rtl && !/^[\d ]+$/.test(text) ? 1 : options.rtl ? 2 : 0;
    const span: StyleSpanRecord = {
      range: { paragraphId, start, end: start + text.length },
      text,
      props: [],
      style: options.rtl
        ? {
            ...DEFAULT_RUN_STYLE,
            shaping: { script: 'Hebr', direction: level % 2 ? 'rtl' : 'ltr', level, baseLevel: 1 },
          }
        : DEFAULT_RUN_STYLE,
      box: { x, y: 0, width, height: 13.9 },
      ...(text.trim() === '' ? { lineEndWhitespace: true as const } : {}),
    };
    x += width;
    start += text.length;
    return span;
  });
  return frozenLine({
    spans,
    drawings: [],
    start: 0,
    end: start,
    width: x - 1.25,
    height: 13.9,
    baseline: 11.1,
    leading: 0,
    trailingSpacing: 0,
    ...options.closing,
  });
}

/** Every span copied, then aligned: the placement before spans shared their range. */
function copiedThenAligned(
  line: PendingLine,
  paragraphId: string,
  penX: number,
  indent: number,
  width: number,
  isLastLine: boolean,
  shared: CellLineAlignment
) {
  const placed = line.spans.map((span) => ({
    ...span,
    range: { ...span.range, paragraphId },
    box: { ...span.box, x: span.box.x + penX, y: 7.3 },
  }));
  const spans = alignSpans(
    placed,
    shared.measurer,
    indent,
    width,
    shared.alignment,
    boxLineSetsLikeLastLine(shared.props, line, isLastLine, shared.styleCascade),
    shared.alignment === 'center' || shared.alignment === 'right' ? line.width : undefined,
    shared.rtl,
    shared.inTableCell,
    line.spaceShrink === true
  );
  return {
    spans,
    offset: lineAlignOffset(placed, spans, shared.alignment, width, line.width),
    drawings: [],
  };
}

/** Same structure, key order and number bits. */
function expectSameBits(actual: unknown, expected: unknown, path = '$'): void {
  if (typeof actual === 'number' || typeof expected === 'number') {
    if (!Object.is(actual, expected)) throw Error(`${path}: ${actual} is not ${expected}`);
    return;
  }
  if (actual === expected) return;
  expect(typeof actual).toBe('object');
  expect(Object.keys(actual as object)).toEqual(Object.keys(expected as object));
  for (const key of Object.keys(actual as object))
    expectSameBits(
      (actual as Record<string, unknown>)[key],
      (expected as Record<string, unknown>)[key],
      `${path}.${key}`
    );
}

const LINES: readonly [string, readonly string[], { rtl?: boolean; closing?: object }?][] = [
  ['one word', ['Alpha']],
  ['words', ['Alpha ', 'beta ', 'gamma']],
  ['a hanging space', ['Alpha beta ']],
  ['a hanging space run', ['Alpha ', 'beta', '   ']],
  ['a double space across runs', ['Alpha ', ' beta ', 'gamma']],
  ['a manual break', ['Alpha ', 'beta', '\n'], { closing: { manualBreakAfter: true } }],
  ['a page break', ['Alpha ', 'beta ', '\f'], { closing: { pageBreakAfter: true } }],
  ['a column break', ['Alpha ', 'beta'], { closing: { columnBreakAfter: true } }],
  ['shrunk spaces', ['Alpha ', 'beta ', 'gamma'], { closing: { spaceShrink: true } }],
  ['right-to-left words', ['אלפא ', 'בטא ', '12 ', 'גמא '], { rtl: true }],
];

describe('alignCellLine', () => {
  for (const [name, texts, options] of LINES)
    for (const alignment of ['left', 'center', 'right', 'both'] as const)
      for (const isLastLine of [false, true])
        test(`${name}, ${alignment}, ${isLastLine ? 'last' : 'inner'} line`, () => {
          const props = alignment === 'both' ? [jc('both')] : [jc(alignment)];
          const shared: CellLineAlignment = {
            measurer,
            styleCascade: undefined,
            props,
            alignment: alignment as Alignment,
            rtl: options?.rtl === true,
            inTableCell: true,
          };
          for (const width of [41.7, 96.35, 300.1]) {
            const line = lineOf('p1', texts, options);
            const actual = alignCellLine(line, 'p1', 3.3, 7.3, [], 3.3 + 2.15, width, isLastLine, {
              ...shared,
            });
            expectSameBits(
              actual,
              copiedThenAligned(line, 'p1', 3.3, 3.3 + 2.15, width, isLastLine, shared)
            );
          }
        });

  test('shares the broken range only when it names the placed paragraph', () => {
    const line = lineOf('p1', ['Alpha ', 'beta']);
    const shared: CellLineAlignment = {
      measurer,
      styleCascade: undefined,
      props: [],
      alignment: 'left',
      rtl: false,
      inTableCell: true,
    };
    const own = alignCellLine(line, 'p1', 0, 0, [], 0, 100, true, shared).spans;
    expect(own.map((span) => span.range)).toEqual(line.spans.map((span) => span.range));
    own.forEach((span, index) => expect(span.range).toBe(line.spans[index]!.range));
    const other = alignCellLine(line, 'p2', 0, 0, [], 0, 100, true, shared).spans;
    expect(other.map((span) => span.range.paragraphId)).toEqual(['p2', 'p2']);
    other.forEach((span, index) => expect(span.range).not.toBe(line.spans[index]!.range));
    expect(line.spans.map((span) => span.range.paragraphId)).toEqual(['p1', 'p1']);
  });
});

test('boxLineSetsLikeLastLine reads only the breaks a box line keeps', () => {
  const flags = [undefined, true] as const;
  for (const props of [[], [jc('both')], [jc('distribute')]])
    for (const compatibility of [
      undefined,
      { unstretchedManualBreakLines: true as const },
      { pageBreakLinesStretch: true as const },
    ])
      for (const pageBreakAfter of flags)
        for (const columnBreakAfter of flags)
          for (const manualBreakAfter of flags)
            for (const isLastLine of [false, true]) {
              const line = { pageBreakAfter, columnBreakAfter, manualBreakAfter };
              const kept = {
                ...(pageBreakAfter ? { pageBreakAfter } : {}),
                ...(manualBreakAfter ? { manualBreakAfter } : {}),
              };
              expect(boxLineSetsLikeLastLine(props, line, isLastLine, compatibility)).toBe(
                setsLikeLastLine(props, kept, isLastLine, compatibility)
              );
            }
});

test('ordinary placement preserves alignment bits at width and coordinate boundaries', () => {
  for (const texts of [['42'], ['Alpha ', 'beta'], ['  A', ' B'], ['12.50', '%']]) {
    const line = lineOf('p1', texts);
    for (const penX of [-0, -13.7, 3.3, 1e8])
      for (const delta of [-0.001, -1e-9, 0, 1e-10, 1e-9, 0.001, 100.25])
        for (const alignment of ['left', 'center', 'right'] as const) {
          const width = line.width + delta;
          const indent = penX + 2.15;
          const actual = placeOrdinaryCellLine(line, 'p2', penX, 7.3, indent, width, alignment);
          expect(actual).not.toBeNull();
          const expected = copiedThenAligned(line, 'p2', penX, indent, width, true, {
            measurer,
            styleCascade: undefined,
            props: [],
            alignment,
            rtl: false,
            inTableCell: true,
          });
          expectSameBits({ ...actual, drawings: [] }, expected);
        }
  }
});

test('ordinary placement refuses lines with width-dependent or bidi content', () => {
  for (const line of [
    lineOf('p1', ['Text ']),
    lineOf('p1', ['A\tB']),
    lineOf('p1', ['漢字']),
    lineOf('p1', ['123'], { rtl: true }),
    lineOf('p1', ['Text'], { closing: { compressesSpaces: true } }),
    lineOf('p1', ['Text'], { closing: { wrapMirrored: true } }),
    lineOf('p1', ['Text'], { closing: { manualBreakAfter: true } }),
  ])
    expect(placeOrdinaryCellLine(line, 'p1', 0, 0, 0, 100, 'center')).toBeNull();
  const line = lineOf('p1', ['Text']);
  expect(placeOrdinaryCellLine(line, 'p1', 0, 0, 0, 100, 'both')).toBeNull();
  expect(placeOrdinaryCellLine(line, 'p1', 0, 0, 0, Infinity, 'right')).toBeNull();
});
