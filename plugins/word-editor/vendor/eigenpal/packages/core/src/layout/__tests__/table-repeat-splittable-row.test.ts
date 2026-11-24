import { expect, test } from 'bun:test';
import { layOut, letterDocument, line, pageOf, rowsOf, type Row } from './table-letter-fixtures.ts';

// Page 1 holds the lead line, a spacer, the 60pt header row, and the 20pt row a, with 5pt
// left. Row z can split and goes to page 2, below the repeated header.
const headerCase = (z: Row) =>
  letterDocument(648 - 12 - 60 - 20 - 5, [
    { tag: 'h', twips: 1200, header: true },
    { tag: 'a', twips: 400 },
    z,
  ]);

const cases: [string, Row][] = [
  ['one line', { tag: 'z', cantSplit: false, firstLineTwips: 12000 }],
  [
    'a first line and three more lines',
    { tag: 'z', cantSplit: false, firstLineTwips: 12000, lines: 4 },
  ],
  ['lines past the page edge', { tag: 'z', cantSplit: false, firstLineTwips: 12000, lines: 21 }],
  ['a first line taller than the page', { tag: 'z', cantSplit: false, firstLineTwips: 13200 }],
];

for (const [name, z] of cases) {
  for (const compatibilityMode of [undefined, 14]) {
    test(`before mode 15, the header repeats above a splittable row with ${name} whose first line does not fit below it (${compatibilityMode ? `mode ${compatibilityMode}` : 'no mode'})`, () => {
      const result = layOut(headerCase(z), compatibilityMode);
      const placed = rowsOf(result);
      expect(placed.get('hc1@repeat')!.page).toBe(1);
      const row = placed.get('zc1')!;
      expect(row.page).toBe(1);
      expect(row.row.box.y).toBeCloseTo(60, 6);
      // The row stays whole below the repeat and runs past the 648pt band.
      expect(row.row.hasContinuation).toBeFalsy();
      expect(row.row.box.y + row.row.box.height).toBeGreaterThan(648);
      expect(pageOf(result, 'AFTER')).toBe(2);
    });
  }
}

test('mode 15 omits the header above a splittable row whose first line does not fit below it', () => {
  const result = layOut(headerCase(cases[1]![1]), 15);
  const placed = rowsOf(result);
  expect(placed.has('hc1@repeat')).toBe(false);
  const row = placed.get('zc1')!;
  expect(row.page).toBe(1);
  expect(row.row.box.y).toBe(0);
  expect(row.row.box.y + row.row.box.height).toBeLessThanOrEqual(648 + 0.001);
});

test('before mode 15, a splittable row whose first line fits below the header splits there', () => {
  const result = layOut(
    headerCase({ tag: 'z', cantSplit: false, firstLineTwips: 11000, lines: 6 }),
    14
  );
  const head = rowsOf(result).get('zc1')!;
  expect(head.page).toBe(1);
  expect(head.row.box.y).toBeCloseTo(60, 6);
  expect(head.row.hasContinuation).toBe(true);
  expect(pageOf(result, 'AFTER')).toBe(2);
});

// A nested table of one 75pt column opens the cell. Its first row holds one line of
// `firstTwips`, and its second row one 12pt line. `after` 12pt lines follow the nested table.
const nested = (tag: string, firstTwips: number, after = 4) =>
  '<w:tbl><w:tblPr><w:tblW w:w="1500" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
  '<w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/>' +
  '<w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/></w:tblBorders>' +
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
  '</w:tblPr><w:tblGrid><w:gridCol w:w="1500"/></w:tblGrid>' +
  `<w:tr><w:tc><w:tcPr><w:tcW w:w="1500" w:type="dxa"/></w:tcPr>${line(`${tag}n`, firstTwips)}</w:tc></w:tr>` +
  `<w:tr><w:tc><w:tcPr><w:tcW w:w="1500" w:type="dxa"/></w:tcPr>${line(`${tag}m`)}</w:tc></w:tr>` +
  `</w:tbl>${line(tag)}${['zl1', 'zl2', 'zl3']
    .slice(0, after - 1)
    .map((text) => line(text))
    .join('')}`;

