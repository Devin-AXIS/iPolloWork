import { expect, test } from 'bun:test';
import {
  createTableWidthFitEnvelope,
  tableWidthEnvelopeHolds,
  type CellWidthConstraint,
} from '../table-width-fit-envelope.ts';
import { cellFlowBox } from '../table-cell-text-direction.ts';
import { sumCols } from '../table-cell-spacing.ts';
import { tokenLineHoldsAtWidth, LINE_HOLD_TOLERANCE_PT } from '../paragraph-cache-width-reuse.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import type { PendingLine } from '../pending-line.ts';

const constraint = (column = 0): CellWidthConstraint => ({
  gridColumn: column,
  gridSpan: 1,
  insetLeft: 5.125,
  insetRight: 4.625,
  indentLeft: 0,
  indentRight: 0,
});
function line(width: number, firstLineOffset = 0): PendingLine {
  return {
    spans: [
      {
        text: 'word',
        range: { paragraphId: 'p', start: 0, end: 4 },
        props: [],
        style: DEFAULT_RUN_STYLE,
        box: { x: 0, y: 0, width, height: 12 },
      },
    ],
    drawings: [],
    start: 0,
    end: 4,
    width,
    firstLineOffset,
    height: 12,
    baseline: 10,
    leading: 0,
    trailingSpacing: 0,
  };
}
function individuallyHolds(
  pending: PendingLine,
  c: CellWidthConstraint,
  columns: number[],
  left: number
): boolean {
  const x = left + sumCols(columns, 0, c.gridColumn);
  const width = Math.max(
    sumCols(columns, c.gridColumn, c.gridColumn + c.gridSpan) ||
      sumCols(columns, 0, columns.length),
    1
  );
  const flow = cellFlowBox(false, x, width, 0, Infinity, {
    left: c.insetLeft,
    right: c.insetRight,
    top: 0,
    bottom: 0,
  });
  const available = Math.max(
    1,
    Math.max(1, flow.flowRight - flow.flowLeft) - c.indentLeft - c.indentRight
  );
  return pending.spans.length
    ? tokenLineHoldsAtWidth(pending, available)
    : pending.width + Math.max(0, pending.firstLineOffset ?? 0) <=
        available + LINE_HOLD_TOLERANCE_PT;
}

test('a row group keeps one maximum for each distinct cell geometry', () => {
  const builder = createTableWidthFitEnvelope(7);
  for (let row = 0; row < 35; row++)
    for (let column = 0; column < 7; column++) {
      expect(builder.add(line(row + column), constraint(column))).toBe(true);
    }
  const envelope = builder.finish()!;
  expect(envelope.cellCount).toBe(245);
  expect(envelope.groups).toHaveLength(7);
  expect(tableWidthEnvelopeHolds(envelope, Array(7).fill(60), 0)).toBe(true);
  expect(tableWidthEnvelopeHolds(envelope, Array(7).fill(20), 0)).toBe(false);
});

test('grouped checks agree with every individual width expression at fractional boundaries', () => {
  const members = Array.from({ length: 80 }, (_, i) => ({
    pending: line(1.125 + (i % 11) * 2.375, (i % 3) - 1.125),
    c: {
      ...constraint(i % 3),
      gridSpan: i % 3 === 0 ? 2 : 1,
      insetLeft: i % 2 ? 5.125 : -2.5,
      indentLeft: i % 4 ? 1.25 : -3.75,
    },
  }));
  const builder = createTableWidthFitEnvelope(3);
  for (const member of members) expect(builder.add(member.pending, member.c)).toBe(true);
  const envelope = builder.finish()!;
  for (const left of [-1e12, -91.625, -0, 0, 14.125, 1e12]) {
    for (let step = 0; step < 150; step++) {
      const columns = [step / 3, step / 5, step / 7];
      expect(tableWidthEnvelopeHolds(envelope, columns, left)).toBe(
        members.every((member) => individuallyHolds(member.pending, member.c, columns, left))
      );
    }
  }
  const boundary = createTableWidthFitEnvelope(1);
  boundary.add(line(20), { ...constraint(), insetLeft: 0, insetRight: 0 });
  for (const width of [
    20 - LINE_HOLD_TOLERANCE_PT - 1e-10,
    20 - LINE_HOLD_TOLERANCE_PT,
    20 - LINE_HOLD_TOLERANCE_PT + 1e-10,
  ]) {
    expect(tableWidthEnvelopeHolds(boundary.finish()!, [width], 0)).toBe(
      20 <= width + LINE_HOLD_TOLERANCE_PT
    );
  }
});

test('invalid or unproved members invalidate the whole certificate', () => {
  for (const pending of [
    { ...line(20), manualBreakAfter: true as const },
    { ...line(20), width: NaN },
    { ...line(20), firstLineOffset: Infinity },
  ]) {
    const builder = createTableWidthFitEnvelope(1);
    expect(builder.add(line(10), constraint())).toBe(true);
    expect(builder.add(pending, constraint())).toBe(false);
    expect(builder.finish()).toBeNull();
  }
  for (const c of [
    { ...constraint(), gridSpan: 2 },
    { ...constraint(), gridColumn: -1 },
    { ...constraint(), insetRight: Infinity },
  ]) {
    const builder = createTableWidthFitEnvelope(1);
    expect(builder.add(line(10), c)).toBe(false);
    expect(builder.finish()).toBeNull();
  }
});

