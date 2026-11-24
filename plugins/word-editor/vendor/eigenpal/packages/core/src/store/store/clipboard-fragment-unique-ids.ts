// The document-unique id namespaces ONE clipboard paste has to freshen: bookmark `@w:id`,
// revision `@w:id`, and `wp:docPr/@id`.
//
// Split out of `clipboard-fragment-merge.ts` (max-lines cap) when the three counters stopped
// being `++` walks. Each one seeded from "one past the highest in the target" and then counted
// up. That is Word's own sequence and exactly what two replicas compute identically from one
// snapshot: both peers paste the same picture and both call it `wp:docPr/@id="6"`. The tree
// converges, so nothing reports it — only the id namespace is wrong, and only the merged
// document shows it. Word treats a `docPr` id as document-global and renumbers on open, a
// shared bookmark id makes one hyperlink resolve to the other peer's marker, and a shared
// revision id makes Accept on your insertion accept theirs.
//
// With a collaboration actor bound, every id here comes from that actor's residue class
// (`id % ACTOR_ID_STRIPE === actorStripe(actor)`), so no other actor's stripe can contain it.
// Striping only the SEED is not enough and is worse than nothing: seed in the stripe, then
// `++`, and the second id has already left it while the code reads as striped. With no actor
// bound — a solo author, Word's case — every family keeps its dense `seed, seed + 1, …` walk
// byte for byte, because a file nobody is collaborating on is the fidelity baseline.

import {
  MAX_DECIMAL_ID,
  resolveAllocationActor,
  stripedDecimalIdSequence,
} from '../package/actor-scoped-ids.ts';
import {
  MAX_UNSIGNED_INT,
  allocateDrawingPropertyId,
  drawingPropertyIdOccupancy,
} from '../package/drawing-package-edit.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { attributeValueOf } from './tree-op-nodes.ts';
import { walkAll } from './clipboard-fragment-defaults.ts';
import { carriesRevisionId } from './tree-op-revision-ids.ts';

/**
 * The `docPr` seed when `allocateDrawingPropertyId` refuses, unchanged from the `++` walk.
 *
 * It refuses when the package already holds an id at the `xsd:unsignedInt` ceiling. Jumping
 * clear of Word's dense range has always been this lane's answer to that, rather than refusing
 * a paste over one hostile `@id`.
 */
const DOC_PR_FALLBACK_SEED = 100_000;

export interface FragmentUniqueIdRequest {
  /** The working package the merge has built so far. */
  readonly pkg: OoxmlPackage;
  /** The story part the blocks land in. */
  readonly ownerPart: OoxmlPart;
  /** Target note parts taking transplanted bodies — the same id spaces as the owner part. */
  readonly notesParts: readonly OoxmlPart[];
  /** Blocks plus note bodies: everything whose ids are about to be rewritten. */
  readonly travelling: readonly OoxmlNode[];
  /** Fragment-side bookmark ids in first-appearance order; empty when it carries none. */
  readonly fragmentBookmarkIds: readonly string[];
  readonly hasRevision: boolean;
  readonly hasDocPr: boolean;
}

/** Fragment id → target id, one map per namespace, ready for `rewriteIdentifiers`. */
export interface FragmentUniqueIdMaps {
  readonly bookmarkIds: Map<string, string>;
  readonly revisionIds: Map<string, string>;
  readonly docPrIds: Map<string, string>;
}

/**
 * Freshen every unique-id namespace the fragment carries.
 *
 * `null` when a namespace has no id left to mint. Under an actor that means the stripe is
 * full: `MAX_DECIMAL_ID / ACTOR_ID_STRIPE` is 32,768 slots and a fragment may legally carry a
 * quarter of a million ids, so it is reachable from a crafted payload. The caller refuses the
 * paste, because the alternatives are handing back an id the document already uses or leaving
 * the stripe — and both of those are the collision this module exists to prevent.
 */
export function mintFragmentUniqueIds(
  request: FragmentUniqueIdRequest
): FragmentUniqueIdMaps | null {
  // The actor the open store transaction bound, resolved ONCE so the three families cannot
  // disagree about whether this paste is collaborative.
  const actor = resolveAllocationActor();
  const bookmarkIds = mintBookmarkIds(request, actor);
  const revisionIds = mintRevisionIds(request, actor);
  const docPrIds = mintDocPrIds(request, actor);
  if (!bookmarkIds || !revisionIds || !docPrIds) return null;
  return { bookmarkIds, revisionIds, docPrIds };
}

/**
 * One paste's id sequence for a namespace: the actor's stripe, or Word's dense walk.
 *
 * The dense walk carries no ceiling on purpose. `seed, seed + 1, …` is what a solo paste has
 * always written, and a solo document's ids are the thing this change must not move.
 */
function idSequence(
  actor: string | undefined,
  used: ReadonlySet<string>,
  denseSeed: number,
  max: number
): () => string | null {
  if (actor) return stripedDecimalIdSequence(used, actor, max);
  let next = denseSeed;
  // The seed sits above every id of its own kind, but `wp:docPr` also skips the legacy VML
  // shape numbers `drawingPropertyIdOccupancy` marks used, which can lie above it.
  return () => {
    while (used.has(String(next))) next += 1;
    return next > max ? null : String(next++);
  };
}

/**
 * Record an occupied id under every spelling Word reads as the same integer.
 *
 * `"07"` and `"7"` are one id, so a stripe that lands on 7 must not reuse a marker spelled
 * with a leading zero — the same normalization `tree-op-bookmark-ids.ts` applies before it
 * stripes. A value that is not a 1-to-10-digit integer is recorded raw and never normalized:
 * a 23-digit attacker-controlled `@w:id` is not a number to reason about.
 */
