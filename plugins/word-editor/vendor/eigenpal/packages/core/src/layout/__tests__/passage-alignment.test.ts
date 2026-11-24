// A line that steps over a float aligns each of its parts inside the passage that holds it:
// centred text centres on each side of the picture, right-aligned text ends at each passage's
// right edge, and justified text fills each passage. Aligning the line as one block moved the
// text before the float onto the picture.

import { describe, expect, test } from 'bun:test';
import { loadBody, layoutUnderFloat, squareWrapZone, W } from './float-over-table-harness.ts';
import { linesOf, type LineRecord, type StyleSpanRecord } from '../semantic-records.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';
import { FIXED_MEASURER_CHAR_WIDTH } from '../fixed-measurer.ts';
import { lineWrapPassages } from '../line-wrap-passages.ts';
import { lineAlignmentMeasure } from '../paragraph-alignment.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

const WORDS = 'aa bbb cc dddd ee fff gg hhhh ii jjj kk llll mm nnn oo pppp qq rrr ss tttt';

/** Every body line of `paragraphXml`'s last paragraph, beside floats over `[left, right)`. */
function linesBeside(
  paragraphXml: string,
  floats: readonly { readonly left: number; readonly width: number }[]
): LineRecord[] {
  const source = loadBody(paragraphXml);
  const paragraphs = source.root.children
    .flatMap((child) => ('children' in child ? child.children : []))
    .filter((child) => child.kind === 'paragraph');
  const target = paragraphs.at(-1)!;
  const zones = floats.map((float, index) => ({
    ...squareWrapZone({
      anchorParagraphId: target.id,
      top: 0,
      height: 70,
      left: float.left,
      width: float.width,
      drawingNodeId: `float-${index}`,
    }),
    sourceKind: 'table' as const,
  }));
  return linesOf(layoutUnderFloat(source, new Map([[0, zones]]))).filter(
    (line) => line.range.paragraphId === target.id
  );
}