/** The fragments of row z (the row below the repeated header), in page order. */
const zRowsOf = (result: ReturnType<typeof layOut>) =>
  result.pages.flatMap((page, index) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'table'
        ? fragment.rows
            .filter((row) => row.cells.some((cell) => cell.blocks[0]?.kind === 'table'))
            .map((row) => ({ page: index, row }))
        : []
    )
  );

/** The pages that open with a repeat of the header row. */
const repeatPagesOf = (result: ReturnType<typeof layOut>) =>
  result.pages.flatMap((page, index) =>
    page.fragments.some(
      (fragment) => fragment.kind === 'table' && fragment.rows[0]?.isHeaderRepeat === true
    )
      ? [index]
      : []
  );

const nestedCases: [string, readonly [string, string]][] = [
  ['in each cell', [nested('zc1', 12000), nested('zc2', 12000)]],
  // This row fits a fresh page, so the other cell must start too.
  ['in one cell', [`${line('zc1')}${line('zl1')}`, nested('zc2', 12000, 1)]],
];

for (const [name, cellContent] of nestedCases) {
  for (const compatibilityMode of [undefined, 14]) {
    test(`before mode 15, the header repeats above a row that opens with a nested table ${name} whose first nested row does not fit below it (${compatibilityMode ? `mode ${compatibilityMode}` : 'no mode'})`, () => {
      const result = layOut(
        headerCase({ tag: 'z', cantSplit: false, cellContent }),
        compatibilityMode
      );
      expect(repeatPagesOf(result)).toEqual([1]);
      const placed = zRowsOf(result);
      expect(placed).toHaveLength(1);
      const { page, row } = placed[0]!;
      expect(page).toBe(1);
      expect(row.box.y).toBeCloseTo(60, 6);
      // The row stays whole below the repeat and runs past the 648pt band.
      expect(row.hasContinuation).toBeFalsy();
      expect(row.box.y + row.box.height).toBeGreaterThan(648);
      expect(pageOf(result, 'AFTER')).toBe(2);
    });
  }
}

test('mode 15 omits the header above a row that opens with a nested table that does not fit below it', () => {
  const result = layOut(
    headerCase({ tag: 'z', cantSplit: false, cellContent: nestedCases[0]![1] }),
    15
  );
  // The repeat opens only the page of the row's continuation.
  expect(repeatPagesOf(result)).toEqual([2]);
  const [first] = zRowsOf(result);
  expect(first!.page).toBe(1);
  expect(first!.row.box.y).toBe(0);
  expect(first!.row.hasContinuation).toBe(true);
});

test('before mode 15, a row whose nested table starts below the header splits there', () => {
  const cellContent = [nested('zc1', 11000), nested('zc2', 11000)] as const;
  const result = layOut(headerCase({ tag: 'z', cantSplit: false, cellContent }), 14);
  const [head] = zRowsOf(result);
  expect(head!.page).toBe(1);
  expect(head!.row.box.y).toBeCloseTo(60, 6);
  expect(head!.row.hasContinuation).toBe(true);
  expect(repeatPagesOf(result)).toEqual([1, 2]);
});

/** The fragments of row z: every row fragment after page 1 that is not a header repeat. */
const zFragmentsOf = (result: ReturnType<typeof layOut>) =>
  result.pages.flatMap((page, index) =>
    index === 0
      ? []
      : page.fragments.flatMap((fragment) =>
          fragment.kind === 'table'
            ? fragment.rows
                .filter((row) => !row.isHeaderRepeat)
                .map((row) => ({ page: index, row }))
            : []
        )
  );

// Rows taller than a page in which the first content of only one cell does not fit below the
// header: a nested table, or a 600pt paragraph line followed by more lines.
const tallCases: [string, readonly [string, string]][] = [
  ['a nested table', [`${line('zc1')}${line('zl1')}`, nested('zc2', 12000)]],
  [
    'a paragraph line',
    [
      `${line('zc1')}${line('zl1')}`,
      line('zc2', 12000) + Array.from({ length: 7 }, (_, i) => line(`y${i}`)).join(''),
    ],
  ],
];

