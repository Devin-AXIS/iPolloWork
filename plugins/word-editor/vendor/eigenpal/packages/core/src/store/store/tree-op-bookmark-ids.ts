// Minting `@w:id` values for NEW bookmarks — the id space TOC insert and refresh draw on.
//
// Split from `tree-op-toc.ts`, which owns placement; this module owns only "which bookmark
// id is free in this part". Same actor as revisions and comments: the store transaction's
// `actorId`, resolved through `resolveAllocationActor`. A second identity here would let two
// peers agree on a bookmark `@w:id` while their revision ids stayed striped.

import {
  MAX_DECIMAL_ID,
  nextStripedDecimalId,
  resolveAllocationActor,
} from '../package/actor-scoped-ids.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';

/**
 * The next free bookmark `@w:id` in this part.
 *
 * `ST_DecimalNumber`, and Word reads it as a signed 32-bit integer. Solo documents take the
 * lowest unused id starting at 1 — that is what `insertBookmarks` minted before striping, so
 * a file with a gap at 2 keeps minting 2, not one past the highest. Counting past a 23-digit
 * attacker-controlled `@w:id` once produced `w:id="1e+22"`, which Word calls unreadable.
 *
 * When a collaboration actor is bound on the store transaction, the next id is the next
 * unused value in that actor's stripe. Two peers inserting or refreshing a TOC from the
 * same snapshot then cannot share an `@w:id`.
 */
export function nextBookmarkId(part: OoxmlPart, actorId?: string): () => string {
  const used = usedBookmarkIds(part);
  const actor = resolveAllocationActor(actorId);
  if (actor) {
    const striped = stripedBookmarkIds(used);
    return () => {
      const id = nextStripedDecimalId(striped, actor, MAX_DECIMAL_ID);
      striped.add(id);
      used.add(id);
      return id;
    };
  }
  let next = 1;
  return () => {
    while (used.has(String(next))) next += 1;
    // Past the signed 32-bit ceiling there is no "one higher" that Word will read. Wrapping
    // to the lowest unused id keeps a crafted `@w:id` from forcing `w:id="1e+22"`.
    if (next > MAX_DECIMAL_ID) {
      for (let candidate = 1; candidate <= MAX_DECIMAL_ID; candidate += 1) {
        if (!used.has(String(candidate))) {
          used.add(String(candidate));
          return String(candidate);
        }
      }
      throw new TypeError('no free bookmark id');
    }
    const id = String(next++);
    used.add(id);
    return id;
  };
}

/** Every bookmark `@w:id` string in use. Raw values, so solo occupancy stays byte-identical. */
function usedBookmarkIds(part: OoxmlPart): Set<string> {
  const used = new Set<string>();
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'bookmarkStart' || node.localName === 'bookmarkEnd') {
      for (const attribute of node.attributes) {
        if (attribute.localName !== 'id') continue;
        if (attribute.value) used.add(attribute.value);
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return used;
}

/**
 * Occupied ids a striped mint must skip.
 *
 * Hostile or out-of-range values are ignored for seeding rather than counted past. A
 * leading-zero twin (`"07"`) is also recorded as `"7"` so a stripe that lands on 7 does
 * not reuse an id Word treats as the same integer.
 */
function stripedBookmarkIds(used: ReadonlySet<string>): Set<string> {
  const striped = new Set<string>();
  for (const raw of used) {
    striped.add(raw);
    if (!/^\d{1,10}$/.test(raw)) continue;
    const value = Number(raw);
    if (value <= MAX_DECIMAL_ID) striped.add(String(value));
  }
  return striped;
}
