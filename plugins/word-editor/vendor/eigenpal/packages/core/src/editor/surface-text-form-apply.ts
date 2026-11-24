import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';
import { storyScopeOfNodeId } from './surface-scope.ts';

/** Field dialogs share the surface's normal commit, validation, and repaint path. */
export function applyTextFormOperation(
  op: TreeDocOp,
  commit: (run: () => TreeApplyResult) => void,
  apply: (ops: readonly TreeDocOp[]) => TreeApplyResult
): boolean {
  let applied = false;
  commit(() => {
    const result = apply([op]);
    applied = !result.rejected;
    return result;
  });
  return applied;
}

/** Pending field values across stories commit together, with one undo entry. */
export function applyTextFormSave(
  ops: readonly TreeDocOp[],
  selection: SemanticSelection,
  deps: {
    session: TreeDocxSessionView;
    commit(run: () => TreeApplyResult, selectionAfter: () => SemanticSelection): void;
    refusal(): string | null;
    gate(ops: readonly TreeDocOp[], scope: StoryScope): string | null;
    collaborationActive: boolean;
  }
): string | null {
  const refusal = deps.refusal();
  if (refusal) return refusal;
  const groups = new Map<string, { scope: StoryScope; ops: TreeDocOp[] }>();
  for (const op of ops) {
    if (op.op !== 'commitTextFormField') return 'invalidArgs';
    const scope = storyScopeOfNodeId(deps.session, op.paragraphId, { kind: 'body' });
    const key = JSON.stringify(scope);
    const group = groups.get(key) ?? { scope, ops: [] };
    group.ops.push(op);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const blocked = deps.gate(group.ops, group.scope);
    if (blocked) return blocked;
  }
  // The collaboration journal has no atomic field-result operation. Do not write off-journal.
  if (deps.collaborationActive) return 'unsupported';
  let result: TreeApplyResult | undefined;
  deps.commit(
    () => (result = deps.session.applyTreeOpsAtomic([...groups.values()])),
    () => selection
  );
  return result?.rejected ? (result.reason ?? 'invalidArgs') : null;
}
