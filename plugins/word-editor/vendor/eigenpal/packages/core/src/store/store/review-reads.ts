import { unboundTableHistories } from './revision-table-unbound-history.ts';
import { ordinaryMoveRanges, ordinaryMoveInsertionSites } from './revision-move-ranges.ts';
import { mergeAdjacentSameKindEdits } from './review-inline-groups.ts';
import { groupTableRevisions } from './review-table-groups.ts';
import { structuralChangeOf } from './review-structural-details.ts';
import { reviewCardText } from './review-text.ts';
export { commentBodyText, commentInitials } from './review-text.ts';
// Derive pending review decisions from the canonical tree, not the visible spans:
// original/proposed display modes must never hide a decision from review actions.

import { WML_NAMESPACE_URI } from '../package/ooxml-tree.ts';
import { revisionSegments } from './review-revision-segments.ts';
import type { OoxmlElement, OoxmlPart } from '../package/ooxml-tree.ts';
import { mergeParagraphBreakEdits } from './review-paragraph-breaks.ts';
import { mergeParagraphMarkFormatting } from './review-paragraph-mark-formatting.ts';
import { mergeConsecutiveParagraphPropertyChanges } from './review-paragraph-property-groups.ts';
import {
  changedLanguages,
  changedFormatting,
  type ReviewFormattingChange,
} from './review-formatting.ts';
import { collectRevisionSites } from './tree-op-revisions.ts';
import { sourcelessMoveSites } from './review-sourceless-moves.ts';
import type { RevisionAddress } from './tree-op-types.ts';
import {
  commentAnchorsOfStory,
  commentsOfPart,
  threadStateOfPart,
  type CommentRecord,
  type CommentThreadState,
} from './comment-reads.ts';
import { locateSites } from './review-site-locations.ts';
import { createRecentRootCache } from './recent-root-cache.ts';
import { withStableCards } from './review-item-identity.ts';
import { rememberRevisionRoot, unchangedRevisionItems } from './review-items-reuse.ts';
import { deepParagraphOrderOfPart } from './review-paragraph-order.ts';
// The vocabulary this derivation speaks — the item shapes and their pure helpers — lives in
// `review-items.ts`, where the binding and layout lanes can reach it too.
import {
  registerRevisionSiteNodeIds,
  reviewItemPositionRank,
  revisionSiteNodeIdsOf,
  type ReviewCommentItem,
  type ReviewItem,
  type ReviewModelInput,
  type ReviewPosition,
  type ReviewRange,
  type ReviewRevisionItem,
  type ReviewRevisionKind,
} from './review-items.ts';

export { locateSites } from './review-site-locations.ts';
export { deepParagraphOrderOfPart, paragraphOrderOfPart } from './review-paragraph-order.ts';

/** `EG_ParaRPrTrackChanges` by element name: the four decisions a paragraph mark can carry. */
const MARK_DIRECTIONS: Readonly<Record<string, 'insert' | 'delete' | 'moveFrom' | 'moveTo'>> = {
  ins: 'insert',
  del: 'delete',
  moveFrom: 'moveFrom',
  moveTo: 'moveTo',
};

function wmlAttribute(node: OoxmlElement, localName: string): string | undefined {
  for (const attribute of node.attributes) {
    if (attribute.localName === localName && attribute.namespaceUri === WML_NAMESPACE_URI) {
      return attribute.value;
    }
  }
  return undefined;
}

function addressKey(address: RevisionAddress): string {
  return `${address.id}\u0000${address.author}\u0000${address.date ?? ''}`;
}

/**
 * The key a site groups under, one string per site node and kind. Rebuilt per site on every
 * derivation, each key was a new string that every map lookup hashed again; a long reviewed
 * document derives the queue after each tracked keystroke. The node is immutable, and its
 * address is read from its own attributes.
 */
const sourceKeys = new WeakMap<object, { readonly kind: string; readonly key: string }>();

function sourceKeyOf(node: object, kind: ReviewRevisionKind, address: RevisionAddress): string {
  const cached = sourceKeys.get(node);
  if (cached?.kind === kind) return cached.key;
  const localName = (node as { localName?: string }).localName;
  const key =
    kind === 'structural'
      ? `structural\u0000${addressKey(address)}`
      : `${kind}\u0000${localName}\u0000${addressKey(address)}`;
  sourceKeys.set(node, { kind, key });
  return key;
}

