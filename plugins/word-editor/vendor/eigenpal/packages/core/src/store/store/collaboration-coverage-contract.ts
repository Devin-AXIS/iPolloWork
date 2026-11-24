// The collaboration-expressibility contract.
//
// Every authorable action a single session can perform — every `TreeDocOp` kind, and every
// member of the accepted property, wrap, and content-control vocabularies — MUST replicate.
// Collaboration replays a canonical primitive journal onto peers, so "replicates" means: the
// action's journal captures deterministically and replays to a convergent replica. The gate
// that proves it is `canonical-primitive-journal-coverage.test.ts`, which requires a
// replay-convergence fixture for every kind AND every variant.
//
// This registry is the ONE escape hatch. An action that genuinely cannot be expressed as a
// journal — a purely local, non-replicable op — is declared here with a reason, and the gate
// accepts a declared reason IN PLACE OF a fixture. Nothing else passes: an action with
// neither a fixture nor an entry here fails the gate. That is the forcing function. An agent
// adding a feature must either prove it replicates or record, here, why it does not — the
// decision is explicit and reviewed, never silent.
//
// Removing an entry is how a later change promotes an action to replicable: delete the line,
// add the fixture. Adding one is a deliberate, reviewable admission that a capability does
// not cross the collaboration boundary yet.

import { IMAGE_WRAP_TARGETS, type ImageWrapTarget } from '../package/drawing-projection.ts';
import { INSERTABLE_CONTENT_CONTROL_TYPES } from './tree-op-content-controls.ts';
import {
  ACCEPTED_PARAGRAPH_PROPERTIES,
  ACCEPTED_RUN_PROPERTIES,
  TREE_DOC_OP_KINDS,
  type AcceptedParagraphProperty,
  type AcceptedRunProperty,
  type TreeDocOpKind,
} from './tree-op-types.ts';

type InsertableControlType = (typeof INSERTABLE_CONTENT_CONTROL_TYPES)[number];

/**
 * Actions declared not collaboration-expressible, each with the reason it cannot replicate.
 *
 * The coverage gate reads this in place of a fixture. Keep every reason specific enough that a
 * reader can decide whether it still holds.
 */
export interface CollaborationCoverageContract {
  readonly opKinds: ReadonlyMap<TreeDocOpKind, string>;
  readonly paragraphProperties: ReadonlyMap<AcceptedParagraphProperty, string>;
  readonly runProperties: ReadonlyMap<AcceptedRunProperty, string>;
  readonly wrapTargets: ReadonlyMap<ImageWrapTarget, string>;
  readonly contentControlTypes: ReadonlyMap<InsertableControlType, string>;
}

const REPEATING_SECTION_REASON =
  'Repeating-section items are refused at apply time (reason "unsupported"): the op reaches ' +
  'no store mutation, so there is no journal to replicate. Promote by implementing the op, ' +
  'then add a coverage fixture.';

export const COLLABORATION_UNCOVERED: CollaborationCoverageContract = Object.freeze({
  opKinds: new Map<TreeDocOpKind, string>([
    ['addRepeatingSectionItem', REPEATING_SECTION_REASON],
    ['removeRepeatingSectionItem', REPEATING_SECTION_REASON],
  ]),
  // Every accepted property, wrap target, and control type replicates today; none is excused.
  paragraphProperties: new Map<AcceptedParagraphProperty, string>(),
  runProperties: new Map<AcceptedRunProperty, string>(),
  wrapTargets: new Map<ImageWrapTarget, string>(),
  contentControlTypes: new Map<InsertableControlType, string>(),
});

/** The full vocabularies the contract partitions, for the gate to iterate. @internal */
export const COLLABORATION_COVERAGE_VOCABULARIES = Object.freeze({
  opKinds: TREE_DOC_OP_KINDS,
  paragraphProperties: ACCEPTED_PARAGRAPH_PROPERTIES,
  runProperties: ACCEPTED_RUN_PROPERTIES,
  wrapTargets: IMAGE_WRAP_TARGETS,
  contentControlTypes: INSERTABLE_CONTENT_CONTROL_TYPES,
});
