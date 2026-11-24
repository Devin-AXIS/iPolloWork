// Query-time narrowing of the review queue: revision-kind exclusion and replacement pairing
// for `getReviewItems(query)`. Pairing is the default; `pairReplacements: false` opts out.
//
// A pair is a READ-SIDE decision. The store keeps the deletion and the insertion as two
// revisions; a pair item lists both halves' addresses and canonical sites, so resolving it
// issues the same accept/reject ops a host would issue for the halves, in one transaction.

import type { ReviewItemPlacement, ReviewItemQuery } from '../contracts/editor.ts';
import type {
  ReviewChangesResolvedEvent,
  ReviewItemRevealEvent,
} from '../contracts/editor-events.ts';
import {
  isReplacementPair,
  REPLACEMENT_PAIR_ID_PREFIX,
  registerRevisionSiteNodeIds,
  replacementPairId,
  reviewItemKey,
  revisionSiteNodeIdsOf,
  type ReviewItem,
  type ReviewRevisionItem,
} from '../store/store/review-items.ts';

const PAIR_KEY_PREFIX = `revision-${REPLACEMENT_PAIR_ID_PREFIX}`;

/** The two store revisions one paired replacement stands for. */
export interface ReplacementHalves {
  readonly deletion: ReviewRevisionItem;
  readonly insertion: ReviewRevisionItem;
}

const halvesOf = new WeakMap<object, ReplacementHalves>();

/** The halves of a paired replacement, or null for every other item. */
export function replacementPairHalves(item: ReviewItem | undefined): ReplacementHalves | null {
  return item ? (halvesOf.get(item) ?? null) : null;
}

/** The item followed by its halves when it is a pair, for checks that must hold for all. */
export function reviewItemWithHalves(item: ReviewItem): readonly ReviewItem[] {
  const halves = halvesOf.get(item);
  return halves ? [item, halves.deletion, halves.insertion] : [item];
}

const pairable = isReplacementPair;

/** Pairs by deletion, so one queue revision yields the same pair object on every read. */
const pairCache = new WeakMap<ReviewRevisionItem, ReviewRevisionItem>();

function pairOf(
  deletion: ReviewRevisionItem,
  insertion: ReviewRevisionItem,
  /** The half that comes first in the document: the pair sits where it does. */
  first: ReviewRevisionItem
): ReviewRevisionItem {
  const cached = pairCache.get(deletion);
  if (cached && halvesOf.get(cached)?.insertion === insertion) return cached;
  const date = insertion.date ?? deletion.date;
  const pair: ReviewRevisionItem = {
    kind: 'revision',
    id: replacementPairId(deletion.id, insertion.id),
    address: first.address,
    addresses: [...deletion.addresses, ...insertion.addresses],
    replacedText: deletion.text,
    revisionKind: 'replace',
    author: insertion.author,
    ...(date !== undefined ? { date } : {}),
    text: insertion.text,
    ranges: [...deletion.ranges, ...insertion.ranges],
    nesting: deletion.nesting,
    replacedRangeCount: deletion.ranges.length,
    readOnly: deletion.readOnly || insertion.readOnly,
    replyIds: [...deletion.replyIds, ...insertion.replyIds],
  };
  halvesOf.set(pair, { deletion, insertion });
  pairCache.set(deletion, pair);
  return registerRevisionSiteNodeIds(pair, [
    ...revisionSiteNodeIdsOf(deletion),
    ...revisionSiteNodeIdsOf(insertion),
  ]);
}

/**
 * Replace each deletion and the touching insertion from the same author next to it, in either
 * order, among the queue's revisions, with one `replace` item at the first half's position.
 */
function pairReplacements(items: readonly ReviewItem[]): {
  readonly items: readonly ReviewItem[];
  readonly renamed: ReadonlyMap<string, string>;
} {
  const revisions = items.filter((item): item is ReviewRevisionItem => item.kind === 'revision');
  const pairs = new Map<ReviewItem, ReviewRevisionItem>();
  const absorbed = new Set<ReviewItem>();
  const renamed = new Map<string, string>();
  for (let index = 0; index + 1 < revisions.length; index += 1) {
    const first = revisions[index]!;
    const second = revisions[index + 1]!;
    const insertionFirst = first.revisionKind === 'insert';
    // A deletion with the insertion after it, as typing over a selection writes, pairs first:
    // an insertion before that deletion stays its own change, as it was before compare pairs.
    const next = revisions[index + 2];
    if (insertionFirst && next && pairable(second, next)) continue;
    // The pair takes the place of whichever half comes first.
    const [deletion, insertion] = insertionFirst ? [second, first] : [first, second];
    if (!pairable(deletion, insertion)) continue;
    const pair = pairOf(deletion, insertion, first);
    pairs.set(first, pair);
    absorbed.add(second);
    renamed.set(deletion.id, pair.id);
    renamed.set(insertion.id, pair.id);
    index += 1;
  }
  if (pairs.size === 0) return { items, renamed };
  const next: ReviewItem[] = [];
  for (const item of items) {
    if (absorbed.has(item)) continue;
    next.push(pairs.get(item) ?? item);
  }
  return { items: next, renamed };
}