const CONTENT_KINDS: Readonly<Record<string, ReviewRevisionKind>> = {
  revisionInsert: 'insert',
  revisionDelete: 'delete',
  revisionMoveFrom: 'moveFrom',
  revisionMoveTo: 'moveTo',
  moveFromRangeStart: 'moveFrom',
  moveToRangeStart: 'moveTo',
};

/** @internal */
export interface ReviewDerivationDependencies {
  readonly retainRevisionItems: boolean;
  readonly revisionSites: typeof collectRevisionSites;
  readonly locations: typeof locateSites;
  readonly commentAnchors: typeof commentAnchorsOfStory;
  readonly deepOrder: (part: OoxmlPart) => ReadonlyMap<string, number>;
}

const interactiveReviewDerivation: ReviewDerivationDependencies = {
  retainRevisionItems: true,
  revisionSites: collectRevisionSites,
  locations: locateSites,
  commentAnchors: commentAnchorsOfStory,
  deepOrder: deepParagraphOrderOfPart,
};

/**
 * Every revision in one story, one card per DECISION.
 *
 * Sites sharing an `(id, author, date)` and revision kind retain their source sites.
 * Unchanged text separates inline decisions even when their source attributes match.
 *
 * Cached by part root except for paragraph-scoped synthetic roots. Results are shared
 * and readonly; part names are checked because ranges embed them.
 */
export function revisionItemsOf(part: OoxmlPart): readonly ReviewRevisionItem[] {
  return revisionItemsOfWith(part, interactiveReviewDerivation);
}

function revisionItemsOfWith(
  part: OoxmlPart,
  dependencies: ReviewDerivationDependencies
): readonly ReviewRevisionItem[] {
  const cacheable = part.root.kind !== 'paragraph';
  if (cacheable && dependencies.retainRevisionItems) {
    const cached = revisionItemsCache.get(part.root);
    // The name rides along because the items embed it (`ranges[*].partName`): a root is
    // the cache key, and serving one part's items to another part that shares the root
    // under a different name would stamp every range with the wrong part.
    if (cached && cached.name === part.name) {
      rememberRevisionRoot(part);
      return cached.items;
    }
    const unchanged = unchangedRevisionItems(part, (root) => {
      const previous = revisionItemsCache.get(root);
      return previous?.name === part.name ? previous.items : undefined;
    });
    if (unchanged) {
      revisionItemsCache.set(part.root, { name: part.name, items: unchanged });
      rememberRevisionRoot(part);
      return unchanged;
    }
  }
  const computed = computeRevisionItemsOf(part, dependencies);
  const items =
    cacheable && dependencies.retainRevisionItems ? withStableCards(part.name, computed) : computed;
  if (cacheable && dependencies.retainRevisionItems) {
    revisionItemsCache.set(part.root, { name: part.name, items });
    rememberRevisionRoot(part);
  }
  return items;
}

/** Revision cards per part root, bounded like the site index above. */
const revisionItemsCache = createRecentRootCache<{
  readonly name: string;
  readonly items: readonly ReviewRevisionItem[];
}>(8);

