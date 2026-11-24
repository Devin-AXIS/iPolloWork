import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { NO_THEME_FONTS } from '../run-style.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import { hitTestSemantic } from '../semantic-point-queries.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { linesOf, type LineRecord } from '../semantic-records.ts';
import { distributeLineCharacters, SPACE_SHARE_LIMIT } from '../distributed-character-spacing.ts';
import { loadBody, layoutUnderFloat, squareWrapZone, W } from './float-over-table-harness.ts';

// 10pt per character at 11pt and a 100pt measure, so every position is checkable by hand.
const measurer = createFixedMeasurer(10, 14);
const geometry = { width: 120, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } };
const RUN = '<w:rPr><w:sz w:val="22"/></w:rPr>';
const run = (text: string, rPr = RUN) => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (content: string, pPr = '<w:jc w:val="distribute"/>') =>
  `<w:p><w:pPr>${pPr}</w:pPr>${content}</w:p>`;

function root(xml: string) {
  const result = readOoxmlPart(xml, { name: '/word/part.xml', contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}
const settings = (mode: number) =>
  root(
    `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${mode}"/></w:compat></w:settings>`
  );
/** A cascade for `docDefaults` (null: no styles part) under `mode` (null: no settings part). */
function styles(docDefaults: string | null, mode: number | null = 15) {
  const stylesRoot =
    docDefaults === null
      ? null
      : root(
          `<w:styles xmlns:w="${W}">${docDefaults}<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`
        );
  return buildStyleCascadeTable(stylesRoot, NO_THEME_FONTS, mode === null ? null : settings(mode));
}
type Cascade = ReturnType<typeof styles>;

/** Modern-mode packages whose styles part authors a `w:rPrDefault`, even an empty one. */
const WITH_RUN_DEFAULTS = {
  'an empty rPrDefault': styles('<w:docDefaults><w:rPrDefault/></w:docDefaults>'),
  'an rPrDefault with properties': styles(
    '<w:docDefaults><w:rPrDefault><w:rPr><w:lang w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault></w:docDefaults>'
  ),
};
/** Modern-mode packages that leave the run defaults to the application. */
const WITHOUT_RUN_DEFAULTS = {
  'no styles part': styles(null),
  'an empty docDefaults': styles('<w:docDefaults/>'),
  'only a pPrDefault': styles('<w:docDefaults><w:pPrDefault/></w:docDefaults>'),
};
/** Legacy packages spread characters whatever their defaults. */
const LEGACY = {
  'no settings part and no styles part': styles(null, null),
  'no settings part and an empty docDefaults': styles('<w:docDefaults/>', null),
  'mode 14 with only a pPrDefault': styles('<w:docDefaults><w:pPrDefault/></w:docDefaults>', 14),
  'mode 14 with an empty rPrDefault': styles('<w:docDefaults><w:rPrDefault/></w:docDefaults>', 14),
};

function layout(body: string, styleCascade: Cascade | undefined, using = measurer) {
  const source = loadBody(body);
  const before = serializeOoxmlPart(source);
  const result = layoutSemanticDocument(source, 0, {
    measurer: using,
    geometry,
    ...(styleCascade ? { styleCascade } : {}),
  });
  expect(serializeOoxmlPart(source)).toBe(before);
  return result;
}

/** Each visible span of a line as `[text, start x]`, x is content-relative. */
function placed(line: LineRecord) {
  return line.spans
    .filter((span) => span.text !== '' && span.text !== '\n')
    .map((span) => [span.text, Number(span.box.x.toFixed(6))] as const);
}

for (const [kind, cascade] of Object.entries(WITH_RUN_DEFAULTS)) {
  test(`a distributed single word spreads its letters to both edges: ${kind}`, () => {
    const [line] = linesOf(layout(paragraph(run('Text')), cascade));
    // 60pt of slack over three character gaps.
    expect(placed(line!)).toEqual([
      ['T', 0],
      ['e', 30],
      ['x', 60],
      ['t', 90],
    ]);
  });

  test(`a distributed single character stays centered: ${kind}`, () => {
    for (const text of ['X', '名']) {
      const [line] = linesOf(layout(paragraph(run(text)), cascade));
      expect(placed(line!)).toEqual([[text, 45]]);
    }
  });
}

test('spaces take their share of the slack first, the rest goes after every character', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  const [line] = linesOf(layout(paragraph(run('ab cd')), cascade));
  // 50pt of slack: the space takes 4.5pt, and four gaps share the other 45.5pt.
  const step = (50 - SPACE_SHARE_LIMIT * 10) / 4;
  expect(placed(line!).map(([text]) => text)).toEqual(['a', 'b', ' ', 'c', 'd']);
  const xs = placed(line!).map(([, x]) => x);
  expect(xs[1]).toBeCloseTo(10 + step, 6);
  expect(xs[2]).toBeCloseTo(20 + 2 * step, 6);
  expect(xs[3]).toBeCloseTo(30 + 3 * step + SPACE_SHARE_LIMIT * 10, 6);
  expect(xs[4]).toBeCloseTo(90, 6);
});

test('a line with less slack than its spaces can take stretches only its spaces', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  const [line] = linesOf(layout(paragraph(run('a b c d e')), cascade));
  // 10pt of slack, less than four spaces can take (18pt): each space takes 2.5pt, and the
  // line is not split into characters.
  expect(line!.spans.some((span) => span.text.length > 1)).toBe(true);
  const letters = (value: LineRecord) =>
    value.spans
      .filter((span) => span.text.trim() !== '')
      .map((span) => [span.text.trim(), Number(span.box.x.toFixed(6))]);
  expect(letters(line!)).toEqual([
    ['a', 0],
    ['b', 22.5],
    ['c', 45],
    ['d', 67.5],
    ['e', 90],
  ]);
});

