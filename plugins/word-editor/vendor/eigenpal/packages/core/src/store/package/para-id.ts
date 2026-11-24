// `w14:paraId` — Word's stable paragraph identity.
//
// Word (2013+) stamps every `<w:p>` with an 8-hex `w14:paraId` (paired with
// `w14:textId`). Other parts anchor to it: `commentsExtended.xml` threads comment
// replies by it, tracked-changes/coauthoring merge references it, and the public
// contract addresses paragraphs by it (`DocAnchor.paraId`). This module owns the
// value rules, deterministic minting, and the load-time normalization pass that
// guarantees every paragraph of an opened part carries a valid, part-unique id.
//
// Value rules (MS-DOCX §2.6.2.3 / §2.6.2.4 — an MS extension, not ECMA-376):
// 8 hex digits, greater than 0x00000000 and less than 0x80000000, unique among
// the paragraphs of one document part, matched case-insensitively. Word treats
// `00000000` as absent. `w14:textId` carries no uniqueness requirement.
//
// Minting is DETERMINISTIC (FNV-1a over a caller-supplied seed), not random:
// `splitParagraphMany` must stay byte-identical to the sequence of single splits
// it stands for, reopening the same bytes must rebuild the same tree, and tests
// must be reproducible. Randomness buys nothing here — uniqueness is what Word
// requires, and the collision bump provides it.

import { MC_NAMESPACE_URI, W14_NAMESPACE_URI, WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { carryIndexToRebuiltRoot, parentNodeOf } from './ooxml-edit.ts';
import type { OoxmlAttribute, OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { validateOoxmlPart } from './ooxml-validate.ts';
import { createSubtreeAggregateMemo, keepsSubtreeMemo } from './subtree-memo-policy.ts';
import { createRecentRootCache } from '../store/recent-root-cache.ts';

const PARA_ID_PATTERN = /^[0-9A-Fa-f]{8}$/;

/** Valid per MS-DOCX: 8 hex digits, non-zero, below 0x80000000. */
export function isValidParaId(value: string): boolean {
  if (!PARA_ID_PATTERN.test(value)) return false;
  const numeric = Number.parseInt(value, 16);
  return numeric !== 0 && numeric < 0x80000000;
}

/** The authored `w14:paraId` value of an element, verbatim, or null. */
export function paraIdOf(node: OoxmlNode): string | null {
  if (node.kind === 'textValue') return null;
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri === W14_NAMESPACE_URI && attribute.localName === 'paraId')
      return attribute.value;
  }
  return null;
}