function computeRevisionItemsOf(
  part: OoxmlPart,
  dependencies: ReviewDerivationDependencies
): readonly ReviewRevisionItem[] {
  // Sites FIRST, and the site index only when there is at least one. `locateSites` merges
  // an O(document) index per fresh root, and a structural keystroke on an untracked
  // document paid that merge for a list this function was about to answer "empty" over.
  // The site walk itself is per-subtree memoized, so it is the cheap half.
  const sites = dependencies.revisionSites(part);
  if (sites.length === 0) return [];
  const located = dependencies.locations(part);
  const moveRanges = new Map(ordinaryMoveRanges(part.root).map((range) => [range.start.id, range]));
  const sourceless = sourcelessMoveSites(part.root, sites);
  const moveInsertions = ordinaryMoveInsertionSites(part.root);
  const hasParagraphMarks = sites.some((site) => site.paragraphMark);
  const previewByNode = new Map<string, { range: ReviewRange; text: string }>();
  const byAddress = new Map<
    string,
    {
      address: RevisionAddress;
      revisionKind: ReviewRevisionKind;
      localName: string;
      identitySuffix?: string;
      markDirection?: 'insert' | 'delete' | 'moveFrom' | 'moveTo';
      author: string;
      date?: string;
      text: string;
      structuralChanges?: NonNullable<ReviewRevisionItem['structuralChanges']>[number][];
      formattingLanguages?: string[];
      formattingChanges?: ReviewFormattingChange[];
      /** Deletion previews remain separate from inserted text. */
      deletedText: string;
      ranges: ReviewRange[];
      siteNodeIds: string[];
      readOnly: boolean;
      /** The DEEPEST site in the group: the reading a caret in this text gets. */
      nesting: number;
    }
  >();

  const currentInlineGroup = new Map<string, string>();
  const segments = revisionSegments(part);
  const unboundHistories = unboundTableHistories(part, sites);
  for (const site of sites) {
    // Unused history, and the legacy list history, lists as no change; bulk decisions drop it.
    if (unboundHistories.has(site.node.id) || site.node.localName === 'numberingChange') continue;
    const moveRange = moveRanges.get(site.node.id);
    const siteText = reviewCardText(moveRange ? moveRange.content : [site.node]);
    const sourceId = wmlAttribute(site.node, 'id');
    const id = sourceId ?? `missing-${site.node.id}`;
    // `@w:author` is REQUIRED by `CT_TrackChange`, and files from other generators omit it
    // anyway. Skipping those made the revision invisible in the pane AND invisible to
    // Accept All, which then reported success over a document that still held tracked
    // markup. It is listed instead, read-only, because there is no author to resolve it as.
    const author = wmlAttribute(site.node, 'author') ?? '';
    const authorless =
      wmlAttribute(site.node, 'author') === undefined && site.node.localName !== 'tblGridChange';
    const date = wmlAttribute(site.node, 'date');
    const address: RevisionAddress = date === undefined ? { id, author } : { id, author, date };

    const kind: ReviewRevisionKind = moveInsertions.has(site.node.id)
      ? 'insert'
      : site.propertyChange
        ? 'format'
        : site.paragraphMark
          ? 'paragraphMark'
          : (CONTENT_KINDS[site.node.kind] ?? 'structural');
    // The element name IS the decision for a mark, and it is the only place the direction
    // survives: `w:pPr/w:rPr` holds the revision as a bare element, not as a wrapper kind.
    const markDirection = site.paragraphMark ? MARK_DIRECTIONS[site.node.localName] : undefined;

    const structuralChange = kind === 'structural' ? structuralChangeOf(site) : undefined;
    // A change inside an equation sits where the equation does.
    // A change inside a complex field's result sits where the field does: the field reads as
    // one character, as a simple field does.
    const own = located.get(site.node.id);
    const field =
      own && own.start === own.end ? segments.fieldOf(site.node.id, site.parent) : undefined;
    const start =
      (field ? located.get(field) : undefined) ??
      own ??
      located.get(segments.equationOf(site.node.id, site.parent) ?? '');
    const end = moveRange?.end && located.get(moveRange.end.id);
    const where =
      start && end && start.paragraphId === end.paragraphId ? { ...start, end: end.end } : start;
    const range: ReviewRange | null = where
      ? {
          partName: part.name,
          start: { paragraphId: where.paragraphId, offset: where.start },
          end: { paragraphId: where.paragraphId, offset: where.end },
        }
      : null;

    if (
      hasParagraphMarks &&
      range &&
      (kind === 'paragraphMark' || kind === 'insert' || kind === 'delete')
    ) {
      previewByNode.set(site.node.id, {
        range,
        text: kind === 'paragraphMark' ? '\n' : siteText,
      });
    }

    // Keyed on the ELEMENT too. `@w:id` has no uniqueness constraint and Word writes one
    // date per editing burst, so an insertion and a deletion can legally share the triple —
    // and grouping on it alone showed them as one `insert` card with both texts run together,
    // whose Accept deleted the half the card claimed to be inserting.
    // A wrapper's edge or a field character ends a change: fragments on either side are two.
    const segment =
      kind === 'paragraphMark'
        ? segments.markSegmentOf(site.node.id, site.parent)
        : segments.segmentOf(site.node.id, site.parent);
    const sourceKey = `${sourceKeyOf(site.node, kind, address)}\u0000${segment}`;
    // Same attributes do not join text across an unchanged character.
    let key = currentInlineGroup.get(sourceKey) ?? sourceKey;
    const previous = byAddress.get(key);
    const previousEnd = previous?.ranges[previous.ranges.length - 1]?.end;
    if (
      (kind === 'insert' || kind === 'delete') &&
      range &&
      previousEnd &&
      previousEnd.paragraphId === range.start.paragraphId &&
      previousEnd.offset < range.start.offset
    ) {
      key = `${sourceKey}\u0000site-${site.node.id}`;
    }
    if (kind === 'insert' || kind === 'delete') currentInlineGroup.set(sourceKey, key);
    const existing = byAddress.get(key);
    if (existing) {
      existing.siteNodeIds.push(site.node.id);
      if (structuralChange && !existing.structuralChanges?.includes(structuralChange)) {
        (existing.structuralChanges ??= []).push(structuralChange);
      }
      if (site.propertyChange) {
        existing.formattingLanguages = [
          ...new Set([...(existing.formattingLanguages ?? []), ...changedLanguages(site)]),
        ];
        existing.formattingChanges = [
          ...new Map(
            [...(existing.formattingChanges ?? []), ...changedFormatting(site)].map((change) => [
              JSON.stringify(change),
              change,
            ])
          ).values(),
        ];
      }
      if (
        range &&
        !existing.ranges.some(
          (candidate) =>
            candidate.partName === range.partName &&
            candidate.start.paragraphId === range.start.paragraphId &&
            candidate.start.offset === range.start.offset &&
            candidate.end.paragraphId === range.end.paragraphId &&
            candidate.end.offset === range.end.offset
        )
      ) {
        existing.ranges.push(range);
      }
      if (kind !== 'structural' && existing.revisionKind === 'structural') {
        existing.revisionKind = kind;
      }
      // ANY refused site refuses the whole decision, matching `resolveRevisions`: resolving
      // only the sites the engine understands would leave a row half-tracked.
      existing.readOnly ||= site.refused || authorless;
      // The deepest site speaks for the decision. A group's sites can sit at different
      // depths, and the shallowest would make an enclosed change look unenclosed.
      if (site.nesting > existing.nesting) existing.nesting = site.nesting;
      if (kind === 'delete' || kind === 'moveFrom') existing.deletedText += siteText;
      else if (kind !== 'format' && kind !== 'paragraphMark') existing.text += siteText;
      continue;
    }
    byAddress.set(key, {
      address,
      localName: site.node.localName,
      // A change that a wrapper's edge or a field character divides names its first site in
      // every part, so deciding one part never hands its key to the next.
      ...(kind === 'insert' ||
      kind === 'delete' ||
      segment !== (kind === 'paragraphMark' ? '' : '\u0000')
        ? { identitySuffix: `\u0000site-${site.node.id}` }
        : {}),
      ...(structuralChange ? { structuralChanges: [structuralChange] } : {}),
      ...(site.propertyChange
        ? {
            formattingLanguages: changedLanguages(site),
            formattingChanges: changedFormatting(site),
          }
        : {}),
      revisionKind: kind,
      ...(markDirection ? { markDirection } : {}),
      author,
      ...(date === undefined ? {} : { date }),
      text:
        kind === 'format' || kind === 'paragraphMark' || kind === 'delete' || kind === 'moveFrom'
          ? ''
          : siteText,
      deletedText: kind === 'delete' || kind === 'moveFrom' ? siteText : '',
      ranges: range ? [range] : [],
      siteNodeIds: [site.node.id],
      nesting: site.nesting,
      // The resolver decides support; unaddressable records remain visible but read-only.
      readOnly: site.refused || authorless || sourceId === undefined,
    });
  }

  // A change split at a wrapper's edge or a field character is two items with one address:
  // each later one names its first site, so every key stays unique.
  const usedIds = new Set<string>();
  const items = [...byAddress.values()].map((entry): ReviewRevisionItem => {
    const base = `${entry.revisionKind}${entry.revisionKind === 'format' || entry.revisionKind === 'paragraphMark' ? `-${entry.localName}` : ''}-${part.name}\u0000${addressKey(entry.address)}${entry.identitySuffix ?? ''}`;
    const id = usedIds.has(base) ? `${base}\u0000site-${entry.siteNodeIds[0]}` : base;
    usedIds.add(id);
    return registerRevisionSiteNodeIds(
      {
        kind: 'revision' as const,
        // Include the part: body/header revisions can share id, author, and date.
        id,
        address: entry.address,
        addresses: [entry.address],
        revisionKind: entry.revisionKind,
        ...(entry.revisionKind === 'format' ? { formattingKind: entry.localName } : {}),
        ...(entry.structuralChanges?.length ? { structuralChanges: entry.structuralChanges } : {}),
        ...(entry.formattingChanges?.length ? { formattingChanges: entry.formattingChanges } : {}),
        ...(entry.formattingLanguages?.length
          ? { formattingLanguages: entry.formattingLanguages }
          : {}),
        ...(entry.markDirection ? { markDirection: entry.markDirection } : {}),
        author: entry.author,
        ...(entry.date === undefined ? {} : { date: entry.date }),
        text: entry.text || entry.deletedText,
        replacedText: '',
        ranges: entry.ranges,
        nesting: entry.nesting,
        readOnly: entry.readOnly,
        // Filled by `collectReviewItems`, which is the only place that sees the comments too.
        replyIds: [],
      },
      entry.siteNodeIds
    );
  });
  const order = dependencies.deepOrder(part);
  // Formatting on text and on the paragraph mark it reaches is one decision.
  const firstSite = (item: ReviewRevisionItem) => revisionSiteNodeIdsOf(item)[0] ?? '';
  const tableItems = mergeParagraphMarkFormatting(
    groupTableRevisions(part, items, sites, located, order, (item) =>
      segments.segmentOf(firstSite(item))
    ),
    part,
    sites,
    order
  );
  // Finish inline chains before a paragraph mark connects their endpoints. Otherwise a
  // cross-paragraph group jumps past the zero-width instruction/result wrappers inside
  // an atomic field, leaving those wrappers as separate review decisions.
  // Same-kind fragments remain one decision even when their source dates differ.
  const textItems = mergeParagraphBreakEdits(
    mergeAdjacentSameKindEdits(tableItems, order, (item) => segments.segmentOf(firstSite(item))),
    part,
    order,
    previewByNode,
    (item) =>
      item.revisionKind === 'paragraphMark'
        ? segments.markSegmentOf(firstSite(item))
        : segments.containerOf(firstSite(item)),
    sourceless
  );
  return mergeConsecutiveParagraphPropertyChanges(textItems, part, sites, order);
}

