// Shared classification for tracked editing and explicit automation proposals.
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { RevisionAttributionInput } from '../store/store/tree-op-types.ts';
import { PROPERTY_CHANGE_WRAPPER_OF_OP } from '../store/store/tree-op-tracked-properties.ts';
import type { OoxmlParagraphNode } from '../store/package/ooxml-tree.ts';
import { retractedLengthOf } from '../store/store/tree-op-retraction.ts';
import { trackedInsertionLanding } from '../store/store/tree-op-tracked-adjacency.ts';

type RevisionCapableOp = Extract<
  TreeDocOp,
  {
    op:
      | 'insertText'
      | 'deleteText'
      | 'insertTab'
      | 'insertHardBreak'
      | 'insertPageBreak'
      | 'insertPageField'
      | 'insertComplexField'
      | 'insertEquation'
      | 'setFieldResult'
      | 'insertInlineContentControl'
      | 'insertNote'
      | 'insertTable'
      | 'insertTableRow'
      | 'deleteTableRow'
      | 'mergeTableCells'
      | 'splitTableCell'
      | 'setRunProperties'
      | 'setParagraphProperties'
      | 'setParagraphMarkProperties'
      | 'setListNumbering'
      | 'setListLevel'
      | 'setContentControlValue';
  }
>;
const REVISION_CAPABLE_OPS: ReadonlySet<TreeDocOp['op']> = new Set<RevisionCapableOp['op']>([
  'insertText',
  'deleteText',
  'insertTab',
  'insertHardBreak',
  'insertPageBreak',
  'insertPageField',
  'insertComplexField',
  'insertEquation',
  'setFieldResult',
  'insertInlineContentControl',
  'insertNote',
  'insertTable',
  'insertTableRow',
  'deleteTableRow',
  // Only inside the author's own proposed table: suggesting refuses them anywhere else.
  'mergeTableCells',
  'splitTableCell',
  'setRunProperties',
  'setParagraphProperties',
  'setParagraphMarkProperties',
  // List numbering is paragraph formatting: a suggester's bullet, demote or removed number
  // is a `w:pPrChange` a reviewer can reject, like any other paragraph property.
  'setListNumbering',
  'setListLevel',
  // A dropdown, date, checkbox or text value becomes a strike and an insertion in the control.
  'setContentControlValue',
]);

export function isRevisionCapable(op: TreeDocOp): op is RevisionCapableOp {
  return REVISION_CAPABLE_OPS.has(op.op);
}

export function isTrackedEdit(op: TreeDocOp): boolean {
  if (isRevisionCapable(op)) return op.revision !== undefined;
  switch (op.op) {
    case 'setParagraphMarkRevision':
    case 'proposeParagraphMerge':
      return true;
    // Paste proposes its breaks through the op itself, so a paste of newlines alone is a
    // tracked edit with no `insertText` beside it to report for it.
    case 'insertContentControl':
    case 'authorTable':
    case 'splitParagraphMany':
      return op.revision !== undefined;
    default:
      return false;
  }
}

/**
 * Whether this op's tracked form is a PROPERTY CHANGE record.
 *
 * Asked because `w:doNotTrackFormatting` (§17.15.1.50) turns exactly those off: a document
 * may ask for its formatting changes to be applied without a `w:rPrChange` while its text
 * edits stay tracked. That is a producer instruction, so it gates the WRITE and never how an
 * existing record is read.
 *
 * Read from the STORE's own table rather than restated here — the store shares one `@w:id`
 * per wrapper name for the same set, and two lists of it would drift.
 */
const isPropertyChangeOp = (op: TreeDocOp['op']): boolean => PROPERTY_CHANGE_WRAPPER_OF_OP.has(op);

/**
 * Attribute ops the way suggesting mode does: revision-capable ops gain `revision` unless they
 * carry one, a split proposes its mark, and a join proposes removing the mark between. Pure, so
 * the paginated surface and a preview fork attribute one way.
 */
export function attributeTrackedOps(
  ops: readonly TreeDocOp[],
  revision: RevisionAttributionInput,
  trackFormatting: boolean
): TreeDocOp[] {
  return ops.flatMap((op): TreeDocOp[] => {
    // Already-attributed ops pass through untouched — a caller that named an author keeps it.
    if (isRevisionCapable(op)) {
      if (!trackFormatting && isPropertyChangeOp(op.op)) return [op];
      return [op.revision !== undefined ? op : { ...op, revision }];
    }
    // A SPLIT becomes a real split plus a proposed mark on the first paragraph: the text
    // is already in two paragraphs, and what is being proposed is the break between them.
    // §17.13.5 puts the new mark on the FIRST paragraph, and rejecting it runs the two
    // back together.
    // Paste cuts its pasted text into paragraphs with ONE op, so the proposal rides on the
    // op itself: the store mints the paragraphs, so only the store can address their marks.
    if (op.op === 'splitParagraphMany') return [{ ...op, revision }];
    if (op.op === 'splitParagraph') {
      return [
        op,
        {
          op: 'setParagraphMarkRevision' as const,
          paragraphId: op.paragraphId,
          kind: 'ins' as const,
          revision,
        },
      ];
    }
    // A JOIN becomes a proposal to remove the mark BETWEEN the paragraphs, which belongs
    // to the first — and the paragraphs stay where they are. Joining them outright made
    // rejecting restore the words but not the boundary, so the original was unrecoverable.
    if (op.op === 'joinParagraphs') {
      // Addressed by the SECOND paragraph: the mark being proposed away belongs to
      // whichever paragraph precedes it, and a multi-paragraph delete emits a join per
      // paragraph with `firstId` pinned to the group head — so naming the first stamped
      // one paragraph N times and left the rest untouched.
      return [{ op: 'proposeParagraphMerge' as const, paragraphId: op.secondId, revision }];
    }
    return [op];
  });
}

/**
 * Where a tracked replacement of `[start, end)` in `paragraph` lands, from the paragraph's own
 * tree: after the struck words, minus what of the range was the author's own pending insertion,
 * which retracts. The store's rule, so a caller cannot predict a landing the store will not use.
 */
export function trackedReplacementLanding(
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  author: string,
  date: string | undefined
): number {
  const { past, landing } = trackedInsertionLanding(paragraph, { start, end }, end, author, date);
  const retracted = retractedLengthOf(paragraph, start, past, author);
  // NOTHING STRUCK, nothing to land after: a zero-width range, or one covering only this
  // author's own pending insertion, which retracts and writes no strike at all. The store
  // then places at the aim, and so must this.
  const strikes = past - start > retracted;
  return (strikes ? landing : past) - retracted;
}

/** Ops that change the DOCUMENT, as opposed to reading or resolving it. */
export function isDocumentEdit(op: TreeDocOp): boolean {
  return (
    op.op !== 'acceptRevision' &&
    op.op !== 'rejectRevision' &&
    op.op !== 'acceptAllRevisions' &&
    op.op !== 'rejectAllRevisions' &&
    op.op !== 'setRevisionAttribution'
  );
}
