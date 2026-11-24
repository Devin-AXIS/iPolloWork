import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';

// Run-level `w:fitText`: consecutive runs with one `w:id` take exactly `w:val` twips.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CHAR = 6;
const measurer = createFixedMeasurer(CHAR, 14);

function part(xml: string) {
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}
const fit = (val: number, id?: string) =>
  `<w:fitText w:val="${val}"${id === undefined ? '' : ` w:id="${id}"`}/>`;
// 11 pt, where the fixed measurer gives every character CHAR points.
const run = (text: string, props = '') =>
  `<w:r><w:rPr><w:sz w:val="22"/>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

function layout(body: string, width = 400) {
  const doc = part(`<w:document xmlns:w="${W}"><w:body><w:p>${body}</w:p></w:body></w:document>`);
  return layoutSemanticDocument(doc, 0, {
    measurer,
    geometry: {
      width: width + 20,
      height: 600,
      margin: { left: 10, right: 10, top: 10, bottom: 10 },
    },
  });
}
const lines = (value: ReturnType<typeof layout>) => value.pages[0]!.fragments[0]!.lines;
const spans = (value: ReturnType<typeof layout>) => lines(value).flatMap((l) => l.spans);

/** The x where model offset `start` begins on the first line. */
function xAt(value: ReturnType<typeof layout>, start: number): number {
  for (const span of lines(value)[0]!.spans) {
    if (span.range.start === start) return span.box.x;
    if (span.range.start < start && span.range.end > start) {
      return span.box.x + ((start - span.range.start) / span.text.length) * span.box.width;
    }
  }
  throw new Error(`no span at ${start}`);
}

test('narrower fitted text spreads to the stated width and the last character keeps its own', () => {
  // "[" + ABCDE (5 x 6 = 30 pt) fitted to 2880 twips (144 pt) + "]".
  const value = layout(run('[') + run('ABCDE', fit(2880, '1')) + run(']'));
  expect(xAt(value, 6) - xAt(value, 1)).toBeCloseTo(144, 6);
  const last = spans(value).find((span) => span.range.start === 5)!;
  expect(last.text).toBe('E');
  expect(last.box.width).toBeCloseTo(CHAR, 6);
  // Every other character takes the same advance: (144 - 30) / 4 extra each.
  expect(xAt(value, 2) - xAt(value, 1)).toBeCloseTo(CHAR + 114 / 4, 6);
});

test('wider fitted text compresses every character to the stated width', () => {
  const value = layout(run('[') + run('ABCDEFGHIJ', fit(720, '2')) + run(']'));
  // 60 pt of text in 36 pt.
  expect(xAt(value, 11) - xAt(value, 1)).toBeCloseTo(36, 6);
  const fitted = spans(value).filter((span) => span.range.start >= 1 && span.range.end <= 11);
  for (const span of fitted) expect(span.style.horizontalScalePercent).toBeCloseTo(60, 6);
});

test('runs sharing one id form one group across formatting changes', () => {
  const value = layout(
    run('[') + run('ABC', `<w:b/>${fit(2880, '3')}`) + run('DE', fit(2880, '3')) + run(']')
  );
  expect(xAt(value, 6) - xAt(value, 1)).toBeCloseTo(144, 6);
  // The extra advance is uniform across the run seam.
  expect(xAt(value, 4) - xAt(value, 3)).toBeCloseTo(xAt(value, 2) - xAt(value, 1), 6);
});

test('different ids, an interrupting run, and an absent id each decide the grouping', () => {
  const twoIds = layout(
    run('[') + run('ABC', fit(1440, '4')) + run('DE', fit(1440, '5')) + run(']')
  );
  expect(xAt(twoIds, 4) - xAt(twoIds, 1)).toBeCloseTo(72, 6);
  expect(xAt(twoIds, 6) - xAt(twoIds, 4)).toBeCloseTo(72, 6);

  const split = layout(
    run('[') + run('ABC', fit(1440, '6')) + run('xy') + run('DE', fit(1440, '6')) + run(']')
  );
  expect(xAt(split, 4) - xAt(split, 1)).toBeCloseTo(72, 6);
  expect(xAt(split, 8) - xAt(split, 6)).toBeCloseTo(72, 6);

  const noId = layout(run('[') + run('ABC', fit(1440)) + run('DE', fit(2880)) + run(']'));
  // One group, at the width of its first run.
  expect(xAt(noId, 6) - xAt(noId, 1)).toBeCloseTo(72, 6);
});

test('the group replaces authored character spacing and scale', () => {
  const plain = layout(run('[') + run('ABCDE', fit(2880, '7')) + run(']'));
  const authored = layout(
    run('[') + run('ABCDE', `${fit(2880, '7')}<w:spacing w:val="40"/><w:w w:val="50"/>`) + run(']')
  );
  for (const offset of [2, 3, 4, 5, 6]) {
    expect(xAt(authored, offset)).toBeCloseTo(xAt(plain, offset), 6);
  }
});

test('a one-character group carries the whole extra advance after the character', () => {
  const value = layout(run('[') + run('A', fit(1440, '8')) + run(']'));
  expect(xAt(value, 2) - xAt(value, 1)).toBeCloseTo(72, 6);
});

test('a fitted group moves to the next line whole instead of breaking at its spaces', () => {
  // 40 characters of filler leave 160 pt of a 400 pt line; the 200 pt group cannot fit there.
  const filler = 'filler words to take most of the line ';
  const value = layout(run(filler) + run('AB CD EF', fit(4000, '9')) + run(' after'));
  const rows = lines(value).map((line) => line.spans.map((span) => span.text).join(''));
  expect(rows[0]!.trimEnd()).toBe(filler.trimEnd());
  expect(rows[1]!.startsWith('AB CD EF')).toBe(true);
});

test('a paragraph whose natural width wraps fits on one line once its group is fitted', () => {
  // ( + 70 characters (420 pt) fitted to 300 pt + ): one 312 pt line in a 400 pt column.
  const long = 'abcdefghij'.repeat(7);
  const value = layout(
    run('(') + run(long, `${fit(6000, '20')}<w:w w:val="98"/>`) + run(')') + run(' tail')
  );
  expect(lines(value)).toHaveLength(1);
  expect(xAt(value, 71) - xAt(value, 1)).toBeCloseTo(300, 6);
});
