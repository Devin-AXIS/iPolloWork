// Review reads and decisions narrowed to a stretch of a story or to one review-queue key.
//
// A RANGE ASKS BY POSITION. `getRevisions` with a span answers the listed decisions of that
// span's story whose characters the span overlaps, in the same order and with the same handles
// as the story-wide listing, so a revision reached through a range IS the one the body lists.
// Positions are model offsets: the runtime's text view changes what a range's text reads, never
// which decisions sit inside it.
//
// A REVIEW KEY IS THE QUEUE'S NAME FOR A DECISION (`reviewItemKey`, `parseReviewItemKey`). The
// item is found in its part, then placed in the story its first paragraph belongs to, and only
// accepted when that story's own membership holds it too. A paired key must name a deletion
// and an insertion the queue itself would pair. A key naming nothing answers no stretch and no
// members rather than a refusal, so a caller can choose a null object.
//
// DECISIONS IN ONE BATCH SHARE A LEDGER. Each decision is planned against the state before the
// batch, so two scoped decisions that reach the same change would both target its sites and the
// second would fail as stale. The ledger records what earlier decisions resolved; a later
// decision drops those keys, and a contrary decision on one of them refuses.

import { planRevisionBatch } from '../store/store/revision-batch.ts';
import {
  isReplacementPair,
  parseReviewItemKey,
  reviewItemKey,
  revisionSiteNodeIdsOf,
  type ReviewCommentItem,
  type ReviewRange,
  type ReviewRevisionItem,
} from '../store/store/review-items.ts';
import { revisionItemsOf, commentItemsOf } from '../store/store/review-reads.ts';
import {
  commentAnchorsOfStory,
  commentsOfPart,
  threadStateOfPart,
  type CommentThreadState,
} from '../store/store/comment-reads.ts';
import { commentPartNameOf, commentsExtendedPartNameOf } from '../store/store/comment-writes.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { nestedTextDecisionOps } from './revision-nested-text.ts';
import { parentNodeOf } from '../store/package/ooxml-edit.ts';
import { revisionItemsInStory, revisionReads } from './review.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import {
  resolveSpanRef,
  spanValue,
  storyOfHandle,
  storyOfSpanRef,
  type ResolvedRange,
} from './spans.ts';
import { sharesItsPart, type AutomationStoryId } from './stories.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationErrorCode, AutomationSpan, AutomationValue } from './protocol.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';

/** A reply chain is walked to its anchored head; the file already broke any cycle. */
const MAX_THREAD_DEPTH = 64;

const APPLIED: AutomationValue = Object.freeze({ kind: 'applied' as const });

function refuse(code: AutomationErrorCode, message: string, detail?: string): PlannedOperation {
  return {
    ok: false,
    error: Object.freeze(detail === undefined ? { code, message } : { code, message, detail }),
  };
}

function query(value: AutomationValue): PlannedOperation {
  return { ok: true, kind: 'query', value };
}

type Action = 'accept' | 'reject';

/**
 * What an earlier decision in the batch did to a change: accepted it, rejected it, or removed
 * it with the text around it (a rejected insertion or an accepted deletion that holds it).
 */
type Decided = Action | 'removed';

/** What the decisions earlier in one batch resolved. One per batch planner. */
export interface RevisionDecisionLedger {
  /** Store review keys an earlier decision resolved, with what it did to them. */
  readonly decided: Map<string, Decided>;
  /** Whether an earlier decision resolved a whole story. */
  whole: boolean;
}

export function createRevisionDecisionLedger(): RevisionDecisionLedger {
  return { decided: new Map(), whole: false };
}

/**
 * Plan accepting or rejecting exactly these changes, as one decision in the batch.
 *
 * A change inside text that this decision or an earlier one removes is skipped whatever the
 * action, because no decision on it can change the result. A change an earlier decision took the
 * same way is skipped too. The decision refuses when an earlier decision took the contrary action
 * on a change it still covers, when an earlier decision resolved the whole story, and when any
 * change cannot be resolved.
 */
