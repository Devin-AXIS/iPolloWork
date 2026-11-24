// Presence addressing: a stable `w14:paraId` to this replica's canonical paragraph node.
//
// A remote caret names one paragraph by its stable id, twice per selection, on every caret
// move. Resolving one used to build a snapshot of every paragraph in every story part and
// scan it, which is O(document) on a path that has to be O(1). Memoizing that snapshot on
// `packageRevision` did not fix it: typing bumps the revision on every keystroke, so the
// memo missed exactly when it mattered, and the miss now paid for a rebuild too.
//
// Every memo here keys on OBJECT IDENTITY, which is what the rest of the engine does and
// what survives an unrelated edit:
//
//   - `paragraphAddressesOf` maps paraId to node id for ONE part and remembers it against
//     the part ROOT. A header nobody edits keeps its map for the life of that tree.
//   - `createBodyParagraphLookup` keeps the reverse map, node id to paraId, for the LAST body
//     root only: every edit makes a new body root, and the shared cache above would otherwise
//     fill with body maps that undo history keeps alive. So an edit can cost two body walks,
//     one per direction, when both lookups run on the new tree; neither builds the other's map.
//   - `createParagraphAddressResolver` remembers where each paraId resolved last time, then
//     re-checks the hint through the store's own node index, which is O(1). A paragraph
//     that did not move survives every keystroke elsewhere in the document.
//
// The hint is re-checked, never trusted: one whose node no longer carries the paraId is
// dropped and the part maps decide. Presence painted on the wrong paragraph is worse than
// presence that costs a rebuild.
//
// The re-check cannot see that ANOTHER paragraph took the id first: an earlier paragraph
// renamed to it, a pasted copy, a text box added inside an earlier paragraph, or a body
// paragraph that now shadows a header's. So before each lookup the owner of the store passes the
// change since the last one (`forgetChangedParagraphIds`), and every hint is dropped unless the
// change was typing that could not move an id; the part maps then decide.

import { findNode, type OoxmlNode, type OoxmlPart } from '../store/package/index.ts';
import { isValidParaId, normalizeParagraphIdentity, paraIdOf } from '../store/package/para-id.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import { createRecentRootCache } from '../store/store/recent-root-cache.ts';
import { paragraphTextOf } from '../store/store/tree-op-apply.ts';
import type { CollaborationParagraph } from './replication.ts';

const STORY_ROOTS = new Set(['document', 'hdr', 'ftr', 'footnotes', 'endnotes']);

/**
 * Part maps kept alive at once: the body plus a document's worth of furniture and notes,
 * with room for the roots an undo still names. Bounded because package history retains old
 * roots by reference and each map is O(paragraphs in that part).
 */
const MAX_MEMOIZED_PARTS = 24;

/**
 * Remembered addresses. The id arrives over the wire, so the map must not grow with the
 * number of distinct ids a peer can name.
 */
const MAX_ADDRESS_HINTS = 512;

/** Which map an identity walk builds. */
type WalkDirection = 'byParagraphId' | 'byNodeId';

const partAddresses = createRecentRootCache<ReadonlyMap<string, string>>(MAX_MEMOIZED_PARTS);

let paragraphEnumerations = 0;
let paragraphVisits = 0;

/**
 * @internal Warm-path recorder for collaboration paragraph enumerations.
 *
 * Presence address resolution must not enumerate paragraphs per caret move: one walk per
 * body tree for each lookup direction (node id to paraId, paraId to node id) is the expected
 * cost. This counts the enumerations
 * that do happen so a test can assert the caret path stays off them.
 */
export function collaborationParagraphScanRecorder(): {
  readonly enumerations: number;
  readonly visits: number;
  reset(): void;
} {
  return {
    get enumerations() {
      return paragraphEnumerations;
    },
    get visits() {
      return paragraphVisits;
    },
    reset() {
      paragraphEnumerations = 0;
      paragraphVisits = 0;
    },
  };
}

/** Whether a part is a story root presence can name. */
export function isStoryPart(part: OoxmlPart): boolean {
  const root = part.root;
  return root.namespaceUri === WML_NAMESPACE_URI && STORY_ROOTS.has(root.localName);
}

