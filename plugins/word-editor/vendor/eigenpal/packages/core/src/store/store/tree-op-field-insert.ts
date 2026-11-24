// Field insertion ops: the page-number fields and one inert complex field.
//
// Split out of `tree-op-types.ts` and `tree-op-validate.ts`, which are at their line caps. Both
// ops write a complete complex field. With a revision, the whole field goes into ONE `w:ins`,
// because the field is one proposal: rejecting it must take the complete atom back, never leave
// a `begin` without its `end`. A `w:fldSimple` is never written into a revision.

import type { EditOptions } from '../package/ooxml-edit.ts';
import type { OoxmlParagraphNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { inertFieldInstruction, inertFieldKeyword } from './inert-field-instruction.ts';
import { insertionRunPropertiesAt } from './tree-op-field-formatting.ts';
import { applyPlaceRunNodes } from './tree-op-run-placement.ts';
import { complexFieldRuns } from './tree-op-fields.ts';
import { applyInsertTrackedRun } from './tree-op-tracked.ts';
import { invalidRevisionAttribution } from './tree-op-revision-attribution.ts';
import type { RevisionAttributionInput } from './tree-op-revision-attribution.ts';
import { splitsSurrogate } from './tree-op-segments.ts';
import type { TreeOpRejection, TreeOpResult } from './tree-op-types.ts';
import { rejectContentEdit } from './tree-op-validate-controls.ts';

/**
 * Insert an allowlisted page-number complex field at a UTF-16 offset.
 *
 * `PAGE_X_OF_Y` is PAGE + literal " of " + NUMPAGES in one undoable op. Non-page
 * instructions are refused — never authored through this path.
 */
export interface InsertPageFieldOp {
  readonly op: 'insertPageField';
  readonly paragraphId: string;
  readonly offset: number;
  readonly field: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES' | 'PAGE_X_OF_Y';
  /**
   * Write this as a TRACKED insertion, on the same terms as `insertText`.
   *
   * The whole field — every `w:fldChar`, the instruction, the `PAGE_X_OF_Y` literal —
   * goes into ONE `w:ins`, because the field is one proposal: rejecting it must take
   * the complete atom back, never leave a `begin` standing without its `end`.
   */
  readonly revision?: RevisionAttributionInput;
}

/**
 * Insert one complex field with an empty cached result at a UTF-16 offset.
 *
 * The instruction must be one that `inertFieldInstruction` admits: a page number, a reference
 * to a bookmark, note, or style, a sequence number, or a date. It is written as text and never
 * evaluated. Every other instruction refuses with `invalidArgs`.
 */
export interface InsertComplexFieldOp {
  readonly op: 'insertComplexField';
  readonly paragraphId: string;
  readonly offset: number;
  readonly instruction: string;
  /** Write the whole field as ONE tracked insertion, on the same terms as `insertText`. */
  readonly revision?: RevisionAttributionInput;
}

const PAGE_FIELDS: ReadonlySet<unknown> = new Set([
  'PAGE',
  'NUMPAGES',
  'SECTIONPAGES',
  'PAGE_X_OF_Y',
]);

/** Validate either field insertion against its paragraph, before any tree work. */
export function validateFieldInsertion(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  length: number,
  op: InsertPageFieldOp | InsertComplexFieldOp
): TreeOpRejection | null {
  if (!Number.isInteger(op.offset) || op.offset < 0 || op.offset > length) {
    return 'offset-out-of-range';
  }
  if (splitsSurrogate(paragraph, op.offset)) return 'splits-surrogate-pair';
  if (op.op === 'insertPageField' ? !PAGE_FIELDS.has(op.field) : !insertableInstruction(op)) {
    return 'invalidArgs';
  }
  // `CT_TrackChange` makes `@w:author` required, so a tracked variant with an empty one
  // would serialize a proposal no reader can attribute or resolve.
  if (op.revision !== undefined && invalidRevisionAttribution(op.revision)) {
    return 'invalid-property-value';
  }
  return rejectContentEdit(part, paragraph, op.offset, op.offset);
}

/** The op is a trust boundary of its own: only the normalized instruction is written. */
function insertableInstruction(op: InsertComplexFieldOp): boolean {
  return inertFieldInstruction(op.instruction) === op.instruction;
}

/**
 * Write the field as five runs: `begin`, instruction, `separate`, an empty result, `end`. With a revision the
 * runs go into ONE `w:ins` through the placement typed text follows. Without one they land
 * where typed text would (`tree-op-run-placement.ts`), so the field shape is the same in both
 * arms.
 *
 * Every run takes the formatting a word typed at the offset would take. The begin marker
 * carries `w:dirty="true"` unless the field is PAGE or NUMPAGES, whose result `updateResult`
 * computes: the cached result is empty, so a reader that evaluates fields recomputes it.
 */
export function applyInsertComplexField(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  op: InsertComplexFieldOp,
  options?: EditOptions
): TreeOpResult {
  const keyword = inertFieldKeyword(op.instruction);
  const dirty = keyword !== 'PAGE' && keyword !== 'NUMPAGES';
  if (op.revision) {
    return applyInsertTrackedRun(
      part,
      paragraph,
      op.offset,
      (mint) =>
        complexFieldRuns(mint, op.instruction, {
          dirty,
          properties: () => insertionRunPropertiesAt(part, paragraph, op.offset, mint),
        }),
      op.revision,
      options
    );
  }
  // Placed where typed text lands, so a field inside a content control or a link stays there.
  // `applyPlaceRunNodes` gives the runs fresh ids of the part's own family.
  let counter = 0;
  const draft = () => `field-draft:${counter++}`;
  const runs = complexFieldRuns(draft, op.instruction, {
    dirty,
    properties: () => insertionRunPropertiesAt(part, paragraph, op.offset, draft),
  });
  return applyPlaceRunNodes(part, paragraph, op.offset, runs, options);
}