for (const [name, cellContent] of tallCases) {
  for (const compatibilityMode of [undefined, 14]) {
    test(`before mode 15, the header repeats above a row taller than a page when ${name} in one cell does not fit below it (${compatibilityMode ? `mode ${compatibilityMode}` : 'no mode'})`, () => {
      const result = layOut(
        headerCase({ tag: 'z', cantSplit: false, cellContent }),
        compatibilityMode
      );
      expect(repeatPagesOf(result)).toEqual([1]);
      const placed = zFragmentsOf(result);
      expect(placed).toHaveLength(1);
      expect(placed[0]!.page).toBe(1);
      expect(placed[0]!.row.box.y).toBeCloseTo(60, 6);
      expect(placed[0]!.row.hasContinuation).toBeFalsy();
      expect(pageOf(result, 'AFTER')).toBe(2);
    });
  }

  test(`mode 15 omits the header above a row taller than a page when ${name} in one cell does not fit below it`, () => {
    const result = layOut(headerCase({ tag: 'z', cantSplit: false, cellContent }), 15);
    expect(repeatPagesOf(result)).toEqual([2]);
    const [first] = zFragmentsOf(result);
    expect(first!.page).toBe(1);
    expect(first!.row.box.y).toBe(0);
    expect(first!.row.hasContinuation).toBe(true);
    // Every cell starts on that page.
    expect(first!.row.cells.every((cell) => cell.blocks.length > 0)).toBe(true);
  });
}

for (const compatibilityMode of [14, 15]) {
  test(`a row taller than a page whose first lines all fit below the header splits there (mode ${compatibilityMode})`, () => {
    const cellContent = [
      `${line('zc1')}${line('zl1')}`,
      line('zc2', 11000) + Array.from({ length: 12 }, (_, i) => line(`y${i}`)).join(''),
    ] as const;
    const result = layOut(
      headerCase({ tag: 'z', cantSplit: false, cellContent }),
      compatibilityMode
    );
    expect(repeatPagesOf(result)).toEqual([1, 2]);
    const [head] = zFragmentsOf(result);
    expect(head!.page).toBe(1);
    expect(head!.row.box.y).toBeCloseTo(60, 6);
    expect(head!.row.hasContinuation).toBe(true);
  });
}

// Row z starts below the repeat on page 2 with one short line in each cell. The next content
// of a cell, a nested table or a 600pt line, does not fit there, so the row continues on page 3.
const lateCases: [string, readonly [string, string]][] = [
  [
    'a nested table in each cell',
    [line('zc1') + nested('zb1', 12000), line('zc2') + nested('zb2', 12000)],
  ],
  ['a nested table in one cell', [line('zc1') + line('zl1'), line('zc2') + nested('zb2', 12000)]],
  [
    'a 600pt line in each cell',
    [line('zc1') + line('zb1', 12000), line('zc2') + line('zb2', 12000)],
  ],
];

for (const [name, cellContent] of lateCases) {
  for (const compatibilityMode of [undefined, 14]) {
    test(`before mode 15, the header repeats above a continued row when ${name} does not fit below it (${compatibilityMode ? `mode ${compatibilityMode}` : 'no mode'})`, () => {
      const result = layOut(
        headerCase({ tag: 'z', cantSplit: false, cellContent }),
        compatibilityMode
      );
      expect(repeatPagesOf(result)).toEqual([1, 2]);
      const placed = zFragmentsOf(result);
      expect(placed.map((part) => part.page)).toEqual([1, 2]);
      expect(placed[0]!.row.hasContinuation).toBe(true);
      // The rest of the row stays below the repeat and runs past the 648pt band.
      const rest = placed[1]!.row;
      expect(rest.box.y).toBeCloseTo(60, 6);
      expect(rest.hasContinuation).toBeFalsy();
      expect(rest.box.y + rest.box.height).toBeGreaterThan(648);
      expect(pageOf(result, 'AFTER')).toBe(3);
    });
  }

  test(`mode 15 omits the header above a continued row when ${name} does not fit below it`, () => {
    const result = layOut(headerCase({ tag: 'z', cantSplit: false, cellContent }), 15);
    expect(repeatPagesOf(result)).not.toContain(2);
    const placed = zFragmentsOf(result);
    expect(placed[1]!.page).toBe(2);
    expect(placed[1]!.row.box.y).toBe(0);
    expect(placed[1]!.row.box.y + placed[1]!.row.box.height).toBeLessThanOrEqual(648 + 0.001);
  });
}