/** FNV-1a over UTF-16 code units — the deterministic mint every id derivation shares. */
export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function toHex8(value: number): string {
  return value.toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Deterministic 8-hex mint in (0x00000000, 0x80000000), collision-free against
 * `used` (uppercase hex). Same seed + same used-set → same value, which is what
 * keeps `splitParagraphMany` byte-identical to its equivalent single splits and
 * a reopened save identical to the session that produced it.
 */
export function mintParaId(seed: string, used: ReadonlySet<string>): string {
  let candidate = 0;
  for (let attempt = 0; attempt < 64; attempt += 1) {
    candidate = fnv1a32(attempt === 0 ? seed : `${seed} ${attempt}`) & 0x7fffffff;
    const hex = toHex8(candidate);
    if (candidate !== 0 && !used.has(hex)) return hex;
  }
  // Hostile saturation: bounded linear probe. Terminates because a document part
  // cannot hold 0x7FFFFFFF paragraphs, so a free value always exists.
  for (;;) {
    candidate = (candidate % 0x7fffffff) + 1;
    const hex = toHex8(candidate);
    if (!used.has(hex)) return hex;
  }
}

/** Bounded: the undo history keeps old roots, and each set holds every id of a part. */
const usedParaIdCache = createRecentRootCache<ReadonlySet<string>>(3);

/** One shared empty list for the (vast) majority of subtrees that carry no paraId. */
const EMPTY_PARA_IDS: readonly string[] = Object.freeze([]);

/**
 * Valid paraIds under one immutable node, in document pre-order, uppercased.
 *
 * Per-NODE memo: an edit shares every untouched subtree by reference, so recomputing the
 * root set after a split touches only the rebuilt spine and reuses every sibling block's
 * cached list. The full walk this composes replaced was O(document) per fresh root, which
 * every structural keystroke paid inside `applyOps` (a split mints its new id against this
 * set). Subtrees with no id share one frozen empty list. Only nodes `keepsSubtreeMemo`
 * admits get an entry: a node of leaves rebuilds its short list from those leaves.
 */
const subtreeParaIdsCache = createSubtreeAggregateMemo<readonly string[]>();

function subtreeParaIds(node: OoxmlNode): readonly string[] {
  if (node.kind === 'textValue') return EMPTY_PARA_IDS;
  const cached = subtreeParaIdsCache.get(node);
  if (cached) return cached;
  let found: string[] | null = null;
  const value = paraIdOf(node);
  if (value !== null && isValidParaId(value)) (found ??= []).push(value.toUpperCase());
  for (const child of node.children) {
    const ids = subtreeParaIds(child);
    if (ids.length === 0) continue;
    found ??= [];
    for (const id of ids) found.push(id);
  }
  const result: readonly string[] = found ?? EMPTY_PARA_IDS;
  // A run answers from its few children again: an entry per run is most of the memo.
  if (node.kind !== 'run' && keepsSubtreeMemo(node))
    subtreeParaIdsCache.set(node, result, result.length);
  return result;
}

/** Every valid `w14:paraId` in the tree, uppercased. Memoized per root object. */
export function usedParaIds(root: OoxmlElement): ReadonlySet<string> {
  const cached = usedParaIdCache.get(root);
  if (cached) return cached;
  const used = new Set<string>(subtreeParaIds(root));
  usedParaIdCache.set(root, used);
  return used;
}

/**
 * The non-empty prefix the part ROOT binds to the w14 namespace, or null.
 *
 * Minted attributes require an in-scope binding (the invariant validator reports
 * `invalid-qname` otherwise, and the serializer would allocate an `nsN` alias).
 * Only the root binding counts: a binding authored on some descendant does not
 * cover paragraphs elsewhere in the tree.
 */
export function w14RootPrefix(root: OoxmlElement): string | null {
  for (const binding of root.namespaceBindings) {
    if (binding.namespaceUri === W14_NAMESPACE_URI && binding.prefix !== '') return binding.prefix;
  }
  return null;
}

/**
 * A root-declared w14 prefix that still resolves to the w14 URI at `node`.
 *
 * A hostile descendant can rebind the same prefix (`xmlns:w14="urn:evil"`), so each
 * root alias is checked against the node's ancestor chain and the first unshadowed one wins.
 */
export function w14PrefixInScopeAt(part: OoxmlPart, node: OoxmlElement): string | null {
  const rootBindings = part.root.namespaceBindings.filter(
    (binding) => binding.namespaceUri === W14_NAMESPACE_URI && binding.prefix !== ''
  );
  if (rootBindings.length === 0) return null;
  const chain: OoxmlElement[] = [];
  let current: OoxmlElement | null = node;
  while (current && current.id !== part.root.id) {
    chain.push(current);
    current = parentNodeOf(part, current.id);
  }
  for (const binding of rootBindings) {
    const shadowed = chain.some((ancestor) =>
      ancestor.namespaceBindings.some(
        (candidate) =>
          candidate.prefix === binding.prefix && candidate.namespaceUri !== W14_NAMESPACE_URI
      )
    );
    if (!shadowed) return binding.prefix;
  }
  return null;
}

/** The minted `[w14:paraId, w14:textId]` pair. `textId` mirrors `paraId`: it has no uniqueness requirement, no consumer reads it, and one allocator is simpler than two — but Word writes both, so we write both. */
export function mintedParagraphIdentityAttributes(
  prefix: string,
  value: string
): readonly OoxmlAttribute[] {
  return Object.freeze([
    Object.freeze({
      kind: 'genericExtension',
      namespaceUri: W14_NAMESPACE_URI,
      localName: 'paraId',
      prefix,
      value,
    } as const),
    Object.freeze({
      kind: 'genericExtension',
      namespaceUri: W14_NAMESPACE_URI,
      localName: 'textId',
      prefix,
      value,
    } as const),
  ]);
}

/**
 * Fresh `w14:paraId`/`w14:textId` on every cloned paragraph, deterministic per seat.
 *
 * `hostPrefix` is the w14 prefix in scope where the clones land, or null when the host part
 * carries no paragraph identity. With a prefix, EVERY paragraph gets an identity, whether
 * or not its source had one: the body's identity invariant (every paragraph addressable by
 * `paraId`) is established at load, and content from outside the document must not punch
 * holes in it. Projected HTML and hand-built fragments carry no ids at all, so minting only
 * over an existing id left every pasted paragraph after the first unaddressable.
 */
export function withFreshParaIds(
  node: OoxmlNode,
  used: Set<string>,
  seedBase: string,
  counter: { value: number },
  hostPrefix: string | null,
  hostPrefixShadowed = false
): OoxmlNode {
  if (node.kind === 'textValue') return node;
  const element: OoxmlElement = node;
  // A fragment element can rebind the host's prefix to another namespace. Inside it the
  // host prefix no longer names w14, so minting under it would write a foreign attribute.
  const shadowed =
    hostPrefixShadowed ||
    (hostPrefix !== null &&
      element.namespaceBindings.some(
        (binding) => binding.prefix === hostPrefix && binding.namespaceUri !== W14_NAMESPACE_URI
      ));
  let attributes = element.attributes;
  if (element.localName === 'p' && element.namespaceUri === WML_NAMESPACE_URI) {
    const identity = element.attributes.find(
      (attribute) =>
        attribute.namespaceUri === W14_NAMESPACE_URI && attribute.localName === 'paraId'
    );
    // Re-mint whenever a `w14:paraId` is present, valid or not: a crafted fragment can
    // carry a syntactically INVALID id shared across paragraphs, which would plant
    // duplicate identities in the host. A fresh valid id replaces it either way.
    const prefix =
      hostPrefix !== null && !shadowed ? hostPrefix : identity ? (identity.prefix ?? 'w14') : null;
    if (prefix !== null) {
      const minted = mintParaId(`${seedBase}:${counter.value}`, used);
      counter.value += 1;
      used.add(minted);
      const kept = element.attributes.filter(
        (attribute) =>
          !(
            attribute.namespaceUri === W14_NAMESPACE_URI &&
            (attribute.localName === 'paraId' || attribute.localName === 'textId')
          )
      );
      attributes = [
        ...kept,
        ...mintedParagraphIdentityAttributes(prefix, minted),
      ] as typeof element.attributes;
    }
  }
  const children = element.children.map((child) =>
    withFreshParaIds(child, used, seedBase, counter, hostPrefix, shadowed)
  );
  const childrenChanged = children.some((child, index) => child !== element.children[index]);
  if (attributes === element.attributes && !childrenChanged) return node;
  return { ...element, attributes, children } as OoxmlNode;
}

function isWmlParagraphElement(node: OoxmlNode): node is OoxmlElement {
  return (
    node.kind !== 'textValue' && node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p'
  );
}

/** Document-order WML `<w:p>` elements at any depth — typed AND demoted-generic (a demoted `w:p` is still a paragraph to Word), including paragraphs nested in table cells, SDTs and textbox content. */
function collectWmlParagraphs(root: OoxmlElement): OoxmlElement[] {
  const paragraphs: OoxmlElement[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (isWmlParagraphElement(node)) paragraphs.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return paragraphs;
}

function isIdentityAttribute(attribute: OoxmlAttribute): boolean {
  return (
    attribute.namespaceUri === W14_NAMESPACE_URI &&
    (attribute.localName === 'paraId' || attribute.localName === 'textId')
  );
}

/** Every prefix that ANY binding in the tree ties to a URI other than w14 — a prefix in this set can be shadowed at some paragraph's depth (`xmlns:w14="urn:evil"` mid-tree) and is unusable for minting. */
function conflictingW14Prefixes(root: OoxmlElement): ReadonlySet<string> {
  const conflicting = new Set<string>();
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    for (const binding of node.namespaceBindings) {
      if (binding.namespaceUri !== W14_NAMESPACE_URI) conflicting.add(binding.prefix);
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return conflicting;
}

/** A prefix for the w14 URI outside the conflicting set — usable at EVERY depth. */
function chooseW14Prefix(conflicting: ReadonlySet<string>): string {
  if (!conflicting.has('w14')) return 'w14';
  for (let suffix = 97; suffix <= 122; suffix += 1) {
    const candidate = `w14${String.fromCharCode(suffix)}`;
    if (!conflicting.has(candidate)) return candidate;
  }
  for (let counter = 2; ; counter += 1) {
    const candidate = `w14x${counter}`;
    if (!conflicting.has(candidate)) return candidate;
  }
}

function freezeElement(element: OoxmlElement): OoxmlElement {
  Object.freeze(element.attributes);
  Object.freeze(element.namespaceBindings);
  Object.freeze(element.children);
  return Object.freeze(element);
}

/**
 * Load-time paragraph-identity normalization for a session's main part.
 *
 * Keeps every valid, first-seen paraId verbatim; mints (deterministically, seeded
 * by the paragraph's structural node id) for paragraphs whose id is missing,
 * malformed, zero, out of range, or a duplicate. Adds the root `xmlns` binding
 * the minted attributes need. Returns the INPUT PART REFERENCE when there is
 * nothing to do — a document Word saved yesterday re-serializes byte-identical.
 *
 * Attribute-only rebuilds move no child, so every node keeps its structural-path
 * id; the copy respreads only the ancestors of changed paragraphs.
 *
 * Fail-open: if the rebuilt part does not validate (a bug, or a pathology the
 * prefix choice could not defuse), the original part is returned — a document
 * must never become unopenable over an identity enhancement.
 */
export function normalizeParagraphIdentity(part: OoxmlPart): OoxmlPart {
  const paragraphs = collectWmlParagraphs(part.root);
  // Collision universe: PARAGRAPH ids only — MS-DOCX scopes uniqueness to paragraphs,
  // so a paraId planted on some other element (attacker noise) neither blocks a mint
  // nor gets deduplicated. The split path's `usedParaIds` walks the whole tree and is
  // therefore strictly wider; both guarantee paragraph-level uniqueness.
  const seen = new Set<string>();
  const toMint: OoxmlElement[] = [];
  let keptAny = false;
  for (const paragraph of paragraphs) {
    const value = paraIdOf(paragraph);
    const canonical = value !== null && isValidParaId(value) ? value.toUpperCase() : null;
    if (canonical !== null && !seen.has(canonical)) {
      seen.add(canonical);
      keptAny = true;
    } else {
      toMint.push(paragraph);
    }
  }

  const rootPrefix = w14RootPrefix(part.root);
  // The byte-stability early return: nothing to mint, and kept ids (if any) already
  // have a root binding. Deliberately does NOT scan for shadowed subtrees — a fully
  // identified Word document must re-serialize byte-identical, and the split path
  // resolves its own in-scope prefix per paragraph anyway.
  if (toMint.length === 0 && !(keptAny && rootPrefix === null)) return part;

  // A root prefix that some descendant rebinds to another URI is unusable: minting
  // under it fails validation for every paragraph inside the shadow, and the fail-open
  // below would then strip identity from the WHOLE document. Mint under a fresh alias
  // (outside the conflicting set → valid at every depth) instead.
  const conflicting = conflictingW14Prefixes(part.root);
  const prefix =
    rootPrefix !== null && !conflicting.has(rootPrefix) ? rootPrefix : chooseW14Prefix(conflicting);
  const needsRootBinding = !part.root.namespaceBindings.some(
    (binding) => binding.prefix === prefix && binding.namespaceUri === W14_NAMESPACE_URI
  );
  const attributesByNodeId = new Map<string, readonly OoxmlAttribute[]>();
  for (const paragraph of toMint) {
    const minted = mintParaId(paragraph.id, seen);
    seen.add(minted);
    attributesByNodeId.set(paragraph.id, [
      ...mintedParagraphIdentityAttributes(prefix, minted),
      ...paragraph.attributes.filter((attribute) => !isIdentityAttribute(attribute)),
    ]);
  }

  const rebuild = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    let children: OoxmlNode[] | null = null;
    node.children.forEach((child, index) => {
      const next = rebuild(child);
      if (next !== child) {
        children ??= [...node.children];
        children[index] = next;
      }
    });
    const attributes = attributesByNodeId.get(node.id);
    if (!attributes && !children) return node;
    return freezeElement({
      ...node,
      ...(children ? { children } : {}),
      ...(attributes ? { attributes } : {}),
    } as OoxmlElement);
  };

  let root = rebuild(part.root) as OoxmlElement;
  if (needsRootBinding) {
    const bindings = [
      ...root.namespaceBindings,
      Object.freeze({ prefix, namespaceUri: W14_NAMESPACE_URI }),
    ];
    // `mc:Ignorable` tells strict consumers the prefix is skippable. Append the
    // token only when the attribute already exists without it — creating one
    // would drag in an `mc` binding for a purely cosmetic gain.
    const ignorable = root.attributes.find(
      (attribute) =>
        attribute.namespaceUri === MC_NAMESPACE_URI && attribute.localName === 'Ignorable'
    );
    let attributes: readonly OoxmlAttribute[] = root.attributes;
    if (ignorable && !ignorable.value.trim().split(/\s+/).includes(prefix)) {
      attributes = root.attributes.map((attribute) =>
        attribute === ignorable
          ? (Object.freeze({
              ...attribute,
              value: [ignorable.value.trim(), prefix].filter(Boolean).join(' '),
            }) as OoxmlAttribute)
          : attribute
      );
    }
    root = freezeElement({ ...root, namespaceBindings: bindings, attributes } as OoxmlElement);
  }

  // A rebuilt root outside the edit primitives carries its index — a no-op at document
  // open (no index exists yet), load-bearing when a story replacement normalizes mid-life.
  carryIndexToRebuiltRoot(part.root, root);
  // Frozen like every part the edit primitives publish — layout memos key on part identity,
  // and the freeze discipline is what makes that identity trustworthy.
  const normalized: OoxmlPart = Object.freeze({ ...part, root });
  return validateOoxmlPart(normalized).ok ? normalized : part;
}
