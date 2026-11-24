// Which ops share, keep, or drop a transaction's tracked revision counter.

import type { TreeDocOp } from './tree-op-types.ts';

/**
 * The ops whose tracked appliers write a revision wrapper. They get the transaction's
 * bookkeeping — the shared counter, and the record of what it has written, which is what
 * tells a replacement's insertion from a keystroke after Backspace.
 */
export const TRACKED_WRAPPER_OPS: ReadonlySet<string> = new Set([
  'insertText',
  'insertTab',
  'insertHardBreak',
  'insertPageBreak',
  'insertPageField',
  'insertComplexField',
  'insertEquation',
  'insertDrawing',
  'deleteText',
  'setParagraphMarkRevision', // Mints from the same counter, so it does not reset it.
]);

/**
 * Of those, the ones whose content comes from the CALLER and can carry revision ids in with
 * it: an anchored text box holds `w:txbxContent` paragraphs that may already be revised. They
 * still get the record — they write a wrapper, and the next op has to know it — but the
 * counter is dropped around them, so nothing after them draws from a walk taken before the
 * content arrived.
 */
export const IMPORTS_REVISION_IDS: ReadonlySet<string> = new Set(['insertDrawing']);

/**
 * Ops that leave the tracked counter valid: they write no revision id and bring in no caller
 * content. The counter mints one past the highest id it walked, so an op that only moves,
 * copies or removes existing ids cannot make it repeat one. Without this, a batch that wraps
 * each tracked replacement in a content control walked the whole part once per control. An
 * op that carries its own `revision` mints outside the counter, so it still drops it.
 */
const KEEPS_REVISION_COUNTER: ReadonlySet<string> = new Set([
  'insertContentControl',
  'insertInlineContentControl',
  'setContentControlProperties',
  'removeContentControl',
  'splitParagraph',
]);

export function keepsRevisionCounter(op: TreeDocOp): boolean {
  return KEEPS_REVISION_COUNTER.has(op.op) && !('revision' in op && op.revision);
}
