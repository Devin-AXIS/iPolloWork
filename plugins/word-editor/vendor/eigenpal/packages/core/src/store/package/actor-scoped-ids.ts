// Actor-scoped decimal id allocation for revision, comment, relationship, bookmark,
// `_Toc` bookmark-name, content-control, and numbering id namespaces.
//
// WHY STRIPES: two replicas that mint by "one past the highest local id" compute the SAME
// value from the same snapshot. The CRDT then keeps both nodes and the shared `@w:id` /
// `rIdN`, so Accept on your tracked change accepts a colleague's edit, and comment anchors
// cross-link. The collision is not structural — the tree is fine, the id namespace is not.
//
// A residue class per actor (id ≡ stripe (mod N)) makes concurrent mints land on disjoint
// numbers, so they cannot meet. N stays small so collaborative ids stay near Word's dense
// range rather than jumping to `rId1048577`. Solo documents pass no actor and keep Word's
// "one past highest" sequence byte-for-byte.
//
// The actor is the SAME `TransactOptions.actorId` the surface already hands the store when a
// collaboration session is attached. This module does not invent a second identity.

import { fnv1a32 } from './para-id.ts';
import type { OoxmlPackage } from './ooxml-package.ts';

/**
 * Stripe count.
 *
 * Two actors that hash into one residue class walk the identical sequence over the identical
 * used-set and mint the identical id — the collision this whole module exists to prevent. So
 * the count is a birthday problem in disguise, not a cosmetic choice: with 16 classes a
 * five-person room shares a stripe 50% of the time (measured over 20,000 sampled rooms, actor
 * ids in the `name:uuid` shape hosts actually produce). This was 16, and it made the striping
 * roughly a coin flip.
 *
 * 65,536 takes that to 0.02% for five and about 0.3% for twenty. The cost is only that a
 * collaborative document's first ids read `rId5095` rather than `rId3`; ids are opaque, and
 * every namespace here has a ceiling in the billions. A solo document passes no actor and keeps
 * Word's dense sequence byte-for-byte, so nothing a single author saves is affected.
 *
 * The hash is FNV-1a, the same one paragraph ids use, so the mapping is stable across
 * processes. Its low bits are uniform enough for a power-of-two modulus: chi-square over 256
 * bins of 200,000 samples came back 257 against an expected 256.
 *
 * A collision remains POSSIBLE, and nothing detects one after the fact. That repair is
 * deferred by design (D4); this constant only makes reaching it unlikely.
 */
export const ACTOR_ID_STRIPE = 65_536;

/** Word reads `ST_DecimalNumber` revision and comment ids as signed 32-bit. */
export const MAX_DECIMAL_ID = 2_147_483_647;

/** `rId` scanners in this package already reject more than nine digits. */
export const MAX_RELATIONSHIP_NUMBER = 999_999_999;

let activeActorId: string | undefined;

/**
 * Bind the transaction's actor for the duration of `run`.
 *
 * Mint sites that cannot take an extra argument (package `applyPackage` hooks, revision
 * appliers) read {@link transactionActorId} rather than inventing a second actor.
 *
 * No actor INHERITS the enclosing one rather than clearing it. Every `TreeDocumentStore.transact`
 * binds through here and most callers pass none, so assigning `undefined` would drop the actor an
 * outer boundary had bound — and every mint inside that transaction would silently fall back to
 * Word's dense sequence and agree with the other replica on the same id. An actor is only ever
 * bound when a replica is attached, which is equally true of the nested transaction.
 */
export function runWithTransactionActor<T>(actorId: string | undefined, run: () => T): T {
  const previous = activeActorId;
  activeActorId = actorId ?? previous;
  try {
    return run();
  } finally {
    activeActorId = previous;
  }
}

/** The actor bound by the open store transaction, or `undefined` when none is attached. */
export function transactionActorId(): string | undefined {
  return activeActorId;
}

/** Stable residue in `0..ACTOR_ID_STRIPE-1` for one actor string. */
export function actorStripe(actorId: string): number {
  return fnv1a32(actorId) % ACTOR_ID_STRIPE;
}

/** Resolve an explicit actor, then the open transaction, then none (solo / Word-like). */
export function resolveAllocationActor(actorId?: string): string | undefined {
  return actorId ?? activeActorId;
}

/**
 * A hash seed scoped to the transaction's actor.
 *
 * Deterministic mints (`mintParaId`) seed from structure — the paragraph and offset a paste
 * lands at — and two replicas pasting at one position from one snapshot compute the same
 * seed, so they would mint the same identity for different paragraphs. The actor keeps the
 * seeds apart. Without one the seed is unchanged, so a solo document mints what it always did.
 */
export function actorScopedSeed(seed: string, actorId?: string): string {
  const actor = resolveAllocationActor(actorId);
  return actor === undefined ? seed : `${actor}|${seed}`;
}

/**
 * Next unused id in `actorId`'s residue class.
 *
 * Walks `stripe, stripe+N, stripe+2N, …` and skips ids already in `used`. Past the ceiling
 * there is no "one higher" left in the stripe; wrapping and handing back a used id would
 * join an existing revision by accident, which a crafted `@w:id` could force. Refuse rather
 * than invent a collision.
 */
