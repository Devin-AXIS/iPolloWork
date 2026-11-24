// A right-to-left line beside a float fills the passages from the right: its first words take
// the rightmost passage, and the text continues in the passage to the left of the float. Each
// part then aligns inside its own passage, with the paragraph's start edge on the right, and
// bidi reordering stays inside each passage. A left-to-right paragraph that holds right-to-left
// text aligns each part inside its own passage too.

import { describe, expect, test } from 'bun:test';
import {
  layoutUnderFloat,
  layoutWithoutFloat,
  loadBody,
  squareWrapZone,
} from './float-over-table-harness.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';
import { FIXED_MEASURER_CHAR_WIDTH } from '../fixed-measurer.ts';
import type { ExclusionZone } from '../drawing-exclusion.ts';
import type { WrapTextSide } from '../drawing-wrap.ts';
import {
  createLayoutSession,
  createFixedMeasurer,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { caretAt, caretStops } from '../semantic-interaction.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { wrapBreakSpace } from '../wrap-break-space.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { linesOf, type LineRecord, type StyleSpanRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const HEBREW = 'אא בבב גג דדדד הה ווו זז חחחח טט ייי כככ לל מממ ננ סססס עע פפפ צצ קקק רר';
/** The fixed measurer's advance at the default 10pt size. */
const ADVANCE = (FIXED_MEASURER_CHAR_WIDTH * 10) / 11;
/** The tiny page's 180pt measure, split by a float over [60, 100). */
const RIGHT = { start: 100, end: 180 };
const LEFT = { start: 0, end: 60 };

function rtlParagraph(jc: string, runs: string, ppr = ''): string {
  return `<w:p><w:pPr><w:bidi/>${ppr}<w:jc w:val="${jc}"/></w:pPr>${runs}</w:p>`;
}
const rtlRun = (text: string) =>
  `<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const ltrRun = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

interface FloatOptions {
  readonly left?: number;
  readonly width?: number;
  readonly textSide?: WrapTextSide;
  /** Overrides on the zone's wrap input, such as wrap distances or a wrap polygon. */
  readonly input?: Partial<ExclusionZone['input']>;
  /** More floats beside the same lines, each `[left, left + width)`. */
  readonly more?: readonly { readonly left: number; readonly width: number }[];
  readonly compatibilityMode?: number;
}

function zoneFor(paragraphId: string, options: FloatOptions = {}): ExclusionZone {
  const zone = squareWrapZone({
    anchorParagraphId: paragraphId,
    top: 0,
    height: 70,
    left: options.left ?? 60,
    width: options.width ?? 40,
  });
  return {
    ...zone,
    input: {
      ...zone.input,
      ...(options.textSide ? { textSide: options.textSide } : {}),
      ...options.input,
    },
  };
}

/** The lines of `paragraphXml` beside one square-wrapped float, by default over [60, 100). */
function linesBeside(paragraphXml: string, options: FloatOptions = {}): LineRecord[] {
  const source = loadBody(paragraphXml);
  const target = source.root.children
    .flatMap((child) => ('children' in child ? child.children : []))
    .find((child) => child.kind === 'paragraph')!;
  const zones = [
    zoneFor(target.id, options),
    ...(options.more ?? []).map((float, index) => ({
      ...squareWrapZone({
        anchorParagraphId: target.id,
        top: 0,
        height: 70,
        ...float,
        drawingNodeId: `float-${index + 2}`,
      }),
    })),
  ];
  if (options.compatibilityMode === undefined)
    return linesOf(layoutUnderFloat(source, new Map([[0, zones]])));
  return linesOf(
    layoutSemanticDocument(source, 0, {
      ...harnessOptions(new Map([[0, zones]])),
      compatibilityMode: options.compatibilityMode,
    })
  );
}

/** The options `layoutUnderFloat` lays out with, on its 200 by 100pt page. */
function harnessOptions(zones: ReadonlyMap<number, readonly ExclusionZone[]>) {
  return {
    measurer: createFixedMeasurer(),
    geometry: { width: 200, height: 100, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    inlineDrawingLayout: {
      ownerPartName: '/word/document.xml',
      project: () => null,
      resourceOf: () => {
        throw new Error('no drawings');
      },
    },
    drawingExclusionZonesByPage: zones,
    drawingExclusionPass: 0,
  };
}

/** The line's parts, in model order: a new part starts at each float's jump. */
function partsOf(line: LineRecord): StyleSpanRecord[][] {
  const parts: StyleSpanRecord[][] = [];
  for (const [index, span] of line.spans.entries()) {
    if (index === 0 || (span.wrapAdvanceBefore ?? 0) > 0.001) parts.push([span]);
    else parts[parts.length - 1]!.push(span);
  }
  return parts;
}

/**
 * Where a part's glyphs start and end. A space ends each word's span. It stands at the span's
 * left when it resolves right to left: in a right-to-left paragraph, or between two
 * right-to-left words. Spans of spaces alone hang and do not count.
 */
function glyphs(
  part: readonly StyleSpanRecord[],
  paragraphRtl = true
): { start: number; end: number } {
  let start = Infinity;
  let end = -Infinity;
  for (const [index, span] of part.entries()) {
    const text = span.text.trimEnd();
    if (text === '') continue;
    const trailing = (span.text.length - text.length) * ADVANCE;
    const isRtl = (candidate?: StyleSpanRecord) => candidate?.style.shaping?.direction === 'rtl';
    const rtl = isRtl(span) && (paragraphRtl || isRtl(part[index + 1]));
    start = Math.min(start, span.box.x + (rtl ? trailing : 0));
    end = Math.max(end, span.box.x + span.box.width - (rtl ? 0 : trailing));
  }
  return { start, end };
}

const glyphSpans = (line: LineRecord) => line.spans.filter((span) => span.text.trim());

/** The lines beside a float over [70, 110), which leaves 70pt on each side. */
function besideOnly(textSide: WrapTextSide, rtl: boolean, compatibilityMode?: number) {
  // Few enough words to stay beside the float.
  const words = HEBREW.split(' ').slice(0, 10).join(' ');
  const paragraph = rtl
    ? rtlParagraph('start', rtlRun(words))
    : `<w:p><w:r><w:t>${words.replace(/[^ ]/g, 'a')}</w:t></w:r></w:p>`;
  const beside = linesBeside(paragraph, {
    left: 70,
    width: 40,
    textSide,
    ...(compatibilityMode === undefined ? {} : { compatibilityMode }),
  }).filter((line) => line.box.y < 70);
  expect(beside.length).toBeGreaterThan(0);
  return beside;
}

const twoPartLines = (lines: readonly LineRecord[]) =>
  lines.filter((line) => partsOf(line).length === 2);

function expectInside(part: readonly StyleSpanRecord[], passage: typeof RIGHT): void {
  for (const span of part) {
    expect(span.box.x).toBeGreaterThanOrEqual(passage.start - 0.001);
    expect(span.box.x + span.box.width).toBeLessThanOrEqual(passage.end + 0.001);
  }
}

describe('a right-to-left line beside a float', () => {
  test('fills the right passage first and continues left of the float', () => {
    const lines = twoPartLines(linesBeside(rtlParagraph('start', rtlRun(HEBREW))));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      const [first, second] = partsOf(line);
      expectInside(first!, RIGHT);
      expectInside(second!, LEFT);
      // The start edge is on the right, in each passage.
      expect(glyphs(first!).end).toBeCloseTo(RIGHT.end, 6);
      expect(glyphs(second!).end).toBeCloseTo(LEFT.end, 6);
      expect(first!.at(-1)!.range.end).toBeLessThanOrEqual(second![0]!.range.start);
    }
  });

  test('centres each part inside its own passage', () => {
    const lines = twoPartLines(linesBeside(rtlParagraph('center', rtlRun(HEBREW))));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      for (const [index, part] of partsOf(line).entries()) {
        const passage = index === 0 ? RIGHT : LEFT;
        const { start, end } = glyphs(part);
        expectInside(part, passage);
        expect((start + end) / 2).toBeCloseTo((passage.start + passage.end) / 2, 6);
      }
    }
  });

  test('sets each end-aligned part at its passage left edge', () => {
    const lines = twoPartLines(linesBeside(rtlParagraph('end', rtlRun(HEBREW))));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      const [first, second] = partsOf(line);
      expect(glyphs(first!).start).toBeCloseTo(RIGHT.start, 6);
      expect(glyphs(second!).start).toBeCloseTo(LEFT.start, 6);
    }
  });

  test('justifies each part to fill its passage', () => {
    const all = linesBeside(rtlParagraph('both', rtlRun(HEBREW)));
    const lines = twoPartLines(all).filter((line) => line !== all.at(-1));
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      for (const [index, part] of partsOf(line).entries()) {
        const passage = index === 0 ? RIGHT : LEFT;
        const { start, end } = glyphs(part);
        expect(start).toBeCloseTo(passage.start, 6);
        expect(end).toBeCloseTo(passage.end, 6);
      }
    }
  });

  test.each([
    ['start', RIGHT.end - 4 * ADVANCE],
    ['center', (RIGHT.start + RIGHT.end - 4 * ADVANCE) / 2],
    ['end', RIGHT.start],
    ['both', RIGHT.end - 4 * ADVANCE],
  ])('places one %s-aligned word inside the right passage', (jc, x) => {
    const [line] = linesBeside(rtlParagraph(jc, rtlRun('שלום')));
    expect(line!.spans).toHaveLength(1);
    expect(line!.spans[0]!.box.x).toBeCloseTo(x, 6);
  });

  test('keeps a left-to-right run in reading order inside its passage', () => {
    const runs =
      rtlRun('אא בבב ') + ltrRun('abc def ') + rtlRun('גג דדדד הה ווו זז חחחח טט ייי כככ לל');
    const [line] = twoPartLines(linesBeside(rtlParagraph('center', runs)));
    const [first, second] = partsOf(line!);
    expectInside(first!, RIGHT);
    expectInside(second!, LEFT);
    const latin = first!.filter((span) => /[a-z]/.test(span.text));
    expect(latin.length).toBeGreaterThan(0);
    for (const span of latin) expect(span.style.shaping?.direction).toBe('ltr');
    // The Latin words read left to right; the Hebrew words before them stand to their right.
    const abc = first!.find((span) => span.text.includes('abc'))!;
    const hebrewFirst = first![0]!;
    expect(hebrewFirst.box.x).toBeGreaterThan(abc.box.x);
    const { start, end } = glyphs(first!);
    expect((start + end) / 2).toBeCloseTo((RIGHT.start + RIGHT.end) / 2, 6);
  });

  test('narrows only the first passage by a first-line indent', () => {
    const lines = linesBeside(rtlParagraph('start', rtlRun(HEBREW), '<w:ind w:firstLine="400"/>'));
    const [first, second] = partsOf(lines[0]!);
    expect(glyphs(first!).end).toBeCloseTo(RIGHT.end - 20, 6);
    expect(glyphs(second!).end).toBeCloseTo(LEFT.end, 6);
    const [later] = partsOf(lines[1]!);
    expect(glyphs(later!).end).toBeCloseTo(RIGHT.end, 6);
  });

  test('lets a hanging first line reach past the start indent', () => {
    // A 40pt start indent on the right; the first line hangs 20pt back toward the edge.
    const lines = linesBeside(
      rtlParagraph('start', rtlRun(HEBREW), '<w:ind w:start="800" w:hanging="400"/>')
    );
    expect(partsOf(lines[0]!)).toHaveLength(2);
    expect(glyphs(partsOf(lines[0]!)[0]!).end).toBeCloseTo(RIGHT.end - 20, 6);
    for (const line of lines.slice(1, 3)) {
      expect(glyphs(partsOf(line)[0]!).end).toBeCloseTo(RIGHT.end - 40, 6);
    }
  });

  test('keeps physical wrap sides', () => {
    // A float over [70, 110) leaves 70pt on each side.
    for (const [textSide, passage] of [
      ['left', { start: 0, end: 70 }],
      ['right', { start: 110, end: 180 }],
    ] as const) {
      for (const line of besideOnly(textSide, true)) {
        for (const span of glyphSpans(line)) expectInside([span], passage);
      }
    }
  });

  test('breaks a largest-side tie by physical side and compatibility mode', () => {
    // Before mode 15 a tie keeps the right side, from mode 15 the left, in either direction.
    for (const rtl of [true, false]) {
      for (const [mode, passage] of [
        [undefined, { start: 110, end: 180 }],
        [14, { start: 110, end: 180 }],
        [15, { start: 0, end: 70 }],
      ] as const) {
        for (const line of besideOnly('largest', rtl, mode)) {
          for (const span of glyphSpans(line)) expectInside([span], passage);
        }
      }
    }
  });

  test('keeps the wrap distance on its physical side', () => {
    // 10pt of wrap distance on the float's left only: the left passage ends at 50.
    const lines = twoPartLines(
      linesBeside(rtlParagraph('start', rtlRun(HEBREW)), {
        input: { wrapDistances: { top: 0, right: 0, bottom: 0, left: 10 } },
      })
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      const [first, second] = partsOf(line);
      expectInside(first!, RIGHT);
      expectInside(second!, { start: 0, end: 50 });
      expect(glyphs(second!).end).toBeCloseTo(50, 6);
    }
  });

  test('wraps around a tight polygon on its physical side', () => {
    // The contour covers [60, 100), as the square bounds do, so only a mirrored contour fits.
    const polygon = [
      { x: 60, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 70 },
      { x: 60, y: 70 },
    ];
    const lines = twoPartLines(
      linesBeside(rtlParagraph('center', rtlRun(HEBREW)), {
        input: { mode: 'tight', polygon, contentBounds: { x: 60, y: 0, width: 40, height: 70 } },
      })
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      const [first, second] = partsOf(line);
      expectInside(first!, RIGHT);
      expectInside(second!, LEFT);
    }
  });

  test('keeps every part out of a physical left indent', () => {
    // `w:end` is the physical left indent of a right-to-left paragraph: 40pt here, with a
    // float over [80, 120), so the passages are [120, 180) and [40, 80).
    const near = { start: 120, end: 180 };
    const far = { start: 40, end: 80 };
    for (const jc of ['start', 'center', 'end', 'both']) {
      const all = linesBeside(rtlParagraph(jc, rtlRun(HEBREW), '<w:ind w:end="800"/>'), {
        left: 80,
      });
      const lines = twoPartLines(all).filter((line) => line !== all.at(-1));
      expect(lines.length).toBeGreaterThanOrEqual(2);
      for (const line of lines) {
        const [first, second] = partsOf(line);
        expectInside(first!, near);
        expectInside(second!, far);
        const { start, end } = glyphs(second!);
        if (jc === 'start') expect(end).toBeCloseTo(far.end, 6);
        if (jc === 'end' || jc === 'both') expect(start).toBeCloseTo(far.start, 6);
        if (jc === 'center') expect((start + end) / 2).toBeCloseTo(60, 6);
        if (jc === 'both') expect(end).toBeCloseTo(far.end, 6);
      }
    }
  });

  test('fills three passages from the right between two floats', () => {
    // Floats over [20, 50) and [100, 130): passages [130, 180), [50, 100), and [0, 20).
    const passages = [
      { start: 130, end: 180 },
      { start: 50, end: 100 },
      { start: 0, end: 20 },
    ];
    const text = 'אא בב גג דד הה וו זז חח טט יי ככ לל ממ נן סס עע פפ צצ קק רר שש תת';
    for (const jc of ['start', 'center']) {
      const lines = linesBeside(rtlParagraph(jc, rtlRun(text)), {
        left: 20,
        width: 30,
        more: [{ left: 100, width: 30 }],
      }).filter((line) => partsOf(line).length === 3);
      expect(lines.length).toBeGreaterThanOrEqual(2);
      for (const line of lines) {
        for (const [index, part] of partsOf(line).entries()) {
          const passage = passages[index]!;
          const { start, end } = glyphs(part);
          expectInside(part, passage);
          if (jc === 'start') expect(end).toBeCloseTo(passage.end, 6);
          else expect((start + end) / 2).toBeCloseTo((passage.start + passage.end) / 2, 6);
        }
      }
    }
  });

  test('keeps a tab stop measured from the start edge beside a float', () => {
    const paragraph = rtlParagraph('start', rtlRun('אא') + '<w:r><w:tab/></w:r>' + rtlRun(HEBREW));
    const tabOf = (lines: readonly LineRecord[]) => {
      const [line] = lines;
      const index = line!.spans.findIndex((span) => span.text === '\t');
      return { tab: line!.spans[index]!, after: line!.spans[index + 1]! };
    };
    const beside = tabOf(linesBeside(paragraph));
    const plain = tabOf(linesOf(layoutWithoutFloat(loadBody(paragraph))));
    // The text after the tab ends at the 36pt default stop from the right edge.
    expect(beside.after.box.x + beside.after.box.width).toBeCloseTo(RIGHT.end - 36, 6);
    expect(beside.tab.box.width).toBeCloseTo(plain.tab.box.width, 6);
    expect(beside.tab.box.x).toBeCloseTo(plain.tab.box.x, 6);
  });

  test('lays out a line the float does not reach as it would without the float', () => {
    const source = loadBody(rtlParagraph('center', rtlRun(HEBREW)));
    const target = source.root.children
      .flatMap((child) => ('children' in child ? child.children : []))
      .find((child) => child.kind === 'paragraph')!;
    // A float far below the paragraph's lines.
    const zone = squareWrapZone({
      anchorParagraphId: target.id,
      top: 75,
      height: 5,
      left: 60,
      width: 40,
    });
    const under = linesOf(layoutUnderFloat(source, new Map([[0, [zone]]])));
    const plain = linesOf(layoutWithoutFloat(source));
    expect(under.map((line) => line.spans)).toEqual(plain.map((line) => line.spans));
  });

  test('places carets and hits inside the passages', () => {
    const source = loadBody(rtlParagraph('center', rtlRun(HEBREW)));
    const target = source.root.children
      .flatMap((child) => ('children' in child ? child.children : []))
      .find((child) => child.kind === 'paragraph')!;
    const layout = layoutUnderFloat(source, new Map([[0, [zoneFor(target.id)]]]));
    const measurer = createFixedMeasurer();
    const split = new Set(twoPartLines(linesOf(layout)).map((line) => line.id));
    expect(split.size).toBeGreaterThanOrEqual(2);
    const stops = caretStops(layout, measurer).filter((stop) => split.has(stop.lineId));
    expect(stops.length).toBeGreaterThan(20);
    for (const stop of stops) {
      // Never over the float.
      expect(stop.x <= LEFT.end + 0.001 || stop.x >= RIGHT.start - 0.001).toBe(true);
      const painted = caretAt(layout, stop.position, measurer);
      expect(painted!.x).toBeCloseTo(stop.x, 6);
    }
    for (const line of linesOf(layout).filter((candidate) => split.has(candidate.id))) {
      for (const span of line.spans) {
        if (!span.text.trim()) continue;
        const point = { x: span.box.x + span.box.width / 2, y: line.box.y + line.box.height / 2 };
        const hit = hitTestPage(layout, 0, point, { measurer });
        expect(hit!.position.offset).toBeGreaterThanOrEqual(span.range.start);
        expect(hit!.position.offset).toBeLessThanOrEqual(span.range.end);
      }
    }
  });

  test('returns the previous pages by identity on a no-change pass', () => {
    const source = loadBody(rtlParagraph('center', rtlRun(HEBREW)));
    const target = source.root.children
      .flatMap((child) => ('children' in child ? child.children : []))
      .find((child) => child.kind === 'paragraph')!;
    const zones = new Map([[0, [zoneFor(target.id)]]]);
    const options = {
      measurer: createFixedMeasurer(),
      geometry: { width: 200, height: 100, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
      inlineDrawingLayout: {
        ownerPartName: '/word/document.xml',
        project: () => null,
        resourceOf: () => {
          throw new Error('no drawings');
        },
      },
      drawingExclusionZonesByPage: zones,
      drawingExclusionPass: 0,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    const first = layoutSemanticDocument(source, 1, options);
    expect(twoPartLines(linesOf(first)).length).toBeGreaterThanOrEqual(2);
    expect(layoutSemanticDocument(source, 2, options).pages).toBe(first.pages);
  });
});

test('a remainder after a clearing break clears its own float in either direction', () => {
  // The paragraph's own 30pt float stands at its start edge and is published on the page. The
  // remainder after `w:br w:clear` restarts below it, as on the first pass.
  for (const [rtl, clear] of [
    [false, 'all'],
    [false, 'left'],
    [true, 'all'],
    [true, 'right'],
  ] as const) {
    const part = loadBody(
      `<w:p><w:pPr>${rtl ? '<w:bidi/>' : ''}</w:pPr>${rtlRun('אא')}` +
        `<w:r><w:br w:type="textWrapping" w:clear="${clear}"/></w:r>${rtlRun('בב גג')}</w:p>`
    );
    const paragraph = part.root.children
      .flatMap((node) => ('children' in node ? node.children : []))
      .find((node) => node.kind === 'paragraph')!;
    const zone = {
      ...squareWrapZone({
        anchorParagraphId: paragraph.id,
        top: 0,
        height: 30,
        left: rtl ? 100 : 0,
        width: 80,
      }),
      anchorModelStart: 0,
    };
    const lines = breakParagraph(
      paragraph,
      paragraph.id,
      0,
      180,
      createFixedMeasurer(),
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      { paragraphRtl: rtl, startOffset: 3, pageExclusionZones: [zone], paragraphStartY: 0 }
    );
    expect(lines[0]!.exclusionSkipBefore).toBe(30);
  }
});

test('a left-to-right paragraph keeps its zone list unless a zone wraps on the largest side', () => {
  const zone = zoneFor('paragraph');
  const largest = zoneFor('paragraph', { textSide: 'largest' });
  const space = wrapBreakSpace(false, 0, 180, {
    firstLineOffset: 0,
    contentLeft: 0,
    wrapRight: 180,
    largestTieLeft: true,
  });
  const plain = [zone];
  expect(space.zones(plain)).toBe(plain);
  const mixed = [zone, largest];
  const seen = space.zones(mixed);
  expect(seen).not.toBe(mixed);
  expect(seen[0]).toBe(zone);
  expect(seen[1]!.input.largestTie).toBe('left');
  // Each zone keeps one image, so identity checks across calls still hold.
  expect(space.zones(mixed)[1]).toBe(seen[1]);
});

describe('a left-to-right paragraph with right-to-left text beside a float', () => {
  test('centres each part inside its own passage', () => {
    const words = 'aa bbb cc dddd ee fff gg hhhh ii jjj kk llll mm nnn oo pppp qq rrr ss tttt';
    const runs = ltrRun('aa bbb cc ') + rtlRun('אא בבב גג דדדד הה ') + ltrRun(words);
    const lines = twoPartLines(
      linesBeside(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${runs}</w:p>`)
    ).filter((line) => line.spans.some((span) => span.style.shaping?.direction === 'rtl'));
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      for (const [index, part] of partsOf(line).entries()) {
        const passage = index === 0 ? LEFT : RIGHT;
        const { start, end } = glyphs(part, false);
        expectInside(part, passage);
        expect((start + end) / 2).toBeCloseTo((passage.start + passage.end) / 2, 6);
      }
    }
  });
});

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const emu = (pt: number) => Math.round(pt * 12_700);