export function planKeyedDecision(
  reads: AutomationStoryReads,
  items: readonly ReviewRevisionItem[],
  action: Action,
  ledger: RevisionDecisionLedger,
  pin: (story: AutomationStoryReads) => PlannedOperation | null
): PlannedOperation {
  const conflict = pin(reads);
  if (conflict) return conflict;
  if (ledger.whole)
    return refuse('conflicting-operations', 'an earlier decision resolved the whole story');
  const live = items.filter((item) => ledger.decided.get(reviewItemKey(item)) !== 'removed');
  const removed = removedBy(
    reads,
    live.filter((item) => {
      const earlier = ledger.decided.get(reviewItemKey(item));
      return removesContent(item, action) && (earlier === undefined || earlier === action);
    })
  );
  const pending: ReviewRevisionItem[] = [];
  for (const item of live) {
    const key = reviewItemKey(item);
    const earlier = ledger.decided.get(key);
    if (removed.has(key)) continue;
    if (earlier === undefined) pending.push(item);
    else if (earlier !== action)
      return refuse('conflicting-operations', 'an earlier decision took the contrary action');
  }
  const settle = (keys: readonly string[]) => {
    for (const key of keys) ledger.decided.set(key, action);
    for (const key of removed) ledger.decided.set(key, 'removed');
  };
  if (pending.length === 0) {
    settle([]);
    return { ok: true, kind: 'command', story: reads.story, ops: [], answer: () => APPLIED };
  }
  const keys = pending.map(reviewItemKey);
  const decision = planRevisionBatch(
    reads.part,
    action,
    keys,
    sharesItsPart(reads.story) ? reads.root : undefined,
    { countRemaining: false, explicit: true }
  );
  let ops = decision.ops;
  const skipped = decision.result.skipped;
  if (skipped.length > 0) {
    // Nested text changes share a batch group, but each one is still its own decision.
    const nested = skipped.every((skip) => skip.reason === 'incomplete-group')
      ? nestedDecisionOps(reads, pending, action)
      : null;
    // The detail names the skip and its structure, `incomplete-group:paired-change`, for
    // diagnostics; neither comes from the file.
    const skip = skipped[0];
    // A lock or a binding keeps the decision: its code names which, as `acceptAll()` does.
    const guarded = skipped.find(
      (entry) => entry.detail === 'locked-content' || entry.detail === 'bound-content'
    );
    if (!nested && guarded)
      return refuse('transaction-refused', 'a content control keeps that change', guarded.detail);
    if (!nested)
      return refuse(
        'unsupported-revision',
        'a tracked change in that decision cannot be resolved',
        skip && (skip.detail ? `${skip.reason}:${skip.detail}` : skip.reason)
      );
    ops = nested;
    settle(keys);
  } else {
    settle([...keys, ...decision.result.resolved.map((entry) => entry.key)]);
    // Changes inside a removed paragraph or row go with it, as text inside removed text does.
    for (const key of decision.swept ?? []) ledger.decided.set(key, 'removed');
  }
  return { ok: true, kind: 'command', story: reads.story, ops, answer: () => APPLIED };
}

/** Whether a decision on this change removes its content: a rejected insertion, an accepted deletion. */
function removesContent(item: ReviewRevisionItem, action: Action): boolean {
  return action === 'reject' ? item.revisionKind === 'insert' : item.revisionKind === 'delete';
}

/**
 * The story's changes that lie inside the text `removing` takes out.
 *
 * Every op is planned from the state before the batch, so such a change is not resolved on its
 * own: its sites go with that text, and an op naming them would name nodes that are gone.
 */
function removedBy(
  reads: AutomationStoryReads,
  removing: readonly ReviewRevisionItem[]
): ReadonlySet<string> {
  const sites = new Set<string>();
  for (const item of removing) for (const id of revisionSiteNodeIdsOf(item)) sites.add(id);
  if (sites.size === 0) return new Set();
  const underRemoved = (id: string): boolean => {
    for (let node = parentNodeOf(reads.part, id); node; node = parentNodeOf(reads.part, node.id))
      if (sites.has(node.id)) return true;
    return false;
  };
  return new Set(
    revisionItemsInStory(reads)
      .filter((item) => {
        const own = revisionSiteNodeIdsOf(item);
        return own.length > 0 && own.every(underRemoved);
      })
      .map(reviewItemKey)
  );
}

/** Each pending item resolved alone as a nested text decision, or null when one cannot be. */
function nestedDecisionOps(
  reads: AutomationStoryReads,
  items: readonly ReviewRevisionItem[],
  action: Action
): readonly TreeDocOp[] | null {
  const ops: TreeDocOp[] = [];
  for (const item of items) {
    const own = nestedTextDecisionOps(reads, item, action);
    if (own.length === 0) return null;
    for (const op of own) ops.push(op);
  }
  return ops;
}