function paragraphElements(part: OoxmlPart): OoxmlNode[] {
  const result: OoxmlNode[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') result.push(node);
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return result;
}

/**
 * Every addressable body paragraph, in document order.
 *
 * This is the enumerating read. Presence does not use it; text publication does, because a
 * publication has to diff against the whole list it is given.
 */
export function paragraphSnapshot(part: OoxmlPart): readonly CollaborationParagraph[] {
  // Furniture parts mint paraIds only when their store opens, and that mint does not
  // replicate. Presence still has to name them, so this pass mints the same values a
  // read would: deterministic from the node id, node ids unchanged, package not written.
  const identified = normalizeParagraphIdentity(part);
  paragraphEnumerations += 1;
  const result: CollaborationParagraph[] = [];
  const seen = new Set<string>();
  for (const paragraph of paragraphElements(identified)) {
    paragraphVisits += 1;
    const authoredId = paraIdOf(paragraph);
    if (!authoredId || !isValidParaId(authoredId)) continue;
    const paragraphId = authoredId.toUpperCase();
    if (seen.has(paragraphId)) continue;
    seen.add(paragraphId);
    const text = paragraphTextOf(identified, paragraph.id);
    if (text === null) continue;
    result.push(Object.freeze({ paragraphId, nodeId: paragraph.id, text }));
  }
  return Object.freeze(result);
}

/**
 * Stable paraId to canonical node id for one part, memoized on the part ROOT.
 *
 * Carries no text: text is read per resolved paragraph, so a part map costs one attribute
 * read per paragraph instead of a segment walk per paragraph.
 */
export function paragraphAddressesOf(part: OoxmlPart): ReadonlyMap<string, string> {
  const cached = partAddresses.get(part.root);
  if (cached) return cached;
  const byParagraphId = identityWalk(part, 'byParagraphId');
  partAddresses.set(part.root, byParagraphId);
  return byParagraphId;
}

/**
 * One walk of a part's paragraphs under the snapshot's own id rules: `normalizeParagraphIdentity`
 * mints an id for a missing, invalid, or later duplicate one, and the first `w:p` to carry an id
 * claims it (a demoted generic `w:p` too, which then has no address). Builds the one map its
 * caller keeps: `byParagraphId`, stable paraId to node id for the first claimant, or
 * `byNodeId`, node id to the stable paraId a snapshot lists it under. Not memoized here.
 */
function identityWalk(part: OoxmlPart, direction: WalkDirection): Map<string, string> {
  const identified = normalizeParagraphIdentity(part);
  paragraphEnumerations += 1;
  const addresses = new Map<string, string>();
  const claimed = new Set<string>();
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') {
      paragraphVisits += 1;
      const authoredId = paraIdOf(node);
      if (authoredId && isValidParaId(authoredId)) {
        const paragraphId = authoredId.toUpperCase();
        if (!claimed.has(paragraphId)) {
          claimed.add(paragraphId);
          if (node.kind === 'paragraph') {
            if (direction === 'byParagraphId') addresses.set(paragraphId, node.id);
            else addresses.set(node.id, paragraphId);
          }
        }
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(identified.root);
  return addresses;
}

/** One resolved presence address: the live part and the node inside it. */
export interface ParagraphAddress {
  readonly part: OoxmlPart;
  readonly nodeId: string;
}

interface ParagraphAddressHint {
  readonly partName: string;
  readonly root: OoxmlNode;
  readonly nodeId: string;
}

function sameRoots(left: readonly OoxmlPart[], right: readonly OoxmlNode[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]!.root !== right[index]) return false;
  }
  return true;
}

/** Stable paragraph id to address, with the hint invalidation its owner drives. */
export interface ParagraphAddressResolver {
  (paragraphId: string): ParagraphAddress | null;
  /**
   * These paragraphs now carry these ids. A hint for one of the ids that names another node
   * may no longer name the first claimant, so it is dropped; a hint that names the same node
   * (typing in it) stays.
   */
  forgetIds(claims: Iterable<{ readonly paragraphId: string; readonly nodeId: string }>): void;
  /** Any id may have a new first claimant (a structural or package-wide change). */
  forgetAll(): void;
  /** Whether any hint is held, so a change listener can skip work when none is. */
  hasHints(): boolean;
}

/**
 * Resolve stable paragraph ids against the story parts a replica holds.
 *
 * `storyParts` returns body first and the remaining story parts after, which is the
 * precedence a duplicate id resolves by. The caller must report changes that can move an id
 * to another paragraph through `forgetIds` or `forgetAll`; see the module header.
 */
