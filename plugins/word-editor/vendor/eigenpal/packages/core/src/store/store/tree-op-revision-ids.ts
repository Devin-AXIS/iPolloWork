// Minting `@w:id` values for NEW revisions — the id space the tracked-edit appliers draw on.
//
// Split from `tree-op-tracked.ts`, which owns the wrappers and placement rules; this module
// owns only the question "which id is free in this part".

import {
  MAX_DECIMAL_ID,
  nextStripedDecimalId,
  resolveAllocationActor,
} from '../package/actor-scoped-ids.ts';
import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';

let partWalks = 0;

/** @internal Test recorder: how many times a mint walked a whole part for its highest id. */
export function revisionIdWalkRecorder(): { readonly walks: number; reset(): void } {
  return {
    get walks() {
      return partWalks;
    },
    reset() {
      partWalks = 0;
    },
  };
}

/**
 * The next free `@w:id` for a revision in this part.
 *
 * `ST_DecimalNumber`, and only ever compared for equality — Word writes them densely from
 * zero and nothing reads them as an order. Taking one past the highest in use keeps a new
 * revision from joining an existing one by accident, which is what an id collision means.
 *
 * When a collaboration actor is bound on the store transaction, the next id is the next
 * unused value in that actor's stripe. Two peers minting from the same snapshot then
 * cannot share an `@w:id`, which is what made Accept on your edit accept theirs too.
 * No actor keeps the dense sequence byte-identical to a solo Word document.
 */
export function nextRevisionId(part: OoxmlPart, actorId?: string): () => string {
  partWalks += 1;
  let highest = -1;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    // REVISION ids only. `@w:id` is also carried by bookmarks, comments and permissions,
    // and those are separate id spaces — a `w:bookmarkStart` id is attacker-controlled and
    // unbounded (`ST_DecimalNumber` is xsd:integer), so scanning them all let a 23-digit
    // bookmark id produce `w:id="1e+22"`: not an integer, and a file Word calls unreadable.
    if (REVISION_ID_BEARING.has(node.localName) && node.namespaceUri === WML_NAMESPACE_URI) {
      for (const attribute of node.attributes) {
        if (attribute.namespaceUri !== WML_NAMESPACE_URI || attribute.localName !== 'id') continue;
        // Strictly parsed and clamped: Word reads a revision id as a 32-bit signed integer,
        // so a larger value is not something to count past — it is something to ignore.
        if (!/^\d{1,10}$/.test(attribute.value)) continue;
        const value = Number(attribute.value);
        if (value <= MAX_REVISION_ID && value > highest) highest = value;
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  const actor = resolveAllocationActor(actorId);
  if (actor) {
    const used = usedRevisionIds(part);
    return () => {
      const id = nextStripedDecimalId(used, actor, MAX_REVISION_ID);
      used.add(id);
      return id;
    };
  }
  let next = highest + 1;
  // Read once on the first wrap, then every id this minter hands out is recorded in it, so
  // two mints in one transaction never return the same free id.
  let wrapped: Set<string> | null = null;
  // Every id below the cursor is taken, so the next mint starts there instead of at zero.
  let cursor = 0;
  return () => {
    // Past the ceiling there is no "one higher" left, and clamping to it would hand back an
    // id the file already uses — turning every edit the user makes into a member of somebody
    // else's revision, which a crafted `@w:id` could force deliberately. Wrap and take the
    // lowest id nobody is using instead.
    if (next > MAX_REVISION_ID) {
      const used = (wrapped ??= usedRevisionIds(part));
      for (; cursor <= MAX_REVISION_ID; cursor += 1) {
        const id = String(cursor);
        if (used.has(id)) continue;
        used.add(id);
        cursor += 1;
        return id;
      }
      // Two billion revisions in one part is not a document; refuse to invent a collision.
      throw new TypeError('no free revision id');
    }
    return String(next++);
  };
}

/** Every revision id in use, for the wrap-around case. */
function usedRevisionIds(part: OoxmlPart): Set<string> {
  const used = new Set<string>();
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (REVISION_ID_BEARING.has(node.localName) && node.namespaceUri === WML_NAMESPACE_URI) {
      for (const attribute of node.attributes) {
        if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'id') {
          // Compared as numbers: a file's `05`, `+5` or `0000000000000000005` takes the id a
          // new revision would write as `5`, and an all-zero id takes `0`.
          const value = attribute.value;
          const digits = /^\+?0*(\d{1,15})$/.exec(value);
          used.add(digits ? String(Number(digits[1])) : value);
        }
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return used;
}

/**
 * The elements whose `@w:id` is a REVISION id. Every other `@w:id` is a different space.
 *
 * Matched on LOCAL NAME, not on the typed kind: only the four content wrappers get a kind of
 * their own, and `w:cellIns`, `w:trPr/w:ins`, `w:rPrChange` and the rest read as `generic`.
 * Keying on kind missed them, so a document whose only revisions were a tracked row
 * insertion minted an id already in use — and the new edit then shared an address with a
 * structural revision the engine refuses, which marked the user's own insertion read-only.
 *
 * Exported so the clipboard merge occupies the same set when it mints ids for a pasted
 * revision. A second list there would let a striped paste land on the id of a `w:cellIns` it
 * never looked at, and the pasted insertion would join that row revision.
 */
export const REVISION_ID_BEARING: ReadonlySet<string> = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'cellIns',
  'cellDel',
  'cellMerge',
  'rPrChange',
  'pPrChange',
  'tblPrChange',
  'tblPrExChange',
  'tcPrChange',
  'trPrChange',
  'sectPrChange',
  'tblGridChange',
  'numberingChange',
]);

/**
 * Whether this node carries a REVISION `@w:id`, by local name in the WML namespace.
 *
 * The one predicate for the question, because two lanes ask it: this module mints past the
 * highest id in use, and the clipboard re-mints every id a pasted fragment brings with it.
 * Matching on the typed KIND instead — which only the four content wrappers have — let a
 * pasted `w:rPrChange` keep its id, so one review card covered the original text and the copy,
 * and rejecting it reverted formatting in a place nobody had proposed anything.
 */
export function carriesRevisionId(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    REVISION_ID_BEARING.has(node.localName)
  );
}

/** `ST_DecimalNumber` is unbounded; Word's reader is not. */
const MAX_REVISION_ID = MAX_DECIMAL_ID;