interface Position {
  readonly index: number;
  readonly offset: number;
}

function compare(a: Position, b: Position): number {
  return a.index === b.index ? a.offset - b.offset : a.index - b.index;
}

/**
 * Whether a review range shares characters with a span of the same story.
 *
 * A collapsed span counts what it touches, so a caret inside a change finds it. A span with
 * length counts a zero-length change only when the change sits before the span's end.
 */
function overlaps(reads: AutomationStoryReads, scope: ResolvedRange, range: ReviewRange): boolean {
  const from = reads.indexOf(range.start.paragraphId);
  const to = reads.indexOf(range.end.paragraphId);
  if (from < 0 || to < 0) return false;
  const start = { index: from, offset: range.start.offset };
  const end = { index: to, offset: range.end.offset };
  const low = { index: reads.indexOf(scope.start.paragraphId), offset: scope.start.offset };
  const high = { index: reads.indexOf(scope.end.paragraphId), offset: scope.end.offset };
  // A collapsed span touches what sits at its position.
  if (compare(low, high) === 0) return compare(start, high) <= 0 && compare(end, low) >= 0;
  // A zero-length change (a paragraph mark, a property change at the end of the text) counts
  // only from where the span starts to before where it ends, so a span ending at the end of a
  // paragraph leaves that paragraph's mark alone unless it continues into the next one.
  if (compare(start, end) === 0) return compare(start, low) >= 0 && compare(start, high) < 0;
  return compare(start, high) < 0 && compare(end, low) > 0;
}

/** Every decision of a span's story the span overlaps, readOnly and structural ones included. */
function itemsInScope(
  reads: AutomationStoryReads,
  scope: ResolvedRange | null
): readonly ReviewRevisionItem[] {
  if (scope === null) return [];
  return revisionItemsInStory(reads).filter((item) =>
    item.ranges.some((range) => overlaps(reads, scope, range))
  );
}

/** The listed (typed) members among `items`, as handles in story order. */
function listedHandles(
  reads: AutomationStoryReads,
  items: readonly ReviewRevisionItem[],
  handles: AutomationHandleTable,
  pkg: OoxmlPackage | null
): AutomationValue {
  const ids = new Set(items.map((item) => item.id));
  return {
    kind: 'handles',
    handles: revisionReads(reads, pkg)
      .filter((revision) => ids.has(revision.id))
      .map((revision) => handles.revision(revision.id, reads.story)),
  };
}

/** The parts that can hold review items: the main part, declared furniture, and notes parts. */
function reviewParts(packageReads: AutomationPackageReads): readonly OoxmlPart[] {
  const parts = new Map<string, OoxmlPart>();
  const add = (reads: AutomationStoryReads | null) => {
    if (reads && !parts.has(reads.part.name)) parts.set(reads.part.name, reads.part);
  };
  add(packageReads.body);
  const sections = packageReads.sections().length;
  for (let sectionIndex = 0; sectionIndex < sections; sectionIndex += 1) {
    for (const slot of packageReads.furniture(sectionIndex)) {
      if (slot.declared)
        add(packageReads.story({ kind: slot.kind, sectionIndex, variant: slot.variant }));
    }
  }
  for (const noteKind of ['footnote', 'endnote'] as const) {
    const listing = packageReads.noteIds(noteKind);
    const first = listing.ok ? listing.ids[0] : undefined;
    if (first !== undefined) add(packageReads.story({ kind: 'note', noteKind, noteId: first }));
  }
  return [...parts.values()];
}

/** The story that holds a paragraph, as reads. */
function storyReadsOf(
  packageReads: AutomationPackageReads,
  paragraphId: string | undefined
): AutomationStoryReads | null {
  if (paragraphId === undefined) return null;
  const id: AutomationStoryId | null = packageReads.storyOf(paragraphId);
  return id ? packageReads.story(id) : null;
}

/** A tracked change a key names: its store items (two for a pair) and the story they are in. */
interface KeyedRevisions {
  readonly reads: AutomationStoryReads;
  readonly items: readonly ReviewRevisionItem[];
}