function paragraph(jc: string, text = WORDS): string {
  return `<w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

/** The line's parts: a new part starts at each float's jump. */
function partsOf(line: LineRecord): StyleSpanRecord[][] {
  const parts: StyleSpanRecord[][] = [];
  for (const [index, span] of line.spans.entries()) {
    if (index === 0 || (span.wrapAdvanceBefore ?? 0) > 0.001) parts.push([span]);
    else parts[parts.length - 1]!.push(span);
  }
  return parts;
}

/** Where a part's visible glyphs start and end: trailing spaces hang and do not count. */
function visible(part: readonly StyleSpanRecord[]): { start: number; end: number } {
  const last = part[part.length - 1]!;
  // The fixed measurer gives every character one advance at the run's size.
  const advance = (FIXED_MEASURER_CHAR_WIDTH * last.style.fontSizePt) / 11;
  return { start: part[0]!.box.x, end: last.box.x + last.text.trimEnd().length * advance };
}

const PASSAGES = [
  { start: 0, end: 60 },
  { start: 100, end: 180 },
];

/** Lines that hold text on both sides of the float. */
function splitLines(lines: readonly LineRecord[]): LineRecord[] {
  return lines.filter((line) => partsOf(line).length === 2);
}

describe('a line that steps over a float', () => {
  test('centres each part inside its own passage', () => {
    const lines = splitLines(linesBeside(paragraph('center'), [{ left: 60, width: 40 }]));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      for (const [index, part] of partsOf(line).entries()) {
        const { start, end } = visible(part);
        const passage = PASSAGES[index]!;
        expect(start).toBeGreaterThanOrEqual(passage.start - 0.001);
        expect(end).toBeLessThanOrEqual(passage.end + 0.001);
        expect((start + end) / 2).toBeCloseTo((passage.start + passage.end) / 2, 6);
      }
    }
  });

  test('ends each right-aligned part at its passage right edge', () => {
    const lines = splitLines(linesBeside(paragraph('right'), [{ left: 60, width: 40 }]));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      for (const [index, part] of partsOf(line).entries()) {
        expect(visible(part).end).toBeCloseTo(PASSAGES[index]!.end, 6);
      }
    }
  });

  test('justifies each part to fill its passage, and sets only the last part flush left', () => {
    const lines = linesBeside(paragraph('both'), [{ left: 60, width: 40 }]);
    const split = splitLines(lines);
    expect(split.length).toBeGreaterThanOrEqual(3);
    const last = lines.at(-1)!;
    for (const line of split) {
      for (const [index, part] of partsOf(line).entries()) {
        const { start, end } = visible(part);
        const passage = PASSAGES[index]!;
        expect(start).toBeCloseTo(passage.start, 6);
        if (line === last && index === partsOf(line).length - 1) {
          expect(end).toBeLessThan(passage.end);
        } else expect(end).toBeCloseTo(passage.end, 6);
      }
    }
  });

  test('keeps left-aligned parts where the pen placed them', () => {
    const lines = splitLines(linesBeside(paragraph('left'), [{ left: 60, width: 40 }]));
    for (const line of lines) {
      const [first, second] = partsOf(line);
      expect(first![0]!.box.x).toBe(0);
      expect(second![0]!.box.x).toBe(100);
    }
  });

  test('aligns each of three parts between two floats', () => {
    const lines = linesBeside(paragraph('center'), [
      { left: 40, width: 30 },
      { left: 110, width: 30 },
    ]);
    const passages = [
      { start: 0, end: 40 },
      { start: 70, end: 110 },
      { start: 140, end: 180 },
    ];
    const threeParts = lines.filter((line) => partsOf(line).length === 3);
    expect(threeParts.length).toBeGreaterThanOrEqual(2);
    for (const line of threeParts) {
      for (const [index, part] of partsOf(line).entries()) {
        const { start, end } = visible(part);
        expect((start + end) / 2).toBeCloseTo(
          (passages[index]!.start + passages[index]!.end) / 2,
          6
        );
      }
    }
  });

  test('centres the parts of a left-to-right line that bidi resolution shaped', () => {
    // A right-to-left word at the end gives every span of the paragraph a shaping record.
    // The passage past the float holds one word, so that part is one span ending in a space.
    const passages = [
      { start: 0, end: 60 },
      { start: 150, end: 180 },
    ];
    const lines = splitLines(
      linesBeside(paragraph('center', `${WORDS} שלום`), [{ left: 60, width: 90 }])
    ).filter((line) => line.spans.every((span) => span.style.shaping?.direction !== 'rtl'));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.some((line) => line.spans.some((span) => span.style.shaping))).toBe(true);
    for (const line of lines) {
      const parts = partsOf(line);
      expect(parts).toHaveLength(2);
      for (const [index, part] of parts.entries()) {
        const { start, end } = visible(part);
        const passage = passages[index]!;
        expect((start + end) / 2).toBeCloseTo((passage.start + passage.end) / 2, 6);
      }
    }
  });

  test('stretches every part of a justified ideographic line', () => {
    const text = '文'.repeat(60);
    const lines = linesBeside(paragraph('both', text), [{ left: 60, width: 40 }]);
    const inner = splitLines(lines).filter((line) => line !== lines.at(-1));
    expect(inner.length).toBeGreaterThanOrEqual(2);
    for (const line of inner) {
      for (const [index, part] of partsOf(line).entries()) {
        const last = part[part.length - 1]!;
        expect(part[0]!.box.x).toBeCloseTo(PASSAGES[index]!.start, 6);
        expect(last.box.x + last.box.width).toBeCloseTo(PASSAGES[index]!.end, 6);
      }
    }
  });

  test('measures a line whose pen stepped over a float without placing anything past it', () => {
    const intervals = [
      { start: 0, end: 60 },
      { start: 100, end: 180 },
    ];
    const measure = { start: 0, end: 180 };
    // Content ends at 50 in the first passage; the pen stands at the second passage's start.
    const stepped = lineWrapPassages(intervals, 0, 50, 100, measure);
    expect(stepped).toEqual({ wrapSegment: { start: 0, end: 60, contentEnd: 50 } });
    if (!stepped || !('wrapSegment' in stepped)) throw new Error('no segment');
    const aligned = lineAlignmentMeasure({ width: 100, ...stepped }, 0, 0, 180);
    expect(aligned).toEqual({ indent: 0, available: 60, used: 50 });
    // A pen that stopped with its content keeps measuring from the pen.
    expect(lineWrapPassages(intervals, 0, 50, 50, measure)).toEqual({
      wrapSegment: { start: 0, end: 60 },
    });
    // Content in both passages records both, also when the only item past the float has no
    // width, such as a break placed after the jump.
    for (const contentEnd of [150, 100]) {
      expect(lineWrapPassages(intervals, 0, contentEnd, contentEnd, measure)).toEqual({
        wrapPassages: intervals,
      });
    }
  });

  test("publishes each float's jump as the gap alignment left", () => {
    for (const jc of ['center', 'right', 'both']) {
      for (const line of splitLines(linesBeside(paragraph(jc), [{ left: 60, width: 40 }]))) {
        for (let index = 1; index < line.spans.length; index += 1) {
          const span = line.spans[index]!;
          if (!span.wrapAdvanceBefore) continue;
          const previous = line.spans[index - 1]!;
          expect(span.wrapAdvanceBefore).toBeCloseTo(
            span.box.x - (previous.box.x + previous.box.width),
            6
          );
        }
      }
    }
  });
});

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const emu = (pt: number) => Math.round(pt * 12_700);

/** A 108 by 60pt picture `x` points into its frame, square-wrapped on `wrapText`. */
function floatRun(x: number, wrapText: string, relativeFrom = 'margin'): string {
  return (
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="${relativeFrom}"><wp:posOffset>${emu(x)}</wp:posOffset></wp:positionH>` +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    `<wp:extent cx="${emu(108)}" cy="${emu(60)}"/>` +
    `<wp:wrapSquare wrapText="${wrapText}"/><wp:docPr id="1" name="float"/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/>` +
    '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/>' +
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm>' +
    `<a:ext cx="${emu(108)}" cy="${emu(60)}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic>` +
    '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

/** Letter page with 1in margins: a 468pt measure. */
function layoutBody(body: string): LineRecord[] {
  const part = load(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      `<w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" ` +
      'w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
      '</w:sectPr></w:body></w:document>'
  );
  return linesOf(
    layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(),
      inlineDrawingLayout: layoutContext(part),
    })
  );
}

