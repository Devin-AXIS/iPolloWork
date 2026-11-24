import { expect, test } from 'bun:test';
import type { SemanticTableCell, SemanticTableRow } from '../semantic-table.ts';
import {
  rowForWidenedMeasurement,
  retargetSharedGridLineSideRules,
} from '../legacy-table-side-rules.ts';
import type { CellBorderBox } from '../table-borders.ts';
import { cellContentInsets } from '../table-cell-geometry.ts';
import {
  carryWidenedCellContentInsets,
  sharedCellContentInsets,
  widenedCellContentInsets,
} from '../cell-content-insets-memo.ts';
import { widenedCellInsets } from '../table-autofit-cell-cache.ts';
import { EMPTY_TABLE_CELL_STYLE_FORMATTING } from '../style-cascade.ts';

const edge = { state: 'edge', style: 'single', color: null, widthPt: 2 } as const;
const borders: CellBorderBox = { top: edge, right: edge, bottom: edge, left: edge };
const cell = (extra: Partial<SemanticTableCell> = {}): SemanticTableCell => ({
  id: 'cell',
  gridSpan: 1,
  gridColumn: 0,
  vMergeContinue: false,
  vAlign: 'top',
  textDirection: 'horizontal',
  margins: { top: 1, right: 3, bottom: 2, left: 4 },
  borders,
  preferredWidth: { type: 'auto', value: 0 },
  styleFormatting: EMPTY_TABLE_CELL_STYLE_FORMATTING,
  blocks: [],
  ...extra,
});
const plain = (source: SemanticTableCell) => {
  const { centeredSideRules: _rules, legacyContentAlignment: _legacy, ...result } = source;
  return result;
};
const stripped = (source: SemanticTableCell) => {
  const { centeredSideRules: _rules, centeredSidePaint: _paint, ...result } = source;
  return result;
};

test('widened insets preserve the original flag-removal arithmetic', () => {
  const numbers = [0, -0, 0.125, 1 / 3, 8, -2, Number.NaN, Number.POSITIVE_INFINITY];
  const edges = [
    { state: 'omitted' },
    { state: 'none' },
    edge,
    { ...edge, style: 'double' },
    { ...edge, style: 'triple' },
    { ...edge, style: 'thick' },
  ] as const;
  for (let index = 0; index < 128; index++) {
    const side = edges[index % edges.length]!;
    const source = cell({
      centeredSideRules: index % 2 ? true : undefined,
      legacyContentAlignment: index % 3 ? true : undefined,
      contentBottomIsOuter: index % 2 === 0,
      topBandClearancePt: index % 4 ? numbers[index % numbers.length] : undefined,
      margins: {
        top: numbers[index % numbers.length]!,
        right: numbers[(index + 1) % numbers.length]!,
        bottom: numbers[(index + 2) % numbers.length]!,
        left: numbers[(index + 3) % numbers.length]!,
      },
      contentBorders: { top: side, right: side, bottom: side, left: side },
    });
    for (const collapsed of [false, true]) {
      const expected = cellContentInsets(plain(source), collapsed);
      const actual = widenedCellContentInsets(source, collapsed);
      for (const name of ['top', 'right', 'bottom', 'left'] as const)
        expect(Object.is(actual[name], expected[name])).toBe(true);
      expect(widenedCellContentInsets(source, collapsed)).toBe(actual);
      const current = cellContentInsets(source, collapsed);
      const widened = widenedCellInsets(source, collapsed, current);
      const changes = source.centeredSideRules || source.legacyContentAlignment;
      expect(
        Object.is(widened.left, changes ? Math.max(current.left, expected.left) : current.left)
      ).toBe(true);
      expect(
        Object.is(widened.right, changes ? Math.max(current.right, expected.right) : current.right)
      ).toBe(true);
    }
  }
});

test('side-rule copies reuse the exact insets already measured for widening', () => {
  const source = cell({ centeredSideRules: true, centeredSidePaint: true });
  const copy = stripped(source);
  const expected = [false, true].map((mode) => widenedCellContentInsets(source, mode));
  carryWidenedCellContentInsets(source, copy);
  for (const [index, mode] of [false, true].entries()) {
    expect(sharedCellContentInsets(copy, mode)).toBe(expected[index]!);
    expect(sharedCellContentInsets(copy, mode)).toEqual(cellContentInsets(copy, mode));
  }
});