/**
 * Comment cards, threaded however the file says so and flat when nothing says so.
 *
 * ECMA-376 §17.13.4.2 gives `CT_Comment` no parent pointer, so threading is never something
 * the standard states outright. Three sources, strongest first: `@w15:paraIdParent`, then
 * `@w16cid:parentId` — both in namespaces outside Part 1 — and finally a COINCIDENT anchor, a
 * comment whose `w:commentRangeStart`/`End` cover exactly the characters an earlier comment's
 * cover. The ranges are Part 1's own vocabulary and the only part of a thread that survives a
 * producer dropping the extension parts. Coincidence is the last resort and never overrides a
 * stated link.
 *
 * Deliberately not containment. A remark on one word inside another remark's sentence nests
 * without being a reply, and reading that as a thread would bury an independent comment inside
 * someone else's.
 */
export function commentItemsOf(
  comments: readonly CommentRecord[],
  anchors: readonly {
    commentId: string;
    partName: string;
    start: ReviewPosition;
    end: ReviewPosition;
    orphaned: boolean;
  }[],
  threadState: ReadonlyMap<string, CommentThreadState>
): ReviewCommentItem[] {
  const anchorById = new Map(anchors.map((anchor) => [anchor.commentId, anchor]));
  const byParaId = new Map<string, CommentRecord>();
  const byId = new Map<string, CommentRecord>();
  for (const comment of comments) {
    if (comment.paraId) byParaId.set(comment.paraId.toUpperCase(), comment);
    byId.set(comment.id, comment);
  }

  // First comment authored on each exact span, in `comments.xml` order — a later comment on
  // that same span replies to it. Orphans are excluded: an unusable range is not a match.
  const firstOnSpan = new Map<string, string>();
  const coincidentParent = new Map<string, string>();
  for (const comment of comments) {
    const anchor = anchorById.get(comment.id);
    if (!anchor || anchor.orphaned) continue;
    // A ZERO-WIDTH range is evidence of nothing. Two comments that both cover no characters
    // sit at the same offset for any number of reasons — adjacent markers, a range the
    // producer wrote empty — and reading that as a thread put two unrelated authors in one
    // card. Only a range with characters in it can say "these two remarks are about the same
    // words".
    if (
      anchor.start.paragraphId === anchor.end.paragraphId &&
      anchor.start.offset === anchor.end.offset
    ) {
      continue;
    }
    const span =
      `${anchor.start.paragraphId}:${anchor.start.offset}` +
      `|${anchor.end.paragraphId}:${anchor.end.offset}`;
    if (!firstOnSpan.has(span)) firstOnSpan.set(span, comment.id);
    else coincidentParent.set(comment.id, firstOnSpan.get(span)!);
  }

  const parentOf = new Map<string, string>();
  for (const comment of comments) {
    const state = comment.paraId ? threadState.get(comment.paraId.toUpperCase()) : undefined;
    const stated = state?.parentParaId ? byParaId.get(state.parentParaId) : undefined;
    // A parent id pointing at a comment the file never defined is dropped, not carried: it
    // would produce a reply nested under a card that will never be rendered.
    const named = comment.parentCommentId ? byId.get(comment.parentCommentId) : undefined;
    // A `w15:commentEx` record for this comment settles the question either way: a record with
    // no `@paraIdParent` says top-level, and coincidence must not argue with it. Files exist
    // that carry a record per comment purely to hold `@w15:done` on a flat list.
    const shared = state === undefined ? coincidentParent.get(comment.id) : undefined;
    const inferred = shared ? byId.get(shared) : undefined;
    const parent = stated ?? named ?? inferred;
    if (parent && parent.id !== comment.id) parentOf.set(comment.id, parent.id);
  }
  // A file can still describe a cycle (A replies to B, B replies to A). Breaking it here keeps
  // the rail's "top-level cards only" filter from hiding every card in the loop.
  for (const child of [...parentOf.keys()]) {
    const seen = new Set<string>([child]);
    let walk = parentOf.get(child);
    while (walk !== undefined) {
      if (seen.has(walk)) {
        parentOf.delete(child);
        break;
      }
      seen.add(walk);
      walk = parentOf.get(walk);
    }
  }
  const repliesOf = new Map<string, string[]>();
  for (const [child, parent] of parentOf) {
    const bucket = repliesOf.get(parent);
    if (bucket) bucket.push(child);
    else repliesOf.set(parent, [child]);
  }

  return comments.map((comment) => {
    const anchor = anchorById.get(comment.id);
    const state = comment.paraId ? threadState.get(comment.paraId.toUpperCase()) : undefined;
    const parentId = parentOf.get(comment.id);
    return {
      kind: 'comment' as const,
      id: comment.id,
      comment,
      range: anchor ? { partName: anchor.partName, start: anchor.start, end: anchor.end } : null,
      resolved: state?.done ?? false,
      ...(parentId === undefined ? {} : { parentId }),
      replyIds: repliesOf.get(comment.id) ?? [],
      orphaned: anchor === undefined || anchor.orphaned,
    };
  });
}