const LONG = `${WORDS} ${WORDS} ${WORDS}`;

test('a line in a table cell centres each part inside its own passage', () => {
  // A cell as wide as the measure, no cell margins, and a float 144pt into it.
  const lines = layoutBody(
    '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
      '</w:tblPr><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:tc><w:tcPr>' +
      '<w:tcW w:w="9360" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
      `${floatRun(144, 'bothSides', 'column')}<w:r><w:t>${LONG}</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/>`
  );
  const passages = [
    { start: 0, end: 144 },
    { start: 252, end: 468 },
  ];
  const split = splitLines(lines);
  expect(split.length).toBeGreaterThanOrEqual(2);
  for (const line of split) {
    for (const [index, part] of partsOf(line).entries()) {
      const { start, end } = visible(part);
      const passage = passages[index]!;
      expect(start).toBeGreaterThanOrEqual(passage.start - 0.001);
      expect(end).toBeLessThanOrEqual(passage.end + 0.001);
      expect((start + end) / 2).toBeCloseTo((passage.start + passage.end) / 2, 6);
    }
  }
});

describe('square wrapping on the largest side', () => {
  /** Lines beside a 108pt float 162pt from the margin: the passage to its right is larger. */
  function linesBesideFloat(wrapText: string): LineRecord[] {
    return layoutBody(
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${floatRun(162, wrapText)}` +
        `<w:r><w:t>${LONG}</w:t></w:r></w:p>`
    );
  }

  test('keeps text off the smaller side of the float', () => {
    const beside = linesBesideFloat('largest').filter((line) => line.box.y < 50);
    expect(beside.length).toBeGreaterThan(0);
    for (const line of beside) {
      for (const span of line.spans) expect(span.box.x).toBeGreaterThanOrEqual(270 - 0.001);
    }
    const both = linesBesideFloat('bothSides').filter((line) => line.box.y < 50);
    expect(both.some((line) => line.spans.some((span) => span.box.x < 162))).toBe(true);
  });
});