/**
 * Apply a query's revision-kind exclusion and replacement pairing to the queue.
 *
 * Excluded kinds leave first, so an excluded deletion or insertion never pairs. Pairs then
 * honor an exclusion of `'replace'`. A comment answering a half answers its pair, and a
 * comment answering a change the query dropped becomes a top-level card again.
 */
export function narrowReviewItems(
  items: readonly ReviewItem[],
  query: ReviewItemQuery | undefined
): readonly ReviewItem[] {
  // The rail, commands and highlights each narrow the same queue several times per commit.
  // The answer depends on the queue and these two query fields only.
  const key = `${pairsReplacementsUnder(query)}|${[...(query?.excludeRevisionKinds ?? [])].sort().join(',')}`;
  let byQuery = narrowedQueues.get(items);
  const known = byQuery?.get(key);
  if (known) return known;
  const narrowed = narrowUncached(items, query);
  if (!byQuery) narrowedQueues.set(items, (byQuery = new Map()));
  byQuery.set(key, narrowed);
  return narrowed;
}

/** Narrowed queues per queue, weakly: they go with the queue they were narrowed from. */
const narrowedQueues = new WeakMap<readonly ReviewItem[], Map<string, readonly ReviewItem[]>>();

function narrowUncached(
  items: readonly ReviewItem[],
  query: ReviewItemQuery | undefined
): readonly ReviewItem[] {
  const excluded = new Set(query?.excludeRevisionKinds ?? []);
  const keep = (item: ReviewItem): boolean =>
    item.kind !== 'revision' || !excluded.has(item.revisionKind);
  let next = excluded.size > 0 ? items.filter(keep) : items;
  let renamed: ReadonlyMap<string, string> = new Map();
  if (pairsReplacementsUnder(query)) {
    const paired = pairReplacements(next);
    renamed = paired.renamed;
    next = excluded.size > 0 ? paired.items.filter(keep) : paired.items;
  }
  if (excluded.size === 0 && renamed.size === 0) return next;
  // A comment that answers a change this QUERY dropped is a top-level card again. The link is
  // only a reason to render the comment inside the change's card, so publishing it beside a
  // change the caller cannot see makes the comment unrenderable: the rail skips it as a reply
  // and no card claims it. The rail hides `format` and `structural` by default, and a tracked
  // formatting change anchors on exactly the run it decorates, so this is the ordinary case.
  const present = new Set(next.filter((item) => item.kind === 'revision').map((item) => item.id));
  return next.map((item) => {
    if (item.kind !== 'comment' || item.parentRevisionId === undefined) return item;
    const parent = renamed.get(item.parentRevisionId) ?? item.parentRevisionId;
    if (present.has(parent)) {
      return parent === item.parentRevisionId ? item : { ...item, parentRevisionId: parent };
    }
    const { parentRevisionId: _dropped, ...rest } = item;
    return rest;
  });
}

/**
 * The keys the open item lights on the page: its own and, when `pairs` is set, the other half
 * of its replacement. Uses the same pairing as `pairReplacements`, so the page lights what
 * the paired card shows. `items` is read only for a revision, and only when pairing.
 */
export function litReviewKeys(
  items: () => readonly ReviewItem[],
  activeKey: string | null,
  pairs: boolean | undefined
): ReadonlySet<string> {
  if (activeKey === null) return new Set();
  const partner = pairs ? replacementPartnerKey(items(), activeKey) : null;
  return new Set(partner === null ? [activeKey] : [activeKey, partner]);
}

/** The key of the other half of the replacement `key` belongs to among `items`, or null. */
function replacementPartnerKey(items: readonly ReviewItem[], key: string): string | null {
  for (const item of pairReplacements(items).items) {
    const halves = halvesOf.get(item);
    if (!halves) continue;
    const deletion = reviewItemKey(halves.deletion);
    const insertion = reviewItemKey(halves.insertion);
    if (deletion === key) return insertion;
    if (insertion === key) return deletion;
  }
  return null;
}

/**
 * Which activation opened a whole replacement. The surface pins the deletion either way, so
 * this tells "open the pair" from "open the deletion": only the first lights both halves.
 */
