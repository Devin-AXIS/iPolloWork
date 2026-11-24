import { sharesItsPart } from './stories.ts';
import { collectRevisionSites } from '../store/store/tree-op-revisions.ts';
import { reviewItemKey } from '../store/store/review-items.ts';
import type { PlannedOperation } from './plan-types.ts';
import { planRevisionBatch, type RevisionBatchResult } from '../store/store/revision-batch.ts';
import { retainedNestedRowSites } from '../store/store/revision-table-preserve-nested.ts';
import { guardKeepsOps, holdsGuardedControls } from '../store/store/revision-content-lock.ts';
import {
  invalidRevisionAuthorInput,
  planRevisionAuthorChange,
} from '../store/store/revision-author-change.ts';
import { storyKey } from './stories.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { storyOfHandle } from './spans.ts';
import { listedRevisionItemsInStory, revisionItemsInStory } from './review.ts';
import {
  inertPropertyChangeInputsOf,
  inertPropertyChanges,
} from '../layout/review-inert-property-changes.ts';
import { revisionItemsOf } from '../store/store/review-reads.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { planNarrowRevisionDecision, type RevisionDecisionLedger } from './review-scope.ts';
import { textboxSiteIndex } from './textbox-revision-scope.ts';

/** The store's bound on one decision's explicit site list (`tree-op-validate.ts`). */
const MAX_SITES_PER_OP = 50_000;

type CollectionDecision = Exclude<
  Extract<AutomationOperation, { readonly op: 'acceptAllRevisions' | 'rejectAllRevisions' }>,
  { readonly scope: unknown } | { readonly key: unknown }
>;

type AnyCollectionDecision = Extract<
  AutomationOperation,
  { readonly op: 'acceptAllRevisions' | 'rejectAllRevisions' }
>;

type DecisionTarget =
  | { readonly ok: true; readonly reads: AutomationStoryReads }
  | {
      readonly ok: false;
      readonly code: AutomationErrorCode;
      readonly message: string;
      readonly detail?: string;
    };

/** Resolve either the compatible document form or the story-scoped body form. */
export function revisionDecisionTarget(
  operation: CollectionDecision,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads
): DecisionTarget {
  if ('body' in operation) {
    const story = storyOfHandle(operation.body, 'body', handles, packageReads);
    return story.ok
      ? { ok: true, reads: story.value }
      : {
          ok: false,
          code: story.code,
          message: 'that handle does not name a body',
          detail: story.detail,
        };
  }
  if (!handles.resolve(operation.document, 'document')) {
    return {
      ok: false,
      code: 'invalid-handle',
      message: 'that handle does not name a document',
      detail: 'document',
    };
  }
  return packageReads.body
    ? { ok: true, reads: packageReads.body }
    : {
        ok: false,
        code: 'document-unavailable',
        message: 'this host holds no document',
      };
}

/**
 * Build one atomic collection decision after its target story has been resolved.
 *
 * A header, footer, or the main body owns its part, so the store's part-wide op is the decision.
 * Notes share `footnotes.xml` / `endnotes.xml`, so one exact canonical note root scopes the same
 * store-level all-decision, and a text box story is scoped to its own `w:txbxContent` the same
 * way. Its owner's decision names its own sites so it leaves the boxes it anchors alone.
 * Listing identities never participate in collection mutation.
 */
export function revisionCollectionOps(
  operation: CollectionDecision,
  reads: AutomationStoryReads
): readonly TreeDocOp[] {
  if (
    reads.root.kind !== 'textValue' &&
    collectRevisionSites({ ...reads.part, root: reads.root }).length === 0
  )
    return [];
  const op = operation.op;
  const index = textboxSiteIndex(reads.part);
  const sites = () => collectRevisionSites(reads.part).map((site) => site.node.id);
  // The store takes a bounded site list per op; one transaction still makes it one decision.
  const chunked = (ids: readonly string[]): TreeDocOp[] => {
    const ops: TreeDocOp[] = [];
    for (let start = 0; start < ids.length; start += MAX_SITES_PER_OP) {
      ops.push({ op, siteNodeIds: ids.slice(start, start + MAX_SITES_PER_OP) });
    }
    return ops;
  };
  if (reads.story.kind === 'textbox') {
    // The VML copy carries the same changes; deciding them together keeps the copies alike.
    const root = reads.root.id;
    const copy = index.copy.size
      ? sites().filter((id) => index.copy.has(id) && index.story.get(id) === root)
      : [];
    return [{ op, scopeRootId: root }, ...chunked(copy)];
  }
  if (sharesItsPart(reads.story)) return [{ op, scopeRootId: reads.root.id }];
  if (index.story.size === 0) return [{ op }];
  const all = sites();
  const own = all.filter((id) => !index.story.has(id));
  return own.length === all.length ? [{ op }] : chunked(own);
}