test('leading spaces keep their advance and trailing spaces hang', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  const [leading] = linesOf(layout(paragraph(run('  ab')), cascade));
  expect(placed(leading!)).toEqual([
    [' ', 0],
    [' ', 10],
    ['a', 20],
    ['b', 90],
  ]);
  const [trailing] = linesOf(layout(paragraph(run('ab  ')), cascade));
  expect(placed(trailing!).slice(0, 2)).toEqual([
    ['a', 0],
    ['b', 90],
  ]);
});

test('an inner line whose spaces absorb its slack sets as a justified line', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  // The first line holds `a b c d e`: 10pt of slack, less than four spaces can take (18pt).
  const text = 'a b c d e f g h i j k';
  const distributed = linesOf(layout(paragraph(run(text)), cascade));
  const justified = linesOf(layout(paragraph(run(text), '<w:jc w:val="both"/>'), cascade));
  expect(distributed.length).toBeGreaterThan(1);
  const join = (line: LineRecord) => line.spans.map((span) => span.text).join('');
  expect(join(distributed[0]!)).toBe(join(justified[0]!));
  const visible = (line: LineRecord) =>
    placed(line)
      .filter(([value]) => value.trim() !== '')
      .map(([value, x]) => [value.trim(), x]);
  expect(visible(distributed[0]!)).toEqual(visible(justified[0]!));
});

test('an inner line with more slack than its spaces take spreads its characters', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  // The first line holds `aa bb cc`: 20pt of slack, two spaces take 9pt, seven gaps share 11pt.
  const lines = linesOf(layout(paragraph(run('aa bb cc dd')), cascade));
  expect(lines.length).toBe(2);
  const first = placed(lines[0]!).filter(([value]) => value.trim() !== '');
  const step = (20 - 2 * SPACE_SHARE_LIMIT * 10) / 7;
  expect(first.map(([value]) => value)).toEqual(['a', 'a', 'b', 'b', 'c', 'c']);
  expect(first[1]![1]).toBeCloseTo(10 + step, 6);
  expect(first[2]![1]).toBeCloseTo(30 + 3 * step + SPACE_SHARE_LIMIT * 10, 6);
  expect(first.at(-1)![1]).toBeCloseTo(90, 6);
});