export function createParagraphAddressResolver(
  storyParts: () => readonly OoxmlPart[]
): ParagraphAddressResolver {
  const hints = new Map<string, ParagraphAddressHint>();
  let absent: { readonly roots: readonly OoxmlNode[]; readonly ids: Set<string> } | null = null;

  const remember = (paragraphId: string, part: OoxmlPart, nodeId: string): void => {
    // Delete first so the re-insert moves the entry to the back of the eviction order.
    hints.delete(paragraphId);
    hints.set(paragraphId, { partName: part.name, root: part.root, nodeId });
    while (hints.size > MAX_ADDRESS_HINTS) {
      const oldest = hints.keys().next();
      if (oldest.done) break;
      hints.delete(oldest.value);
    }
  };

  const fromHint = (paragraphId: string, parts: readonly OoxmlPart[]): ParagraphAddress | null => {
    const hint = hints.get(paragraphId);
    if (!hint) return null;
    const part = parts.find((candidate) => candidate.name === hint.partName);
    if (!part) return null;
    // Same tree, so nothing in it moved and the hint is exact.
    if (part.root === hint.root) return { part, nodeId: hint.nodeId };
    // A rebuilt tree. Re-check through the store's node index instead of re-scanning: a
    // text edit rebuilds the root and leaves every paragraph's node id and paraId alone.
    const node = findNode(part, hint.nodeId);
    if (!node || node.kind !== 'paragraph') return null;
    const authoredId = paraIdOf(node);
    if (!authoredId || authoredId.toUpperCase() !== paragraphId) return null;
    remember(paragraphId, part, hint.nodeId);
    return { part, nodeId: hint.nodeId };
  };

  const resolve = (paragraphId: string): ParagraphAddress | null => {
    const parts = storyParts();
    const hinted = fromHint(paragraphId, parts);
    if (hinted) return hinted;
    // An id no part held stays unheld while every part is the same tree. Without this a
    // caret in a paragraph this replica has not received re-scans on every read.
    if (absent && absent.ids.has(paragraphId) && sameRoots(parts, absent.roots)) return null;
    for (const part of parts) {
      const nodeId = paragraphAddressesOf(part).get(paragraphId);
      if (nodeId === undefined) continue;
      remember(paragraphId, part, nodeId);
      return { part, nodeId };
    }
    if (!absent || !sameRoots(parts, absent.roots)) {
      absent = { roots: parts.map((part) => part.root), ids: new Set() };
    }
    if (absent.ids.size < MAX_ADDRESS_HINTS) absent.ids.add(paragraphId);
    return null;
  };
  return Object.assign(resolve, {
    forgetIds(claims: Iterable<{ readonly paragraphId: string; readonly nodeId: string }>) {
      for (const { paragraphId, nodeId } of claims) {
        if (hints.get(paragraphId)?.nodeId !== nodeId) hints.delete(paragraphId);
      }
    },
    forgetAll() {
      hints.clear();
    },
    hasHints() {
      return hints.size > 0;
    },
  });
}

/**
 * Tell `resolver` which stable ids one store change may have given a new first claimant.
 *
 * Only a text-local change (typing, IME, a narrowed remote text edit) keeps hints, and only
 * when every node it names is a paragraph: text moves no paraId, so a hint stays unless that
 * paragraph now carries a hinted id another node held. Anything else forgets every hint:
 * structure, properties, drawings, undo and redo, and a change whose node lists cannot be
 * trusted to be complete (a package-channel write reports none, and may rename or add any
 * paragraph, a text box's included). The next lookup of a forgotten id walks that part once.
 */
export function forgetChangedParagraphIds(
  resolver: ParagraphAddressResolver,
  parts: readonly OoxmlPart[],
  change: {
    readonly impact: string;
    readonly dirty: readonly string[];
    readonly created: readonly string[];
  }
): void {
  if (!resolver.hasHints()) return;
  const changed = [...change.dirty, ...change.created];
  if (change.impact !== 'text-local' || changed.length === 0) return resolver.forgetAll();
  const claims: { paragraphId: string; nodeId: string }[] = [];
  for (const nodeId of changed) {
    const part = parts.find((candidate) => nodeId.startsWith(`${candidate.name}#`));
    const node = part ? findNode(part, nodeId) : null;
    const authoredId = node?.kind === 'paragraph' ? paraIdOf(node) : null;
    if (!authoredId) return resolver.forgetAll();
    claims.push({ paragraphId: authoredId.toUpperCase(), nodeId });
  }
  resolver.forgetIds(claims);
}

/**
 * The body paragraph with this canonical node id, as `paragraphSnapshot(body)` would list it,
 * or null. A remote caret's character lookup asks this on every caret move. It reads a node id
 * to paraId map from `identityWalk`, which applies the snapshot's own id rules, so it answers
 * exactly what the snapshot does, then reads that one paragraph's text.
 *
 * The map is kept for the last body root only. Caret moves on an unchanged document are O(1);
 * the first lookup after an edit walks the body once (no text), shared by every lookup on that
 * tree. The snapshot it replaces listed every paragraph and its text on every call.
 */
export function createBodyParagraphLookup(
  body: () => OoxmlPart
): (nodeId: string) => CollaborationParagraph | null {
  let last: { readonly root: OoxmlNode; readonly byNodeId: ReadonlyMap<string, string> } | null =
    null;
  return (nodeId) => {
    const part = body();
    if (last?.root !== part.root)
      last = { root: part.root, byNodeId: identityWalk(part, 'byNodeId') };
    const paragraphId = last.byNodeId.get(nodeId);
    if (paragraphId === undefined) return null;
    const text = paragraphTextOf(part, nodeId);
    return text === null ? null : Object.freeze({ paragraphId, nodeId, text });
  };
}
