// The one host implementation.
//
// INTERNAL composition factory. It is not exported from the lane's public surface, because a
// consumer that could build a host over its own port could build a second document model —
// which is the exact thing the lane exists to prevent. Both shipped hosts (`server-host.ts`
// here, and the browser adapter in the editor lane) call this with a port over the SAME
// canonical package and the SAME `TreeDocumentStore.transact` write path.
//
// THE BATCH RULE, stated once because everything else follows from it:
//
//   plan every operation in order, then commit every command in one transaction.
//
// Planning is pure. A query answers from the package as of the start of the batch; a command
// is validated and turned into a `TreeDocOp` without touching anything. If planning or the
// commit fails, no transaction is opened or it is refused whole, and the response reports the
// failing operation with a code and everything else as `skipped`. There is no path through
// this file that writes part of a batch.

import {
  trackingStep,
  trackPlannedChanges,
  supportsTrackedAutomationOperation,
  type LocalTrackingState,
} from './change-tracking.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import { runWithTransactionActor } from '../store/package/actor-scoped-ids.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { createHandleTable, type AutomationHandleTable } from './handles.ts';
import { createBatchPlanner, type PlannedOperation } from './plan.ts';
import { documentReads, type AutomationPackageReads } from './reads.ts';
import { createReadTexts, stampEndpoints, staleEndpointDetail } from './stale-spans.ts';
import type { AutomationOperation } from './operations.ts';
import type {
  AutomationBatchRequest,
  AutomationBatchResponse,
  AutomationCapabilities,
  AutomationChangeEvent,
  AutomationError,
  AutomationErrorCode,
  AutomationHost,
  AutomationOperationResult,
  AutomationSaveResult,
  AutomationUnsubscribe,
} from './protocol.ts';
import type {
  AutomationCommentWrite,
  AutomationDocumentPort,
  InsertCustomNodeWrite,
} from './document-port.ts';
import type { StoryScope } from '../store/store/tree-package-store.ts';

export interface AutomationHostComposition {
  readonly port: AutomationDocumentPort;
  readonly capabilities: AutomationCapabilities;
}

const SKIPPED: AutomationOperationResult = Object.freeze({ status: 'skipped' as const });

function automationError(
  code: AutomationErrorCode,
  message: string,
  detail?: string
): AutomationError {
  return Object.freeze(detail === undefined ? { code, message } : { code, message, detail });
}

/** Map a store story-transaction refusal onto the protocol code a caller can handle. */
function storeTransactionError(reason: string): AutomationError {
  // `edit.tracked-structure-unsupported` is the public code of a browser surface refusal: a
  // suggesting-mode edit, such as deleting a whole table, that has no tracked form.
  if (
    reason === 'review-module-required' ||
    reason === 'automation-structural-tracking-unsupported' ||
    reason === 'edit.tracked-structure-unsupported'
  )
    return automationError(
      'unsupported-capability',
      'this edit requires a supported review mode',
      reason
    );
  if (reason === 'story-end-paragraph')
    return automationError(
      'unsupported-capability',
      'a body, note or text box keeps the paragraph after a table that ends it',
      reason
    );
  if (reason === 'block-required')
    return automationError(
      'unsupported-capability',
      'a body, note, comment, text box, or table cell keeps its last paragraph, and a table its last row and column',
      reason
    );
  // The refusal a plan-time cell write gives, for a cell an earlier edit in the batch reshaped.
  if (reason === 'unsupported-cell-content')
    return automationError('unsupported-content', 'that cell is not one plain paragraph', reason);
  if (reason === 'unsupported-revision:foreign-insertion')
    return automationError(
      'unsupported-revision',
      "the new text would land inside a container within another author's pending insertion",
      reason
    );
  const unsupported =
    reason === 'unsupported-revision' || reason.startsWith('unsupported-revision:');
  return automationError(
    unsupported ? 'unsupported-revision' : 'transaction-refused',
    unsupported
      ? 'that story contains a tracked change this engine cannot resolve'
      : 'the document store refused the transaction',
    reason
  );
}

