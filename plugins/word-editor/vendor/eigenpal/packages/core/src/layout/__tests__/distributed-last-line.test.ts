import { expect, test } from 'bun:test';
import { serializeOoxmlPart, type OoxmlProperty } from '../../store/index.ts';
import { boxLineSetsLikeLastLine, setsLikeLastLine } from '../paragraph-alignment.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type LineRecord, type StyleSpanRecord } from '../semantic-records.ts';
import { loadBody, layoutUnderFloat, squareWrapZone } from './float-over-table-harness.ts';

const measurer = createFixedMeasurer(10, 14);
const geometry = {
  width: 120,
  height: 400,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};
const jc = (val: string) => ({ localName: 'jc', attributes: { val } }) as OoxmlProperty;
const paragraph = (alignment: string, text: string) =>
  `<w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

function layout(body: string) {
  const source = loadBody(body);
  const before = serializeOoxmlPart(source);
  const result = layoutSemanticDocument(source, 0, { measurer, geometry });
  expect(serializeOoxmlPart(source)).toBe(before);
  return linesOf(result);
}

function end(spans: readonly StyleSpanRecord[]) {
  const span = spans.filter((s) => s.text.trim().length > 0).at(-1)!;
  return span.box.x + measurer.measure(span.text.trimEnd(), span.style);
}

for (const text of ['aa bb cc dd ee ff gg hh ii', '甲乙丙丁戊己庚辛壬癸子丑寅']) {
  test(`distributed body paragraphs stretch their final line: ${text}`, () => {
    const distributed = layout(paragraph('distribute', text));
    const justified = layout(paragraph('both', text));
    expect(distributed.length).toBeGreaterThan(1);
    expect(distributed.map((line) => line.spans.map((s) => s.text).join(''))).toEqual(
      justified.map((line) => line.spans.map((s) => s.text).join(''))
    );
    for (const line of distributed) expect(end(line.spans)).toBeCloseTo(100, 7);
    expect(end(justified.at(-1)!.spans)).toBeLessThan(100);
  });
}

test('distributed paragraphs stretch the final line in a table cell', () => {
  const lines = layout(
    `<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${paragraph('distribute', 'aa bb cc dd ee ff gg hh ii')}</w:tc></w:tr></w:tbl>`
  );
  // The cell's lines; the empty paragraph the body reads after the table has no text.
  const cell = lines.filter((line) => line.spans.some((span) => span.text.length > 0));
  expect(cell.length).toBeGreaterThan(1);
  for (const line of cell) expect(end(line.spans)).toBeCloseTo(100, 7);
});

function parts(line: LineRecord) {
  const result: StyleSpanRecord[][] = [];
  for (const span of line.spans) {
    if (result.length === 0 || (span.wrapAdvanceBefore ?? 0) > 0.001) result.push([]);
    result.at(-1)!.push(span);
  }
  return result;
}

test('the final distributed line fills each passage beside a float', () => {
  const source = loadBody(paragraph('distribute', 'aa bb cc dd ee ff gg hh ii jj kk ll mm nn'));
  const before = serializeOoxmlPart(source);
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
  const lines = linesOf(layoutUnderFloat(source, new Map([[0, [zone]]])));
  const last = lines.at(-1)!;
  const passages = parts(last);
  expect(passages).toHaveLength(2);
  const fixed = createFixedMeasurer();
  for (const [index, spans] of passages.entries()) {
    const span = spans.filter((s) => s.text.trim().length > 0).at(-1)!;
    const right = span.box.x + fixed.measure(span.text.trimEnd(), span.style);
    expect(right).toBeCloseTo(index === 0 ? 60 : 180, 7);
  }
  expect(serializeOoxmlPart(source)).toBe(before);
});

test('last-line classification preserves distribution and normal justification', () => {
  for (const closing of [
    {},
    { pageBreakAfter: true },
    { columnBreakAfter: true },
    { manualBreakAfter: true as const },
  ]) {
    for (const isLast of [false, true]) {
      expect(setsLikeLastLine([jc('distribute')], closing, isLast)).toBe(false);
      expect(boxLineSetsLikeLastLine([jc('distribute')], closing, isLast)).toBe(false);
    }
  }
  expect(setsLikeLastLine([jc('both')], {}, true)).toBe(true);
  expect(boxLineSetsLikeLastLine([jc('both')], {}, true)).toBe(true);
  expect(setsLikeLastLine([jc('both')], { pageBreakAfter: true }, false)).toBe(true);
  expect(setsLikeLastLine([jc('both')], { manualBreakAfter: true }, false)).toBe(false);
  expect(
    setsLikeLastLine([jc('both')], { manualBreakAfter: true }, false, {
      unstretchedManualBreakLines: true,
    })
  ).toBe(true);
  // The last authored alignment wins.
  expect(setsLikeLastLine([jc('distribute'), jc('both')], {}, true)).toBe(true);
});

function start(spans: readonly StyleSpanRecord[]) {
  return spans.find((s) => s.text.trim().length > 0)!.box.x;
}

const bidiParagraph = (text: string) =>
  `<w:p><w:pPr><w:bidi/><w:jc w:val="distribute"/></w:pPr><w:r><w:rPr><w:rtl/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

