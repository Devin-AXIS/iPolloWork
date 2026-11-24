import { weakRefOf } from '../../store/package/weak-ref.ts';
import { expect, test } from 'bun:test';
import {
  retargetSharedGridLineSideRules,
  withCentredSideRulePaint,
  withLegacyTableSideRules,
  withSharedGridLineSideRules,
  type SideRuleTableShape,
} from '../legacy-table-side-rules.ts';
import type { SemanticTableRow } from '../semantic-table.ts';
import type { TableBorderSide } from '../table-borders.ts';

// Side-rule copies only add or drop the centred flags, so they keep the uniform-rule answer
// of the rows they copy. Side borders count their reads to show the answer is reused.
let sideReads = 0;
const NONE: TableBorderSide = { state: 'none' };
const rule = (widthPt: number): TableBorderSide => ({
  state: 'edge',
  style: 'single',
  color: null,
  widthPt,
});
function sides(widthPt: number) {
  const edge = rule(widthPt);
  const read = () => {
    sideReads += 1;
    return edge;
  };
  const box = { top: NONE, bottom: NONE };
  Object.defineProperty(box, 'left', { get: read, enumerable: true });
  Object.defineProperty(box, 'right', { get: read, enumerable: true });
  return box;
}
function rows(borderPt: number, contentPt?: number): SemanticTableRow[] {
  return Array.from({ length: 3 }, (_, row) => ({
    id: `r${row}`,
    cells: [0, 1].map((column) => ({
      id: `c${row}-${column}`,
      gridColumn: column,
      gridSpan: 1,
      vMergeContinue: false,
      borders: sides(borderPt),
      ...(contentPt === undefined ? {} : { contentBorders: sides(contentPt) }),
    })),
  })) as unknown as SemanticTableRow[];
}
const narrow: SideRuleTableShape = {
  compatibilityMode: 15,
  depth: 0,
  bidiVisual: false,
  floating: false,
  cellSpacingPt: 0,
  widthType: 'dxa',
  alignment: 'left',
  layoutFixed: false,
  indentPt: 0,
  columnWidthsPt: [100, 100],
  containerWidthPt: 300,
};
const WIDE = [100, 250];
const flags = (result: { rows: readonly SemanticTableRow[] }) =>
  result.rows.flatMap((row) =>
    row.cells.map((cell) => [cell.centeredSidePaint, cell.centeredSideRules])
  );

test('side-rule copies reuse the uniform rule without reading side borders again', () => {
  const shared = withSharedGridLineSideRules(rows(1), narrow);
  expect(shared.outerRuleOffsetPt).toBe(0.5);
  expect(flags(shared).every(([paint, rules]) => paint && rules)).toBe(true);

  sideReads = 0;
  const widened = retargetSharedGridLineSideRules(shared.rows, narrow, WIDE);
  expect(sideReads).toBe(0);
  expect(widened.outerRuleOffsetPt).toBeUndefined();
  expect(widened).toEqual(
    withSharedGridLineSideRules(rows(1), { ...narrow, columnWidthsPt: WIDE })
  );

  // Back to widths that fit: the same decision as a fresh read.
  sideReads = 0;
  const back = retargetSharedGridLineSideRules(
    widened.rows,
    { ...narrow, columnWidthsPt: WIDE },
    [100, 100]
  );
  // Only the per-cell shared-line test reads the sides; the uniform rule is already known.
  expect(sideReads).toBe(2 * 6 * 2);
  expect(back).toEqual(withSharedGridLineSideRules(rows(1), narrow));
});

test('carried answers keep the content-border fallback', () => {
  // Content borders decide over cell borders when present.
  const content = withSharedGridLineSideRules(rows(4, 1), narrow);
  expect(content.outerRuleOffsetPt).toBe(0.5);
  const contentBack = retargetSharedGridLineSideRules(
    retargetSharedGridLineSideRules(content.rows, narrow, WIDE).rows,
    { ...narrow, columnWidthsPt: WIDE },
    [100, 100]
  );
  expect(contentBack.outerRuleOffsetPt).toBe(0.5);

  // Without content borders the cell borders decide.
  const plain = withSharedGridLineSideRules(rows(4), narrow);
  expect(plain.outerRuleOffsetPt).toBe(2);
  const plainBack = retargetSharedGridLineSideRules(
    retargetSharedGridLineSideRules(plain.rows, narrow, WIDE).rows,
    { ...narrow, columnWidthsPt: WIDE },
    [100, 100]
  );
  expect(plainBack.outerRuleOffsetPt).toBe(2);
  expect(flags(plainBack)).toEqual(flags(plain));
});

test('unchanged source rows reuse the latest identical side-rule variant', () => {
  const source = rows(1);
  const first = withLegacyTableSideRules(source);
  sideReads = 0;
  const second = withLegacyTableSideRules([...source]);
  expect(second).not.toBe(first);
  for (let index = 0; index < source.length; index++) expect(second[index]).toBe(first[index]);
  expect(sideReads).toBe(0);
  const painted = withCentredSideRulePaint(source);
  expect(painted[0]).not.toBe(first[0]);
  expect(painted[0]!.cells[0]!.centeredSideRules).toBeUndefined();
  expect(painted[0]!.cells[0]!.centeredSidePaint).toBe(true);
  // One latest variant is retained, rather than every historical combination.
  const revisited = withLegacyTableSideRules(source);
  expect(revisited[0]).not.toBe(first[0]);
  expect(revisited).toEqual(first);
});

test('changed side-rule options and source rows invalidate only their entries', () => {
  const source = rows(1);
  const first = withLegacyTableSideRules(source, false, false);
  const simple = withLegacyTableSideRules(source, true, false);
  expect(simple[0]).not.toBe(first[0]);
  const unequal = withLegacyTableSideRules(source, true, true);
  expect(unequal[0]).not.toBe(simple[0]);
  const changed = [{ ...source[0]!, id: 'replacement' }, ...source.slice(1)];
  const next = withLegacyTableSideRules(changed, true, true);
  expect(next[0]).not.toBe(unequal[0]);
  expect(next[1]).toBe(unequal[1]);
  expect(next[2]).toBe(unequal[2]);
});

test('live source rows do not retain discarded side-rule copies', () => {
  const source = rows(1);
  const discarded = (() => weakRefOf(withLegacyTableSideRules(source)[0]!))();
  Bun.gc(true);
  expect(discarded.deref()).toBeUndefined();
  expect(source[0]!.cells.length).toBe(2);
  expect(withLegacyTableSideRules(source)[0]!.cells[0]!.centeredSideRules).toBe(true);
});