test('a line before a manual line break spreads its characters', () => {
  const lines = linesOf(
    layout(
      paragraph(`<w:r>${RUN}<w:t>ab</w:t><w:br/><w:t>cd</w:t></w:r>`),
      WITH_RUN_DEFAULTS['an empty rPrDefault']
    )
  );
  expect(lines).toHaveLength(2);
  for (const line of lines) {
    const [first, second] = placed(line);
    expect(first![1]).toBe(0);
    expect(second![1]).toBeCloseTo(90, 6);
  }
});

test('letters spread across formatting runs and grapheme clusters stay whole', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  const [line] = linesOf(
    layout(paragraph(run('Te') + run('xt', '<w:rPr><w:b/><w:sz w:val="22"/></w:rPr>')), cascade)
  );
  expect(placed(line!)).toEqual([
    ['T', 0],
    ['e', 30],
    ['x', 60],
    ['t', 90],
  ]);
  const [cluster] = linesOf(layout(paragraph(run('café')), cascade));
  expect(placed(cluster!).map(([text]) => text)).toEqual(['c', 'a', 'f', 'é']);
});

test('a distributed East Asian line spaces every character, punctuation included', () => {
  const [line] = linesOf(
    layout(paragraph(run('「漢字」')), WITH_RUN_DEFAULTS['an empty rPrDefault'])
  );
  expect(placed(line!)).toEqual([
    ['「', 0],
    ['漢', 30],
    ['字', 60],
    ['」', 90],
  ]);
});

test('right-to-left text keeps its letters together', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  const rtl = '<w:rPr><w:rtl/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>';
  // A right-to-left paragraph stretches only its spaces, so one word centers.
  const [bidiText] = linesOf(
    layout(paragraph(run('Text'), '<w:bidi/><w:jc w:val="distribute"/>'), cascade)
  );
  expect(placed(bidiText!)[0]![1]).toBeCloseTo(30, 6);
  // A right-to-left word in a left-to-right paragraph has no gap of its own.
  const [hebrew] = linesOf(layout(paragraph(run('שלום', rtl)), cascade));
  expect(placed(hebrew!)).toEqual([['שלום', 30]]);
});

test('a distributed tab line spreads the text after its tab from the tab stop', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  const body = (alignment: string) =>
    paragraph(
      `<w:r>${RUN}<w:t>Ab</w:t><w:tab/><w:t>Cd</w:t></w:r>`,
      `<w:jc w:val="${alignment}"/>`
    );
  const left = linesOf(layout(body('left'), cascade))[0]!;
  const [line] = linesOf(layout(body('distribute'), cascade));
  const stop = left.spans.find((span) => span.text === 'Cd')!.box.x;
  // The text before the tab and the tab stop stay; the last character reaches the edge.
  expect(placed(line!)).toEqual([
    ['Ab', 0],
    ['\t', 20],
    ['C', stop],
    ['d', 90],
  ]);
});

test('a distributed single word spreads its letters in a table cell', () => {
  const [line] = linesOf(
    layout(
      `<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${paragraph(run('Cell'))}</w:tc></w:tr></w:tbl>`,
      WITH_RUN_DEFAULTS['an empty rPrDefault']
    )
  );
  expect(placed(line!).map(([, x]) => x)).toEqual([0, 30, 60, 90]);
});

test('the passages beside a float spread their characters inside each passage', () => {
  const source = loadBody(paragraph(run('aa bb cc dd ee ff gg hh ii jj kk ll mm nn')));
  const target = source.root.children
    .flatMap((child) => ('children' in child ? child.children : []))
    .find((child) => child.kind === 'paragraph')!;
  const zone = squareWrapZone({
    anchorParagraphId: target.id,
    top: 0,
    height: 70,
    left: 60,
    width: 40,
  });
  const result = layoutUnderFloat(source, new Map([[0, [zone]]]), undefined, {
    styleCascade: WITH_RUN_DEFAULTS['an empty rPrDefault'],
  });
  const last = linesOf(result).at(-1)!;
  const jump = last.spans.findIndex((span) => (span.wrapAdvanceBefore ?? 0) > 0.001);
  expect(jump).toBeGreaterThan(0);
  // Each part spreads inside its own passage and keeps the float's jump between them.
  for (const [part, edge] of [
    [last.spans.slice(0, jump), 60],
    [last.spans.slice(jump), 180],
  ] as const) {
    const visible = part.filter((span) => span.text.trim() !== '');
    expect(visible.every((span) => span.text.length === 1)).toBe(true);
    const end = visible.at(-1)!;
    expect(end.box.x + end.box.width).toBeCloseTo(edge, 6);
  }
});