/**
 * Everything the review surface lists, in document order.
 *
 * Order is by paragraph position within the story, then by offset. A comment and the revision
 * it covers therefore arrive together, which is what lets a surface group them. Furniture
 * stories rank after the body in one merged order — their geometry (the page they first paint
 * on) is a layout question the queue deliberately does not answer.
 */
export function collectReviewItems(input: ReviewModelInput): ReviewItem[] {
  return collectReviewItemsWith(input, interactiveReviewDerivation);
}

/** @internal */
export function collectReviewItemsWith(
  input: ReviewModelInput,
  dependencies: ReviewDerivationDependencies
): ReviewItem[] {
  // The body part deduped against the furniture list, so a caller passing a part twice —
  // or the same shared header under two sections — cannot double every card in it.
  const parts: OoxmlPart[] = [input.storyPart];
  const seen = new Set<string>([input.storyPart.name]);
  // Comment text holds tracked changes too; the comment cards come from the same part below.
  for (const part of [
    ...(input.furnitureParts ?? []),
    ...(input.stylesPart ? [input.stylesPart] : []),
    ...(input.commentsPart ? [input.commentsPart] : []),
  ]) {
    if (seen.has(part.name)) continue;
    seen.add(part.name);
    parts.push(part);
  }

  const comments = input.commentsPart ? commentsOfPart(input.commentsPart) : [];
  const threadState = input.commentsExtendedPart
    ? threadStateOfPart(input.commentsExtendedPart)
    : new Map<string, CommentThreadState>();

  // ONE anchor set across every story, then ONE pass over `comments.xml`. Collecting
  // per-story and concatenating listed each comment once per story — anchored in one,
  // orphaned in all the others.
  const revisions: ReviewRevisionItem[] = [];
  const anchors: ReturnType<typeof commentAnchorsOfStory> = [];
  // With one story there is nothing to merge: the memoized per-part order IS the order,
  // and copying it entry-by-entry was a measurable slice of every full derivation.
  const order: ReadonlyMap<string, number> =
    parts.length === 1 ? dependencies.deepOrder(parts[0]!) : new Map<string, number>();
  for (const part of parts) {
    // Loops, not `push(...spread)`: a heavily tracked part yields tens of thousands of
    // items, and spreading them as call arguments overflows the engine's argument limit.
    for (const item of revisionItemsOfWith(part, dependencies)) revisions.push(item);
    for (const anchor of dependencies.commentAnchors(part)) anchors.push(anchor);
    if (parts.length === 1) continue;
    const merged = order as Map<string, number>;
    const base = merged.size;
    for (const [id, position] of dependencies.deepOrder(part)) {
      if (!merged.has(id)) merged.set(id, base + position);
    }
  }

  const items: ReviewItem[] = linkRevisionReplies([
    ...revisions,
    ...commentItemsOf(comments, anchors, threadState),
  ]);
  return items.sort((a, b) => reviewItemPositionRank(a, order) - reviewItemPositionRank(b, order));
}

