import type {
  DocumentEditingMode,
  ReviewItemPlacement,
  ReviewItemQuery,
  SemanticPosition,
} from '../contracts/editor.ts';
import type { ExecResult } from '../contracts/types.ts';
import type { ReviewCommentItem, ReviewItem } from '../layout/index.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { reviewWriteRefusal } from './review-write-refusal.ts';
import { openTextboxParagraphOrder } from './review-story-entry.ts';

interface CommentResolutionDeps {
  readonly reviewEnabled: boolean;
  readonly editingMode: DocumentEditingMode;
  readonly placements: (query?: ReviewItemQuery) => readonly ReviewItemPlacement[];
  readonly surface: PaginatedSurface | null;
  readonly proReviewReason: string;
  readonly bump: () => void;
}

function isCommentItem(item: ReviewItem): item is ReviewCommentItem {
  return item.kind === 'comment';
}

/** What resolving a comment range needs from the facade: the surface and two paragraph orders. */
export interface CommentRangeDeps {
  readonly surface: PaginatedSurface | null;
  /** Body layout order, memoized — this runs on every snapshot read. */
  readonly bodyOrder: () => ReadonlyMap<string, number>;
  /** Order of the story the reader has open, which is the ruler inside a header or a note. */
  readonly openStoryOrder: () => ReadonlyMap<string, number>;
}

/**
 * The range a new comment would cover: the RETAINED pin when a panel took focus, else the
 * live selection. Null when nothing is selected, or the selection is a caret.
 *
 * A READ, and deliberately flush-free. `useReview` polls it through `getReviewRevision` /
 * `getSelectionPlacement` as a `useSyncExternalStore` snapshot, so flushing here committed
 * queued typing and layout during React render: Chrome updated while the rail was rendering,
 * and consecutive snapshot reads returned different ticks. A caller that WRITES the range
 * flushes before it reads.
 */
export function commentTargetRangeOf(
  deps: CommentRangeDeps
): { from: SemanticPosition; to: SemanticPosition } | null {
  const { surface } = deps;
  const selection = surface?.retainedSelection() ?? surface?.state().selection ?? null;
  if (!selection) return null;
  const { anchor, head } = selection;
  if (anchor.paragraphId === head.paragraphId && anchor.offset === head.offset) return null;
  if (!surface?.publishedLayout()) return null;
  // Document order, not the order the user swept in: a backwards drag has its head first.
  // Through the memoized INDEX, not `indexOf` over the id list — this runs on every
  // snapshot read, and a linear scan of a 2432-paragraph document twice per read is the
  // kind of cost that only shows up on the documents that can least afford it.
  const order = deps.bodyOrder();
  let anchorIndex = order.get(anchor.paragraphId) ?? -1;
  let headIndex = order.get(head.paragraphId) ?? -1;
  if (anchorIndex === -1 || headIndex === -1) {
    // The body layout order only knows body paragraphs, so a range selected inside a
    // header, footer or note resolved to nothing: `selectionAnchorY` came back null, the
    // "comment on this" affordance never appeared, and `addComment` reported that a
    // comment needs a selected range while one was plainly on screen. The open story
    // publishes its own order, and that is the ruler for a selection inside it.
    const scoped = deps.openStoryOrder();
    anchorIndex = scoped.get(anchor.paragraphId) ?? -1;
    headIndex = scoped.get(head.paragraphId) ?? -1;
  }
  if (anchorIndex === -1 || headIndex === -1) {
    // Text in an open text box is in no story's paragraph list either, so the box's own
    // paragraphs rule a selection inside it, in the body or in a header.
    const box = openTextboxParagraphOrder(surface);
    anchorIndex = box.get(anchor.paragraphId) ?? -1;
    headIndex = box.get(head.paragraphId) ?? -1;
  }
  if (anchorIndex === -1 || headIndex === -1) return null;
  const forwards =
    anchorIndex < headIndex || (anchorIndex === headIndex && anchor.offset <= head.offset);
  return forwards ? { from: anchor, to: head } : { from: head, to: anchor };
}