type BatchOperation = Extract<
  AutomationOperation,
  { readonly op: 'resolveRevisionBatch' | 'setRevisionAuthorBatch' }
>;

/**
 * The story and review keys a selected-set operation addresses. Unknown host handles fail
 * closed. Omitted revisions select the whole story; an owner story names its own decisions,
 * so the text boxes it anchors stay out.
 */
function batchSelection(
  operation: BatchOperation,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads
) {
  const target = revisionDecisionTarget(
    { op: 'acceptAllRevisions', body: operation.body },
    handles,
    packageReads
  );
  if (!target.ok) return target;
  if (operation.revisions !== undefined && !Array.isArray(operation.revisions))
    return {
      ok: false as const,
      code: 'unsupported-content' as const,
      message: 'invalid revision batch',
    };
  let keys: string[] | undefined = operation.revisions === undefined ? undefined : [];
  if (
    keys === undefined &&
    !sharesItsPart(target.reads.story) &&
    textboxSiteIndex(target.reads.part).story.size > 0
  )
    keys = revisionItemsInStory(target.reads).map(reviewItemKey);
  for (const handle of operation.revisions ?? []) {
    const revision = handles.resolve(handle, 'revision');
    if (
      !revision ||
      revision.kind !== 'revision' ||
      storyKey(revision.story) !== storyKey(target.reads.story)
    )
      return {
        ok: false as const,
        code: 'invalid-handle' as const,
        message: 'revision does not belong to this story',
      };
    keys!.push(`revision-${revision.revisionId}`);
  }
  const scopeRoot = sharesItsPart(target.reads.story) ? target.reads.root : undefined;
  return { ok: true as const, reads: target.reads, keys, scopeRoot };
}

/** Resolve handles once, then plan the selected sites together. Unknown host handles fail closed. */
export function revisionBatchPlan(
  operation: Extract<AutomationOperation, { op: 'resolveRevisionBatch' }>,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads
) {
  const selection = batchSelection(operation, handles, packageReads);
  if (!selection.ok) return selection;
  if (!['accept', 'reject'].includes(operation.action))
    return {
      ok: false as const,
      code: 'unsupported-content' as const,
      message: 'invalid revision batch',
    };
  // Revisions the caller names are decided as single calls on them would be.
  const plan = planRevisionBatch(
    selection.reads.part,
    operation.action,
    selection.keys,
    selection.scopeRoot,
    operation.revisions === undefined ? undefined : { explicit: true }
  );
  return { ok: true as const, reads: selection.reads, ...plan };
}

/** Plan an attribution change for a selected set, with the same selection rules as a decision. */
export function revisionAuthorPlan(
  operation: Extract<AutomationOperation, { op: 'setRevisionAuthorBatch' }>,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads
) {
  const attribution = {
    author: operation.author,
    ...(operation.date === undefined ? {} : { date: operation.date }),
  };
  if (
    typeof operation.author !== 'string' ||
    (operation.date !== undefined && typeof operation.date !== 'string') ||
    invalidRevisionAuthorInput(attribution) ||
    (operation.authors !== undefined &&
      (operation.revisions !== undefined ||
        !Array.isArray(operation.authors) ||
        operation.authors.some((name) => typeof name !== 'string')))
  )
    return {
      ok: false as const,
      code: 'unsupported-content' as const,
      message:
        'author must be nonblank text, date an xsd:dateTime, and authors a list without revisions',
    };
  const selection = batchSelection(operation, handles, packageReads);
  if (!selection.ok) return selection;
  const keys =
    operation.revisions === undefined
      ? storyKeysWithoutUnlisted(selection, packageReads.package)
      : selection.keys;
  const plan = planRevisionAuthorChange(
    selection.reads.part,
    attribution,
    keys,
    selection.scopeRoot,
    operation.authors
  );
  return { ok: true as const, reads: selection.reads, ...plan };
}

/**
 * A whole-story author change names every change of the story except records with no card,
 * which keep their author. The story's own keys when it chose them (a body with text boxes),
 * else every key of the scoped derivation; `selection.keys` unchanged when there are none.
 */
function storyKeysWithoutUnlisted(
  selection: {
    readonly reads: AutomationStoryReads;
    readonly keys: readonly string[] | undefined;
    readonly scopeRoot?: OoxmlNode | undefined;
  },
  pkg: OoxmlPackage | null
): readonly string[] | undefined {
  if (!pkg) return selection.keys;
  const { part } = selection.reads;
  const root = selection.scopeRoot;
  const items = revisionItemsOf(root && root.kind !== 'textValue' ? { ...part, root } : part);
  const unlisted = new Set(
    inertPropertyChanges(items, inertPropertyChangeInputsOf(pkg)).map(reviewItemKey)
  );
  if (unlisted.size === 0) return selection.keys;
  return (selection.keys ?? items.map(reviewItemKey)).filter((key) => !unlisted.has(key));
}

