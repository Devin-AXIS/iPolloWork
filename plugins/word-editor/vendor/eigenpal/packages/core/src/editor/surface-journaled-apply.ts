// The surface's journaled write: the collaboration gate, the actor, and the history token on
// every commit, plus document setup (see `markDocumentSetupEdit`).
//
// In a collaboration session, setup commits first and on its own, outside shared undo: a
// participant's undo of the edit that first needed a built-in style must not take that style
// from content other participants added since. The same session repairs the duplicate setup
// styles a merge can leave when two participants add one while apart.

import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { EditorCollaborationSession } from '../collaboration/index.ts';
import {
  DEPENDENCY_KEY_IDS,
  ORIGIN_IDS,
  type HistoryGroup,
  type StoryScope,
  type TreeDocOp,
  type TreeModelChange,
} from '@docx-editor.dev/core/store';
import { runOutsideSharedUndo } from '../store/package/canonical-primitive-capture.ts';
import { isDocumentSetupEdit } from '../store/package/style-definition-edit.ts';
import { duplicateSetupStylesEdit } from '../store/package/setup-style-repair.ts';

type ApplyTreeOps = TreeDocxSessionView['applyTreeOps'];
type PackageEdits = NonNullable<Parameters<ApplyTreeOps>[4]>['packageEdits'];

export interface JournaledApplyDeps {
  readonly session: TreeDocxSessionView;
  readonly collaboration: EditorCollaborationSession | undefined;
  /** The history group of the commit in flight, if any. */
  readonly historyGroup: () => HistoryGroup | undefined;
  readonly defaultScope: () => StoryScope;
  /** Whether this editor may write now (not viewing, editable). Gates the repair. */
  readonly canRepair: () => boolean;
  /** Run a task after the current one. */
  readonly later: (task: () => void) => void;
}

export function createJournaledApply(deps: JournaledApplyDeps) {
  const { session, collaboration } = deps;
  let operationCounter = 0;

  const optionsFor = (packageEdits: PackageEdits, historyToken: HistoryGroup | undefined) => {
    if (!collaboration) return { packageEdits, historyToken };
    operationCounter += 1;
    const actorId = collaboration.identity.actorId;
    return {
      packageEdits,
      origin: ORIGIN_IDS.mutationHuman,
      actorId,
      operationId: `${actorId}:${collaboration.sessionId}:browser:${operationCounter}`,
      recordsHistory: false,
      historyToken,
    };
  };

  /** Commit setup edits on their own, outside shared undo. */
  const commitSetup = (edits: PackageEdits, scope: StoryScope) =>
    runOutsideSharedUndo(() =>
      session.applyTreeOps([], undefined, undefined, scope, optionsFor(edits, undefined))
    );

  /**
   * Gate and attribute a write the way typing does, without the TOC-read-only rule.
   *
   * Refresh rewrites TOC result paragraphs, so the surface's `applyOps` would refuse the write
   * that exists to update them. The collaboration gate and the actor still apply.
   */
  function apply(
    ops: readonly TreeDocOp[],
    selectionBefore?: Parameters<ApplyTreeOps>[1],
    selectionAfter?: Parameters<ApplyTreeOps>[2],
    scope: StoryScope = deps.defaultScope(),
    packageEdits?: PackageEdits
  ): ReturnType<ApplyTreeOps> {
    const refusal = collaboration?.gateOperations(ops, scope);
    if (refusal) return { committed: false, rejected: true, opCount: 0, reason: refusal };
    const setup = collaboration ? (packageEdits ?? []).filter(isDocumentSetupEdit) : [];
    if (setup.length > 0) {
      const result = commitSetup(setup, scope);
      if (result.rejected) return result;
    }
    const rest = packageEdits?.filter((edit) => !setup.includes(edit));
    // The group of the commit in flight travels with the transaction into local history and,
    // through the journal, to the collaboration undo authority.
    return session.applyTreeOps(
      ops,
      selectionBefore,
      selectionAfter,
      scope,
      optionsFor(rest?.length ? rest : undefined, deps.historyGroup())
    );
  }

  /** In a session, remove the duplicate setup styles a merge left. Safe to call often. */
  function repairSetupStyles(): void {
    if (!collaboration || !deps.canRepair()) return;
    if (collaboration.gateOperations([], { kind: 'body' })) return;
    const edit = duplicateSetupStylesEdit(session.currentPackage());
    if (edit) commitSetup([edit], { kind: 'body' });
  }

  let repairQueued = false;
  /**
   * After a change from another participant: repair once that change has settled. A change
   * narrowed to the main story's paragraphs (remote typing) cannot reach the styles part.
   */
  function noteRemoteChange(change: Pick<TreeModelChange, 'dependencyKeys'>): void {
    if (!collaboration || repairQueued) return;
    const keys = change.dependencyKeys;
    if (keys.length > 0 && keys.every((key) => key === DEPENDENCY_KEY_IDS.story)) return;
    repairQueued = true;
    deps.later(() => {
      repairQueued = false;
      repairSetupStyles();
    });
  }

  return { apply, noteRemoteChange };
}