function recordUsed(used: Set<string>, raw: string): void {
  used.add(raw);
  if (!/^\d{1,10}$/.test(raw)) return;
  const value = Number(raw);
  if (value <= MAX_DECIMAL_ID) used.add(String(value));
}

/** The dense seed's rule, kept identical: `Number()`, integers only, highest wins. */
function raiseHighest(highest: number, raw: string | undefined): number {
  if (raw === undefined) return highest;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > highest ? parsed : highest;
}

/**
 * Bookmark `@w:id`, over the owner part and every notes part a transplant lands in.
 *
 * No reserved value: `ST_DecimalNumber` admits 0, Word writes `_GoBack` with `w:id="0"`, and
 * `tree-op-bookmark-ids.ts` already lets a stripe-0 actor take it. So a striped paste may mint
 * 0 where the dense walk (seeded at `highest + 1`, and `highest` starts at 0) never could.
 * Occupancy is what keeps that safe, not a reservation.
 */
function mintBookmarkIds(
  request: FragmentUniqueIdRequest,
  actor: string | undefined
): Map<string, string> | null {
  const map = new Map<string, string>();
  if (request.fragmentBookmarkIds.length === 0) return map;
  let highest = 0;
  const used = new Set<string>();
  for (const part of [request.ownerPart, ...request.notesParts]) {
    walkAll([part.root], (node) => {
      if (node.kind !== 'bookmarkStart' && node.kind !== 'bookmarkEnd') return;
      const raw = attributeValueOf(node, 'id');
      if (raw === undefined) return;
      // Occupancy covers `w:bookmarkEnd` too — an orphaned end marker holds its id — while
      // `highest` counts starts only, which is the scan the dense seed has always used.
      recordUsed(used, raw);
      if (node.kind === 'bookmarkStart') highest = raiseHighest(highest, raw);
    });
  }
  const next = idSequence(actor, used, highest + 1, MAX_DECIMAL_ID);
  for (const id of request.fragmentBookmarkIds) {
    if (map.has(id)) continue;
    const minted = next();
    if (minted === null) return null;
    map.set(id, minted);
  }
  return map;
}

/**
 * Revision `@w:id`, in first-appearance order over the travelling content.
 *
 * No reserved value here either: Word numbers revisions from 0 and only ever compares them for
 * equality.
 *
 * Membership is `carriesRevisionId`, the same predicate `rewriteIdentifiers` rewrites through,
 * because the two must agree exactly. Matching the typed KIND instead covers only the four
 * content wrappers, so a pasted `w:rPrChange` would be rewritten against a map that never
 * minted for it and would keep the id it was copied from — one review card over both the
 * original and the copy. It also keeps a striped id off an existing `w:cellIns`, which would
 * otherwise make the pasted content a member of a tracked row insertion.
 */
function mintRevisionIds(
  request: FragmentUniqueIdRequest,
  actor: string | undefined
): Map<string, string> | null {
  const map = new Map<string, string>();
  if (!request.hasRevision) return map;
  let highest = 0;
  const used = new Set<string>();
  for (const part of [request.ownerPart, ...request.notesParts]) {
    const owner = part === request.ownerPart;
    walkAll([part.root], (node) => {
      if (!carriesRevisionId(node)) return;
      const raw = attributeValueOf(node, 'id');
      if (raw !== undefined) recordUsed(used, raw);
      // The dense seed reads the OWNER part only, which is what the `++` walk it replaced did.
      if (owner) highest = raiseHighest(highest, raw);
    });
  }
  const next = idSequence(actor, used, highest + 1, MAX_DECIMAL_ID);
  let exhausted = false;
  walkAll(request.travelling, (node) => {
    if (exhausted || !carriesRevisionId(node)) return;
    const id = attributeValueOf(node, 'id');
    if (id === undefined || map.has(id)) return;
    const minted = next();
    if (minted === null) exhausted = true;
    else map.set(id, minted);
  });
  return exhausted ? null : map;
}

/**
 * `wp:docPr/@id`, package-wide because Word treats these ids as document-global.
 *
 * `0` IS reserved: it is a legal `xsd:unsignedInt` that `parseValidDocPrId` refuses, so
 * `drawingPropertyIdOccupancy` seeds it as used and a stripe-0 actor skips past it. That
 * occupancy is the same one `allocateDrawingPropertyId` allocates against, which is why the
 * first id a striped paste mints is exactly the id that function would have returned — only
 * the second and later ones move, out of the `++` walk and into the stripe.
 */
function mintDocPrIds(
  request: FragmentUniqueIdRequest,
  actor: string | undefined
): Map<string, string> | null {
  const map = new Map<string, string>();
  if (!request.hasDocPr) return map;
  const { used } = drawingPropertyIdOccupancy(request.pkg);
  // Asked only for the dense walk. Under an actor the seed is never read, and
  // `allocateDrawingPropertyId` would answer with the stripe cursor's own first value.
  let seed = DOC_PR_FALLBACK_SEED;
  if (!actor) {
    const allocated = allocateDrawingPropertyId(request.pkg);
    if (allocated.ok) seed = allocated.id;
  }
  const next = idSequence(actor, used, seed, MAX_UNSIGNED_INT);
  let exhausted = false;
  walkAll(request.travelling, (node) => {
    if (exhausted || node.kind === 'textValue' || node.kind !== 'drawingDocPr') return;
    const value = node.attributes.find(
      (attribute) => attribute.localName === 'id' && attribute.namespaceUri === ''
    )?.value;
    if (value === undefined || map.has(value)) return;
    const minted = next();
    if (minted === null) exhausted = true;
    else map.set(value, minted);
  });
  return exhausted ? null : map;
}