test('the caret and hit testing follow the spread letters', () => {
  const result = layout(paragraph(run('Text')), WITH_RUN_DEFAULTS['an empty rPrDefault']);
  const [line] = linesOf(result);
  const paragraphId = line!.spans[0]!.range.paragraphId;
  const caret = caretAt(result, { paragraphId, offset: 2 }, measurer)!;
  const x = line!.spans.find((span) => span.text === 'x')!;
  expect(caret.x).toBeCloseTo(x.box.x, 6);
  const hit = hitTestSemantic(result, { x: x.box.x + 2, y: caret.y + 1 })!;
  expect(hit.position).toEqual({ paragraphId, offset: 2 });
});

for (const [kind, cascade] of Object.entries(WITHOUT_RUN_DEFAULTS)) {
  test(`without run defaults a distributed line stretches only its spaces: ${kind}`, () => {
    const [word] = linesOf(layout(paragraph(run('Text')), cascade));
    expect(placed(word!)).toEqual([['Text', 30]]);
    const [spaced] = linesOf(layout(paragraph(run('ab cd')), cascade));
    expect(placed(spaced!).map(([text]) => text)).toEqual(['ab ', 'cd']);
    expect(placed(spaced!)[1]![1]).toBeCloseTo(80, 6);
    // Spaces before the first character are no slot, so the line centers with them.
    const [leading] = linesOf(layout(paragraph(run('  ab')), cascade));
    const a = placed(leading!).find(([text]) => text.startsWith('a'))!;
    expect(a[1]).toBeCloseTo(50, 6);
  });
}

test('paint draws each spread letter at its layout position', () => {
  const result = layout(paragraph(run('Text')), WITH_RUN_DEFAULTS['an empty rPrDefault']);
  const host = document.createElement('div');
  paintSemanticLayout(host, result, { scale: 1 });
  const element = host.querySelector<HTMLElement>('.docx-line')!;
  const runs = Array.from(element.querySelectorAll<HTMLElement>('.layout-run-text'));
  expect(runs.map((painted) => painted.textContent)).toEqual(['T', 'e', 'x', 't']);
  // Each gap is letter spacing on the letter before it, so underline and highlight run on.
  expect(runs.map((painted) => painted.style.marginLeft)).toEqual(['', '', '', '']);
  expect(runs.map((painted) => painted.style.letterSpacing)).toEqual(['20px', '20px', '20px', '']);
});

test('paint keeps underline and highlight on the gaps of split East Asian and spread lines', () => {
  const marked =
    '<w:rPr><w:u w:val="single"/><w:highlight w:val="yellow"/><w:sz w:val="22"/></w:rPr>';
  for (const [body, cascade] of [
    [paragraph(run('Text', marked)), WITH_RUN_DEFAULTS['an empty rPrDefault']],
    // A justified East Asian line splits per character in every document: at 10.5pt, ten
    // characters leave 4.5pt of slack.
    [
      paragraph(
        run('甲乙丙丁戊己庚辛壬癸子丑', marked.replace('"22"', '"21"')),
        '<w:jc w:val="both"/>'
      ),
      undefined,
    ],
  ] as const) {
    const result = layout(body, cascade);
    const host = document.createElement('div');
    paintSemanticLayout(host, result, { scale: 1 });
    const runs = Array.from(
      host
        .querySelector<HTMLElement>('.docx-line')!
        .querySelectorAll<HTMLElement>('.layout-run-text')
    );
    const line = linesOf(result)[0]!;
    expect(runs.length).toBe(line.spans.length);
    expect(runs.length).toBeGreaterThan(1);
    for (const [index, painted] of runs.entries()) {
      expect(painted.style.marginLeft).toBe('');
      const span = line.spans[index]!;
      const next = line.spans[index + 1];
      const gap = next ? next.box.x - (span.box.x + span.box.width) : 0;
      if (gap > 0.001) expect(parseFloat(painted.style.letterSpacing)).toBeCloseTo(gap, 6);
    }
    expect(runs.some((painted) => painted.style.letterSpacing !== '')).toBe(true);
  }
});