export function nextStripedDecimalId(
  used: ReadonlySet<string>,
  actorId: string,
  max: number
): string {
  const stripe = actorStripe(actorId);
  for (let candidate = stripe; candidate <= max; candidate += ACTOR_ID_STRIPE) {
    if (!used.has(String(candidate))) return String(candidate);
  }
  throw new TypeError('no free decimal id');
}

/**
 * A cursor over one actor's residue class, for a caller that mints SEVERAL ids at once.
 *
 * {@link nextStripedDecimalId} answers the same question for one id, and its first answer is
 * this sequence's first answer. What it cannot do is continue: it restarts the walk at `stripe`
 * on every call. So a caller minting N ids either pays N walks or — worse — seeds from it once
 * and then counts up by one, which leaves the residue class on the SECOND id and lands on
 * numbers another actor's stripe contains. That reads as striped and collides anyway. The
 * cursor keeps its place instead, so every id it hands back satisfies
 * `Number(id) % ACTOR_ID_STRIPE === actorStripe(actorId)`.
 *
 * `null` past the ceiling rather than a wrap, for the reason `nextStripedDecimalId` throws
 * there: the only ids left in the stripe are ids somebody already holds. The caller decides
 * whether that refuses the whole edit.
 */
export function stripedDecimalIdSequence(
  used: ReadonlySet<string>,
  actorId: string,
  max: number
): () => string | null {
  let candidate = actorStripe(actorId);
  return () => {
    while (candidate <= max && used.has(String(candidate))) candidate += ACTOR_ID_STRIPE;
    if (candidate > max) return null;
    const id = String(candidate);
    candidate += ACTOR_ID_STRIPE;
    return id;
  };
}

/**
 * Solo "one past highest". When that would pass `max`, scan from zero for an unused id —
 * the same wrap the revision minter already had, so a huge attacker-controlled `@w:id`
 * cannot push us into `w:id="1e+22"`.
 */
export function nextDenseDecimalId(
  highest: number,
  used: ReadonlySet<string> | undefined,
  max: number
): string {
  const next = highest + 1;
  if (next <= max) return String(next);
  if (!used) throw new TypeError('no free decimal id');
  for (let candidate = 0; candidate <= max; candidate += 1) {
    if (!used.has(String(candidate))) return String(candidate);
  }
  throw new TypeError('no free decimal id');
}

/**
 * Stripe count for part numbers, as `header3.xml` or `image12.png`. Smaller than
 * {@link ACTOR_ID_STRIPE}: header and footer names take five digits at most, and part names
 * are seen by people.
 */
export const PART_NUMBER_STRIPE = 4096;

/**
 * The part numbers to try for a new part, in order: 1, 2, 3, ... with no actor, the dense
 * numbering a solo document uses, or one actor's stripe of them, so two collaborators who each
 * add a header or an image from one snapshot do not name both parts the same.
 */
export function* partNumberCandidates(max: number, actorId?: string): Generator<number> {
  const actor = resolveAllocationActor(actorId);
  const step = actor === undefined ? 1 : PART_NUMBER_STRIPE;
  const start = actor === undefined ? 1 : (actorStripe(actor) % PART_NUMBER_STRIPE) + 1;
  for (let candidate = start; candidate <= max; candidate += step) yield candidate;
}

const RELATIONSHIP_NUMBER = /^rId(\d{1,9})$/;

/** Parse `rIdN` when N is a 1–9 digit integer; anything else is not a seed. */
export function relationshipNumberOf(id: string): number | null {
  const match = RELATIONSHIP_NUMBER.exec(id);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

/** Format a positive integer as `rIdN`. */
export function relationshipIdFromNumber(value: number): string {
  return `rId${value}`;
}

/**
 * Next `rIdN` on the whole package (internal + external records).
 *
 * No actor: `rId${max+1}` — byte-identical to the three previous copies of this scan.
 * With an actor: the next unused striped `rId`.
 */
export function freePackageRelationshipId(pkg: OoxmlPackage, actorId?: string): string {
  const used = new Set<string>();
  let max = 0;
  for (const records of pkg.relationships.values()) {
    for (const record of records) {
      used.add(record.id);
      const value = relationshipNumberOf(record.id);
      if (value !== null && value > max) max = value;
    }
  }
  for (const external of pkg.externalTargets) {
    used.add(external.id);
    const value = relationshipNumberOf(external.id);
    if (value !== null && value > max) max = value;
  }
  const actor = resolveAllocationActor(actorId);
  if (!actor) return relationshipIdFromNumber(max + 1);
  const numbers = new Set<string>();
  for (const id of used) {
    const value = relationshipNumberOf(id);
    if (value !== null) numbers.add(String(value));
  }
  return relationshipIdFromNumber(
    Number(nextStripedDecimalId(numbers, actor, MAX_RELATIONSHIP_NUMBER))
  );
}
