// `pageBreakLinesStretch`: in a legacy compatibility mode, a justified line that ends in a page
// or column break stretches to the measure. In a modern mode it keeps its natural spacing, as
// a last line does.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { linesOf, type LineRecord, type TextMeasurer } from '../semantic-records.ts';
import { createLayoutSession, layoutSemanticDocument } from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createFixedMeasurer } from '../index.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import type { PendingLine } from '../paragraph-flow.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const URI = 'http://schemas.microsoft.com/office/word';
const WIDTH = 120;
const COLUMN_SPACE = 12;
const measurer: TextMeasurer = createFixedMeasurer(6, 14);
const PAGE = '<w:br w:type="page"/>';
const COLUMN = '<w:br w:type="column"/>';

function cascadeOf(mode: number | undefined, extra = '') {
  const declaration =
    mode === undefined
      ? ''
      : `<w:compatSetting w:name="compatibilityMode" w:uri="${URI}" w:val="${mode}"/>`;
  const read = readOoxmlPart(
    `<w:settings xmlns:w="${W}"><w:compat>${extra}${declaration}</w:compat></w:settings>`,
    { name: '/word/settings.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return buildStyleCascadeTable(null, undefined, read.part.root);
}

interface Options {
  readonly rtl?: boolean;
  readonly table?: boolean;
  readonly jc?: string;
  readonly brk?: string;
  readonly after?: string;
  readonly columns?: boolean;
}

/** One paragraph: `text`, a break, then `after`; optionally in a one-cell table or two columns. */
function body(text: string, options: Options = {}) {
  const { rtl = false, table = false, jc = 'both', brk = PAGE, after = 'tail' } = options;
  const run = (content: string) => `<w:r><w:rPr>${rtl ? '<w:rtl/>' : ''}</w:rPr>${content}</w:r>`;
  const paragraph =
    `<w:p><w:pPr>${rtl ? '<w:bidi/>' : ''}<w:jc w:val="${jc}"/></w:pPr>` +
    `${run(`<w:t xml:space="preserve">${text}</w:t>`)}${run(brk)}` +
    `${after ? run(`<w:t>${after}</w:t>`) : ''}</w:p>`;
  const cell =
    `<w:tbl><w:tblPr><w:tblW w:w="${WIDTH * 20}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
    `</w:tblPr><w:tblGrid><w:gridCol w:w="${WIDTH * 20}"/></w:tblGrid><w:tr><w:tc>` +
    `<w:tcPr><w:tcW w:w="${WIDTH * 20}" w:type="dxa"/></w:tcPr>${paragraph}</w:tc></w:tr></w:tbl><w:p/>`;
  const columns = options.columns ? `<w:cols w:num="2" w:space="${COLUMN_SPACE * 20}"/>` : '';
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${table ? cell : paragraph}` +
      `<w:sectPr><w:pgSz w:w="${(WIDTH + 30) * 20}" w:h="12000"/>` +
      `<w:pgMar w:left="300" w:right="300" w:top="300" w:bottom="300"/>${columns}</w:sectPr>` +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

/** The ink extent of a line's words, in content-box coordinates. */
function edges(line: LineRecord): readonly [number, number] {
  const boxes = line.spans
    .filter((span) => span.text.trim())
    .map((span) => {
      const visible = measurer.measure(span.text.trim(), span.style);
      return (span.style.shaping?.level ?? 0) % 2
        ? [span.box.x + span.box.width - visible, span.box.x + span.box.width]
        : [span.box.x, span.box.x + visible];
    });
  return [Math.min(...boxes.map((box) => box[0]!)), Math.max(...boxes.map((box) => box[1]!))];
}

const LEGACY = [cascadeOf(undefined), cascadeOf(12), cascadeOf(14)] as const;
const MODERN = cascadeOf(15);

function firstLine(part: ReturnType<typeof body>, mode: number | undefined) {
  const styleCascade = cascadeOf(mode);
  return linesOf(
    layoutSemanticDocument(part, 0, { measurer, compatibilityMode: mode, styleCascade })
    // A distributed line in a legacy mode splits per character, so match the line's text.
  ).find((line) => /aaa|אבג/.test(line.spans.map((span) => span.text).join('')))!;
}
const naturalWidth = (text: string) =>
  measurer.measure(text, firstLine(body('aaa'), 15).spans[0]!.style);

test('the rule is on in legacy modes and off in modern ones', () => {
  for (const cascade of LEGACY) expect(cascade.pageBreakLinesStretch).toBe(true);
  expect(MODERN.pageBreakLinesStretch).toBeUndefined();
  expect(cascadeOf(16).pageBreakLinesStretch).toBeUndefined();
});

test.each([
  ['without', 'aaa bbb ccc'],
  ['with', 'aaa bbb ccc '],
])('a justified line %s a trailing space before a page break', (_, text) => {
  for (const mode of [undefined, 12, 14]) {
    expect(edges(firstLine(body(text), mode))).toEqual([0, expect.closeTo(WIDTH, 3)]);
  }
  for (const mode of [15, 16]) {
    const [left, right] = edges(firstLine(body(text), mode));
    expect(left).toBeCloseTo(0, 3);
    expect(right).toBeCloseTo(naturalWidth('aaa bbb ccc'), 3);
  }
});

test('a right-to-left line before a page break fills the measure only in legacy modes', () => {
  const part = body('אבג דהו זחט ', { rtl: true });
  const [legacyLeft, legacyRight] = edges(firstLine(part, 12));
  expect(legacyLeft).toBeCloseTo(0, 3);
  expect(legacyRight).toBeCloseTo(WIDTH, 3);
  const [left, right] = edges(firstLine(part, 15));
  expect(right).toBeCloseTo(WIDTH, 3);
  expect(right - left).toBeCloseTo(naturalWidth('אבג דהו זחט'), 3);
});

test('a line before a column break fills its column only in legacy modes', () => {
  const column = (WIDTH - COLUMN_SPACE) / 2;
  // The paragraph mark after a column break takes a line in the next column, so a break that
  // ends its paragraph still closes a line that is not the last one.
  for (const after of ['tail', '']) {
    const part = body('aaa bbb', { columns: true, brk: COLUMN, after });
    expect(edges(firstLine(part, 14))[1]).toBeCloseTo(column, 3);
    expect(edges(firstLine(part, 15))[1]).toBeCloseTo(naturalWidth('aaa bbb'), 3);
  }
});

test('a column break in a one-column section stretches its line only in legacy modes', () => {
  // The paragraph mark after the break takes a line on the next page, so a break that ends
  // its paragraph still closes a line that is not the last one.
  for (const after of ['tail', '']) {
    const part = body('aaa bbb', { brk: COLUMN, after });
    expect(edges(firstLine(part, 12))[1]).toBeCloseTo(WIDTH, 3);
    expect(edges(firstLine(part, 15))[1]).toBeCloseTo(naturalWidth('aaa bbb'), 3);
  }
});

test('a header line before a page break stretches only in legacy modes', () => {
  // Notes and text boxes lay out through the same box flow as headers and footers.
  const read = readOoxmlPart(
    `<w:hdr xmlns:w="${W}"><w:p><w:pPr><w:jc w:val="both"/></w:pPr>` +
      '<w:r><w:t xml:space="preserve">aaa bbb ccc </w:t></w:r><w:r><w:br w:type="page"/></w:r>' +
      '<w:r><w:t>tail</w:t></w:r></w:p></w:hdr>',
    { name: '/word/header1.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const headerLine = (mode: number) => {
    const story = layoutHeaderFooterStory(
      read.part,
      WIDTH,
      measurer,
      `h${mode}`,
      undefined,
      cascadeOf(mode)
    );
    return story.fragments.flatMap((fragment) => ('lines' in fragment ? fragment.lines : []))[0]!;
  };
  expect(edges(headerLine(12))[1]).toBeCloseTo(WIDTH, 3);
  expect(edges(headerLine(15))[1]).toBeCloseTo(naturalWidth('aaa bbb ccc'), 3);
});

test('a page break that ends its paragraph leaves the line unstretched', () => {
  for (const mode of [12, 15]) {
    expect(edges(firstLine(body('aaa bbb ccc', { after: '' }), mode))[1]).toBeCloseTo(
      naturalWidth('aaa bbb ccc'),
      3
    );
  }
});

test('a table cell ignores the page break, so its line is the last line in every mode', () => {
  const legacy = edges(firstLine(body('aaa bbb', { table: true }), 12));
  expect(legacy).toEqual(edges(firstLine(body('aaa bbb', { table: true }), 15)));
  expect(legacy[1]).toBeLessThan(WIDTH - 1);
});

test('a distributed line before a page break fills the measure in every mode', () => {
  for (const mode of [12, 15]) {
    expect(edges(firstLine(body('aaa bbb ccc', { jc: 'distribute' }), mode))[1]).toBeCloseTo(
      WIDTH,
      3
    );
  }
});

test('the manual line break setting does not change a line before a page break', () => {
  const styleCascade = cascadeOf(12, '<w:doNotExpandShiftReturn/>');
  const line = (brk: string) =>
    linesOf(
      layoutSemanticDocument(body('aaa bbb ccc', { brk }), 0, {
        measurer,
        compatibilityMode: 12,
        styleCascade,
      })
    )[0]!;
  expect(edges(line(PAGE))[1]).toBeCloseTo(WIDTH, 3);
  expect(edges(line('<w:br/>'))[1]).toBeCloseTo(naturalWidth('aaa bbb ccc'), 3);
});

test('changing the mode invalidates retained layout', () => {
  const legacy = LEGACY[1];
  expect(legacy.cacheToken).not.toBe(MODERN.cacheToken);
  const source = body('aaa bbb ccc');
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  for (const [mode, styleCascade] of [
    [15, MODERN],
    [12, legacy],
    [15, MODERN],
  ] as const) {
    const options = { measurer, compatibilityMode: mode, styleCascade };
    const warm = layoutSemanticDocument(source, 0, { ...options, session, cache });
    const fresh = layoutSemanticDocument(source, 0, options);
    expect(warm.pages).toEqual(fresh.pages);
    expect(edges(linesOf(warm)[0]!)[1]).toBeCloseTo(
      styleCascade === legacy ? WIDTH : naturalWidth('aaa bbb ccc'),
      3
    );
  }
});