for (const [name, body, width] of [
  ['a single word', paragraph('distribute', 'Text'), 40],
  ['a single character', paragraph('distribute', 'X'), 10],
  ['a single CJK character', paragraph('distribute', '名'), 10],
  [
    'one word before a manual line break',
    `<w:p><w:pPr><w:jc w:val="distribute"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>Text</w:t><w:br/><w:t>aa bb</w:t></w:r></w:p>`,
    40,
  ],
  ['a single right-to-left word', bidiParagraph('שלום'), 40],
] as const) {
  test(`a distributed line with nothing to stretch centers: ${name}`, () => {
    const first = layout(body)[0]!;
    // Span boxes are content-relative: the line starts half the slack in.
    expect(start(first.spans)).toBeCloseTo((100 - width) / 2, 7);
  });
}

test('a distributed single word centers in a table cell', () => {
  const [line] = layout(
    `<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${paragraph('distribute', 'Cell')}</w:tc></w:tr></w:tbl>`
  );
  expect(start(line!.spans)).toBeCloseTo((100 - 40) / 2, 7);
});

for (const [name, before, after] of [
  ['Latin', 'Ab', 'Cd'],
  ['CJK', '氏名', '値'],
] as const) {
  test(`a distributed ${name} line with nothing to stretch after its tab centers`, () => {
    const body = (alignment: string) =>
      `<w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${before}</w:t><w:tab/><w:t>${after}</w:t></w:r></w:p>`;
    const xOf = (alignment: string) =>
      layout(body(alignment))[0]!.spans.find((s) => s.text.includes(after))!.box.x;
    // The whole line moves by half the room after its content, its tab position included.
    const end = xOf('left') + 10 * after.length;
    expect(xOf('both')).toBeCloseTo(xOf('left'), 7);
    expect(xOf('distribute')).toBeCloseTo(xOf('left') + (100 - end) / 2, 7);
  });
}

test('a justified single word stays at its start edge', () => {
  const [line] = layout(paragraph('both', 'Text'));
  expect(start(line!.spans)).toBeCloseTo(0, 7);
});

test('a distributed right-to-left CJK line beside a float keeps its passages', () => {
  // The float advance holds each passage in place, so the line does not center.
  const source = loadBody(
    '<w:p><w:pPr><w:bidi/><w:jc w:val="distribute"/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥</w:t></w:r></w:p>'
  );
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
  const [line] = linesOf(layoutUnderFloat(source, new Map([[0, [zone]]])));
  expect(parts(line!)).toHaveLength(2);
  for (const span of line!.spans.filter((s) => s.text.trim().length > 0)) {
    // Each character stays in a free passage, left of 60 or right of 100.
    expect(span.box.x + span.box.width <= 60 + 1e-6 || span.box.x >= 100 - 1e-6).toBe(true);
  }
});
