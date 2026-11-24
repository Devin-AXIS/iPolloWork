// A run boundary inside a word is not a break opportunity, so it must not change where the
// word goes. Each case splits the text into runs at every point inside a word and compares
// the layout with the same text in one run: line text, position, metrics and clearance, and
// the caret at every offset.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import { caretAt } from '../semantic-interaction.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-records.ts';
import { layoutContext } from './anchored-drawing-test-fixtures.ts';

const NAMESPACES = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
].join(' ');
const EMU = 12700;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const table = (content: string, twips: number) =>
  `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="${twips}"/></w:tblGrid>` +
  `<w:tr><w:tc><w:tcPr><w:tcW w:w="${twips}" w:type="dxa"/></w:tcPr>${content}</w:tc></w:tr></w:tbl>`;
const picture = (widthPt: number, heightPt: number) =>
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
  '<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  `<pic:spPr><a:xfrm><a:ext cx="${widthPt * EMU}" cy="${heightPt * EMU}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>` +
  '</pic:pic></a:graphicData></a:graphic>';
/** A 40pt high square-wrapped picture, `x` points from the column's left edge. */
const float = (x: number, widthPt: number) =>
  '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
  `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${x * EMU}</wp:posOffset></wp:positionH>` +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>14000</wp:posOffset></wp:positionV>' +
  `<wp:extent cx="${widthPt * EMU}" cy="${40 * EMU}"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="float"/>` +
  `${picture(widthPt, 40)}</wp:anchor></w:drawing></w:r>`;
const inline = (widthPt: number, heightPt: number) =>
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  `<wp:extent cx="${widthPt * EMU}" cy="${heightPt * EMU}"/><wp:docPr id="2" name="inline"/>` +
  `${picture(widthPt, heightPt)}</wp:inline></w:drawing></w:r>`;

interface Shape {
  readonly prefix: string;
  readonly text: string;
  readonly pPr?: string;
  /** Cell width in twips; the paragraph is in the body when absent. */
  readonly cell?: number;
}

