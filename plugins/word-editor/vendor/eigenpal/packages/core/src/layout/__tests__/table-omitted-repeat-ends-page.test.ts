import { expect, test } from 'bun:test';
import { layOut, letterDocument, pageOf, rowsOf, type Row } from './table-letter-fixtures.ts';

// From mode 15, when the last page of a table leaves out its repeated header rows, the content
// after the table starts on the next page even where it fits (`omittedRepeatEndsPage`). The
// reason for the omission does not matter: a row that does not fit below the repeat, or an
// exact last row whose bottom rule leaves the repeat no room. Rows after the omitted row stay on
// that page. A table whose last page keeps its repeat, or has no header rows, keeps the content.

// Page 1 holds the lead line, a spacer, the 60pt header row and the 20pt row a. Row z then fits
// page 2 alone, but not below the repeat, so page 2 leaves the repeat out.
const header: Row = { tag: 'h', twips: 1200, header: true };
const lead: Row = { tag: 'a', twips: 400 };
const small = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({ tag: `y${index}`, twips: 240 }));
const omitted = (rows: readonly Row[]) => letterDocument(551, [header, lead, ...rows]);

const cases: [string, readonly Row[]][] = [
  ['a row that cannot split', [{ tag: 'z', lines: 50 }]],
  ['a minimum-height row that cannot split', [{ tag: 'z', twips: 12000, rule: 'atLeast' }]],
  ['an omitted row followed by a short row', [{ tag: 'z', lines: 50 }, ...small(1)]],
];

for (const [name, rows] of cases) {
  test(`mode 15: after ${name} on a page without the repeat, the next paragraph starts a page`, () => {
    const result = layOut(omitted(rows), 15);
    const placed = rowsOf(result);
    expect(placed.get('zc1')!.page).toBe(1);
    expect(placed.has('hc1@repeat')).toBe(false);
    for (const row of rows) expect(placed.get(`${row.tag}c1`)!.page).toBe(1);
    // The paragraph fits below the last row (it ends near 613pt), yet starts page 3.
    expect(pageOf(result, 'AFTER')).toBe(2);
    expect(result.pages[2]!.fragments[0]!.box.y).toBe(0);
  });
}

test('mode 15: an exact last row whose bottom rule leaves the repeat no room ends the page', () => {
  // A 20pt header and a 627.5pt exact last row: below the repeat the row fits only without its
  // 1.5pt bottom rule, so the repeat is left out (`repeatedHeaderYieldsToTerminalRule`).
  const part = letterDocument(
    591,
    [{ tag: 'h', twips: 400, header: true }, lead, { tag: 'm', twips: 12550 }],
    { align: 'bottom' }
  );
  const result = layOut(part, 15);
  const placed = rowsOf(result);
  expect(placed.get('mc1')!.page).toBe(1);
  expect(placed.has('hc1@repeat')).toBe(false);
  expect(pageOf(result, 'AFTER')).toBe(2);
});

test('mode 15: a table whose last page keeps the repeat leaves the paragraph after it', () => {
  // Page 2 leaves the repeat out, page 3 repeats it above the last rows.
  const result = layOut(omitted([{ tag: 'z', lines: 50 }, ...small(10)]), 15);
  const placed = rowsOf(result);
  expect(placed.get('hc1@repeat')!.page).toBe(2);
  expect(placed.get('y9c1')!.page).toBe(2);
  expect(pageOf(result, 'AFTER')).toBe(2);
});

test('mode 15: without header rows the paragraph stays below the last row', () => {
  const part = letterDocument(591, [{ tag: 'h', twips: 400 }, lead, { tag: 'm', twips: 12550 }], {
    align: 'bottom',
  });
  const result = layOut(part, 15);
  expect(rowsOf(result).get('mc1')!.page).toBe(1);
  expect(pageOf(result, 'AFTER')).toBe(1);
});
