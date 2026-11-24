import { expect, test } from 'bun:test';
import { layOut, letterDocument, rowsOf, textTop } from './table-letter-fixtures.ts';

// Rows a and m are 20pt, z is 40pt. Row m ends at `mBottom`, and z does not fit below it.
const breakRows = (mBottom: number) =>
  [
    mBottom - 12 - 40,
    [
      { tag: 'a', twips: 400 },
      { tag: 'm', twips: 400 },
      { tag: 'z', twips: 800 },
    ],
  ] as const;

for (const [align, mText, zText] of [
  ['bottom', 618, 29],
  ['center', 614.25, 15.25],
  ['top', 610.5, 1.5],
] as const) {
  test(`a ${align} exact row that ends a page draws its rules outside the authored height`, () => {
    const [spacer, rows] = breakRows(630);
    const placed = rowsOf(layOut(letterDocument(spacer, rows, { align })));
    const m = placed.get('mc1')!;
    const z = placed.get('zc1')!;
    expect([m.page, z.page]).toEqual([0, 1]);
    // Row m: 610pt to the authored 630pt, then the 1.5pt table bottom rule below it.
    expect(m.row.box.y).toBeCloseTo(610, 6);
    expect(m.row.box.height).toBeCloseTo(21.5, 6);
    expect(textTop(m)).toBeCloseTo(mText, 6);
    // Row z opens page 2: its 1.5pt top rule replaces the 0.5pt inside rule. The 1pt
    // difference sits above the authored 40pt, and its closing rule below it.
    expect(z.row.box.y).toBe(0);
    expect(z.row.box.height).toBeCloseTo(1 + 40 + 1.5, 6);
    expect(textTop(z)).toBeCloseTo(zText, 6);
    // The table's first row keeps its 1.5pt top rule inside its authored height.
    expect(placed.get('ac1')!.row.box.height).toBeCloseTo(20, 6);
    expect(textTop(placed.get('ac1'))).toBeCloseTo(
      align === 'top' ? 591.5 : align === 'center' ? 594.75 : 598,
      6
    );
  });
}

for (const compatibilityMode of [undefined, 14, 15]) {
  for (const [mBottom, moves] of [
    [646.25, false],
    [646.5, false],
    [646.75, true],
    // The 0.5pt inside rule would fit. The row ends the page, so the 1.5pt bottom rule counts.
    [647.25, true],
  ] as const) {
    test(`an exact row that ends a page at ${mBottom}pt ${moves ? 'moves' : 'stays'} (mode ${compatibilityMode})`, () => {
      const [spacer, rows] = breakRows(mBottom);
      const placed = rowsOf(layOut(letterDocument(spacer, rows), compatibilityMode));
      const a = placed.get('ac1')!;
      const m = placed.get('mc1')!;
      expect(a.page).toBe(0);
      expect(m.page).toBe(moves ? 1 : 0);
      if (moves) {
        // Row a now ends page 1 and takes the bottom rule; row m opens page 2.
        expect(a.row.box.height).toBeCloseTo(21.5, 6);
        expect(m.row.box.y).toBe(0);
        expect(m.row.box.height).toBeCloseTo(21, 6);
        expect(placed.get('zc1')!.row.box.y).toBeCloseTo(21, 6);
      } else {
        expect(m.row.box.y + m.row.box.height).toBeCloseTo(mBottom + 1.5, 6);
      }
    });
  }
}

test('without an inside rule, a row that opens a page gains the whole top rule', () => {
  const [spacer, rows] = breakRows(647.25);
  const placed = rowsOf(layOut(letterDocument(spacer, rows, { insideH: false })));
  const m = placed.get('mc1')!;
  expect(m.page).toBe(1);
  expect(m.row.box.height).toBeCloseTo(21.5, 6);
  expect(textTop(m)).toBeCloseTo(5.5, 6);
  expect(placed.get('zc1')!.row.box.y).toBeCloseTo(21.5, 6);
});

// Page 1: lead, spacer, header h, and row a, with 5pt left. Row m goes to page 2.
// Below a repeated 20pt header, m ends at 647.5pt: it fits, but the 1.5pt bottom rule does not.
const headerCase = () =>
  letterDocument(648 - 12 - 40 - 5, [
    { tag: 'h', twips: 400, header: true },
    { tag: 'a', twips: 400 },
    { tag: 'm', twips: 12550 },
    { tag: 'z', twips: 400 },
  ]);

test('mode 15 omits a repeated header that leaves an exact row that ends the page no rule room', () => {
  const placed = rowsOf(layOut(headerCase(), 15));
  const m = placed.get('mc1')!;
  expect(m.page).toBe(1);
  expect(m.row.box.y).toBe(0);
  expect(m.row.box.height).toBeCloseTo(1 + 627.5 + 1.5, 6);
  // Page 3 repeats the header above row z.
  expect(placed.get('hc1@repeat')!.page).toBe(2);
  expect(placed.get('zc1')!.page).toBe(2);
});

for (const compatibilityMode of [undefined, 14]) {
  test(`before mode 15, the header repeats and the row's rule crosses the margin (mode ${compatibilityMode})`, () => {
    const placed = rowsOf(layOut(headerCase(), compatibilityMode));
    const m = placed.get('mc1')!;
    expect(m.page).toBe(1);
    expect(m.row.box.y).toBeCloseTo(20, 6);
    // The row stays below the repeat: 20 + 627.5 = 647.5pt, and its rule ends at 649pt.
    expect(m.row.box.y + m.row.box.height).toBeCloseTo(649, 6);
    expect(placed.get('zc1')!.page).toBe(2);
  });
}
