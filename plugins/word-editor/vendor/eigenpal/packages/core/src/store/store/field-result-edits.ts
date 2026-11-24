// Deletion across editable saved field results.
//
// In the `editable` field-result mode a saved result is ordinary text, and the field's markers
// take no offsets. A deletion inside one result edits the result runs and keeps the field. A
// deletion with one end inside a result and the other outside would leave the field's
// begin, separate, and end markers unbalanced, so it is refused (`field-structure`). A deletion
// that covers a whole field and reaches past it removes the field: it is applied in the
// `atomic` mode, where the field is one unit, with its offsets mapped to that addressing.

import { currentFieldResultsMode, wholeFieldDeletion } from '../package/field-result-mode.ts';
import { parsedFieldSpansOf } from '../package/field-nodes.ts';
import { findNode } from '../package/ooxml-edit.ts';
import type { OoxmlPart, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { isParagraph, paragraphOffsetIndex } from './tree-op-segments.ts';
import type { TreeDocOp } from './tree-op-types.ts';

/** One saved result's offsets in the `editable` mode: `start` and `end` bound its text. */
export interface SavedResultRange {
  readonly start: number;
  readonly end: number;
  /** The field's segment node: the begin `fldChar`, or the `w:fldSimple` element. */
  readonly nodeId: string;
  readonly simple: boolean;
}

/** Saved-result fields of a paragraph, in document order, under the current mode. */
export function savedResultRanges(paragraph: OoxmlParagraphNode): readonly SavedResultRange[] {
  const offsets = paragraphOffsetIndex(paragraph);
  const ranges: SavedResultRange[] = [];
  for (const field of parsedFieldSpansOf(paragraph)) {
    if (field.addressing !== 'saved-result') continue;
    const begin = offsets.spanOf(field.node.id);
    const endId = field.removeNodeIds.at(-1);
    const end = endId ? offsets.spanOf(endId) : undefined;
    if (begin && end) {
      ranges.push({
        start: begin.start,
        end: end.end,
        nodeId: field.node.id,
        simple: field.kind === 'simple',
      });
    }
  }
  return ranges;
}

/** What a deletion over `[start, end)` does to the saved results it meets. */
export type SavedResultDeletion =
  | { readonly kind: 'inside' }
  | { readonly kind: 'crosses' }
  | { readonly kind: 'removes'; readonly atomicStart: number; readonly atomicEnd: number };

/**
 * Classify a deletion against the paragraph's saved results.
 *
 * `inside`: no saved result is cut (the range is inside one result, or meets none, or
 * empties one exactly). `crosses`: one end is strictly inside a result and the other is not.
 * `removes`: the range covers at least one whole field and reaches past it; the offsets are
 * those of the same range in the `atomic` mode.
 */
export function classifySavedResultDeletion(
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number
): SavedResultDeletion {
  const ranges = savedResultRanges(paragraph);
  const wholeField = wholeFieldDeletion();
  let removes = false;
  for (const range of ranges) {
    // Touching a result's edge from outside is no overlap; its edges are field edges.
    if (start >= range.end || end <= range.start) continue;
    // A selected whole field: its edges are the field's edges, so the field goes.
    if (wholeField && start === range.start && end === range.end) {
      removes = true;
      continue;
    }
    // Inside the result, edges included: the first and last characters, or all of it.
    if (start >= range.start && end <= range.end) continue;
    // Over the whole field and past it: the field goes with the range.
    if (start <= range.start && end >= range.end) {
      removes = true;
      continue;
    }
    return { kind: 'crosses' };
  }
  if (!removes) return { kind: 'inside' };
  // A saved result of length L is one unit in the atomic mode: every field wholly before an
  // offset moves it by `1 - L`. An empty result at the range START belongs inside the range
  // (it is removed with it), so the start counts only fields that end before it.
  const shift = (offset: number, endpoint: 'start' | 'end'): number => {
    let moved = offset;
    for (const range of ranges) {
      const before =
        endpoint === 'start' ? range.end <= offset && range.start < offset : range.end <= offset;
      if (before) moved += 1 - (range.end - range.start);
    }
    return moved;
  };
  return { kind: 'removes', atomicStart: shift(start, 'start'), atomicEnd: shift(end, 'end') };
}

/**
 * The op as it must run, in the `editable` mode: unchanged, refused, or rewritten to the
 * `atomic` mode when it removes whole fields. Other modes and ops pass through.
 */
export function savedResultDeletionPlan(
  part: OoxmlPart,
  op: TreeDocOp
):
  | { readonly kind: 'as-is' }
  | { readonly kind: 'refuse' }
  | { readonly kind: 'atomic'; readonly op: TreeDocOp } {
  if (currentFieldResultsMode() !== 'editable' || op.op !== 'deleteText') return { kind: 'as-is' };
  const paragraph = findNode(part, op.paragraphId);
  if (!isParagraph(paragraph)) return { kind: 'as-is' };
  const verdict = classifySavedResultDeletion(paragraph, op.start, op.end);
  if (verdict.kind === 'crosses') return { kind: 'refuse' };
  if (verdict.kind === 'inside') return { kind: 'as-is' };
  return { kind: 'atomic', op: { ...op, start: verdict.atomicStart, end: verdict.atomicEnd } };
}

/**
 * Simple fields whose saved result an op edits inside, in the `editable` mode. Each is
 * rewritten as a complex field first (`field-simple-to-complex.ts`), so the edit lands in
 * ordinary result runs with the same offsets.
 */
export function simpleFieldsEditedInside(part: OoxmlPart, op: TreeDocOp): readonly string[] {
  if (currentFieldResultsMode() !== 'editable') return [];
  let start: number;
  let end: number;
  if (op.op === 'insertText') {
    start = op.offset;
    end = op.offset;
  } else if (op.op === 'deleteText' || op.op === 'setRunProperties') {
    start = op.start;
    end = op.end;
  } else return [];
  const paragraph = findNode(part, op.paragraphId);
  if (!isParagraph(paragraph)) return [];
  return savedResultRanges(paragraph)
    .filter((range) => range.simple)
    .filter((range) =>
      start === end
        ? start > range.start && start < range.end
        : start < range.end && end > range.start
    )
    .map((range) => range.nodeId);
}

/** The offsets an op addresses in one paragraph, when it addresses any. */
function addressedOffsets(op: TreeDocOp): { paragraphId: string; points: number[] } | null {
  const record = op as unknown as Record<string, unknown>;
  if (typeof record.paragraphId !== 'string') return null;
  const points: number[] = [];
  for (const key of ['offset', 'start', 'end'] as const) {
    if (typeof record[key] === 'number') points.push(record[key] as number);
  }
  if (Array.isArray(record.offsets)) {
    for (const value of record.offsets) if (typeof value === 'number') points.push(value);
  }
  return points.length > 0 ? { paragraphId: record.paragraphId, points } : null;
}

/** Ops that edit inside an editable saved result; every other op is refused there. */
const RESULT_EDIT_OPS: ReadonlySet<string> = new Set([
  'insertText',
  'deleteText',
  'setRunProperties',
]);

/**
 * In the `editable` mode, refuse an op this mode does not support inside a saved result: any
 * op other than typing, deletion, and run formatting whose offsets fall strictly inside a
 * result, or whose range has one end inside and one outside. A split, a tab, a link, a note,
 * or a fragment there would need rules the field markers do not have yet.
 */
export function savedResultOpRefusal(part: OoxmlPart, op: TreeDocOp): boolean {
  if (currentFieldResultsMode() !== 'editable' || RESULT_EDIT_OPS.has(op.op)) return false;
  const addressed = addressedOffsets(op);
  if (!addressed) return false;
  const paragraph = findNode(part, addressed.paragraphId);
  if (!isParagraph(paragraph)) return false;
  return savedResultRanges(paragraph).some((range) =>
    addressed.points.some((point) => point > range.start && point < range.end)
  );
}
