import { expect, test } from 'bun:test';
import { layOut, letterDocument, pageOf, rowsOf, type Row } from './table-letter-fixtures.ts';

// Letter page, 1in margins: a 648pt band. A 60-line row that cannot split is 720pt tall,
// so no page holds it. A 100pt spacer comes before the table.
const tall = (lines = 60): Row => ({ tag: 'r', lines });
const table = (rows: Row[]) => letterDocument(100, rows, { align: 'top' });

for (const compatibilityMode of [undefined, 14]) {
  test(`before mode 15, a row taller than a page stays whole on a fresh page (mode ${compatibilityMode})`, () => {
    const result = layOut(table([tall()]), compatibilityMode);
    const row = rowsOf(result).get('rc1')!;
    expect(row.page).toBe(1);
    expect(row.row.box.y).toBe(0);
    expect(row.row.hasContinuation).toBeFalsy();
    // Every line stays in this one fragment, and the row runs past the 648pt band.
    expect(row.row.cells[0]!.blocks).toHaveLength(60);
    expect(row.row.box.height).toBeGreaterThan(720);
    expect(pageOf(result, 'AFTER')).toBe(2);
  });

  test(`before mode 15, the next row starts the page after a row taller than a page (mode ${compatibilityMode})`, () => {
    const placed = rowsOf(layOut(table([tall(70), { tag: 'q', twips: 400 }]), compatibilityMode));
    expect(placed.get('rc1')!.page).toBe(1);
    expect(placed.get('rc1')!.row.cells[0]!.blocks).toHaveLength(70);
    expect(placed.get('qc1')!.page).toBe(2);
    expect(placed.get('qc1')!.row.box.y).toBe(0);
  });

  test(`before mode 15, repeated headers stay above a row taller than a page (mode ${compatibilityMode})`, () => {
    const placed = rowsOf(
      layOut(table([{ tag: 'h', twips: 400, header: true }, tall()]), compatibilityMode)
    );
    const row = placed.get('rc1')!;
    expect(placed.get('hc1')!.page).toBe(0);
    expect(placed.get('hc1@repeat')!.page).toBe(row.page);
    expect(row.row.box.y).toBeCloseTo(20, 6);
    expect(row.row.hasContinuation).toBeFalsy();
  });
}

test('mode 15 splits a row taller than a page on its fresh page', () => {
  const row = rowsOf(layOut(table([tall()]), 15)).get('rc1')!;
  expect(row.page).toBe(1);
  expect(row.row.hasContinuation).toBe(true);
  expect(row.row.box.y + row.row.box.height).toBeLessThanOrEqual(648 + 0.001);
});

test('before mode 15, a row that can split still splits', () => {
  const row = rowsOf(layOut(table([{ tag: 'r', lines: 60, cantSplit: false }]), 14)).get('rc1')!;
  expect(row.page).toBe(0);
  expect(row.row.hasContinuation).toBe(true);
});
