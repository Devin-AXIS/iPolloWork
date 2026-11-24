// The review queue after a tracked-change decision that changed a few body paragraphs in place.
//
// A decision only removes revision records: it accepts or rejects what is there and adds none.
// When it leaves the body's block sequence as it was, removes records from a few paragraphs and
// leaves every other record in them untouched, and their cards stay inside them, each of those
// paragraphs is patched the way a local edit is (`review-patch.ts`), instead of deriving the
// whole queue again. An edit that only looks like one (it adds or rebuilds a record) is refused,
// and so is anything a card can reach beyond its paragraph. The fallback is the full derivation,
// which is always correct.

import {
  canApplyLocalReviewPatch,
  commentTouchesParagraph,
  controlsChangedIn,
  insideCustomNode,
  onlyBodyChanged,
  patchLocalReviewItems,
  previousHoldsMarkRevision,
  reviewInputsUnchanged,
  revisionAnchoredOutsideParagraph,
  revisionCrossesParagraphBoundary,
  type LocalReviewPatchCache,
  type ReviewPatchInputs,
} from './review-patch.ts';
import type { ReviewItem, ReviewRevisionItem } from '../store/store/review-items.ts';
import {
  collectRevisionSites,
  paragraphOrderOfPart,
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type TreeModelChange,
} from '@docx-editor.dev/core/store';

/** Changed paragraphs past this many derive the queue again. */
const MAX_DECIDED_PARAGRAPHS = 4;

/** The cached queue the patch starts from. */
export type DecisionPatchCache = LocalReviewPatchCache & {
  readonly items: readonly ReviewItem[];
  readonly paragraphOrder?: ReadonlyMap<string, number> | null;
};

/** The reviewer filter as the patch reads it; see `review-item-filter.ts`. */
export interface DecisionPatchFiltering {
  readonly sameFilter: boolean;
  readonly patchable: (paragraphId: string) => boolean;
  readonly filtered: (items: readonly ReviewRevisionItem[]) => readonly ReviewRevisionItem[];
}

/** The derivation of one paragraph's revisions, as the review module provides it. */
export interface DecisionPatchDerivation {
  readonly revisionItemsOfParagraph: (
    part: OoxmlPart,
    paragraphId: string
  ) => readonly ReviewRevisionItem[];
}

function bodyOf(part: OoxmlPart): OoxmlElement | undefined {
  const body = part.root.children.find((child) => child.kind === 'body');
  return body && body.kind !== 'textValue' ? body : undefined;
}

function propertiesOf(paragraph: OoxmlElement): OoxmlNode | undefined {
  return paragraph.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'pPr'
  );
}

/**
 * Whether `after` is `before` with some revision records decided and the rest untouched: fewer
 * sites, each remaining one the very node it was, and the paragraph's properties the same unless
 * no record is left. That is what a decision does; an edit adds or rebuilds a record, and a
 * property change can join a neighbour's card.
 */
function onlyRemovedRecords(
  previousPart: OoxmlPart,
  before: OoxmlElement,
  part: OoxmlPart,
  after: OoxmlElement
): boolean {
  const was = new Map(
    collectRevisionSites({ ...previousPart, root: before }).map((site) => [site.node.id, site.node])
  );
  const now = collectRevisionSites({ ...part, root: after });
  if (now.length >= was.size || !now.every((site) => was.get(site.node.id) === site.node))
    return false;
  return now.length === 0 || propertiesOf(before) === propertiesOf(after);
}

/** Whether a paragraph holds a revision on its own mark, which can join the next paragraph. */
function holdsMarkRevision(part: OoxmlPart, paragraph: OoxmlElement): boolean {
  return collectRevisionSites({ ...part, root: paragraph }).some((site) => site.paragraphMark);
}

/**
 * The body paragraphs `change` decided, when each one can be patched on its own: only the body
 * changed, its block sequence is the one before, every changed block is a paragraph with its id
 * that only lost records, and no card, comment, control or mark reaches past it. Null otherwise.
 */
function decidedParagraphs(
  change: TreeModelChange,
  cache: DecisionPatchCache,
  inputs: ReviewPatchInputs
): readonly string[] | null {
  if (
    !onlyBodyChanged(change, cache, inputs) ||
    // A decision can reach another story in the same commit, such as the note a deleted
    // reference held; the cached cards of that story would then be stale.
    !reviewInputsUnchanged(cache.pkg, inputs.currentPackage, inputs.part.name) ||
    change.created.length > 0 ||
    change.deleted.length > 0 ||
    change.splitJoin.length > 0
  )
    return null;
  const previousPart = cache.pkg.parts.get(inputs.part.name);
  const before = previousPart && bodyOf(previousPart);
  const after = bodyOf(inputs.part);
  if (!previousPart || !before || !after || before.children.length !== after.children.length)
    return null;
  const decided: string[] = [];
  for (const [index, child] of after.children.entries()) {
    const was = before.children[index]!;
    if (child === was) continue;
    if (
      decided.length >= MAX_DECIDED_PARAGRAPHS ||
      child.kind !== 'paragraph' ||
      was.kind !== 'paragraph' ||
      child.id !== was.id ||
      !onlyRemovedRecords(previousPart, was, inputs.part, child) ||
      holdsMarkRevision(previousPart, was) ||
      holdsMarkRevision(inputs.part, child) ||
      previousHoldsMarkRevision(inputs.part, child.id) ||
      controlsChangedIn(cache.pkg, inputs.part, child) ||
      insideCustomNode(inputs.part, child.id, cache.items)
    )
      return null;
    decided.push(child.id);
  }
  if (decided.length === 0) return null;
  for (const item of cache.items) {
    for (const paragraphId of decided) {
      if (item.kind === 'comment') {
        if (commentTouchesParagraph(item, paragraphId)) return null;
      } else if (item.kind === 'custom') {
        if (item.range?.start.paragraphId === paragraphId) return null;
      } else if (
        revisionAnchoredOutsideParagraph(item, paragraphId) ||
        revisionCrossesParagraphBoundary(item, paragraphId)
      ) {
        return null;
      }
    }
  }
  return decided;
}

/**
 * The queue after `change`, patched paragraph by paragraph, with the paragraph order it used;
 * null when there is no cached queue or the change is not a decision the patch can follow.
 */
export function patchDecidedReviewItems(
  change: TreeModelChange | null,
  cache: DecisionPatchCache | null,
  inputs: ReviewPatchInputs,
  filtering: DecisionPatchFiltering,
  derive: DecisionPatchDerivation
): {
  readonly items: readonly ReviewItem[];
  readonly paragraphOrder: ReadonlyMap<string, number>;
} | null {
  if (!change || !cache || !filtering.sameFilter) return null;
  const decided = decidedParagraphs(change, cache, inputs);
  if (!decided) return null;
  // The block sequence is the one the cache was ordered by.
  const paragraphOrder = cache.paragraphOrder ?? paragraphOrderOfPart(inputs.part);
  let items = cache.items;
  for (const paragraphId of decided) {
    if (!filtering.patchable(paragraphId)) return null;
    const local = derive.revisionItemsOfParagraph(inputs.part, paragraphId);
    if (!canApplyLocalReviewPatch(items, local, paragraphId, inputs.part)) return null;
    const patched = patchLocalReviewItems(
      items,
      paragraphOrder,
      paragraphId,
      local,
      filtering.filtered,
      inputs.part
    );
    if (!patched) return null;
    items = patched;
  }
  return { items, paragraphOrder };
}