function revisionItemsOfKey(
  packageReads: AutomationPackageReads,
  key: string
): KeyedRevisions | null {
  const parsed = parseReviewItemKey(key);
  if (!parsed || (parsed.kind !== 'revision' && parsed.kind !== 'replacement')) return null;
  const halves = parsed.kind === 'replacement' ? parsed.halves : '';
  for (const part of reviewParts(packageReads)) {
    const all = revisionItemsOf(part);
    let found: readonly ReviewRevisionItem[] | null = null;
    if (parsed.kind === 'revision') {
      const item = all.find((each) => each.id === parsed.id);
      if (item) found = [item];
    } else {
      for (const deletion of all) {
        if (!halves.startsWith(`${deletion.id}+`)) continue;
        const insertionId = halves.slice(deletion.id.length + 1);
        const insertion = all.find((each) => each.id === insertionId);
        if (insertion && isReplacementPair(deletion, insertion)) {
          found = [deletion, insertion];
          break;
        }
      }
    }
    if (!found) continue;
    const reads = storyReadsOf(packageReads, found[0]!.ranges[0]?.start.paragraphId);
    if (!reads) return null;
    // The story's own membership decides, as it does for listings: a text box's change is
    // placed by its sites, and a note shares its part with every other note.
    const members = new Set(revisionItemsInStory(reads).map((item) => item.id));
    return found.every((item) => members.has(item.id)) ? { reads, items: found } : null;
  }
  return null;
}

/** The anchored range of a comment, or of the thread head a reply answers, with its story. */
function commentRangeOfKey(
  packageReads: AutomationPackageReads,
  id: string
): { readonly reads: AutomationStoryReads; readonly range: ReviewRange } | null {
  const pkg = packageReads.package;
  const body = packageReads.body;
  if (!pkg || !body) return null;
  const commentsPart = pkg.parts.get(commentPartNameOf(pkg, body.part.name));
  if (!commentsPart) return null;
  const extended = pkg.parts.get(commentsExtendedPartNameOf(pkg, body.part.name));
  const threadState: ReadonlyMap<string, CommentThreadState> = extended
    ? threadStateOfPart(extended)
    : new Map<string, CommentThreadState>();
  const anchors: ReturnType<typeof commentAnchorsOfStory> = [];
  for (const part of reviewParts(packageReads)) {
    for (const anchor of commentAnchorsOfStory(part)) anchors.push(anchor);
  }
  const items = commentItemsOf(commentsOfPart(commentsPart), anchors, threadState);
  const byId = new Map<string, ReviewCommentItem>(items.map((item) => [item.id, item]));
  let item = byId.get(id);
  for (let depth = 0; item && depth <= MAX_THREAD_DEPTH; depth += 1) {
    if (item.range) {
      if (item.orphaned) return null;
      const reads = storyReadsOf(packageReads, item.range.start.paragraphId);
      return reads && reads.has(item.range.end.paragraphId) ? { reads, range: item.range } : null;
    }
    item = item.parentId === undefined ? undefined : byId.get(item.parentId);
  }
  return null;
}

/** One stretch from the earliest start to the latest end of `ranges`, clamped to the story. */
function coveringSpan(
  reads: AutomationStoryReads,
  ranges: readonly ReviewRange[],
  handles: AutomationHandleTable
): AutomationSpan | null {
  let low: (Position & { readonly paragraphId: string }) | null = null;
  let high: (Position & { readonly paragraphId: string }) | null = null;
  for (const range of ranges) {
    for (const point of [range.start, range.end]) {
      const text = reads.rawText(point.paragraphId);
      if (text === null) return null;
      const at = {
        paragraphId: point.paragraphId,
        index: reads.indexOf(point.paragraphId),
        offset: Math.min(point.offset, text.length),
      };
      if (!low || compare(at, low) < 0) low = at;
      if (!high || compare(at, high) > 0) high = at;
    }
  }
  if (!low || !high) return null;
  const story = reads.story;
  return spanValue({ start: { ...low, story }, end: { ...high, story } }, handles);
}

function validKey(key: unknown): PlannedOperation | null {
  return typeof key === 'string' && key.length > 0
    ? null
    : refuse('unsupported-content', 'a review item key is nonempty text');
}

