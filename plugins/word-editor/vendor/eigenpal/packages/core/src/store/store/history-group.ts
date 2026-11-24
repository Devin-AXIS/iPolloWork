// History groups: the gesture token, and closing groups across the stores one package
// coordinates.
//
// A story store can only see its own history: it closes its open group when a transaction
// with another token lands, and on its own undo and redo. Everything that moves history
// ABOVE it — a package unit pushed, another story's pointer pushed, a package-level undo or
// redo — is invisible to it, so the coordinator closes groups from here at each of those
// points. The rule this keeps: a store's top entry carries a group only while the
// coordinator's top pointer is that store's pointer.

import type { HistoryPointer } from './story-retention.ts';
import type { TreeDocumentStore } from './tree-store.ts';

/**
 * The identity of one continuous user gesture, for history grouping.
 *
 * A live color picker, a font-size stepper or a spacing slider applies every intermediate
 * value so the document updates under the pointer, and each of those writes is a
 * transaction in its own right — it must render, and a collaborator must receive it. What
 * they are NOT is separate undo steps. The caller mints one token when the gesture starts
 * (`Symbol('color-drag')`) and passes it with every write until the gesture ends.
 *
 * A symbol rather than a string, so two unrelated callers cannot collide by naming their
 * gesture the same way, and so a token cannot outlive its gesture by accident through
 * serialization.
 */
export type HistoryGroup = symbol;

/**
 * Close the open history group on every store except the one `pushed` names.
 *
 * `pushed` is the pointer the coordinator just put on top: a story pointer names the one
 * store whose group may still be collecting, so that store is left alone. A package
 * pointer, or `null` for undo and redo, closes every group.
 */
export function closeHistoryGroupsExcept(
  body: TreeDocumentStore,
  stories: ReadonlyMap<string, TreeDocumentStore>,
  pushed: HistoryPointer | null
): void {
  const keptPart = pushed?.kind === 'story' ? pushed.partName : null;
  if (body.part.name !== keptPart) body.closeHistoryGroup();
  for (const [partName, store] of stories) {
    if (partName !== keptPart) store.closeHistoryGroup();
  }
}

// Synchronous, nest-safe observation of the actual history authority. Tokens stay local.
export type HistoryCaptureKind = 'started' | 'extended' | 'split';
export type HistoryCaptureReason = 'package-unit' | 'composition';
let captureObserver:
  | {
      group: HistoryGroup;
      report: (kind: HistoryCaptureKind, reason?: HistoryCaptureReason) => void;
    }
  | undefined;
export function observeHistoryGroup<T>(
  group: HistoryGroup,
  report: (kind: HistoryCaptureKind, reason?: HistoryCaptureReason) => void,
  run: () => T
): T {
  const previous = captureObserver;
  captureObserver = { group, report };
  try {
    return run();
  } finally {
    captureObserver = previous;
  }
}
export function reportHistoryGroup(
  group: HistoryGroup | undefined,
  kind: HistoryCaptureKind,
  reason?: HistoryCaptureReason
): void {
  if (group !== undefined && captureObserver?.group === group) captureObserver.report(kind, reason);
}