for (const [kind, cascade] of Object.entries(LEGACY)) {
  test(`a legacy package spreads characters whatever its defaults: ${kind}`, () => {
    const [word] = linesOf(layout(paragraph(run('Text')), cascade));
    expect(placed(word!)).toEqual([
      ['T', 0],
      ['e', 30],
      ['x', 60],
      ['t', 90],
    ]);
    // An inner line spreads too.
    const [inner] = linesOf(layout(paragraph(run('aa bb cc dd')), cascade));
    expect(placed(inner!).filter(([value]) => value.trim() !== '').length).toBe(6);
  });
}

test('in a legacy package a space takes its face average width less its own advance', () => {
  // 4pt per character at 11pt, so `ab cd` leaves 80pt of slack. Times New Roman averages
  // 821/2048 em, 4.4097pt at 11pt, so the space takes 0.4097pt and four gaps share the rest.
  const narrow = createFixedMeasurer(4, 14);
  const tnr =
    '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="22"/></w:rPr>';
  const xs = (cascade: Cascade) =>
    placed(linesOf(layout(paragraph(run('ab cd', tnr)), cascade, narrow))[0]!).map(([, x]) => x);
  const capacity = (821 / 2048) * 11 - 4;
  const legacyStep = (80 - capacity) / 4;
  const legacy = xs(LEGACY['mode 14 with an empty rPrDefault']);
  expect(legacy[1]).toBeCloseTo(4 + legacyStep, 6);
  expect(legacy[3]).toBeCloseTo(12 + 3 * legacyStep + capacity, 6);
  // A modern package gives the same space 45 percent of its own advance.
  const modern = xs(WITH_RUN_DEFAULTS['an empty rPrDefault']);
  expect(modern[1]).toBeCloseTo(4 + (80 - SPACE_SHARE_LIMIT * 4) / 4, 6);
});

test('distributeLineCharacters reports a line with no character gap', () => {
  const [line] = linesOf(layout(paragraph(run('X')), undefined));
  expect(distributeLineCharacters(line!.spans, measurer, 90, line!.spans.length)).toBeNull();
});

// Pair kerning (`w:kern`) holds a run's letters together on a modern character-distributed
// line. The runs here are 11pt (`w:sz` 22); kerning is on when `w:kern` is not 0 and at most 22.
const kerned = (halfPoints: number) =>
  `<w:rPr><w:sz w:val="22"/><w:kern w:val="${halfPoints}"/></w:rPr>`;
const runDefaults = (rPr: string) =>
  `<w:docDefaults><w:rPrDefault><w:rPr>${rPr}</w:rPr></w:rPrDefault></w:docDefaults>`;

test('a kerned run keeps its letters together and an unkerned run beside it spreads', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  // No gap inside `Wo`, none between `o` and `r`: all 60pt of slack goes between `r` and `d`.
  const [after] = linesOf(layout(paragraph(run('Wo', kerned(2)) + run('rd', kerned(0))), cascade));
  expect(placed(after!)).toEqual([
    ['Wo', 0],
    ['r', 20],
    ['d', 90],
  ]);
  // Mirrored: the gap opens between `W` and `o` only.
  const [before] = linesOf(layout(paragraph(run('Wo', kerned(0)) + run('rd', kerned(2))), cascade));
  expect(placed(before!)).toEqual([
    ['W', 0],
    ['o', 70],
    ['rd', 80],
  ]);
});