/**
 * Plan `getReviewItemRange`: the stretch a review-queue key names, as zero or one spans.
 *
 * Revision, paired replacement, and comment keys resolve. A key naming nothing, an item with no
 * place in a story, or an orphaned comment answers no span.
 */
export function planReviewItemRange(
  key: unknown,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads
): PlannedOperation {
  const invalid = validKey(key);
  if (invalid) return invalid;
  if (packageReads.package === null)
    return refuse('document-unavailable', 'this host holds no document');
  const parsed = parseReviewItemKey(key as string);
  let span: AutomationSpan | null = null;
  if (parsed?.kind === 'comment') {
    const found = commentRangeOfKey(packageReads, parsed.id);
    span = found ? coveringSpan(found.reads, [found.range], handles) : null;
  } else {
    const found = revisionItemsOfKey(packageReads, key as string);
    const ranges = found?.items.flatMap((item) => item.ranges) ?? [];
    span = found && ranges.length > 0 ? coveringSpan(found.reads, ranges, handles) : null;
  }
  return query({ kind: 'spans', spans: span ? [span] : [] });
}

type Listing = Extract<AutomationOperation, { readonly op: 'getRevisions' }>;

/** Plan `getRevisions`: a whole story, the decisions a span overlaps, or one key's own. */
export function planRevisionListing(
  operation: Listing,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads
): PlannedOperation {
  if ('body' in operation) {
    const story = storyOfHandle(operation.body, 'body', handles, packageReads);
    if (!story.ok) return refuse(story.code, 'that handle does not name a body', story.detail);
    const reads = story.value;
    return query({
      kind: 'handles',
      handles: revisionReads(reads, packageReads.package).map((item) =>
        handles.revision(item.id, reads.story)
      ),
    });
  }
  if ('key' in operation) {
    const invalid = validKey(operation.key);
    if (invalid) return invalid;
    const found = revisionItemsOfKey(packageReads, operation.key);
    return query(
      found
        ? listedHandles(found.reads, found.items, handles, packageReads.package)
        : { kind: 'handles', handles: [] }
    );
  }
  const scope = resolveSpanRef(operation.scope, handles, packageReads);
  if (!scope.ok) return refuse(scope.code, 'that span is not a place', scope.detail);
  const story = storyOfSpanRef(operation.scope, handles, packageReads);
  if (!story.ok) return refuse(story.code, 'that span names no story', story.detail);
  return query(
    listedHandles(
      story.value,
      itemsInScope(story.value, scope.value),
      handles,
      packageReads.package
    )
  );
}

type NarrowDecision = Extract<
  AutomationOperation,
  { readonly op: 'acceptAllRevisions' | 'rejectAllRevisions' }
> &
  ({ readonly scope: unknown } | { readonly key: unknown });

/**
 * Accept or reject the decisions a span overlaps or a key names, as one transaction.
 *
 * Covers every overlapping decision, structural ones absent from the listing included, and
 * refuses the whole decision when any of them is read-only or cannot be resolved. A key that
 * names nothing refuses rather than reporting a decision nobody could make.
 */
export function planNarrowRevisionDecision(
  operation: NarrowDecision,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads,
  pin: (story: AutomationStoryReads) => PlannedOperation | null,
  ledger: RevisionDecisionLedger
): PlannedOperation {
  const action: Action = operation.op === 'acceptAllRevisions' ? 'accept' : 'reject';
  let target: KeyedRevisions;
  if ('key' in operation) {
    const invalid = validKey(operation.key);
    if (invalid) return invalid;
    const found = revisionItemsOfKey(packageReads, operation.key as string);
    if (!found) return refuse('invalid-handle', 'that review item is not in this document');
    target = found;
  } else {
    const scopeRef = operation.scope as Extract<Listing, { scope: unknown }>['scope'];
    const scope = resolveSpanRef(scopeRef, handles, packageReads);
    if (!scope.ok) return refuse(scope.code, 'that span is not a place', scope.detail);
    const story = storyOfSpanRef(scopeRef, handles, packageReads);
    if (!story.ok) return refuse(story.code, 'that span names no story', story.detail);
    target = { reads: story.value, items: itemsInScope(story.value, scope.value) };
  }
  if (target.items.some((item) => item.readOnly))
    return refuse('unsupported-revision', 'a tracked change in that decision is read-only');
  return planKeyedDecision(target.reads, target.items, action, ledger, pin);
}
