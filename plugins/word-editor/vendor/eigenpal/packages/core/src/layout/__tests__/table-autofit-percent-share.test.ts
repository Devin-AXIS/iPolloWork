import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';
import { equalShareWidenedWidths } from '../table-autofit-distribution.ts';

// A percentage AutoFit table whose every cell states a percentage width: once a column widens
// to its minimum, the other columns each give up an equal part of what it grew by. A column
// that part takes below its own minimum keeps the minimum, and the next column gives up the
// difference. Reference renderings: the expected widths below, to the 0.24pt their rules
// are placed at, in both the current and the legacy layout.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const near = (actual: readonly number[] | undefined, expected: readonly number[]) => {
  expect(actual).toBeDefined();
  expected.forEach((width, column) =>
    expect(Math.abs(actual![column]! - width)).toBeLessThan(0.25)
  );
};

test('the other columns give up equal parts, whatever their widths', () => {
  // 900/1000/1500/1600 of a 467.52pt table; the first column widens to an unbreakable word.
  near(
    equalShareWidenedWidths([84.15, 93.5, 140.25, 149.6], [196.56, 37.92, 14.16, 14.16]),
    [196.56, 55.92, 102.72, 112.32]
  );
  // Two columns widen; the two others give up the sum in equal parts.
  near(
    equalShareWidenedWidths([84.15, 46.75, 168.3, 168.3], [196.56, 76.8, 37.92, 14.16]),
    [196.56, 76.8, 96.96, 97.2]
  );
});

test('a column held at its minimum passes the rest to the next column', () => {
  near(
    equalShareWidenedWidths([84.15, 37.4, 172.98, 172.98], [196.56, 14.16, 37.92, 14.16]),
    [196.56, 14.16, 121.2, 135.6]
  );
  near(
    equalShareWidenedWidths([84.15, 65.45, 158.96, 158.96], [196.56, 37.92, 37.92, 14.16]),
    [196.56, 37.92, 111.6, 121.44]
  );
  // An 80% table.
  near(
    equalShareWidenedWidths([67.32, 74.8, 112.2, 119.68], [196.56, 37.92, 14.16, 14.16]),
    [196.56, 37.92, 62.88, 76.56]
  );
});

test('no rule settles a table whose last columns cannot give way', () => {
  expect(equalShareWidenedWidths([50, 50], [40, 40])).toBeUndefined();
  expect(equalShareWidenedWidths([10, 50, 20], [40, 10, 19])).toBeUndefined();
});

function widths(prefs: readonly number[], texts: readonly string[], options: Options = {}) {
  const rule = (side: string) => `<w:${side} w:val="single" w:sz="4"/>`;
  const sides = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(rule).join('');
  const grid = prefs.map((pref) => `<w:gridCol w:w="${Math.round((pref * 9000) / 5000)}"/>`);
  const type = options.cellType ?? 'pct';
  const cells = prefs.map(
    (pref, column) =>
      `<w:tc>${type === 'none' ? '' : `<w:tcPr><w:tcW w:w="${pref}" w:type="${type}"/></w:tcPr>`}` +
      `<w:p><w:r><w:t>${texts[column]}</w:t></w:r></w:p></w:tc>`
  );
  const xml =
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>` +
    `<w:tblBorders>${sides}</w:tblBorders></w:tblPr><w:tblGrid>${grid.join('')}</w:tblGrid>` +
    `<w:tr>${cells.join('')}</w:tr></w:tbl><w:p/></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const result = layoutSemanticDocument(parsed.part, 0, {
    ...(options.mode !== undefined ? { compatibilityMode: options.mode } : {}),
    geometry: { width: 470, height: 700, margin: { top: 10, right: 10, bottom: 10, left: 20 } },
    measurer: createFixedMeasurer(5, 12),
  });
  const table = result.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  return table.rows[0]!.cells.map((cell) => cell.box.width);
}
interface Options {
  readonly mode?: number;
  readonly cellType?: 'pct' | 'dxa' | 'none';
}

const WIDE = 'x'.repeat(30);

test('columns with equal preferences stay equal, whatever their text', () => {
  for (const mode of [15, 14, undefined]) {
    const [first, ...rest] = widths(
      [900, 1366, 1366, 1366],
      [WIDE, 'ab', 'a few longer words', 'cd'],
      {
        mode,
      }
    );
    const total = first! + rest.reduce((sum, width) => sum + width, 0);
    expect(first!).toBeGreaterThan((total * 900) / 5000 + 20);
    expect(rest[1]!).toBeCloseTo(rest[0]!, 6);
    expect(rest[2]!).toBeCloseTo(rest[0]!, 6);
  }
});

test('unequal preferences give up the same width each', () => {
  const plain = widths([900, 1000, 1500, 1600], [WIDE, 'ab', 'cd', 'ef'], { mode: 15 });
  const texts = widths([900, 1000, 1500, 1600], [WIDE, 'a few longer words', 'cd', 'ef'], {
    mode: 15,
  });
  // The text in a column that gives way does not change the split.
  texts.forEach((width, column) => expect(width).toBeCloseTo(plain[column]!, 6));
  const total = plain.reduce((sum, width) => sum + width, 0);
  const lost = (column: number, pref: number) => (total * pref) / 5000 - plain[column]!;
  expect(lost(2, 1500)).toBeCloseTo(lost(1, 1000), 6);
  expect(lost(3, 1600)).toBeCloseTo(lost(1, 1000), 6);
});

test('cells without a preferred width stay sized by their content', () => {
  const texts = [WIDE, 'ab', 'a few longer words', 'cd'];
  const [, second, third] = widths([900, 1366, 1366, 1366], texts, { mode: 15, cellType: 'none' });
  expect(third! - second!).toBeGreaterThan(1);
});
