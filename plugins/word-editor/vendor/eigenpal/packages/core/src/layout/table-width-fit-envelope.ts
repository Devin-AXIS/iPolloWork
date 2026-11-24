// Width-only proof for a group of already validated ordinary cell paragraphs.
// This stores numeric constraints, not paragraphs, placed spans, or previous layouts.
import { cellWidthAfterIndents } from './cell-paragraph-inputs.ts';
import { cellFlowBox } from './table-cell-text-direction.ts';
import { sumCols } from './table-cell-spacing.ts';
import { MIN_CELL_BOX_PT } from './semantic-table-layout.ts';
import {
  LINE_HOLD_TOLERANCE_PT,
  lineTiedToPlacement,
  tokenLineMovable,
} from './paragraph-cache-width-reuse.ts';
import type { NumericWidthProof } from './numeric-width-proof-cache.ts';
import { MAX_WIDTH_COMPARISON_ROOM } from './width-comparison-proof.ts';
import type { PendingLine } from './pending-line.ts';

export interface CellWidthConstraint {
  readonly gridColumn: number;
  readonly gridSpan: number;
  readonly insetLeft: number;
  readonly insetRight: number;
  readonly indentLeft: number;
  readonly indentRight: number;
}

interface WidthGroup extends CellWidthConstraint {
  readonly required: number;
  readonly rejected: number;
  readonly tolerance: number;
  readonly minimumAvailable: number;
  readonly maximumAvailable: number;
}

export interface TableWidthFitEnvelope {
  readonly columnCount: number;
  readonly cellCount: number;
  readonly groups: readonly WidthGroup[];
}

// A varied page falls back instead of retaining one constraint for every paragraph.
const MAX_GROUPS = 128;
const MAX_CELLS = 65536;

/** The caller separately proves unchanged source, projection, and placement dependencies. */
export function createTableWidthFitEnvelope(columnCount: number): {
  add(line: PendingLine, constraint: CellWidthConstraint): boolean;
  addNumeric(proof: NumericWidthProof, constraint: CellWidthConstraint): boolean;
  finish(): TableWidthFitEnvelope | null;
} {
  const groups = new Map<string, WidthGroup>();
  let cells = 0;
  let valid = Number.isInteger(columnCount) && columnCount > 0 && columnCount <= 1024;
  function addBounds(
    constraint: CellWidthConstraint,
    required: number,
    rejected: number,
    tolerance: number,
    minimumAvailable: number,
    maximumAvailable: number
  ): boolean {
    if (!valid) return false;
    const values = [
      constraint.gridColumn,
      constraint.gridSpan,
      constraint.insetLeft,
      constraint.insetRight,
      constraint.indentLeft,
      constraint.indentRight,
      tolerance,
    ];
    if (
      ++cells > MAX_CELLS ||
      !values.every(Number.isFinite) ||
      !Number.isInteger(constraint.gridColumn) ||
      !Number.isInteger(constraint.gridSpan) ||
      constraint.gridColumn < 0 ||
      constraint.gridSpan < 1 ||
      constraint.gridColumn + constraint.gridSpan > columnCount ||
      !Number.isFinite(required) ||
      !(rejected > required) ||
      tolerance < 0 ||
      tolerance > 1 ||
      !Number.isFinite(minimumAvailable) ||
      minimumAvailable < 1 ||
      maximumAvailable < minimumAvailable
    ) {
      valid = false;
      return false;
    }
    const key = values.map((value) => (Object.is(value, -0) ? '-0' : String(value))).join('|');
    const previous = groups.get(key);
    if (!previous && groups.size >= MAX_GROUPS) {
      valid = false;
      return false;
    }
    if (
      previous &&
      previous.required >= required &&
      previous.rejected <= rejected &&
      previous.minimumAvailable >= minimumAvailable &&
      previous.maximumAvailable <= maximumAvailable
    )
      return true;
    groups.set(key, {
      gridColumn: constraint.gridColumn,
      gridSpan: constraint.gridSpan,
      insetLeft: constraint.insetLeft,
      insetRight: constraint.insetRight,
      indentLeft: constraint.indentLeft,
      indentRight: constraint.indentRight,
      required: Math.max(previous?.required ?? -Infinity, required),
      rejected: Math.min(previous?.rejected ?? Infinity, rejected),
      tolerance,
      minimumAvailable: Math.max(previous?.minimumAvailable ?? 1, minimumAvailable),
      maximumAvailable: Math.min(previous?.maximumAvailable ?? Infinity, maximumAvailable),
    });
    return true;
  }
  return {
    add(line, constraint) {
      if (line.spans.length ? !tokenLineMovable(line) : lineTiedToPlacement(line)) {
        valid = false;
        return false;
      }
      return addBounds(
        constraint,
        line.width + Math.max(0, line.firstLineOffset ?? 0),
        Infinity,
        LINE_HOLD_TOLERANCE_PT,
        1,
        Infinity
      );
    },
    addNumeric(proof, constraint) {
      if (
        !proof ||
        !Number.isFinite(proof.acceptedWidth) ||
        proof.acceptedWidth < 0 ||
        proof.acceptedWidth > MAX_WIDTH_COMPARISON_ROOM
      ) {
        valid = false;
        return false;
      }
      return addBounds(
        constraint,
        proof.acceptedWidth,
        proof.rejectedWidth,
        proof.tolerance,
        proof.minimumAvailable,
        MAX_WIDTH_COMPARISON_ROOM
      );
    },
    finish() {
      return valid && cells > 0
        ? { columnCount, cellCount: cells, groups: [...groups.values()] }
        : null;
    },
  };
}

/** Exact existing width expressions, evaluated once for each distinct cell geometry. */
export function tableWidthEnvelopeHolds(
  envelope: TableWidthFitEnvelope,
  columns: readonly number[],
  left: number
): boolean {
  if (
    columns.length !== envelope.columnCount ||
    !Number.isFinite(left) ||
    !columns.every((value) => Number.isFinite(value) && value >= 0)
  )
    return false;
  const total = sumCols(columns, 0, columns.length);
  if (!Number.isFinite(total)) return false;
  for (const group of envelope.groups) {
    const x = left + sumCols(columns, 0, group.gridColumn);
    const width = Math.max(
      sumCols(columns, group.gridColumn, group.gridColumn + group.gridSpan) || total,
      MIN_CELL_BOX_PT
    );
    const flow = cellFlowBox(false, x, width, 0, Infinity, {
      left: group.insetLeft,
      right: group.insetRight,
      top: 0,
      bottom: 0,
    });
    const contentWidth = Math.max(1, flow.flowRight - flow.flowLeft);
    const available = cellWidthAfterIndents(contentWidth, group.indentLeft, group.indentRight);
    if (!(
      available >= group.minimumAvailable &&
      available <= group.maximumAvailable &&
      group.required <= available + group.tolerance &&
      group.rejected > available + group.tolerance
    ))
      return false;
  }
  return true;
}