export function createPairedActivation(
  /** True when the review UI shows every replacement as one card. */
  paneLightsPairs: () => boolean,
  surface: () => { activatedReviewKey(): string | null } | null
): {
  /**
   * Record the pinned deletion key of a pair activation, or null for any other activation.
   * Returns `pinKey`.
   */
  set(pinKey: string | null): string | null;
  /** Whether the active band covers both halves of a replacement right now. */
  lightsPair(): boolean;
} {
  let pin: string | null = null;
  return {
    set: (pinKey) => (pin = pinKey),
    lightsPair: () =>
      paneLightsPairs() || (pin !== null && surface()?.activatedReviewKey() === pin),
  };
}

/** Whether `query` pairs replacements. It does unless it sets `pairReplacements: false`. */
export function pairsReplacementsUnder(query: ReviewItemQuery | undefined): boolean {
  return query?.pairReplacements !== false;
}

/** True for a key only a paired query produces. */
export function isReplacementPairKey(key: string): boolean {
  return key.startsWith(PAIR_KEY_PREFIX);
}

/**
 * The placement a key names, for key-addressed verbs that need the item and not its geometry.
 * A paired key only exists in a paired read, so it is looked up there directly, whatever
 * query produced it. One read per call, without the layout pass.
 */
export function findReviewPlacement(
  placements: (query?: ReviewItemQuery) => readonly ReviewItemPlacement[],
  key: string
): ReviewItemPlacement | undefined {
  const query: ReviewItemQuery = {
    placement: false,
    pairReplacements: isReplacementPairKey(key),
  };
  return placements(query).find((entry) => entry.key === key);
}

/** The store keys a resolution must cover: the halves of a pair, else the item itself. */
export function resolutionKeysOf(item: ReviewItem): readonly string[] {
  const halves = halvesOf.get(item);
  return halves
    ? [reviewItemKey(halves.deletion), reviewItemKey(halves.insertion)]
    : [reviewItemKey(item)];
}

/**
 * The key `query` reads for the review item whose store key is `key`: when the query pairs
 * replacements, which it does unless it sets `pairReplacements: false`, the pair a deletion
 * or insertion belongs to; otherwise `key` itself.
 */
export function keyUnderQuery(
  placements: (query?: ReviewItemQuery) => readonly ReviewItemPlacement[],
  key: string | null,
  query: ReviewItemQuery | undefined
): string | null {
  if (key === null || !pairsReplacementsUnder(query)) return key;
  const pair = placements({ ...query, placement: false }).find(
    (entry) =>
      isReplacementPairKey(entry.key) && resolutionKeysOf(entry.item as ReviewItem).includes(key)
  );
  return pair?.key ?? key;
}

/**
 * A reveal event with `pairKey` set when its item is a paired replacement or one half of
 * one. The event names a store key, so a host that lists pairs needs the pair's key to find
 * the item. One paired read per reveal; reveals are single user actions.
 */
export function withRevealPairKey(
  placements: (query?: ReviewItemQuery) => readonly ReviewItemPlacement[],
  event: ReviewItemRevealEvent
): ReviewItemRevealEvent {
  const pairKey = isReplacementPairKey(event.key)
    ? event.key
    : keyUnderQuery(placements, event.key, { pairReplacements: true });
  return pairKey !== null && isReplacementPairKey(pairKey) ? { ...event, pairKey } : event;
}

/** The bulk decision event with each skipped half's pair key, as a reveal carries it. */
export function withSkippedPairKeys(
  placements: (query?: ReviewItemQuery) => readonly ReviewItemPlacement[],
  event: ReviewChangesResolvedEvent
): ReviewChangesResolvedEvent {
  if (!event.skipped.length) return event;
  // One paired read for the whole decision, however many changes it skipped.
  const pairOf = new Map<string, string>();
  for (const entry of placements({ placement: false, pairReplacements: true })) {
    if (!isReplacementPairKey(entry.key)) continue;
    for (const half of resolutionKeysOf(entry.item as ReviewItem)) pairOf.set(half, entry.key);
  }
  return {
    ...event,
    skipped: event.skipped.map((skip) => {
      const pairKey = pairOf.get(skip.key);
      return pairKey === undefined ? skip : { ...skip, pairKey };
    }),
  };
}

const keyedQueues = new WeakMap<readonly ReviewItem[], ReadonlyMap<string, ReviewItem>>();

/** Each item by its store key, built once per queue (weakly, so it goes with the queue). */
export function reviewItemsByKey(items: readonly ReviewItem[]): ReadonlyMap<string, ReviewItem> {
  let byKey = keyedQueues.get(items);
  if (!byKey) {
    const map = new Map<string, ReviewItem>();
    for (const item of items) map.set(reviewItemKey(item), item);
    keyedQueues.set(items, (byKey = map));
  }
  return byKey;
}
