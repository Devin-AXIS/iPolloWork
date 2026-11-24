import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode } from '../../store/package/ooxml-tree.ts';
import {
  cellParagraphLines,
  zonesReachingCellParagraph,
  type HeldCellBreak,
} from '../cell-continuation-lines.ts';
import type { ExclusionZone } from '../drawing-exclusion.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { initialCellCursor, unplacedHeldBreak } from '../table-cell-cursor.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord, TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function cellTable(content: string, twips: number, paragraphProps = '', header = false) {
  const headerRow = header
    ? '<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr>' +
      `<w:tcW w:w="${twips}" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>head</w:t></w:r></w:p></w:tc></w:tr>`
    : '';
  return (
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="${twips}"/></w:tblGrid>${headerRow}<w:tr><w:tc><w:tcPr>` +
    `<w:tcW w:w="${twips}" w:type="dxa"/></w:tcPr><w:p>${paragraphProps}${content}</w:p></w:tc></w:tr></w:tbl>`
  );
}

function layout(
  body: string,
  height: number,
  measurer: TextMeasurer = createFixedMeasurer(),
  cached = false
) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 1, {
    measurer,
    ...(cached ? { cache: createParagraphLayoutCache<readonly PendingLine[]>() } : {}),
    geometry: { width: 400, height, margin: { top: 20, bottom: 20, left: 20, right: 20 } },
  });
}

/** Every body-row cell line's model range and x, in page order; repeated header rows skipped. */
function cellLines(result: ReturnType<typeof layout>): string[] {
  return result.pages.flatMap((page) =>
    page.fragments
      .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
      .flatMap((table) =>
        table.rows.flatMap((row) =>
          row.cells.flatMap((cell) =>
            cell.blocks.flatMap((block) =>
              block.kind === 'paragraph'
                ? block.lines
                    .filter((line) => !line.spans.some((span) => span.text === 'head'))
                    .map(
                      (line) =>
                        `${line.range.start}-${line.range.end}@${(line.spans[0]?.box.x ?? 0).toFixed(2)}`
                    )
                : []
            )
          )
        )
      )
  );
}

const alternatingRuns = (count: number) =>
  '<w:r><w:rPr><w:b/></w:rPr><w:t>1</w:t></w:r><w:r><w:t>1</w:t></w:r>'.repeat(count / 2);

for (const [header, cached] of [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
] as const) {
  test(`a cell paragraph split across pages costs time linear in its length${header ? ' under a repeated header row' : ''}${cached ? ' with a paragraph cache' : ''}`, () => {
    const calls = (count: number) => {
      const base = createFixedMeasurer();
      let made = 0;
      const measurer: TextMeasurer = {
        ...base,
        lineMetrics: (...args: Parameters<TextMeasurer['lineMetrics']>) => {
          made += 1;
          return base.lineMetrics(...args);
        },
      };
      const result = layout(
        cellTable(alternatingRuns(count), 400, '', header),
        400,
        measurer,
        cached
      );
      expect(result.pages.length).toBeGreaterThan(count / 100);
      return made;
    };
    // Re-breaking the remainder on each page made this ratio about 11.
    expect(calls(1600) / calls(400)).toBeLessThan(4.5);
  });
}

const words = Array.from({ length: 120 }, (_, index) => `w${index % 7}x${'a'.repeat(index % 5)}`);
const plain = `<w:r><w:t xml:space="preserve">${words.join(' ')}</w:t></w:r>`;
const cases: Record<string, string> = {
  plain: '',
  'hanging indent': '<w:pPr><w:ind w:left="400" w:hanging="400"/></w:pPr>',
  'first-line indent': '<w:pPr><w:ind w:firstLine="600"/></w:pPr>',
  'right-to-left': '<w:pPr><w:bidi/><w:ind w:start="300" w:hanging="300"/></w:pPr>',
};
for (const [name, props] of Object.entries(cases))
  for (const [header, cached] of [
    [false, false],
    [true, false],
    [true, true],
  ] as const)
    test(`a continued ${name} cell paragraph keeps the lines of its whole break${header ? ' under a repeated header row' : ''}${cached ? ' with a paragraph cache' : ''}`, () => {
      const split = layout(cellTable(plain, 1600, props, header), 200, undefined, cached);
      const whole = layout(cellTable(plain, 1600, props, header), 4000);
      expect(split.pages.length).toBeGreaterThan(2);
      expect(whole.pages).toHaveLength(1);
      expect(cellLines(split)).toEqual(cellLines(whole));
    });

const line = (start: number, end: number) => ({ start, end }) as unknown as PendingLine;
const paragraph = { kind: 'paragraph' } as unknown as OoxmlNode;
const zoneAt = (
  y: number,
  height: number,
  x = 0,
  mode: 'square' | 'topAndBottom' = 'square',
  textSide: 'bothSides' | 'left' = 'bothSides'
) =>
  ({
    verticalBand: { x, y, width: 50, height },
    input: {
      mode,
      textSide,
      contentBounds: { x, y, width: 50, height },
      polygon: null,
      clipPolygon: null,
      wrapDistances: { top: 0, right: 9, bottom: 0, left: 9 },
      effectInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  }) as unknown as ExclusionZone;
const reaching = (
  zones: readonly ExclusionZone[],
  paragraphId = 'p',
  linesLeft = 0,
  linesRight = 200,
  paragraphOrderIndex?: (id: string) => number | undefined
) =>
  zonesReachingCellParagraph(zones, {
    paragraphOrderIndex,
    originX: 0,
    width: 200,
    paragraphId,
    top: 100,
    linesLeft,
    linesRight,
  });

function linesFor(held: HeldCellBreak | undefined, continuedAfter: number, startOffset: number) {
  const rest = [line(startOffset, startOffset + 3)];
  return (zones: readonly ExclusionZone[] = [], key = 'k') =>
    cellParagraphLines({
      paragraph,
      startOffset,
      continuedAfter,
      legacyLineStart: 0,
      held,
      zones: reaching(zones),
      inlineDrawingLayout: undefined,
      heldKey: () => key,
      breakRemainder: () => rest,
    });
}

test('a continuation picks its line by index, not by the first line with its start', () => {
  // A layout-owned piece wrapped over three lines: the last two start at its end.
  const whole = [line(0, 5), line(5, 9), line(9, 9), line(9, 12)];
  const held = { key: 'k', lines: whole, base: 0 };
  const hit = linesFor(held, 3, 9)();
  expect(hit.lines).toBe(whole);
  expect(hit.lineStart).toBe(3);
  expect(hit.priorLineCount).toBe(0);
  // A stale cursor, or another key, breaks the remainder instead.
  expect(linesFor(held, 1, 9)().lines).not.toBe(whole);
  expect(linesFor(held, 3, 9)([], 'other').lines).not.toBe(whole);
});

test('a page that breaks its own remainder carries it on to the next page', () => {
  const miss = linesFor(undefined, 4, 20)();
  expect(miss.lineStart).toBe(0);
  expect(miss.priorLineCount).toBe(4);
  const carried = miss.carry()!;
  expect(carried.base).toBe(4);
  // The next page continues after one more line and indexes that remainder break.
  const remainder = [line(20, 23), line(23, 27), line(27, 30)];
  const next = linesFor({ ...carried, lines: remainder }, 5, 23)();
  expect(next.lines).toBe(remainder);
  expect(next.lineStart).toBe(1);
  expect(next.priorLineCount).toBe(4);
});

test('only an exclusion band that can reach the paragraph stops the reuse', () => {
  const whole = [line(0, 5), line(5, 9), line(9, 12)];
  const held = { key: 'k', lines: whole, base: 0 };
  const reuses = (zone: ExclusionZone) => linesFor(held, 1, 5)([zone]).lines === whole;
  // A header logo's band ends above the paragraph.
  expect(reuses(zoneAt(0, 60))).toBe(true);
  // A band beside the cell, wider than its wrap distance away, on whichever side text passes.
  expect(reuses(zoneAt(150, 40, 260))).toBe(true);
  expect(reuses(zoneAt(150, 40, -70))).toBe(true);
  expect(reuses(zoneAt(150, 40, 260, 'square', 'left'))).toBe(true);
  // A band over the cell, within its wrap distance, or top and bottom: no reuse.
  expect(reuses(zoneAt(150, 40, 20))).toBe(false);
  expect(reuses(zoneAt(150, 40, 205))).toBe(false);
  expect(reuses(zoneAt(150, 40, 260, 'topAndBottom'))).toBe(false);
  expect(linesFor(held, 1, 5)([zoneAt(150, 40)]).carry()).toBeUndefined();
});

test('pages with and without zones that cannot reach the paragraph share one break', () => {
  const whole = [line(0, 5), line(5, 9), line(9, 12)];
  const beside = zoneAt(150, 40, 260);
  const made = { ...linesFor(undefined, 0, 0)([zoneAt(0, 60), beside]).carry()!, lines: whole };
  expect(linesFor(made, 1, 5)([]).lines).toBe(whole);
  expect(linesFor(made, 1, 5)([beside]).lines).toBe(whole);
  // A zone that reaches the paragraph is passed on to the break, and stops the reuse.
  const zones = [zoneAt(0, 60), beside, zoneAt(150, 40, 20)];
  expect(reaching(zones).map((zone) => zone.verticalBand.x)).toEqual([20]);
  expect(linesFor(made, 1, 5)(zones).lines).not.toBe(whole);
});

test('a zone the paragraph anchors itself always reaches it', () => {
  const own = { ...zoneAt(0, 60), anchorParagraphId: 'p' } as ExclusionZone;
  expect(reaching([own])).toHaveLength(1);
  expect(reaching([own], 'q')).toHaveLength(0);
});

test('a zone in the strip a negative indent pushes the lines into reaches them', () => {
  // The lines start 10 pt left of the cell; a band ends 8 pt left of it, no wrap distance.
  const strip = zoneAt(150, 40, -58);
  const tight = {
    ...strip,
    input: { ...strip.input, wrapDistances: { top: 0, right: 0, bottom: 0, left: 0 } },
  } as ExclusionZone;
  expect(reaching([tight])).toHaveLength(0);
  expect(reaching([tight], 'p', -10)).toHaveLength(1);
});

test('a continued paragraph that places nothing keeps its break for the next page', () => {
  const held = { key: 'k', lines: [line(0, 5)], base: 0 };
  const cursor = { ...initialCellCursor(), blockIndex: 2, startOffset: 5, heldBreak: held };
  expect(unplacedHeldBreak(cursor, 2, 5)).toEqual({ heldBreak: held });
  // Once the walk moves past it, or the cursor carries none, nothing is kept.
  expect(unplacedHeldBreak(cursor, 3, undefined)).toEqual({});
  expect(unplacedHeldBreak(initialCellCursor(), 0, undefined)).toEqual({});
});

test('a band that ends exactly at the paragraph top does not reach it', () => {
  expect(reaching([zoneAt(40, 60, 20)])).toHaveLength(0);
  expect(reaching([zoneAt(40, 61, 20)])).toHaveLength(1);
});

test('a zone in the strip a negative right indent pushes the lines into reaches them', () => {
  const strip = zoneAt(150, 40, 208);
  const tight = {
    ...strip,
    input: { ...strip.input, wrapDistances: { top: 0, right: 0, bottom: 0, left: 0 } },
  } as ExclusionZone;
  expect(reaching([tight])).toHaveLength(0);
  expect(reaching([tight], 'p', 0, 210)).toHaveLength(1);
});

test('a zone anchored in a later paragraph does not reach an earlier one', () => {
  const later = { ...zoneAt(150, 40, 20), anchorParagraphId: 'later' } as ExclusionZone;
  const order = (id: string) => ({ p: 1, later: 2 })[id];
  expect(reaching([later], 'p', 0, 200, order)).toHaveLength(0);
  expect(reaching([later], 'p')).toHaveLength(1);
});
