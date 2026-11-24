// Apply table authoring as one semantic operation. Intermediate node IDs stay inside the store.
import { paragraphTextOf } from './tree-op-apply.ts';
import { planInsertTable, planTableMutation } from './table-authoring-plan.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import type { TreeDocOp, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';
import { TEXT_DEPS } from './tree-op-nodes.ts';
type Op = Extract<TreeDocOp, { op: 'authorTable' }>;
function plan(part: OoxmlPart, op: Op) {
  const reads = { part, root: part.root, rawText: (id: string) => paragraphTextOf(part, id) };
  const action = op.action;
  return action.kind === 'insert'
    ? planInsertTable(
        reads,
        action.paragraphId,
        action.offset,
        action.rowCount,
        action.columnCount,
        action.values,
        op.revision
      )
    : planTableMutation(reads, action.tableId, action.mutation, op.revision);
}
function malformed(op: Op): boolean {
  return (
    !op.action || typeof op.action !== 'object' || !['insert', 'existing'].includes(op.action.kind)
  );
}
export function validateTableAuthoring(_part: OoxmlPart, op: Op): TreeOpRejection | null {
  // Validation never applies primitives: collaboration capture may already be active here.
  // The applier computes and validates the complete candidate before returning it for commit.
  if (malformed(op)) return 'invalidArgs';
  const action = op.action;
  if (action.kind === 'existing')
    return typeof action.tableId === 'string' &&
      action.mutation &&
      typeof action.mutation === 'object'
      ? null
      : 'invalidArgs';
  return typeof action.paragraphId === 'string' &&
    Number.isInteger(action.offset) &&
    action.offset >= 0 &&
    Number.isInteger(action.rowCount) &&
    action.rowCount > 0 &&
    Number.isInteger(action.columnCount) &&
    action.columnCount > 0
    ? null
    : 'invalidArgs';
}

function ids(root: OoxmlNode): Set<string> {
  const out = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === 'paragraph') out.add(node.id);
    if (node.kind !== 'textValue') stack.push(...node.children);
  }
  return out;
}
export function applyTableAuthoring(part: OoxmlPart, op: Op): TreeOpResult {
  if (malformed(op)) return { ok: false, reason: 'invalidArgs' };
  const result = plan(part, op);
  if (!result.ok)
    return {
      ok: false,
      reason:
        result.reason === 'locked' ||
        result.reason === 'bound' ||
        result.reason === 'unsupported-cell-content'
          ? result.reason
          : 'invalidArgs',
    };
  const splits = result.effects.flatMap((effect) => [
    ...(effect.split ? [effect.split] : []),
    ...(effect.splits ?? []),
  ]);
  const caret = [...result.effects].reverse().find((effect) => effect.caret)?.caret;
  const before = ids(part.root),
    after = ids(result.resultPart.root);
  return {
    ok: true,
    part: result.resultPart,
    effect: {
      dirty: [op.action.kind === 'insert' ? op.action.paragraphId : op.action.tableId],
      created: [...after].filter((id) => !before.has(id)),
      deleted: [...before].filter((id) => !after.has(id)),
      dependencyKeys: TEXT_DEPS,
      impact: 'flow-structural',
      ...(splits.length ? { splits } : {}),
      ...(caret ? { caret } : {}),
    },
  };
}