function part(shape: Shape, runs: string) {
  const p = `<w:p>${shape.pPr ?? ''}${shape.prefix}${runs}</w:p>`;
  const body = shape.cell === undefined ? p : table(p, shape.cell);
  const result = readOoxmlPart(`<w:document ${NAMESPACES}><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function layout(shape: Shape, runs: string): SemanticLayout {
  const source = part(shape, runs);
  return layoutSemanticDocument(source, 0, {
    measurer: createFixedMeasurer(),
    inlineDrawingLayout: layoutContext(source),
  });
}

/** Split spans sum their widths in another order, so positions compare to 0.001pt. */
const round = (value: number) => Math.round(value * 1000) / 1000;

function summary(shape: Shape, result: SemanticLayout) {
  const block = result.pages[0]!.fragments[0]!;
  const p = block.kind === 'table' ? block.rows[0]!.cells[0]!.blocks[0]! : block;
  if (p.kind !== 'paragraph') throw new Error('Expected paragraph');
  const carets = [];
  for (let offset = 0; offset <= shape.text.length; offset++) {
    const caret = caretAt(result, { paragraphId: p.paragraphId, offset });
    carets.push(caret && [round(caret.x), round(caret.y), round(caret.height)]);
  }
  const lines = p.lines.map((line) => [
    line.spans.map((span) => span.text).join(''),
    round(line.box.y),
    round(line.box.height),
    round(line.baseline),
    round(line.exclusionSkipBefore ?? 0),
  ]);
  return { pages: result.pages.length, height: p.box.height, lines, carets };
}

/** Split points inside a word whose layout differs from the text in one run. */
function differingSplits(shape: Shape): string[] {
  const expected = summary(shape, layout(shape, run(shape.text)));
  const differing: string[] = [];
  for (let at = 1; at < shape.text.length; at++) {
    if (shape.text[at - 1] === ' ' || shape.text[at] === ' ') continue;
    const runs = run(shape.text.slice(0, at)) + run(shape.text.slice(at));
    if (!Bun.deepEquals(summary(shape, layout(shape, runs)), expected)) differing.push(`${at}`);
  }
  return differing;
}

const TEXT = 'xx AlphaBetaGam sit ametconsec adipiscing elitsed doeiusmod';

describe('a word split across runs is placed as the same text in one run', () => {
  test.each<[string, Shape]>([
    ['a float between two passages', { prefix: float(60, 300), text: TEXT }],
    ['a float at the left of a cell', { prefix: float(0, 60), text: TEXT, cell: 2000 }],
    [
      'a float and a first-line indent',
      { prefix: float(0, 300), text: TEXT, pPr: '<w:pPr><w:ind w:firstLine="720"/></w:pPr>' },
    ],
    [
      'a tall inline picture on the line the word leaves',
      { prefix: inline(40, 30), text: TEXT, cell: 2400 },
    ],
    [
      'a wide inline picture before the word',
      { prefix: inline(60, 10), text: 'AlphaBetaGam sit amet', cell: 2000 },
    ],
    [
      'an inline picture beside a float',
      { prefix: float(0, 60) + inline(30, 20), text: TEXT, cell: 3000 },
    ],
    ['a float that leaves the word but not its space', { prefix: float(0, 400), text: TEXT }],
    ['a float at the left of a wider cell', { prefix: float(0, 60), text: TEXT, cell: 2400 }],
    [
      'a word wider than the passage beside the float',
      {
        prefix: float(0, 400),
        text: 'xx AlphaBetaGammaDeltaEpsilonZetaEtaTheta sit',
        pPr: '<w:pPr><w:ind w:right="500"/></w:pPr>',
      },
    ],
  ])('%s', (_name, shape) => {
    expect(differingSplits(shape)).toEqual([]);
  });

  test('a word in three runs moves as a whole past a float', () => {
    const shape: Shape = {
      prefix: float(100, 200),
      text: 'xxxxxxxxxxx AlphaBetaGammaDelta sit',
      pPr: '<w:pPr><w:ind w:right="1000"/></w:pPr>',
    };
    const expected = summary(shape, layout(shape, run(shape.text)));
    const word = shape.text.indexOf('Alpha');
    for (const [first, second] of [
      [word + 3, word + 9],
      [word + 5, word + 14],
      [word + 12, word + 16],
    ] as const) {
      const runs =
        run(shape.text.slice(0, first)) +
        run(shape.text.slice(first, second)) +
        run(shape.text.slice(second));
      expect([first, second, summary(shape, layout(shape, runs))]).toEqual([
        first,
        second,
        expected,
      ]);
    }
  });

  test('an edit before a moved word keeps incremental layout equal to a clean pass', () => {
    const shape: Shape = { prefix: float(0, 60), text: TEXT, cell: 2000 };
    const before = part(shape, run('xx Alpha') + run('BetaGam sit ametconsec'));
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const session = createLayoutSession();
    const measurer = createFixedMeasurer();
    const options = { cache, session, measurer, inlineDrawingLayout: layoutContext(before) };
    const initial = layoutSemanticDocument(before, 0, options);
    const block = initial.pages[0]!.fragments[0]!;
    if (block.kind !== 'table') throw new Error('Expected table');
    const cellParagraph = block.rows[0]!.cells[0]!.blocks[0]!;
    if (cellParagraph.kind !== 'paragraph') throw new Error('Expected paragraph');
    const paragraphId = cellParagraph.paragraphId;
    const edited = applyTreeOp(before, { op: 'insertText', paragraphId, offset: 1, text: 'x' });
    if (!edited.ok) throw new Error(edited.reason);
    const next = { ...options, inlineDrawingLayout: layoutContext(edited.part) };
    const incremental = layoutSemanticDocument(edited.part, 1, next);
    const clean = layoutSemanticDocument(edited.part, 1, {
      measurer: createFixedMeasurer(),
      inlineDrawingLayout: layoutContext(edited.part),
    });
    expect(JSON.parse(JSON.stringify(incremental))).toEqual(JSON.parse(JSON.stringify(clean)));
  });
});

describe('a word that moves to a line where only its ink fits', () => {
  const lines = (shape: Shape) => {
    const result = layout(shape, run(shape.text));
    const block = result.pages[0]!.fragments[0]!;
    const p = block.kind === 'table' ? block.rows[0]!.cells[0]!.blocks[0]! : block;
    if (p.kind !== 'paragraph') throw new Error('Expected paragraph');
    return p.lines.map((line) => line.spans.map((span) => span.text).join(''));
  };

  test('hangs its trailing space instead of starting the next line with it', () => {
    // A 27.5 pt cell holds `Alpha` (27.3 pt) but not `Alpha `.
    expect(lines({ prefix: '', text: 'xx Alpha sit', cell: 570 })).toEqual([
      'xx ',
      'Alpha ',
      'sit',
    ]);
    expect(lines({ prefix: '', text: 'xx Alpha ', cell: 570 })).toEqual(['xx ', 'Alpha ']);
    expect(lines({ prefix: float(0, 400), text: 'xx AlphaBetaGam sit amet' })).toEqual([
      'xx ',
      'AlphaBetaGam ',
      'sit amet',
    ]);
  });
});

describe('a word of pieces that cannot be chopped', () => {
  // A body page number with no cached result is a placeholder that finalize rewrites per
  // page, so it is never cut. A cached result is ordinary text and may be.
  const fields = (count: number) => '<w:fldSimple w:instr=" PAGE "/>'.repeat(count);
  /** A square float anchored in the paragraph before the fields, 150 pt to 250 pt. */
  const earlierFloat = `${float(150, 100)}</w:p><w:p>`;

  function measured(shape: Shape, count: number) {
    const source = part(shape, fields(count));
    const base = createFixedMeasurer();
    let calls = 0;
    const measurer = {
      ...base,
      lineMetrics: (...args: Parameters<typeof base.lineMetrics>) => {
        calls += 1;
        return base.lineMetrics(...args);
      },
    };
    const result = layoutSemanticDocument(source, 0, {
      measurer,
      inlineDrawingLayout: layoutContext(source),
    });
    return { calls, result };
  }

  // Each field result continues the word and overflows, so each carries the word again.
  // Laying every span of the word again for each piece made the work quadratic.
  test.each<[string, Shape]>([
    ['in the body', { prefix: '', text: '' }],
    ['in a narrow cell', { prefix: '', text: '', cell: 400 }],
    ['beside a float', { prefix: earlierFloat, text: '' }],
  ])('%s costs line-metric work linear in its pieces', (_name, shape) => {
    const small = measured(shape, 200).calls;
    const large = measured(shape, 400).calls;
    expect(large / small).toBeLessThan(2.5);
  });

  // 27 fields fill the near passage; the 28th moves the word to the far one, which holds it.
  // A word wider than both passages moves below the float, where the whole column is clear.
  test.each([
    [28, 250],
    [60, 0],
  ])('%i fields move to the first place that holds them beside a float', (count, x) => {
    const { result } = measured({ prefix: earlierFloat, text: '' }, count);
    const p = result.pages[0]!.fragments[1]!;
    if (p.kind !== 'paragraph') throw new Error('Expected paragraph');
    const line = p.lines[0]!;
    const spans = line.spans;
    expect(spans).toHaveLength(count);
    expect(round(spans[0]!.box.x)).toBe(x);
    // The float spans 1.1pt to 41.1pt from the top of the earlier paragraph.
    if (x === 0) expect(line.box.y).toBeGreaterThanOrEqual(41.1);
    else expect(line.box.y).toBeLessThan(41.1);
    for (let index = 1; index < spans.length; index++) {
      const before = spans[index - 1]!.box;
      expect(round(spans[index]!.box.x)).toBe(round(before.x + before.width));
    }
  });

  test('cached field results wrap like the same text in runs beside a float', () => {
    const lines = (content: string) => {
      const p = layout({ prefix: earlierFloat, text: '' }, content).pages[0]!.fragments[1]!;
      if (p.kind !== 'paragraph') throw new Error('Expected paragraph');
      return p.lines.map((line) => [
        round(line.spans[0]!.box.x),
        line.spans.map((span) => span.text).join(''),
      ]);
    };
    const cached = '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>';
    expect(lines(cached.repeat(60))).toEqual(lines(run('1'.repeat(60))));
  });
});
