import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type SemanticLayout } from '../semantic-records.ts';
import { caretAt, caretStops } from '../semantic-interaction.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { bidiDirectionOfStop, horizontalCaretStep } from '../visual-caret-navigation.ts';
import { directedEmbeddingLevels } from '../bidi-directives.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function part(xml: string, name = '/word/document.xml') {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw Error(result.reason);
  return result.part;
}

const run = (text: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

function layout(content: string, pPr = ''): SemanticLayout {
  return layoutSemanticDocument(
    part(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${pPr}</w:pPr>${content}</w:p><w:sectPr><w:pgSz w:w="6000" w:h="5000"/><w:pgMar w:left="300" w:right="300" w:top="300" w:bottom="300"/></w:sectPr></w:body></w:document>`
    ),
    0,
    {
      measurer,
      styleCascade: buildStyleCascadeTable(
        part(
          `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault><w:pPrDefault/></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/></w:style></w:styles>`,
          '/word/styles.xml'
        ).root
      ),
    }
  );
}

/** The characters of the first line in painted order, left to right. */
function visualText(result: SemanticLayout): string {
  const line = linesOf(result)[0]!;
  return [...line.spans]
    .sort((a, b) => a.box.x - b.box.x)
    .map((span) =>
      span.style.shaping?.direction === 'rtl' ? [...span.text].reverse().join('') : span.text
    )
    .join('');
}

function caretXs(result: SemanticLayout, length: number): number[] {
  const paragraphId = linesOf(result)[0]!.range.paragraphId;
  return Array.from({ length: length + 1 }, (_, offset) => {
    const caret = caretAt(result, { paragraphId, offset }, measurer);
    if (!caret) throw Error(`no caret at ${offset}`);
    return caret.x;
  });
}

test('a right-to-left override paints its letters in reverse order', () => {
  const result = layout(`${run('x ')}<w:bdo w:val="rtl">${run('abc')}</w:bdo>${run(' y')}`);
  expect(visualText(result)).toBe('x cba y');
  const override = linesOf(result)[0]!.spans.find((span) => span.text === 'abc')!;
  expect(override.style.shaping?.direction).toBe('rtl');
  expect(override.style.shaping?.override).toBe('rtl');
});

test('paint draws an override span with the override, and plain spans as isolates', () => {
  const result = layout(`${run('x ')}<w:bdo w:val="rtl">${run('abc')}</w:bdo>${run(' y')}`);
  const host = document.createElement('div');
  paintSemanticLayout(host, result, { scale: 1 });
  const elements = Array.from(host.querySelectorAll<HTMLElement>('.layout-run-text'));
  const override = elements.find((element) => element.textContent === 'abc')!;
  expect(override.style.direction).toBe('rtl');
  expect(override.style.unicodeBidi).toBe('isolate-override');
  for (const element of elements.filter((item) => item !== override))
    expect(element.style.unicodeBidi).toBe('isolate');
});

test('the caret moves right to left through a right-to-left override', () => {
  const result = layout(`${run('x ')}<w:bdo w:val="rtl">${run('abc')}</w:bdo>${run(' y')}`);
  const xs = caretXs(result, 7);
  // Offsets 2..5 cover `abc`: the caret after `a` sits left of the caret before it.
  expect(xs[3]).toBeLessThan(xs[2]!);
  expect(xs[4]).toBeLessThan(xs[3]!);
  // Every offset clicks back to itself.
  const line = linesOf(result)[0]!;
  for (const offset of [3, 4]) {
    const hit = hitTestPage(
      result,
      0,
      { x: xs[offset]!, y: line.box.y + line.box.height / 2 },
      { measurer }
    );
    expect(hit?.position.offset).toBe(offset);
  }
});

test('arrow keys move by painted position through a right-to-left override', () => {
  const result = layout(`${run('x ')}<w:bdo w:val="rtl">${run('abc')}</w:bdo>${run(' y')}`);
  const stops = caretStops(result, measurer);
  const at = stops.findIndex((stop) => stop.position.offset === 3);
  const directionOf = (stop: (typeof stops)[number]) => bidiDirectionOfStop(result, stop);
  // Between `a` and `b`, painted as `cba`: ArrowLeft passes `b`, ArrowRight passes `a`.
  expect(horizontalCaretStep(stops, at, -1, directionOf).target?.position.offset).toBe(4);
  expect(horizontalCaretStep(stops, at, 1, directionOf).target?.position.offset).toBe(2);
});

test('a right-to-left embedding keeps letters in order and moves its trailing neutral', () => {
  // The letters resolve to level 2 and keep their order; the trailing `!` takes the
  // embedding's direction and moves to its left.
  const result = layout(`${run('x ')}<w:dir w:val="rtl">${run('ab!')}</w:dir>`);
  expect(visualText(result)).toBe('x !ab');
});

test('a left-to-right override keeps Hebrew letters in logical order', () => {
  const result = layout(`<w:bdo w:val="ltr">${run('אבג')}</w:bdo>`);
  expect(visualText(result)).toBe('אבג');
});

test('an unknown direction value leaves the wrapper transparent', () => {
  const result = layout(`<w:bdo w:val="up">${run('abc')}</w:bdo>`);
  expect(visualText(result)).toBe('abc');
  expect(linesOf(result)[0]!.spans[0]!.style.shaping).toBeUndefined();
});

test('East Asian font slicing inside a wrapper matches the slicing outside it', () => {
  const fonts = '<w:rFonts w:ascii="Latin Face" w:hAnsi="Latin Face" w:eastAsia="MS Mincho"/>';
  const text = run('ab漢字cd', fonts);
  const spans = (content: string) =>
    linesOf(layout(content))[0]!.spans.map((span) => [
      span.text,
      span.style.fontFamily,
      span.style.fontFamilyEastAsia,
    ]);
  // Under a right-to-left directive the slices keep their text and faces; only order changes.
  const slices = (content: string) =>
    linesOf(layout(content))[0]!
      .spans.map((span) => `${span.text}|${span.style.fontFamilyEastAsia}`)
      .sort();
  const plain = spans(text);
  expect(plain.map(([slice]) => slice)).toEqual(['ab', '漢字', 'cd']);
  expect(spans(`<w:bdo w:val="ltr">${text}</w:bdo>`)).toEqual(plain);
  expect(spans(`<w:dir w:val="ltr">${text}</w:dir>`)).toEqual(plain);
  expect(slices(`<w:bdo w:val="rtl">${text}</w:bdo>`)).toEqual(slices(text));
  expect(slices(`<w:dir w:val="rtl">${text}</w:dir>`)).toEqual(slices(text));
});

test('a line break inside a wrapper keeps its direction on the next line', () => {
  for (const wrapper of ['bdo', 'dir']) {
    const result = layout(
      `<w:${wrapper} w:val="rtl">${run('abc')}<w:r><w:br/></w:r>${run('def')}</w:${wrapper}>`
    );
    const levels = linesOf(result).map((line) =>
      line.spans.filter((span) => span.text.trim()).map((span) => span.style.shaping?.level)
    );
    expect(levels[0]![0]).toBeGreaterThan(0);
    expect(levels[1]![0]).toBe(levels[0]![0]);
  }
  const lines = linesOf(
    layout(`<w:bdo w:val="rtl">${run('abc')}<w:r><w:br/></w:r>${run('def')}</w:bdo>`)
  );
  expect(lines[1]!.spans.find((span) => span.text === 'def')?.style.shaping?.direction).toBe('rtl');
});

test('a field that begins inside a wrapper keeps its direction when it ends outside', () => {
  const field = (end: string) =>
    `<w:bdo w:val="rtl">${run('ab')}<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('7')}${end === 'inside' ? '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:bdo>' : '</w:bdo><w:r><w:fldChar w:fldCharType="end"/></w:r>'}`;
  const levels = (end: string) =>
    linesOf(layout(field(end)))[0]!.spans.map((span) => [span.text, span.style.shaping?.level]);
  expect(levels('inside')).toEqual([
    ['ab', 1],
    // A body PAGE paints the page it lands on, not its cached `7`.
    ['1', 1],
  ]);
  expect(levels('outside')).toEqual(levels('inside'));
});

test('an authored pop control inside a wrapper does not end the wrapper', () => {
  for (const text of ['ab‬cd', 'ab‪x‬cd', 'ab‫x']) {
    const result = layout(`<w:bdo w:val="rtl">${run(text)}</w:bdo>${run(' tail')}`);
    const levelOf = (letter: string) =>
      linesOf(result)[0]!.spans.find((span) => span.text.includes(letter))?.style.shaping?.level;
    expect(levelOf('a')! % 2).toBe(1);
    // An unmatched pop leaves the override in force; an authored embedding nests inside it.
    expect(levelOf(text.at(-1)!)).toBeGreaterThan(0);
    if (text.endsWith('cd')) expect(levelOf('c')! % 2).toBe(1);
    // The wrapper and any authored embedding close before the text after it.
    expect(levelOf('t')).toBe(0);
  }
});

test('authored embeddings and isolates stay inside their own wrapper depth', () => {
  const spans = (content: string) =>
    linesOf(layout(content))[0]!.spans.map((span) => [span.text, span.style.shaping?.level]);
  const levelOf = (content: string, letter: string) =>
    spans(content).find(([text]) => String(text).includes(letter))?.[1] as number | undefined;
  // An RLE opened in the outer wrapper is still open after a nested wrapper closes.
  const nested = `<w:dir w:val="rtl">${run('‫x')}<w:bdo w:val="ltr">${run('y')}</w:bdo>${run('z')}</w:dir>`;
  expect(levelOf(nested, 'z')).toBe(levelOf(nested, 'x'));
  // A PDF inside an isolate does not pop the override, and the isolate closes before it does.
  const isolate = `<w:bdo w:val="rtl">${run('ab⁧c‬d⁩ef')}</w:bdo>${run(' tail')}`;
  expect(levelOf(isolate, 'e')! % 2).toBe(1);
  expect(levelOf(isolate, 't')).toBe(0);
});

test('a field whose result sits inside a wrapper takes the wrapper', () => {
  const field =
    `${run('ab')}<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:bdo w:val="rtl">${run('7')}` +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:bdo>';
  const page = linesOf(layout(field))[0]!.spans.find((span) => span.text === '1');
  expect(page).toBeDefined();
  expect(page?.style.shaping?.override).toBe('rtl');
  // An unterminated field's cached text keeps the wrapper too.
  const open =
    `<w:bdo w:val="rtl"><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('xyz')}</w:bdo>`;
  const cached = linesOf(layout(open))[0]!.spans.find((span) => span.text.includes('x'));
  expect(cached?.style.shaping?.override).toBe('rtl');
});

const fieldOf = (result: string, end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>') =>
  `${run('ab')}<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}${end}`;

test('a field that begins and shows its result outside a wrapper ignores the wrapper at its end', () => {
  const field = fieldOf(
    run('7'),
    '<w:bdo w:val="rtl"><w:r><w:fldChar w:fldCharType="end"/></w:r></w:bdo>'
  );
  const page = linesOf(layout(field))[0]!.spans.find((span) => span.text === '1');
  expect(page).toBeDefined();
  expect(page?.style.shaping?.override).toBeUndefined();
  expect(page?.style.shaping?.level ?? 0).toBe(0);
});

test('only the first displayed result run gives a field its wrappers', () => {
  const field = fieldOf(`${run('7')}<w:bdo w:val="rtl">${run('8')}</w:bdo>`);
  const atom = linesOf(layout(field))[0]!.spans.find((span) => span.text === '1');
  expect(atom).toBeDefined();
  expect(atom?.style.shaping?.override).toBeUndefined();
});

test('an authored PDI that closes an outer isolate keeps the wrapper open', () => {
  const levelOf = (content: string, letter: string) =>
    linesOf(layout(content))[0]!.spans.find((span) => span.text.includes(letter))?.style.shaping
      ?.level;
  const wrapped = `<w:dir w:val="rtl">${run('ab⁩cd')}</w:dir>`;
  const control = levelOf(wrapped, 'c');
  expect(control).toBeGreaterThan(0);
  expect(levelOf(`${run('⁧x')}${wrapped}`, 'c')).toBe(control);
});

test('authored controls cost linear time inside a wrapper', () => {
  const count = 60_000;
  const text = '‪'.repeat(count) + '⁩'.repeat(count);
  const pieces = [
    { text, bidiDirectives: [{ kind: 'embedding', direction: 'rtl' }] },
  ] as unknown as Parameters<typeof directedEmbeddingLevels>[0];
  const started = performance.now();
  const { levels } = directedEmbeddingLevels(pieces, text, 'ltr');
  expect(levels.length).toBe(text.length);
  // The quadratic scan took several seconds at this size.
  expect(performance.now() - started).toBeLessThan(2_000);
});

const rtlRun = (text: string) => run(text, '<w:rtl/>');

// Letters by name, so the table reads in logical order: A = "אבג", D = "דהו", Z = "זחט".
const A = 'אבג';
const D = 'דהו';
const Z = 'זחט';
const reversed = (text: string) => [...text].reverse().join('');
const ltrOverride = (content: string) => `<w:bdo w:val="ltr">${content}</w:bdo>`;

// Paragraph content, right-to-left paragraph or not, and the glyphs left to right (spaces
// dropped). A wrapper whose next run is a right-to-left run stays open to the paragraph end.
const WRAPPER_CASES: ReadonlyArray<readonly [string, string, boolean, string]> = [
  [
    'override, then a right-to-left run',
    `${rtlRun(`${A} `)}${ltrOverride(run('abc def'))}${rtlRun(` ${D}`)}`,
    true,
    `abcdef${D}${reversed(A)}`,
  ],
  [
    'override, then a plain run',
    `${rtlRun(`${A} `)}${ltrOverride(run('abc def'))}${run(` ${D}`)}`,
    true,
    `${reversed(D)}abcdef${reversed(A)}`,
  ],
  [
    'override, then two right-to-left runs',
    `${rtlRun(`${A} `)}${ltrOverride(run('abc def'))}${rtlRun(` ${D}`)}${rtlRun(` ${Z}`)}`,
    true,
    `abcdef${D}${Z}${reversed(A)}`,
  ],
  [
    'override first in the paragraph',
    `${ltrOverride(rtlRun(A))}${rtlRun(` ${D}`)}`,
    true,
    `${A}${D}`,
  ],
  [
    'override in a left-to-right paragraph',
    `${rtlRun(`${A} `)}${ltrOverride(run('abc def'))}${rtlRun(` ${D}`)}`,
    false,
    `abcdef${D}${reversed(A)}`,
  ],
  [
    'right-to-left override',
    `${rtlRun(`${A} `)}<w:bdo w:val="rtl">${run('abc def')}</w:bdo>${rtlRun(` ${D}`)}`,
    true,
    `${reversed(D)}fedcba${reversed(A)}`,
  ],
  [
    'override, then a plain run after the right-to-left run',
    `${rtlRun(`${A} `)}${ltrOverride(run('abc def'))}${rtlRun(` ${D}`)}${run(' xyz')}`,
    true,
    `abcdef${D}xyz${reversed(A)}`,
  ],
  [
    'left-to-right embedding',
    `${rtlRun(`${A} `)}<w:dir w:val="ltr">${run('abc def')}</w:dir>${rtlRun(` ${D}`)}`,
    true,
    `abcdef${reversed(D)}${reversed(A)}`,
  ],
  [
    'override of a right-to-left run',
    `${rtlRun(`${A} `)}${ltrOverride(rtlRun('abc def'))}${rtlRun(` ${D}`)}`,
    true,
    `abcdef${D}${reversed(A)}`,
  ],
  [
    'override, then digits',
    `${rtlRun(`${A} `)}${ltrOverride(run('abc def'))}${rtlRun(' 123')}`,
    true,
    `abcdef123${reversed(A)}`,
  ],
  [
    'override past plain and right-to-left runs',
    `${rtlRun(`${A} `)}${ltrOverride(run('abc def'))}${rtlRun(` ${D}`)}${run(' xyz')}${rtlRun(` ${Z}`)}`,
    true,
    `abcdef${D}xyz${Z}${reversed(A)}`,
  ],
  [
    'right-to-left override over a right-to-left run',
    `${rtlRun(`${A} `)}<w:bdo w:val="rtl">${run('abc def')}</w:bdo>${rtlRun(' xyz')}`,
    true,
    `zyxfedcba${reversed(A)}`,
  ],
  [
    'right-to-left override in a left-to-right paragraph',
    `${run('pq ')}<w:bdo w:val="rtl">${run('abc')}</w:bdo>${rtlRun(' xyz')}${run(' end')}`,
    false,
    'pqdnezyxcba',
  ],
  [
    'a second override inside the open one',
    `${rtlRun(`${A} `)}${ltrOverride(run('abc def'))}${rtlRun(` ${D}`)}${ltrOverride(run(' ghi'))}${rtlRun(` ${Z}`)}`,
    true,
    `abcdef${D}ghi${Z}${reversed(A)}`,
  ],
  [
    'override past a plain space',
    `${rtlRun(`${A} `)}${ltrOverride(run('abc def'))}${rtlRun(` ${D}`)}${run(' ')}${rtlRun(Z)}`,
    true,
    `abcdef${D}${Z}${reversed(A)}`,
  ],
  [
    'embedding past plain and right-to-left runs',
    `${rtlRun(`${A} `)}<w:dir w:val="ltr">${run('abc def')}</w:dir>${rtlRun(` ${D}`)}${run(' xyz')}${rtlRun(` ${Z}`)}`,
    true,
    `abcdef${reversed(D)}xyz${reversed(Z)}${reversed(A)}`,
  ],
  [
    'right-to-left embedding in a left-to-right paragraph',
    `${run('pq ')}<w:dir w:val="rtl">${run('abc')}</w:dir>${rtlRun(' xyz')}${run(' end')}`,
    false,
    'pqendxyzabc',
  ],
  [
    'override of a right-to-left run, then a plain run',
    `${rtlRun(`${A} `)}${ltrOverride(rtlRun('abc def'))}${run(` ${D}`)}`,
    true,
    `${reversed(D)}abcdef${reversed(A)}`,
  ],
];

for (const [label, content, bidi, glyphs] of WRAPPER_CASES) {
  test(`wrapper placement: ${label}`, () => {
    const result = layout(content, bidi ? '<w:bidi/>' : '');
    expect(visualText(result).replaceAll(' ', '')).toBe(glyphs);
  });
}

test('spaces that end the paragraph inside a wrapper stay at the line end', () => {
  const result = layout(`${run('x ')}<w:bdo w:val="rtl">${run('abc  ')}</w:bdo>`);
  expect(visualText(result)).toBe('x cba  ');
});

test('many wrappers left open stay cheap', () => {
  const count = 8_000;
  const content = Array.from(
    { length: count },
    () => `<w:bdo w:val="ltr">${run('a')}</w:bdo>${rtlRun(D[0]!)}`
  ).join('');
  const started = performance.now();
  layout(content, '<w:bidi/>');
  // An unbounded stack copied per piece took several seconds and gigabytes at this size.
  expect(performance.now() - started).toBeLessThan(4_000);
});

test('a picture inside a wrapper left open stays in its run-direction group', () => {
  const NS =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const picture =
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="127000" cy="38100"/><wp:docPr id="1" name="p1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="127000" cy="38100"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const document = load(
    `<w:document ${NS}><w:body><w:p>${run('pq ')}<w:dir w:val="rtl">${run('abc')}</w:dir>` +
      `${rtlRun(` ${A} `)}${picture}${rtlRun(` ${D}`)}</w:p></w:body></w:document>`
  );
  const result = layoutSemanticDocument(document, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(document),
  });
  const line = linesOf(result)[0]!;
  const groups = new Set(
    line.spans
      .filter((span) => span.text.trim() && span.text !== 'pq ')
      .map((span) => span.style.shaping?.runDirection)
  );
  expect(groups).toEqual(new Set(['ltr']));
  expect(line.drawings?.[0]?.bidiRunDirection).toBe('ltr');
});