/** A 108 by 60pt picture `x` points into its column, square-wrapped on both sides. */
function floatRun(x: number): string {
  return (
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="column"><wp:posOffset>${emu(x)}</wp:posOffset></wp:positionH>` +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    `<wp:extent cx="${emu(108)}" cy="${emu(60)}"/>` +
    '<wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="float"/>' +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/>` +
    '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/>' +
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm>' +
    `<a:ext cx="${emu(108)}" cy="${emu(60)}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic>` +
    '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

test('a right-to-left line in a table cell fills and centres each passage', () => {
  // A cell as wide as the 468pt measure, no cell margins, and a float over [144, 252).
  const text = `${HEBREW} ${HEBREW} ${HEBREW}`;
  const part = load(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:body><w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
      '</w:tblPr><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:tc><w:tcPr>' +
      '<w:tcW w:w="9360" w:type="dxa"/></w:tcPr>' +
      `${rtlParagraph('center', floatRun(144) + rtlRun(text))}</w:tc></w:tr></w:tbl><w:p/>` +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" ' +
      'w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>'
  );
  const lines = linesOf(
    layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(),
      inlineDrawingLayout: layoutContext(part),
    })
  );
  const passages = [
    { start: 252, end: 468 },
    { start: 0, end: 144 },
  ];
  const split = twoPartLines(lines);
  expect(split.length).toBeGreaterThanOrEqual(2);
  for (const line of split) {
    for (const [index, part] of partsOf(line).entries()) {
      const passage = passages[index]!;
      const { start, end } = glyphs(part);
      expectInside(part, passage);
      expect((start + end) / 2).toBeCloseTo((passage.start + passage.end) / 2, 6);
    }
  }
});