test('changed geometry and retained alignment flags cannot receive widened insets', () => {
  const source = cell({ centeredSideRules: true, centeredSidePaint: true });
  const expected = widenedCellContentInsets(source, true);
  const changes: Partial<SemanticTableCell>[] = [
    { centeredSideRules: true },
    { legacyContentAlignment: true },
    { margins: { ...source.margins, top: 9 } },
    { borders: { ...borders, bottom: { ...edge, widthPt: 9 } } },
    { contentBorders: { ...borders, left: { state: 'none' } } },
    { contentBottomIsOuter: true },
    { topBandClearancePt: 9 },
  ];
  for (const change of changes) {
    const copy = { ...stripped(source), ...change };
    carryWidenedCellContentInsets(source, copy);
    const actual = sharedCellContentInsets(copy, true);
    expect(actual).not.toBe(expected);
    expect(actual).toEqual(cellContentInsets(copy, true));
  }
});

test('missing measurements and separate border modes keep their regular computation', () => {
  const source = cell({ centeredSideRules: true });
  const collapsed = widenedCellContentInsets(source, true);
  const copy = stripped(source);
  carryWidenedCellContentInsets(source, copy);
  expect(sharedCellContentInsets(copy, false)).not.toBe(collapsed);
  expect(sharedCellContentInsets(copy, false)).toEqual(cellContentInsets(copy, false));
  const other = cell({ centeredSideRules: true });
  const otherCopy = stripped(other);
  carryWidenedCellContentInsets(other, otherCopy);
  expect(sharedCellContentInsets(otherCopy, true)).toEqual(cellContentInsets(otherCopy, true));
});

const rowOf = (source: SemanticTableCell): SemanticTableRow => ({
  id: 'row',
  isHeader: false,
  cantSplit: false,
  height: { rule: 'auto' },
  cells: [source],
});

test('widening reuses its measured cells when the side-rule decision changes', () => {
  const source = cell({ centeredSideRules: true, centeredSidePaint: true });
  const row = rowOf(source);
  const prepared = rowForWidenedMeasurement(row, 1, false)!;
  expect(prepared).not.toBe(row);
  expect(prepared.cells[0]!.centeredSideRules).toBeUndefined();
  expect(prepared.cells[0]!.centeredSidePaint).toBeUndefined();
  for (const mode of [false, true]) {
    const current = cellContentInsets(source, mode);
    expect(widenedCellInsets(source, mode, current, prepared.cells[0])).toEqual(
      widenedCellInsets(source, mode, current)
    );
  }
  const retarget = retargetSharedGridLineSideRules(
    [row],
    {
      compatibilityMode: 15,
      depth: 0,
      bidiVisual: false,
      floating: false,
      cellSpacingPt: 0,
      widthType: 'dxa',
      alignment: 'left',
      layoutFixed: false,
      indentPt: 0,
      columnWidthsPt: [100],
      containerWidthPt: 300,
    },
    [300]
  );
  expect(retarget.rows[0]).toBe(prepared);
  expect(rowForWidenedMeasurement(row, 1, false)).toBe(prepared);
});

test('rows with unmeasured cells keep individual widening measurements', () => {
  for (const extra of [
    { legacyContentAlignment: true },
    { vMergeContinue: true },
    { gridColumn: -1 },
    { gridColumn: 1 },
    { textDirection: 'btLr' },
    { gridSpan: 2 },
  ] as const) {
    const row = rowOf(cell({ centeredSideRules: true, ...extra }));
    expect(rowForWidenedMeasurement(row, 1, false)).toBeUndefined();
  }
  const spanning = rowOf(cell({ centeredSideRules: true, gridSpan: 2 }));
  expect(rowForWidenedMeasurement(spanning, 2, true)).toBeDefined();
  const legacy = cell({ centeredSideRules: true, legacyContentAlignment: true });
  const current = cellContentInsets(legacy, true);
  // A retained legacy flag cannot substitute for the fully widened measurement.
  expect(widenedCellInsets(legacy, true, current, stripped(legacy))).toEqual(
    widenedCellInsets(legacy, true, current)
  );
});
