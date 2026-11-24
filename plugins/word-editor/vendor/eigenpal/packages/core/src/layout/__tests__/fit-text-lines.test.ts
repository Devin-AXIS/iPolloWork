import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';

// `w:fitText` groups keep their stated spacing through justification, distribution, space
// shrinking and the table AutoFit minimum; tabs, field results, surrogate pairs and units.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CHAR = 6;
const measurer = createFixedMeasurer(CHAR, 14);

const fit = (val: number | string, id = '1') => `<w:fitText w:val="${val}" w:id="${id}"/>`;
// 11 pt, where the fixed measurer gives every character CHAR points.
const run = (text: string, props = '') =>
  `<w:r><w:rPr><w:sz w:val="22"/>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (content: string, pPr = '') => `<w:p><w:pPr>${pPr}</w:pPr>${content}</w:p>`;

function layout(body: string, width = 400, compatibilityMode?: number) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 0, {
    measurer,
    ...(compatibilityMode === undefined ? {} : { compatibilityMode }),
    geometry: {
      width: width + 20,
      height: 600,
      margin: { left: 10, right: 10, top: 10, bottom: 10 },
    },
  });
}
type Layout = ReturnType<typeof layout>;
const allLines = (value: Layout) =>
  value.pages[0]!.fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph' ? fragment.lines : []
  );

/** The line index and x where model offset `start` of the first paragraph begins. */
function at(value: Layout, start: number, lines = allLines(value)): { line: number; x: number } {
  for (const [line, record] of lines.entries()) {
    for (const span of record.spans) {
      if (span.range.start === start && span.text.length > 0) return { line, x: span.box.x };
      if (span.range.start < start && span.range.end > start) {
        const x = span.box.x + ((start - span.range.start) / span.text.length) * span.box.width;
        return { line, x };
      }
    }
  }
  throw new Error(`no span at ${start}`);
}
const x = (value: Layout, start: number) => at(value, start).x;

// "x [" then "AB CD" fitted to 72 pt: 5 characters (30 pt) spread over 4 gaps of 10.5 pt.
const GROUP = run('x [') + run('AB CD', fit(1440)) + run('] y');
const STEP = CHAR + 42 / 4;

test('a justified line does not stretch the spaces inside a fitted group', () => {
  const tail = ' and more words so the paragraph wraps onto a second line for sure here';
  const value = layout(para(GROUP + run(tail), '<w:jc w:val="both"/>'));
  expect(allLines(value).length).toBeGreaterThan(1);
  // A at 3, B 4, space 5, C 6, D 7.
  for (const offset of [4, 5, 6, 7]) {
    expect(x(value, offset) - x(value, offset - 1)).toBeCloseTo(STEP, 6);
  }
});

test('a distributed line opens no gap inside a fitted group', () => {
  const value = layout(para(GROUP, '<w:jc w:val="distribute"/>'));
  for (const offset of [4, 5, 6, 7]) {
    expect(x(value, offset) - x(value, offset - 1)).toBeCloseTo(STEP, 6);
  }
  // The slack goes outside the group: here to the space after it.
  expect(x(value, 10) - x(value, 8)).toBeGreaterThan(2 * CHAR + 1);
});

test('a justified line does not shrink a fitted group to keep it on the line', () => {
  // Eight 5-letter words and their spaces leave 112 pt; the 128 pt group needs 16 pt of
  // shrink. The eight plain spaces can give 12 pt; the group's own spaces give nothing.
  const filler = Array.from({ length: 8 }, () => 'aaaaa').join(' ') + ' ';
  const value = layout(
    para(
      run(filler) + run('AB CD EF GH', fit(2560)) + run(' tail words after it and more'),
      '<w:jc w:val="both"/>'
    ),
    400,
    15
  );
  expect(at(value, filler.length).line).toBe(1);
  // With 4 pt less, the plain spaces shrink and the group stays on the line.
  const kept = layout(
    para(
      run(filler) + run('AB CD EF GH', fit(2480)) + run(' tail words after it and more'),
      '<w:jc w:val="both"/>'
    ),
    400,
    15
  );
  expect(at(kept, filler.length).line).toBe(0);
});

test('the AutoFit minimum keeps a fitted group whole', () => {
  const cell = (inner: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${inner}</w:tc>`;
  const long = 'long cell text that fills the rest of the width easily '.repeat(4);
  const table =
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>' +
    cell(para(run('aa bb cc', fit(4320)))) +
    cell(para(run(long))) +
    '</w:tr></w:tbl><w:p/>';
  const value = layout(table);
  const cellLines = value.pages[0]!.fragments.flatMap((fragment) =>
    fragment.kind === 'table'
      ? fragment.rows[0]!.cells[0]!.blocks.flatMap((inner) =>
          inner.kind === 'paragraph' ? inner.lines : []
        )
      : []
  );
  expect(cellLines).toHaveLength(1);
  const groupSpans = cellLines[0]!.spans;
  const last = groupSpans.at(-1)!;
  expect(last.box.x + last.box.width - groupSpans[0]!.box.x).toBeCloseTo(216, 3);
});

test('a tab ends the group: the text after it keeps its natural width', () => {
  const value = layout(para(run('[') + run('AB\tCD', fit(1440)) + run(']')));
  // "AB" alone takes the 72 pt.
  expect(x(value, 3) - x(value, 1)).toBeCloseTo(72, 6);
  // "CD" after the tab is not fitted, and no second group takes another 72 pt.
  expect(x(value, 5) - x(value, 4)).toBeCloseTo(CHAR, 6);
  expect(x(value, 6) - x(value, 5)).toBeCloseTo(CHAR, 6);
});

test('a field result inside the group is a group character', () => {
  const value = layout(
    para(
      run('[') +
        run('AB', fit(1440)) +
        `<w:fldSimple w:instr=" DATE "><w:r><w:rPr><w:sz w:val="22"/>${fit(1440)}</w:rPr><w:t>C</w:t></w:r></w:fldSimple>` +
        run('DE', fit(1440)) +
        run(']')
    )
  );
  // One group of 5 characters over 72 pt, not two groups.
  expect(x(value, 6) - x(value, 1)).toBeCloseTo(72, 6);
});

test('a surrogate pair takes one gap like any other character', () => {
  // A, an emoji (two UTF-16 units, 12 pt here), B: 24 pt over 2 gaps of 24 pt in 72 pt.
  const value = layout(para(run('[') + run('A\u{1F600}B', fit(1440)) + run(']')));
  expect(x(value, 2) - x(value, 1)).toBeCloseTo(CHAR + 24, 6);
  expect(x(value, 4) - x(value, 2)).toBeCloseTo(2 * CHAR + 24, 6);
  expect(x(value, 5) - x(value, 1)).toBeCloseTo(72, 6);
});

test('a universal measure such as 1in states the width', () => {
  const value = layout(para(run('[') + run('ABC', fit('1in')) + run(']')));
  expect(x(value, 4) - x(value, 1)).toBeCloseTo(72, 6);
});