/**
 * The shape {@link linkRevisionReplies} needs, stated STRUCTURALLY.
 *
 * The store's queue is revisions and comments; the layout lane's adds a third kind for custom
 * nodes, and neither union is assignable to the other. Both lanes have to run this pass — the
 * store on the full derivation, the session on the locally patched list — so the pass is
 * written against the fields it actually reads rather than against either union, and hands
 * back the caller's own item type.
 */
export interface LinkableReviewItem {
  readonly kind: string;
  readonly id: string;
  readonly ranges?: readonly ReviewRange[];
  readonly range?: ReviewRange | null;
  readonly parentId?: string;
  readonly parentRevisionId?: string;
  readonly replyIds?: readonly string[];
  readonly orphaned?: boolean;
  /** How deeply a revision is nested; absent on the kinds that cannot nest. */
  readonly nesting?: number;
}

function normalizeRetainedCommentLinks<T extends LinkableReviewItem>(
  item: T,
  retainedCommentIds: ReadonlySet<string>
): T {
  if (item.kind !== 'comment') return item;
  const replyIds = item.replyIds ?? [];
  const retainedReplyIds = replyIds.filter((id) => retainedCommentIds.has(id));
  const parentWasRemoved = item.parentId !== undefined && !retainedCommentIds.has(item.parentId);
  if (!parentWasRemoved && retainedReplyIds.length === replyIds.length) return item;
  if (parentWasRemoved) {
    // Promote an answer whose thread head was filtered; rebuild its revision link below.
    const { parentId: _parentId, parentRevisionId: _parentRevisionId, ...rest } = item;
    return (
      retainedReplyIds.length === replyIds.length ? rest : { ...rest, replyIds: retainedReplyIds }
    ) as T;
  }
  return { ...item, replyIds: retainedReplyIds } as T;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1)
    if (left[index] !== right[index]) return false;
  return true;
}