test('a kerned run stretches at its spaces, and a space opens a gap after it only', () => {
  const cascade = WITH_RUN_DEFAULTS['an empty rPrDefault'];
  // Gaps open between `a` and `b` and after the kerned space: 50pt of slack, the space takes
  // 4.5pt, and two gaps share the other 45.5pt.
  const [line] = linesOf(layout(paragraph(run('ab', kerned(0)) + run(' cd', kerned(2))), cascade));
  const step = (50 - SPACE_SHARE_LIMIT * 10) / 2;
  expect(placed(line!).map(([text]) => text)).toEqual(['a', 'b', ' ', 'cd']);
  const xs = placed(line!).map(([, x]) => x);
  expect(xs[1]).toBeCloseTo(10 + step, 6);
  expect(xs[2]).toBeCloseTo(20 + step, 6);
  expect(xs[3]).toBeCloseTo(80, 6);
  // A kerned line with spaces sets as a justified line: words whole, spaces stretched.
  const [words] = linesOf(layout(paragraph(run('ab cd', kerned(2))), cascade));
  expect(placed(words!).filter(([text]) => text.trim() !== '')).toEqual([
    ['ab', 0],
    ['cd', 80],
  ]);
});

test('the common kerning default keeps a distributed single word centered', () => {
  const cascade = styles(runDefaults('<w:kern w:val="2"/>'));
  const [line] = linesOf(layout(paragraph(run('Text')), cascade));
  expect(placed(line!)).toEqual([['Text', 30]]);
  // An explicit `w:kern w:val="0"` on the run turns the inherited kerning off again.
  const [unkerned] = linesOf(layout(paragraph(run('Text', kerned(0))), cascade));
  expect(placed(unkerned!).map(([, x]) => x)).toEqual([0, 30, 60, 90]);
});

test('a kerning threshold above the run size does not hold the letters', () => {
  // 12pt threshold, 11pt runs: kerning is off, so the word spreads.
  const [above] = linesOf(
    layout(paragraph(run('Text')), styles(runDefaults('<w:kern w:val="24"/>')))
  );
  expect(placed(above!).map(([, x]) => x)).toEqual([0, 30, 60, 90]);
  // A threshold equal to the run size kerns, so the word centers.
  const [equal] = linesOf(
    layout(paragraph(run('Text')), styles(runDefaults('<w:kern w:val="22"/>')))
  );
  expect(placed(equal!)).toEqual([['Text', 30]]);
});

test('kerning does not hold East Asian characters together', () => {
  const cascade = styles(runDefaults('<w:kern w:val="2"/>'));
  const [cjk] = linesOf(layout(paragraph(run('漢字漢字')), cascade));
  expect(placed(cjk!)).toEqual([
    ['漢', 0],
    ['字', 30],
    ['漢', 60],
    ['字', 90],
  ]);
  // Latin text between East Asian characters stays whole; the gaps beside it still open.
  const [mixed] = linesOf(layout(paragraph(run('漢ab漢')), cascade));
  expect(placed(mixed!).map(([text]) => text)).toEqual(['漢', 'ab', '漢']);
});

test('a legacy package spreads kerned runs too', () => {
  const kernDefault = runDefaults('<w:kern w:val="2"/>');
  for (const cascade of [styles(kernDefault, 14), styles(kernDefault, null)]) {
    const [line] = linesOf(layout(paragraph(run('Text')), cascade));
    expect(placed(line!).map(([, x]) => x)).toEqual([0, 30, 60, 90]);
  }
});

test('a kerned space opens no gap before itself, even after an East Asian character', () => {
  const xs = (cascade: Cascade) =>
    placed(linesOf(layout(paragraph(run('가나 다라')), cascade))[0]!).map(([, x]) => x);
  // Kerned: gaps open between 가 and 나, after the space, and between 다 and 라.
  const kernedStep = (50 - SPACE_SHARE_LIMIT * 10) / 3;
  const kernedXs = xs(styles(runDefaults('<w:kern w:val="2"/>')));
  expect(kernedXs[1]).toBeCloseTo(10 + kernedStep, 6);
  expect(kernedXs[3]).toBeCloseTo(30 + 2 * kernedStep + SPACE_SHARE_LIMIT * 10, 6);
  // Unkerned: the boundary before the space opens a gap too.
  const step = (50 - SPACE_SHARE_LIMIT * 10) / 4;
  expect(xs(WITH_RUN_DEFAULTS['an empty rPrDefault'])[1]).toBeCloseTo(10 + step, 6);
});
