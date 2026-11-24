// Paragraph semantic operations over the canonical tree (task 5.1 / 5.2).
//
// Every op addresses STABLE NODE IDENTITIES and UTF-16 offsets, never byte ranges — that is
// the whole difference from the model these replace, where an edit was a splice into the
// original XML text and a paragraph with no captured byte range could not be edited at all.
//
// Ops are declarative and JSON-safe. Application is pure: `applyTreeOp` returns a new part
// plus the structural effect, or a typed rejection, and never mutates its input. Validation
// runs BEFORE any tree work, so a rejected op leaves the tree, revision and indexes exactly
// as they were.

import { withFieldResultsMode } from '../package/field-result-mode.ts';
import type { EditOptions } from '../package/ooxml-edit.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';
import {
  savedResultDeletionPlan,
  savedResultOpRefusal,
  simpleFieldsEditedInside,
} from './field-result-edits.ts';
import { complexFieldFromSimple } from './field-simple-to-complex.ts';
import { applyTreeOp as applyTreeOpInMode } from './tree-op-apply.ts';
import type { TreeDocOp, TreeOpResult } from './tree-op-validate.ts';
//
// This module is the entry point. Vocabulary, segmentation, and validation live in
// tree-op-types / tree-op-segments / tree-op-validate; application lives in tree-op-apply.ts.

export {
  ACCEPTED_PARAGRAPH_PROPERTIES,
  ACCEPTED_RUN_PROPERTIES,
  TREE_DOC_OP_KINDS,
  inlineControlEndingAt,
  inlineControlStartingAt,
  paragraphOffsetIndex,
  segmentsOf,
  validateTreeOp,
  type AcceptedParagraphProperty,
  type AcceptedRunProperty,
  type ImpactClass,
  type InlineControlSpan,
  type OffsetSpan,
  type OoxmlProperty,
  type ParagraphOffsetIndex,
  type Segment,
  type TreeDocOp,
  type TreeDocOpKind,
  type DrawingTreeDocOp,
  type TreeOpEffect,
  type TreeOpRejection,
  type TreeOpResult,
} from './tree-op-validate.ts';
export { paragraphTextOf } from './tree-op-apply.ts';

/**
 * Apply one op. `options.fieldResults` installs the field-result addressing mode for the
 * op's whole run (`field-result-mode.ts`); absent keeps the enclosing mode.
 */
export function applyTreeOp(part: OoxmlPart, op: TreeDocOp, options?: EditOptions): TreeOpResult {
  return withFieldResultsMode(options?.fieldResults, () => {
    // A deletion across editable saved results keeps every field's markers balanced.
    if (savedResultOpRefusal(part, op)) return { ok: false, reason: 'field-result-unsupported' };
    const plan = savedResultDeletionPlan(part, op);
    if (plan.kind === 'refuse') return { ok: false, reason: 'field-structure' };
    if (plan.kind === 'atomic') {
      return withFieldResultsMode('atomic', () => applyTreeOpInMode(part, plan.op, options));
    }
    let target = part;
    const created: string[] = [];
    const deleted: string[] = [];
    for (const simpleId of simpleFieldsEditedInside(part, op)) {
      const rewritten = complexFieldFromSimple(target, simpleId, options);
      if (!rewritten.ok) return { ok: false, reason: 'tree-invariant' };
      target = rewritten.part;
      created.push(...rewritten.created);
      deleted.push(...rewritten.deleted);
    }
    const result = applyTreeOpInMode(target, op, options);
    if (!result.ok || deleted.length === 0) return result;
    // The rewrite replaced the simple field: its node is gone and the marker runs are new.
    return {
      ...result,
      effect: {
        ...result.effect,
        created: [...result.effect.created, ...created],
        deleted: [...result.effect.deleted, ...deleted],
      },
    };
  });
}
export {
  MAX_CONTENT_CONTROL_NESTING,
  contentControlValueTypeOf,
  effectiveLockOf,
  findContentControl,
  isContentControlNode,
} from './tree-op-nodes.ts';

export type {
  ShapeFillInput,
  ShapeOutlineDash,
  ShapeOutlineInput,
  ShapeThemeColorInput,
  ShapeThemeColorName,
  TabStopWrite,
} from './tree-op-types.ts';