/** Count pending decisions after mutation, when adjacent surviving changes may regroup. */
export function revisionBatchAnswer(
  body: import('./protocol.ts').AutomationHandle,
  result: RevisionBatchResult,
  handles: AutomationHandleTable,
  post: AutomationPackageReads
): import('./protocol.ts').AutomationValue {
  const target = revisionDecisionTarget({ op: 'acceptAllRevisions', body }, handles, post);
  if (!target.ok) throw new Error('resolved story disappeared');
  const remaining = listedRevisionItemsInStory(target.reads, post.package).length;
  return { kind: 'revisionBatch', result: { ...result, remaining } };
}

/** Share story admission between strict collection decisions and selected-set decisions. */
export function planRevisionDecision(
  operation: AnyCollectionDecision | BatchOperation,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads,
  pin: (story: AutomationStoryReads) => PlannedOperation | null,
  ledger: RevisionDecisionLedger
): PlannedOperation {
  if ('scope' in operation || 'key' in operation)
    return planNarrowRevisionDecision(operation, handles, reads, pin, ledger);
  if (operation.op === 'setRevisionAuthorBatch') {
    const target = revisionAuthorPlan(operation, handles, reads);
    if (!target.ok) return { ok: false, error: { code: target.code, message: target.message } };
    const conflict = pin(target.reads);
    if (conflict) return conflict;
    return {
      ok: true,
      kind: 'command',
      story: target.reads.story,
      ops: target.ops,
      answer: (post) => {
        const after = revisionDecisionTarget(
          { op: 'acceptAllRevisions', body: operation.body },
          handles,
          post
        );
        if (!after.ok) throw new Error('reattributed story disappeared');
        const result = target.finish(after.reads.part);
        // The same decisions stay pending under new keys, so issued proxies follow them.
        const prefix = 'revision-';
        handles.retargetRevisions(
          target.reads.story,
          result.updated.flatMap(({ previousKey, key }) =>
            previousKey.startsWith(prefix) && key.startsWith(prefix)
              ? [{ from: previousKey.slice(prefix.length), to: key.slice(prefix.length) }]
              : []
          )
        );
        return { kind: 'revisionAuthors', result };
      },
    };
  }
  if (operation.op === 'resolveRevisionBatch') {
    const target = revisionBatchPlan(operation, handles, reads);
    if (!target.ok) return { ok: false, error: { code: target.code, message: target.message } };
    const conflict = pin(target.reads);
    if (conflict) return conflict;
    return {
      ok: true,
      kind: 'command',
      story: target.reads.story,
      ops: target.ops,
      answer: (post) => revisionBatchAnswer(operation.body, target.result, handles, post),
    };
  }
  const target = revisionDecisionTarget(operation, handles, reads);
  if (!target.ok)
    return {
      ok: false,
      error: { code: target.code, message: target.message, detail: target.detail },
    };
  const conflict = pin(target.reads);
  if (conflict) return conflict;
  // Every site is planned from the state before the batch; an earlier narrower decision has
  // already resolved some of them.
  if (ledger.whole || ledger.decided.size > 0)
    return {
      ok: false,
      error: {
        code: 'conflicting-operations',
        message: 'an earlier decision in this batch resolved changes',
      },
    };
  // A strict decision refuses rather than report the story reviewed while a row stays pending
  // to keep a nested table its content still needs.
  // The full plan runs only when the story holds a row that could stay.
  const scope = sharesItsPart(target.reads.story) ? target.reads.root : undefined;
  const action = operation.op === 'acceptAllRevisions' ? 'accept' : 'reject';
  const root = scope && scope.kind !== 'textValue' ? scope : undefined;
  const scoped = root ? { ...target.reads.part, root } : target.reads.part;
  if (
    retainedNestedRowSites(scoped, collectRevisionSites(scoped), action).size > 0 &&
    planRevisionBatch(target.reads.part, action, undefined, root, {
      countRemaining: false,
    }).result.skipped.some((skip) => skip.reason === 'retained-structure')
  )
    return {
      ok: false,
      error: {
        code: 'unsupported-revision',
        message: 'a tracked row must stay to keep the nested table inside it',
        detail: 'retained-structure:nested-table',
      },
    };
  // A lock or a binding the decision's own ops meet refuses it with that code, before they run.
  const ops = revisionCollectionOps(operation, target.reads);
  const kept = holdsGuardedControls(target.reads.part)
    ? guardKeepsOps(target.reads.part, ops)
    : null;
  if (kept)
    return {
      ok: false,
      error: {
        code: 'transaction-refused',
        message: 'a content control keeps a change in that decision',
        detail: kept,
      },
    };
  ledger.whole = true;
  return {
    ok: true,
    kind: 'command',
    story: target.reads.story,
    ops,
    answer: () => ({ kind: 'applied' }),
  };
}