test('snapshots retain only numbers and refuse excessive constraint diversity', () => {
  const builder = createTableWidthFitEnvelope(1);
  const source = { ...constraint(), unrelated: { retained: true } };
  builder.add(line(10), source);
  source.insetLeft = 500;
  const envelope = builder.finish()!;
  expect(envelope.groups[0]!.insetLeft).toBe(5.125);
  expect('unrelated' in envelope.groups[0]!).toBe(false);
  for (const columns of [[Infinity], [-1], [20, 20]])
    expect(tableWidthEnvelopeHolds(envelope, columns, 0)).toBe(false);
  const diverse = createTableWidthFitEnvelope(1);
  for (let i = 0; i < 128; i++)
    expect(diverse.add(line(1), { ...constraint(), insetLeft: i })).toBe(true);
  expect(diverse.add(line(1), { ...constraint(), insetLeft: 128 })).toBe(false);
  expect(diverse.finish()).toBeNull();
});

test('empty lines use the same fit rule and snapshots do not change after later additions', () => {
  const builder = createTableWidthFitEnvelope(1);
  expect(builder.add({ ...line(0), spans: [] }, constraint())).toBe(true);
  const first = builder.finish()!;
  expect(tableWidthEnvelopeHolds(first, [0], 0)).toBe(true);
  expect(builder.add(line(20), constraint())).toBe(true);
  expect(first.groups[0]!.required).toBe(0);
  expect(builder.finish()!.groups[0]!.required).toBe(20);
  const trailing = createTableWidthFitEnvelope(1);
  const pending = line(20);
  pending.spans[0] = { ...pending.spans[0]!, text: 'word ' };
  expect(trailing.add(pending, constraint())).toBe(false);
  expect(trailing.finish()).toBeNull();
});

test('the cell budget bounds certificate construction', () => {
  const builder = createTableWidthFitEnvelope(1);
  const pending = line(1);
  const c = constraint();
  let accepted = 0;
  while (builder.add(pending, c)) accepted++;
  expect(accepted).toBe(65536);
  expect(builder.finish()).toBeNull();
});

test('numeric groups intersect both cut bounds without subtracting tolerance', () => {
  const c = { ...constraint(), insetLeft: 0, insetRight: 0 };
  const first = { acceptedWidth: 20, rejectedWidth: 25, tolerance: 0.001, minimumAvailable: 1 };
  const second = { acceptedWidth: 21, rejectedWidth: 24, tolerance: 0.001, minimumAvailable: 22 };
  const builder = createTableWidthFitEnvelope(1);
  expect(builder.addNumeric(first, c)).toBe(true);
  const snapshot = builder.finish()!;
  expect(builder.addNumeric(second, c)).toBe(true);
  const result = builder.finish()!;
  expect(result.groups).toHaveLength(1);
  expect(result.cellCount).toBe(2);
  expect(snapshot.groups[0]!.required).toBe(20);
  expect(snapshot.groups[0]!.rejected).toBe(25);
  for (const width of [
    20,
    21,
    21.999,
    22,
    23,
    24 - 0.001 - 1e-10,
    24 - 0.001,
    24 - 0.001 + 1e-10,
    25,
    2 ** 20,
    2 ** 20 + 1,
  ]) {
    expect(tableWidthEnvelopeHolds(result, [width], 0)).toBe(
      [first, second].every(
        (proof) =>
          width >= proof.minimumAvailable &&
          width <= 2 ** 20 &&
          proof.acceptedWidth <= width + proof.tolerance &&
          proof.rejectedWidth > width + proof.tolerance
      )
    );
  }
  // Different tolerances keep separate comparisons, even for the same cell geometry.
  expect(builder.add(line(22), c)).toBe(true);
  expect(builder.finish()!.groups).toHaveLength(2);
  for (let width = 20; width < 26; width += 0.03125)
    expect(tableWidthEnvelopeHolds(builder.finish()!, [width], 0)).toBe(
      width >= 22 && 21 <= width + 0.001 && 24 > width + 0.001 && 22 <= width + 0.0005
    );
});

test('numeric bounds refuse invalid proofs and preserve the room domain', () => {
  const c = { ...constraint(), insetLeft: 0, insetRight: 0 };
  const proof = {
    acceptedWidth: 1,
    rejectedWidth: Infinity,
    tolerance: 0.001,
    minimumAvailable: 1,
  };
  const valid = createTableWidthFitEnvelope(1);
  expect(valid.addNumeric(proof, c)).toBe(true);
  expect(tableWidthEnvelopeHolds(valid.finish()!, [2 ** 20], 0)).toBe(true);
  expect(tableWidthEnvelopeHolds(valid.finish()!, [2 ** 20 + 1], 0)).toBe(false);
  for (const changed of [
    { acceptedWidth: NaN },
    { acceptedWidth: -1 },
    { acceptedWidth: 2 ** 21 },
    { rejectedWidth: NaN },
    { rejectedWidth: 1 },
    { tolerance: -1 },
    { tolerance: Infinity },
    { minimumAvailable: NaN },
    { minimumAvailable: 0 },
    { minimumAvailable: Infinity },
  ]) {
    const builder = createTableWidthFitEnvelope(1);
    expect(builder.addNumeric({ ...proof, ...changed }, c)).toBe(false);
    expect(builder.finish()).toBeNull();
  }
});
