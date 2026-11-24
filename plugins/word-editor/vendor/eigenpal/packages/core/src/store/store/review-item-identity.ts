// A re-derived review queue hands back the previous object for every card that did not change.

import { revisionSiteNodeIdsOf, type ReviewRevisionItem } from './review-items.ts';
import { setLatestPerPart } from './latest-per-part.ts';

/**
 * `WeakRef` is ES2021 and the workspace tsconfigs pin `lib` at ES2020, so the global is
 * declared here, as `recent-root-cache.ts` does.
 */
interface ItemsWeakRef {
  deref(): readonly ReviewRevisionItem[] | undefined;
}
declare const WeakRef: new (target: readonly ReviewRevisionItem[]) => ItemsWeakRef;

/** Values compared per card before it is treated as changed. */
const COMPARISON_BUDGET = 4_096;

function plainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/** Arrays and plain objects by content, anything else by identity. */
function samePlainData(left: unknown, right: unknown, budget: { left: number }): boolean {
  if (left === right) return true;
  if (--budget.left < 0) return false;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null)
    return false;
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1)
      if (!samePlainData(left[index], right[index], budget)) return false;
    return true;
  }
  if (Array.isArray(right) || !plainObject(left) || !plainObject(right)) return false;
  // Counted, not listed: a card has a dozen keys and this runs once per card per derivation.
  let keys = 0;
  for (const key in left) {
    if (!hasOwn(left, key)) continue;
    keys += 1;
    const a = (left as Record<string, unknown>)[key];
    const b = (right as Record<string, unknown>)[key];
    if (a === b && (a !== undefined || hasOwn(right, key))) continue;
    if (!hasOwn(right, key) || !samePlainData(a, b, budget)) return false;
  }
  for (const key in right) if (hasOwn(right, key)) keys -= 1;
  return keys === 0;
}

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const budget = { left: 0 };

function sameCard(previous: ReviewRevisionItem, next: ReviewRevisionItem): boolean {
  budget.left = COMPARISON_BUDGET;
  return (
    samePlainData(previous, next, budget) &&
    samePlainData(revisionSiteNodeIdsOf(previous), revisionSiteNodeIdsOf(next), budget)
  );
}

/** The last queue per part name, held weakly: a closed document keeps nothing alive here. */
const lastQueues = new Map<string, ItemsWeakRef>();

/**
 * `next` with every card equal to one in the part's previous queue replaced by that object.
 *
 * A tree change re-derives the whole queue, and every card came back as a new object although
 * almost none of them changed. Everything downstream keys on the card object — rail placements,
 * geometry, rendered cards — so one accept rebuilt thousands of them. An equal card is the same
 * data under the same site nodes, so handing back the old object changes no answer.
 */
export function withStableCards(
  partName: string,
  next: readonly ReviewRevisionItem[]
): readonly ReviewRevisionItem[] {
  const previous = lastQueues.get(partName)?.deref();
  let result = next;
  if (previous && previous.length > 0 && next.length > 0) {
    const byId = new Map<string, ReviewRevisionItem>();
    for (const card of previous) byId.set(card.id, card);
    let unchanged = previous.length === next.length;
    const stable = next.map((card, index) => {
      const old = byId.get(card.id);
      const kept = old && sameCard(old, card) ? old : card;
      if (kept !== previous[index]) unchanged = false;
      return kept;
    });
    result = unchanged ? previous : stable;
  }
  setLatestPerPart(lastQueues, partName, new WeakRef(result));
  return result;
}