/**
 * Same global `w:comment` record listed more than once (body + header markers, notes) is
 * valid. Two records, or two keys, sharing an id are not — first-match would resolve the
 * wrong thread.
 */
function uniqueCommentById(
  placements: readonly ReviewItemPlacement[]
): Map<string, ReviewCommentItem> | 'ambiguous' {
  const byId = new Map<string, ReviewCommentItem>();
  for (const placement of placements) {
    const item = placement.item as ReviewItem;
    if (!isCommentItem(item)) continue;
    const existing = byId.get(item.id);
    if (existing === undefined) {
      byId.set(item.id, item);
      continue;
    }
    if (existing.comment !== item.comment) return 'ambiguous';
  }
  return byId;
}

/** The one comment behind a card key, or the refusal that names why there is none. */
export function commentForKey(
  placements: readonly ReviewItemPlacement[],
  key: string
): ReviewCommentItem | ExecResult {
  const matches = placements.filter((entry) => entry.key === key);
  if (matches.length === 0) {
    return { ok: false, code: 'notFound', reason: 'no review item with that key' };
  }
  const comments = matches.map((entry) => entry.item as ReviewItem).filter(isCommentItem);
  if (comments.length === 0) {
    return { ok: false, code: 'kindMismatch', reason: 'the review item is not a comment' };
  }
  const first = comments[0]!;
  for (const candidate of comments) {
    if (candidate.comment !== first.comment) {
      return {
        ok: false,
        code: 'ambiguous',
        reason: 'duplicate comment records share that key',
      };
    }
  }
  return first;
}

/**
 * Resolve or reopen the comment behind a public review card.
 *
 * Kept beside the facade rather than in the Pro adapter: this is an engine write with the same
 * package transaction, viewing gate and typed refusals as the rest of the review commands.
 */
export function setReviewCommentResolved(
  deps: CommentResolutionDeps,
  key: string,
  resolved: boolean
): ExecResult {
  if (!deps.reviewEnabled) {
    return { ok: false, code: 'unsupported', reason: deps.proReviewReason };
  }
  if (deps.editingMode === 'viewing') {
    // Refused THROUGH the surface, as a card accept is, so it is recorded and reported once.
    const refused = deps.surface?.commitReviewOps(
      () => ({ committed: false, reason: 'the document is open for viewing' }),
      'comment-resolve'
    );
    const viewing = 'the document is open for viewing';
    return reviewWriteRefusal(refused ?? viewing, viewing, 'locked');
  }
  // Comment keys do not depend on pairing; the unpaired read keeps each reply's own parent.
  const placements = deps.placements({ pairReplacements: false });
  const item = commentForKey(placements, key);
  if (!('kind' in item)) return item;
  if (!deps.surface) {
    return { ok: false, code: 'notFound', reason: 'no review item with that key' };
  }

  const commentsById = uniqueCommentById(placements);
  if (commentsById === 'ambiguous') {
    return {
      ok: false,
      code: 'ambiguous',
      reason: 'duplicate comment records share an id',
    };
  }

  // Resolve the CONVERSATION even if a host hands the hook one of its reply items. Word's done
  // state belongs to the thread; writing it on a reply alone creates a split state no pane can
  // represent.
  let thread = item;
  const seen = new Set<string>();
  while (thread.parentId !== undefined && !seen.has(thread.id)) {
    seen.add(thread.id);
    const parent = commentsById.get(thread.parentId);
    if (!parent) break;
    thread = parent;
  }

  // Always index the full thread. A resolved root with an unresolved descendant must repair;
  // truncation or malformed metadata must refuse even when the root already matches.
  let ok = false;
  let changed = false;
  const refused = deps.surface.commitReviewOps((historyToken) => {
    const revision = deps.surface!.session.packageRevision();
    ok = deps.surface!.session.setCommentResolved(thread.id, resolved, { historyToken });
    changed = ok && deps.surface!.session.packageRevision() !== revision;
    return { committed: changed };
  }, 'comment-resolve');
  if (!ok) return reviewWriteRefusal(refused, 'the comment could not be resolved', 'notFound');
  if (changed) deps.bump();
  return { ok: true, changed };
}