/**
 * A batch that answered nothing: the failure at its index, `skipped` everywhere else.
 *
 * Including for the operations BEFORE the failure, and including reads. See
 * `AutomationOperationResult` — reporting those as `ok` would describe a state that was never
 * published.
 */
function refuse(
  operations: readonly unknown[],
  index: number,
  error: AutomationError,
  revision: number
): AutomationBatchResponse {
  return {
    ok: false,
    results: operations.map((_, at) => (at === index ? { status: 'error', error } : SKIPPED)),
    revision,
    changed: false,
  };
}

/** The index of the `nth` select operation in a batch: the one a failed selection came from. */
function nthSelect(operations: readonly AutomationOperation[], nth: number): number {
  let seen = -1;
  const index = operations.findIndex(
    (operation) =>
      (operation.op === 'selectSpan' || operation.op === 'selectBookmark') && ++seen === nth
  );
  return index < 0 ? 0 : index;
}

export function createAutomationHost(composition: AutomationHostComposition): AutomationHost {
  const { port } = composition;
  const capabilities = Object.freeze({ ...composition.capabilities });
  const handles = createHandleTable();
  const listeners = new Set<(event: AutomationChangeEvent) => void>();
  let disposed = false;
  let tracking: LocalTrackingState = { mode: 'Off' };
  let executing = 0;
  let pendingEvent: AutomationChangeEvent | null = null;
  /** Reads keyed on package IDENTITY: packages are immutable, so an edit replaces the key. */
  let reads: { readonly pkg: OoxmlPackage; readonly value: AutomationPackageReads } | null = null;
  /** What each answered endpoint's paragraph said, so a later use of it can be checked. */
  const texts = createReadTexts();

  // Only wired when the host claims events. A capability that is false must not fire.
  const unsubscribePort = capabilities.events
    ? port.subscribe(() => {
        if (disposed) return;
        const event: AutomationChangeEvent = Object.freeze({ revision: port.revision() });
        if (executing > 0) pendingEvent = event;
        else for (const listener of [...listeners]) listener(event);
      })
    : () => {};

  const readsOf = (pkg: OoxmlPackage): AutomationPackageReads => {
    if (reads && reads.pkg === pkg) return reads.value;
    const value = documentReads(pkg);
    reads = { pkg, value };
    return value;
  };

  const executeBatch = (request: AutomationBatchRequest): AutomationBatchResponse => {
    const operations: readonly AutomationOperation[] = Array.isArray(request?.operations)
      ? request.operations
      : [];
    const revision = port.revision();
    if (disposed) {
      return refuse(operations, 0, automationError('disposed', 'this host was disposed'), revision);
    }
    if (!capabilities.document) {
      return refuse(
        operations,
        0,
        automationError('unsupported-capability', 'this host has no document', 'document'),
        revision
      );
    }
    const pkg = port.currentPackage();
    if (!pkg) {
      return refuse(
        operations,
        0,
        automationError('document-unavailable', 'this host holds no document right now'),
        revision
      );
    }
    if (request.expectedRevision !== undefined && request.expectedRevision !== revision) {
      return refuse(
        operations,
        0,
        automationError(
          'stale-revision',
          'the document moved since that revision',
          `expected ${String(request.expectedRevision)}, at ${revision}`
        ),
        revision
      );
    }

    // Taken once, before any post-commit read, so the one-entry reads cache ends on the
    // committed package the next batch starts from.
    const start = readsOf(pkg);
    // An endpoint read before its paragraph changed names other text now. Refuse it rather
    // than edit whatever sits at the old offsets.
    for (let index = 0; index < operations.length; index += 1) {
      const detail = staleEndpointDetail(operations[index], revision, texts, handles, start);
      if (detail)
        return refuse(
          operations,
          index,
          detail === 'invalid-read-revision'
            ? automationError('invalid-offset', 'an endpoint carries an invalid readAt', detail)
            : automationError(
                'stale-revision',
                'that range was read before its text changed',
                detail
              ),
          revision
        );
    }

    const allocationActor = port.allocationActor?.();
    const planner = createBatchPlanner({
      handles,
      reads: start,
      capabilities,
      collaborative: port.collaborative?.() ?? false,
      ...(port.compareDocuments ? { compareDocuments: port.compareDocuments } : {}),
      setupOutsideUndo: port.setupOutsideUndo?.() ?? false,
      trackedRangeReplacement: port.trackedRangeReplacement?.() ?? true,
      // Read ONCE per batch: the formatting lanes must not answer one operation against
      // All Markup and the next against the resolved result.
      ...(port.revisionDisplayMode ? { displayMode: port.revisionDisplayMode() } : {}),
      ...(port.replacementLanding
        ? { replacementLanding: port.replacementLanding.bind(port) }
        : {}),
      ...(port.fieldPageContext ? { fieldPageContext: port.fieldPageContext.bind(port) } : {}),
      ...(port.select ? { select: port.select.bind(port) } : {}),
      ...(port.selectRefusal ? { selectRefusal: port.selectRefusal.bind(port) } : {}),
    });

    // PLAN EVERYTHING FIRST. A query's answer is final here; a command's is a closure, because
    // a paragraph a command creates has no identity until the transaction lands.
    const planned: Extract<PlannedOperation, { readonly ok: true }>[] = [];
    /**
     * The batch's ops, in planned order, as thunks.
     *
     * Thunks because of the hyperlink: a command naming an external target has no ops until the
     * relationship exists, and the relationship must not exist until the owner's write gate has let
     * the batch through. Holding a thunk per command keeps the ops in the order they were planned —
     * appending the late ones at the end would reorder a batch against itself.
     */
    const stages: ((relate: (url: string) => string | null) => readonly TreeDocOp[] | null)[] = [];
    /** The one package-level op a batch may hold, which travels alone. See the planner. */
    let lifecycle: TreeDocOp | null = null;
    const packageEdits: import('./document-port.ts').AutomationPackageEdit[] = [];
    /** Comment deletes or content edits can batch; reply/resolve remain solitary. */
    const commentWrites: AutomationCommentWrite[] = [];
    let commentWriteScope: StoryScope | null = null;
    /** The id the comment write minted, which only the port can say. */
    let mintedComment: string | undefined;
    /** The one custom-node write a batch may hold, solitary and its own commit for the same reason. */
    let customNodeWrite: { write: InsertCustomNodeWrite; scope: StoryScope } | null = null;
    /** The one document replacement a batch may hold, solitary like the writes above. */
    let documentReplace: Uint8Array | null = null;
    let firstCommand = -1;
    let requiresReview = false;
    let stagedTracking = tracking;
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index]!;
      if (
        port.suggesting?.() &&
        operation.op !== 'replaceSpan' &&
        (!supportsTrackedAutomationOperation(operation) ||
          (!stagedTracking.author &&
            ([
              'insertContentControl',
              'insertField',
              'insertOoxml',
              'setFieldResult',
              'deleteField',
              'setContentControlProperties',
              'startNewList',
              'setListLevelFormat',
              'insertTable',
              'insertTableRows',
              'updateTable',
              'updateTableCell',
              'splitParagraph',
            ].includes(operation.op) ||
              // Page and section breaks are tracked by the runtime author, never attributed.
              (operation.op === 'insertBreak' && operation.breakType !== 'Line'))))
      )
        return refuse(
          operations,
          index,
          automationError(
            'unsupported-capability',
            'this operation has no supported tracked form in suggesting mode'
          ),
          revision
        );
      const policy = trackingStep(operation, port.localChangeTracking === true, stagedTracking);
      const step =
        policy?.step ??
        trackPlannedChanges(
          operation,
          // Planned under the actor the commit binds. See `AutomationDocumentPort.allocationActor`.
          runWithTransactionActor(allocationActor, () =>
            planner.plan(operation, stagedTracking.author)
          ),
          stagedTracking.author
        );
      if (policy) stagedTracking = policy.state;
      if (!step.ok) return refuse(operations, index, step.error, revision);
      planned.push(step);
      if (step.kind === 'command') {
        if (
          stagedTracking.author &&
          (step.packageEdits?.length || operation.op === 'setContentControlProperties')
        )
          requiresReview = true;
        // Changing who a change belongs to is review authoring, tracked or not.
        if (operation.op === 'setRevisionAuthorBatch') requiresReview = true;
        if (step.packageEdits) packageEdits.push(...step.packageEdits);
        if (firstCommand < 0) firstCommand = index;
        if (step.lifecycle) lifecycle = step.ops[0] ?? null;
        else if (step.relate) {
          const pending = step.relate;
          stages.push((relate) => {
            const relationshipId = relate(pending.url);
            return relationshipId === null ? null : pending.ops(relationshipId);
          });
        } else {
          const { ops } = step;
          stages.push(() => ops);
        }
      } else if (step.kind === 'commentWrite') {
        if (firstCommand < 0) firstCommand = index;
        commentWrites.push(step.write);
        commentWriteScope = planner.writeScope ?? { kind: 'body' };
      } else if (step.kind === 'customNodeWrite') {
        if (firstCommand < 0) firstCommand = index;
        customNodeWrite = { write: step.write, scope: planner.writeScope ?? { kind: 'body' } };
      } else if (step.kind === 'documentReplace') {
        if (firstCommand < 0) firstCommand = index;
        documentReplace = step.docx;
      }
    }

    let changed = false;
    if (commentWrites.length > 0) {
      const applied = port.applyCommentWrites(commentWrites, commentWriteScope ?? { kind: 'body' });
      if (!applied.ok) {
        return refuse(
          operations,
          firstCommand < 0 ? 0 : firstCommand,
          automationError(
            'transaction-refused',
            'the document store refused the comment write',
            applied.reason
          ),
          revision
        );
      }
      changed = applied.changed;
      mintedComment = applied.commentId;
    }
    if (customNodeWrite) {
      const applied = port.applyCustomNodeWrite(customNodeWrite.write, customNodeWrite.scope);
      if (!applied.ok) {
        return refuse(
          operations,
          firstCommand < 0 ? 0 : firstCommand,
          automationError(
            'transaction-refused',
            'the document store refused the custom-node write',
            applied.reason
          ),
          revision
        );
      }
      changed = applied.changed;
    }
    if (documentReplace) {
      const at = firstCommand < 0 ? 0 : firstCommand;
      if (!port.replaceDocument)
        return refuse(
          operations,
          at,
          automationError(
            'unsupported-capability',
            'this host cannot replace the document',
            'edit.operation-unsupported'
          ),
          revision
        );
      const applied = port.replaceDocument(documentReplace);
      // The port's revision: a collaboration room that refused the update has realigned it.
      if (!applied.ok) return refuse(operations, at, applied.error, port.revision());
      changed = applied.changed;
    }
    if (lifecycle) {
      const applied = port.applyLifecycle(lifecycle);
      if (!applied.ok) {
        return refuse(
          operations,
          firstCommand < 0 ? 0 : firstCommand,
          automationError(
            'transaction-refused',
            'the document store refused the transaction',
            applied.reason
          ),
          revision
        );
      }
      changed = applied.changed;
    }
    if (stages.length > 0) {
      // THE STORY THE BATCH PINNED. One transaction against one story, named by the planner
      // rather than assumed to be the body — a header edit committed against the body scope
      // would refuse ids the body does not hold.
      //
      // The ops are built by the OWNER, once it has decided the batch may write: see
      // `AutomationStagedOps`. Everything the planner could decide is already decided; what is left
      // is the relationship a link needs, which cannot be minted before the gate.
      const applied = port.apply(
        (relate) => {
          const built: TreeDocOp[] = [];
          for (const stage of stages) {
            const ops = stage(relate);
            if (ops === null) return null;
            built.push(...ops);
          }
          return built;
        },
        planner.writeScope ?? { kind: 'body' },
        packageEdits,
        requiresReview
      );
      if (!applied.ok) {
        return refuse(
          operations,
          firstCommand < 0 ? 0 : firstCommand,
          storeTransactionError(applied.reason),
          revision
        );
      }
      changed = applied.changed;
    }

    // The committed state, which is the previous one when nothing was written.
    const after = port.currentPackage();
    if (!after) {
      return refuse(
        operations,
        0,
        automationError('document-unavailable', 'this host holds no document right now'),
        revision
      );
    }
    const post = readsOf(after);
    const settled = planner.settle(post);
    if (!settled.ok && settled.selection !== undefined) {
      // The caret could not be placed. Writes in the same batch HAVE committed, so the answer
      // says so (`changed`, the new revision) and names the select: re-read, never replay.
      tracking = stagedTracking;
      const failed = refuse(
        operations,
        nthSelect(operations, settled.selection),
        automationError(
          'unsupported-capability',
          'the host could not place the selection',
          'selection'
        ),
        port.revision()
      );
      // Unlike every other refusal, the operations before this one DID publish: `changed` says so.
      return { ...failed, changed };
    }
    if (!settled.ok) {
      return refuse(
        operations,
        firstCommand < 0 ? 0 : firstCommand,
        automationError(
          'transaction-refused',
          'the transaction did not produce the document the batch planned',
          settled.detail
        ),
        port.revision()
      );
    }

    tracking = stagedTracking;
    const committed = port.revision();
    // Queries answered from the package the batch started with; commands from the result.
    const results: AutomationOperationResult[] = planned.map((step) => ({
      status: 'ok',
      value:
        step.kind === 'query'
          ? stampEndpoints(step.value, revision, texts, handles, start)
          : stampEndpoints(
              step.kind === 'customNodeWrite' || step.kind === 'documentReplace'
                ? step.answer(post)
                : step.answer(post, mintedComment),
              committed,
              texts,
              handles,
              post
            ),
    }));
    return { ok: true, results, revision: committed, changed };
  };

  const execute = (request: AutomationBatchRequest): AutomationBatchResponse => {
    executing += 1;
    try {
      return executeBatch(request);
    } finally {
      executing -= 1;
      if (executing === 0 && pendingEvent) {
        const event = pendingEvent;
        pendingEvent = null;
        // State and answers are final before an observer may read or write this host again.
        for (const listener of [...listeners]) listener(event);
      }
    }
  };

  const created: AutomationHost = {
    capabilities,
    revision: () => port.revision(),
    execute,
    ...(port.prepare ? { prepare: port.prepare.bind(port) } : {}),
    save(): AutomationSaveResult {
      if (disposed) {
        return { ok: false, error: automationError('disposed', 'this host was disposed') };
      }
      if (!capabilities.save) {
        return {
          ok: false,
          error: automationError('unsupported-capability', 'this host cannot save', 'save'),
        };
      }
      const bytes = port.save();
      if (!bytes) {
        return {
          ok: false,
          error: automationError('document-unavailable', 'this host holds no document right now'),
        };
      }
      return { ok: true, bytes };
    },
    subscribe(listener): AutomationUnsubscribe {
      if (disposed || !capabilities.events) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      unsubscribePort();
      port.dispose();
      reads = null;
      texts.clear();
    },
  };
  HANDLE_TABLES.set(created, handles);
  return created;
}

/** Each host's handle table, for the in-process lanes that translate a host's answers. */
const HANDLE_TABLES = new WeakMap<AutomationHost, AutomationHandleTable>();

/**
 * The canonical paragraph id a paragraph handle of `host` names, or `null` for a handle the
 * host did not mint or that names no paragraph. For in-process adapters only, such as the
 * browser editor's text highlights: the protocol itself never answers engine identity.
 *
 * @internal
 */
export function automationParagraphNodeId(host: AutomationHost, handle: unknown): string | null {
  const target = HANDLE_TABLES.get(host)?.resolve(handle, 'paragraph');
  return target?.kind === 'paragraph' ? target.paragraphId : null;
}
