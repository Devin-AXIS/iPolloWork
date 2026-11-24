import { expect, test } from 'bun:test';
import {
  layOut,
  letterDocument,
  pageOf,
  rowsOf,
  textTop,
  type Row,
} from './table-letter-fixtures.ts';

// Page 1 holds the lead line, a spacer, the header row, and the 20pt row a, with 5pt left.
// Row z goes to page 2, where it fits a fresh page but not the room below the repeated header.
const headerCase = (headerTwips: number, z: Row) =>
  letterDocument(648 - 12 - headerTwips / 20 - 20 - 5, [
    { tag: 'h', twips: headerTwips, header: true },
    { tag: 'a', twips: 400 },
    z,
  ]);

const cases: [string, number, Row][] = [
  ['an exact row', 400, { tag: 'z', twips: 12800 }],
  ['a row that cannot split', 1200, { tag: 'z', lines: 50 }],
  ['a minimum-height row that cannot split', 1200, { tag: 'z', twips: 12400, rule: 'atLeast' }],
];

for (const [name, headerTwips, z] of cases) {
  const header = headerTwips / 20;
  for (const compatibilityMode of [undefined, 14]) {
    test(`before mode 15, the header repeats above ${name} that runs past the margin (mode ${compatibilityMode})`, () => {
      const result = layOut(headerCase(headerTwips, z), compatibilityMode);
      const placed = rowsOf(result);
      expect(placed.get('hc1@repeat')!.page).toBe(1);
      const row = placed.get('zc1')!;
      expect(row.page).toBe(1);
      expect(row.row.box.y).toBeCloseTo(header, 6);
      // The row keeps its whole height below the repeat, past the 648pt band.
      expect(row.row.hasContinuation).toBeFalsy();
      expect(row.row.box.y + row.row.box.height).toBeGreaterThan(648);
      expect(pageOf(result, 'AFTER')).toBe(2);
    });
  }

  test(`mode 15 omits the header above ${name} that does not fit below it`, () => {
    const result = layOut(headerCase(headerTwips, z), 15);
    const placed = rowsOf(result);
    expect(placed.has('hc1@repeat')).toBe(false);
    const row = placed.get('zc1')!;
    expect(row.page).toBe(1);
    expect(row.row.box.y).toBe(0);
    expect(row.row.box.y + row.row.box.height).toBeLessThanOrEqual(648 + 0.001);
  });
}

test('before mode 15, the overflowing exact row keeps its alignment over the authored height', () => {
  const placed = rowsOf(layOut(headerCase(400, { tag: 'z', twips: 12800 }), 14));
  // Below the 20pt repeat: 0.5pt inside rule, then 639.5pt of content box; 12pt line centered.
  expect(textTop(placed.get('zc1'))).toBeCloseTo(20 + 0.5 + (639.5 - 12) / 2, 6);
});

test('before mode 15, a row that can split still splits below the repeated header', () => {
  const placed = rowsOf(layOut(headerCase(1200, { tag: 'z', lines: 60, cantSplit: false }), 14));
  const head = placed.get('zc1')!;
  // Page 2 repeats the 60pt header, and the row splits below it.
  expect(head.page).toBe(1);
  expect(head.row.box.y).toBeCloseTo(60, 6);
  expect(head.row.hasContinuation).toBe(true);
});
