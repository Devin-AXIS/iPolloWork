import { normalizeCollaborationTextPackage } from '../collaboration/document-port.ts';
import { isHeaderFooterLifecycleOp } from '../store/package/hf-lifecycle.ts';
import { isNoteLifecycleOp } from '../store/package/note-lifecycle.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { TreePackageStore, StoryScope } from '../store/store/tree-package-store.ts';
import type { SelectionMark } from '../store/store/tree-store.ts';
import type { TreeApplyOptions, TreeApplyResult } from './tree-session.ts';

/** The store token an apply names, under either of its two option names. */
function historyTokenOf(options: TreeApplyOptions) {
  return options.historyToken ?? options.historyGroup;
}

const EMPTY_APPLY: TreeApplyResult = { committed: false, rejected: false, opCount: 0 };

function refused(opCount: number, reason?: string): TreeApplyResult {
  return reason === undefined
    ? { committed: false, rejected: true, opCount }
    : { committed: false, rejected: true, opCount, reason };
}

/** One story's ops for {@link commitSessionTreeOpsAtomic}. */
export interface StoryOpsGroup {
  readonly scope: StoryScope;
  readonly ops: readonly TreeDocOp[];
}

/**
 * Commit several stories' ops as ONE transaction and ONE undo unit.
 *
 * The transaction opens on the first group's scope; every other group applies through the
 * context's cross-part channel (`ctx.applyTo`), the same shape a comment write uses for its
 * story markers plus `comments.xml`. Any refusal — validation, protection, an unknown part —
 * rolls the WHOLE working set back, so a caller can never observe some groups committed and
 * others not, and a single undo restores every part. Lifecycle ops do not belong here: they
 * run their own coordinator lane.
 */
export function commitSessionTreeOpsAtomic(
  packageStore: TreePackageStore,
  groups: readonly StoryOpsGroup[],
  options: TreeApplyOptions = {}
): TreeApplyResult {
  const nonEmpty = groups.filter((group) => group.ops.length > 0);
  const partOps = options.partOps ?? [];
  const opCount = [...nonEmpty, ...partOps].reduce((sum, group) => sum + group.ops.length, 0);
  if (opCount === 0) return options.packageEdits?.length ? refused(0, 'invalidArgs') : EMPTY_APPLY;
  if ([...nonEmpty, ...partOps].some((group) => group.ops.some(isHeaderFooterLifecycleOp))) {
    return refused(opCount, 'invalidArgs');
  }
  if ([...nonEmpty, ...partOps].some((group) => group.ops.some(isNoteLifecycleOp))) {
    return refused(opCount, 'invalidArgs');
  }
  const [primary, ...rest] = nonEmpty;
  // Every part is resolved BEFORE the transaction opens: a missing part refuses the whole
  // commit up front instead of half-applying and rolling back.
  const restParts: { readonly partName: string; readonly ops: readonly TreeDocOp[] }[] = [];
  for (const group of rest) {
    const part = packageStore.partFor(group.scope);
    if (!part) return refused(opCount, 'unknown-part');
    restParts.push({ partName: part.name, ops: group.ops });
  }
  const result = packageStore.transact(
    primary?.scope ?? { kind: 'body' },
    (ctx) => {
      for (const edit of options.packageEdits ?? []) ctx.applyPackage(edit);
      for (const op of primary?.ops ?? []) ctx.apply(op);
      for (const group of restParts) {
        for (const op of group.ops) ctx.applyTo(group.partName, op);
      }
      for (const group of partOps) {
        for (const op of group.ops) ctx.applyTo(group.partName, op);
      }
    },
    { ...options, historyGroup: historyTokenOf(options) }
  );
  if (!result.ok) return refused(opCount, result.reason);
  return { committed: true, rejected: false, opCount };
}

export function commitSessionTreeOps(
  packageStore: TreePackageStore,
  ops: readonly TreeDocOp[],
  selectionBefore: SelectionMark | null | undefined,
  selectionAfter: SelectionMark | null | undefined,
  scope: StoryScope,
  options: TreeApplyOptions
): TreeApplyResult {
  const partOps = options.partOps ?? [];
  const opCount = ops.length + partOps.reduce((sum, group) => sum + group.ops.length, 0);
  if (opCount === 0 && !options.packageEdits?.length) return EMPTY_APPLY;
  if (
    partOps.some((group) =>
      group.ops.some((op) => isHeaderFooterLifecycleOp(op) || isNoteLifecycleOp(op))
    )
  )
    return refused(opCount, 'invalidArgs');
  const lifecycleCount = ops.filter(
    (op) => isHeaderFooterLifecycleOp(op) || isNoteLifecycleOp(op)
  ).length;
  if (lifecycleCount > 0) {
    if (
      partOps.length ||
      options.packageEdits?.length ||
      lifecycleCount !== ops.length ||
      ops.length !== 1
    ) {
      return refused(ops.length, 'invalidArgs');
    }
    const result = packageStore.applyLifecycleOp(ops[0]!, {
      actorId: options.actorId,
      historyGroup: historyTokenOf(options),
    });
    if (!result.ok) return refused(1, result.detail ?? result.reason);
    return { committed: true, rejected: false, opCount: 1 };
  }
  const partName =
    options.recordsHistory === false && options.actorId && options.operationId
      ? packageStore.partFor(scope)?.name
      : undefined;
  const result = packageStore.transact(
    scope,
    (ctx) => {
      if (selectionBefore !== undefined) ctx.selectionBefore(selectionBefore);
      if (selectionAfter !== undefined) ctx.selectionAfter(selectionAfter);
      for (const edit of options.packageEdits ?? []) ctx.applyPackage(edit);
      for (const op of ops) ctx.apply(op);
      for (const group of partOps) {
        for (const op of group.ops) ctx.applyTo(group.partName, op);
      }
      if (partName) {
        ctx.applyPackage((pkg) => normalizeCollaborationTextPackage(pkg, partName, ops));
      }
    },
    { ...options, historyGroup: historyTokenOf(options) }
  );
  if (!result.ok) return refused(opCount, result.reason);
  return { committed: true, rejected: false, opCount };
}
