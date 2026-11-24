// `setParagraphTabStops` validation, split out of `tree-op-validate.ts` for its line cap.

import type { OoxmlPart } from '../package/ooxml-tree.ts';
import type { TreeDocOp, TreeOpRejection } from './tree-op-types.ts';
import { effectiveContentLockAt } from './tree-op-nodes.ts';

type SetParagraphTabStopsOp = Extract<TreeDocOp, { op: 'setParagraphTabStops' }>;

/** Why `setParagraphTabStops` cannot apply, or null. */
export function validateSetParagraphTabStops(
  part: OoxmlPart,
  op: SetParagraphTabStopsOp
): TreeOpRejection | null {
  // Bounded here because nothing downstream is: `w:pos` is a layout dimension, and a
  // file-supplied count becomes an element count. Word's own dialog tops out well
  // inside both.
  if (!Array.isArray(op.stops) || op.stops.length > 64) return 'invalid-range';
  for (const stop of op.stops) {
    // Refused, not thrown: this op is reachable from untyped JS, and validation is the
    // layer that says no.
    if (typeof stop !== 'object' || stop === null) return 'invalid-range';
    // Not `Math.abs`: `clampPositionTwips` drops anything below zero, so a negative
    // position writes markup the engine then reports as no stop at all. The command
    // layer refuses it; a direct `TreeDocOp` caller — who these bounds exist for — must
    // get the same answer.
    if (
      !Number.isInteger(stop.positionTwips) ||
      stop.positionTwips < 0 ||
      stop.positionTwips > 31680
    ) {
      return 'invalid-range';
    }
    if (!['left', 'center', 'right', 'decimal', 'bar'].includes(stop.alignment)) {
      return 'invalid-range';
    }
    if (
      stop.leader !== undefined &&
      !['none', 'dot', 'hyphen', 'underscore', 'heavy', 'middleDot'].includes(stop.leader)
    ) {
      return 'invalid-range';
    }
  }
  // Two stops at one position is markup Word never writes, and the reader keeps only
  // the last — so accepting it would mean the file says one thing and the editor
  // another. The dialog dedupes already; this covers the public command.
  if (new Set(op.stops.map((stop) => Math.round(stop.positionTwips))).size !== op.stops.length) {
    return 'invalid-range';
  }
  // Bounded on the same terms: a clear is an element too, and both lists are
  // file-derived once a document round-trips through the editor.
  if (op.inForcePositionsTwips !== undefined) {
    if (!Array.isArray(op.inForcePositionsTwips) || op.inForcePositionsTwips.length > 64) {
      return 'invalid-range';
    }
    for (const position of op.inForcePositionsTwips) {
      if (!Number.isInteger(position) || Math.abs(position) > 31680) return 'invalid-range';
    }
  }
  // A data binding mirrors text only, so it lets paragraph properties change.
  if (effectiveContentLockAt(part, op.paragraphId).content) return 'locked';
  return null;
}