/** A range as a comparable key, so "exactly these characters" is one lookup. */
function rangeKey(range: ReviewRange): string {
  return (
    `${range.partName}\u0000${range.start.paragraphId}:${range.start.offset}` +
    `|${range.end.paragraphId}:${range.end.offset}`
  );
}

/**
 * Attach each comment that answers a tracked change to the change it answers.
 *
 * A matching non-empty RANGE is the evidence. A stated comment reply beats an inferred revision
 * link, and the deepest revision on a shared span wins to match click targeting.
 *
 * The WHOLE conversation moves, not its head. A change's card renders `replyIds` as a flat list,
 * so linking only the top comment of a thread left every answer to that answer rendered by
 * nobody. Descendants ride along in authoring order.
 *
 * The pass is idempotent: every link is rebuilt from ranges, so locally patched queues cannot
 * retain stale `parentRevisionId` values after edits move a revision.
 */
export function linkRevisionReplies<T extends LinkableReviewItem>(items: readonly T[]): T[] {
  const retainedCommentIds = new Set<string>();
  for (const item of items) {
    if (item.kind === 'comment') retainedCommentIds.add(item.id);
  }
  const retainedItems = items.map((item) =>
    normalizeRetainedCommentLinks(item, retainedCommentIds)
  );
  // Only a span some comment can claim is ever looked up: keying every revision's range built
  // a string per change per keystroke on documents with thousands of changes and no answers.
  const claimableStarts = new Set<string>();
  for (const item of retainedItems) {
    if (item.kind === 'comment' && item.parentId === undefined && !item.orphaned && item.range)
      claimableStarts.add(item.range.start.paragraphId);
  }
  const revisionBySpan = new Map<string, { readonly id: string; readonly nesting: number }>();
  for (const item of claimableStarts.size > 0 ? retainedItems : []) {
    if (item.kind !== 'revision') continue;
    for (const range of item.ranges ?? []) {
      if (
        !claimableStarts.has(range.start.paragraphId) ||
        (range.start.paragraphId === range.end.paragraphId &&
          range.start.offset === range.end.offset)
      ) {
        continue;
      }
      const key = rangeKey(range);
      const nesting = item.nesting ?? 0;
      const held = revisionBySpan.get(key);
      // DEEPEST wins, not first seen. Two changes can share one exact span — `w:ins` wrapping
      // `w:del` — and the reply has to hang on the same card a click on those characters opens,
      // which is the innermost one. First-seen picked the wrapper, so the card the reader was
      // answering and the card their answer appeared under were different cards.
      if (held === undefined || nesting > held.nesting) {
        revisionBySpan.set(key, { id: item.id, nesting });
      }
    }
  }

  // Comment threads as the derivation stated them, so a claimed head brings its answers.
  const commentRepliesOf = new Map<string, readonly string[]>();
  for (const item of retainedItems) {
    if (item.kind === 'comment' && item.replyIds && item.replyIds.length > 0) {
      commentRepliesOf.set(item.id, item.replyIds);
    }
  }
  const descendantsOf = (rootId: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>([rootId]);
    const queue = [...(commentRepliesOf.get(rootId) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      queue.push(...(commentRepliesOf.get(next) ?? []));
    }
    return out;
  };

  const repliesOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const item of retainedItems) {
    if (item.kind !== 'comment' || item.parentId !== undefined) continue;
    if (item.orphaned || !item.range) continue;
    const revisionId = revisionBySpan.get(rangeKey(item.range))?.id;
    if (revisionId === undefined) continue;
    const thread = [item.id, ...descendantsOf(item.id)];
    for (const id of thread) parentOf.set(id, revisionId);
    const bucket = repliesOf.get(revisionId);
    if (bucket) bucket.push(...thread);
    else repliesOf.set(revisionId, thread);
  }

  return retainedItems.map((item) => {
    if (item.kind === 'revision') {
      const replies = repliesOf.get(item.id) ?? [];
      // Unchanged links keep the item, so every identity-keyed read of it stays warm.
      if (sameIds(replies, item.replyIds ?? [])) return item;
      return registerRevisionSiteNodeIds(
        { ...item, replyIds: replies },
        revisionSiteNodeIdsOf(item)
      );
    }
    if (item.kind === 'comment') {
      const parent = parentOf.get(item.id);
      if (parent === undefined) {
        if (item.parentRevisionId === undefined) return item;
        // Rebuilt, not patched: the key has to GO, and spreading cannot remove one.
        const { parentRevisionId: _dropped, ...rest } = item;
        return rest as T;
      }
      return item.parentRevisionId === parent ? item : { ...item, parentRevisionId: parent };
    }
    return item;
  });
}
