import { unsupportedContentOf } from './unsupported-content.ts';
import { registerWidthAlternativeReader } from './paragraph-cache-width-reuse.ts';
import { ParagraphCacheLru } from './paragraph-cache-lru.ts';
import { estimatedParagraphCacheEntryBytes } from './paragraph-cache-weight.ts';
import { registerParagraphCachePeek } from './paragraph-cache-peek.ts';
// Reusing measured and broken lines across revisions (task 9.2).
//
// Breaking a paragraph into lines is the expensive half of layout: every piece is measured,
// every word boundary tested. PLACING those lines — assigning y, cutting fragments at page
// boundaries — is arithmetic over results already in hand. So the break is cached and the
// placement is always redone, which keeps pagination correct after an edit anywhere above
// while a paragraph nobody touched is never measured twice.
//
// A cache is only safe if its key covers everything the cached value depends on. Miss one
// input and the editor shows geometry for a document that no longer exists — worse than no
// cache at all, because it looks right. The key therefore spans:
//
//   CONTENT      the paragraph's text and the run properties over it
//   PROPERTIES   the paragraph's own properties, which decide indents and alignment
//   WIDTH        the space available, since the same text breaks differently in a narrower
//                column
//   PRODUCER     who measured it — a font resource epoch, a shaping library version, a
//                different measurer entirely. Fonts arriving after first paint change every
//                advance in the document, and nothing in the content changes to say so.
//
// The revision is deliberately NOT part of the key: reuse across revisions is the point, and
// a paragraph whose content and context are unchanged lays out identically whatever the
// document around it did.

import type { OoxmlNode } from '@docx-editor.dev/core/store';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { registerParagraphCacheDiagnostics } from './paragraph-cache-diagnostics.ts';
import { sha256FontBytes } from '../store/package/sha256.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  MC_NAMESPACE_URI,
  PIC_NAMESPACE_URI,
  RELATIONSHIPS_NAMESPACE_URI,
  W14_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  WP_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  XMLNS_NAMESPACE_URI,
  XSI_NAMESPACE_URI,
} from '../store/package/ooxml-shared.ts';
import { keepsSubtreeMemo } from '../store/package/subtree-memo-policy.ts';
import { framedTokenJoin } from './framed-token.ts';
import { tableCellBreakKeyChunksOf } from './table-cell-break-keys.ts';

export { framedTokenJoin } from './framed-token.ts';
export {
  aggregateParagraphTokensForTableBlock,
  listTokenForTableBlock,
} from './table-paragraph-tokens.ts';

/** A fingerprint over one paragraph's layout inputs. */
export type ParagraphLayoutKey = string;

/** Cache counters, for asserting that incremental layout is actually reusing work. */
export interface LayoutCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly size: number;
}

/**
 * The per-paragraph measurement cache.
 *
 * Caches the BREAK only — where a paragraph's lines fall at a given width — never its placement.
 * An edit high in a document still repaginates everything below it, while paragraphs nobody
 * touched are never measured again.
 */
export interface ParagraphLayoutCache<T> {
  /**
   * Whether values released after placement remain available to later layout passes.
   *
   * One-shot exporters set this false so producers may avoid defensive snapshots whose
   * only purpose is protecting a value reused by a future pass.
   */
  readonly retainAcrossPasses?: boolean;
  /**
   * Derive a break key inside this cache's ownership scope.
   *
   * Export caches use this hook to release construction-only subtree fingerprints together
   * with measured breaks. Optional so structural/custom cache implementations remain valid.
   */
  keyFor?(inputs: ParagraphKeyInputs): ParagraphLayoutKey;
  get(key: ParagraphLayoutKey): T | undefined;
  set(key: ParagraphLayoutKey, value: T): void;
  /** Release a break after final placement when this cache was created for a one-shot pass. */
  release?(key: ParagraphLayoutKey): void;
  /** Drop entries for paragraphs a commit removed, so the cache cannot grow without bound. */
  retain(keys: ReadonlySet<ParagraphLayoutKey>): void;
  /**
   * Whether THIS published pass should pay for a document-wide {@link retain} sweep.
   *
   * Retention only trims memory — the aging window tolerates deferral — while building the
   * union of live keys costs real time on a large document, so callers ask per pass and
   * sweep on a stride. Per cache instance, so one editor's cadence cannot starve another's.
   * Optional for compatibility: a cache without it is retained on every pass.
   */
  retentionPassDue?(): boolean;
  clear(): void;
  readonly stats: LayoutCacheStats;
}

/**
 * Serialize a property list stably: element order matters, attribute order does not.
 *
 * Boundaries are NUL-framed because attribute VALUES carry file-derived text (marker
 * `w:lvlText`, resolved REF results). A printable join would let a crafted value spell out
 * another property's serialization, and two different property lists would alias to one
 * cache key. XML text cannot carry U+0000, so no file-derived value can forge a boundary.
 */
function propertiesToken(properties: readonly OoxmlProperty[]): string {
  // Join once, without an entry pair and an intermediate string for every attribute.
  // Large tables rebuild these tokens even when the paragraph break stays cached.
  const parts: string[] = [];
  for (let index = 0; index < properties.length; index += 1) {
    const property = properties[index]!;
    if (index > 0) parts.push('\0;');
    parts.push(property.localName, '(\0');
    if (property.attributes) {
      let separator = '';
      for (const name of Object.keys(property.attributes).sort()) {
        parts.push(separator, name, '=', property.attributes[name]!);
        separator = '\0,';
      }
    }
    parts.push('\0)');
  }
  return parts.join('');
}

const immutablePropertyDigests = new WeakMap<readonly OoxmlProperty[], string>();

/** Register properties owned by the internal immutable cell input cache. */
export function rememberLayoutProperties(properties: readonly OoxmlProperty[]): void {
  immutablePropertyDigests.set(properties, reusableLayoutTokenDigest(propertiesToken(properties)));
}

const layoutTokenEncoder = new TextEncoder();

/** Collision-resistant, platform-neutral cache fingerprint over a framed string. */
function layoutTokenDigest(token: string): string {
  return sha256FontBytes(layoutTokenEncoder.encode(token));
}

interface CachedLayoutDigest {
  readonly digest: string;
  readonly bytes: number;
}

const MAX_CACHED_LAYOUT_DIGESTS = 2_048;
const MAX_CACHED_LAYOUT_DIGEST_BYTES = 2 * 1024 * 1024;
const cachedLayoutDigests = new Map<string, CachedLayoutDigest>();
let cachedLayoutDigestBytes = 0;
// Empty optional drawing/projection/exclusion inputs dominate requests. Their digest is
// constant; do not repeatedly delete and reinsert the same LRU entry for each paragraph.
let emptyLayoutDigest: string | undefined;

function reusableLayoutTokenDigest(token: string): string {
  if (token.length === 0) return (emptyLayoutDigest ??= layoutTokenDigest(token));
  const cached = cachedLayoutDigests.get(token);
  // Hits do not mutate insertion order. Repeated delete/set operations accumulate
  // tombstones during table passes; FIFO eviction still bounds this optional memo.
  if (cached) return cached.digest;
  const digest = layoutTokenDigest(token);
  const bytes = token.length * 2;
  if (bytes <= MAX_CACHED_LAYOUT_DIGEST_BYTES) {
    cachedLayoutDigests.set(token, { digest, bytes });
    cachedLayoutDigestBytes += bytes;
    // One iterator for the sweep; see the paragraph cache's `set`.
    for (const [oldestToken, oldest] of cachedLayoutDigests) {
      if (
        cachedLayoutDigests.size <= MAX_CACHED_LAYOUT_DIGESTS &&
        cachedLayoutDigestBytes <= MAX_CACHED_LAYOUT_DIGEST_BYTES
      )
        break;
      cachedLayoutDigests.delete(oldestToken);
      cachedLayoutDigestBytes -= oldest.bytes;
    }
  }
  return digest;
}

/**
 * Namespaces a break-cache token by the inline-drawing CONTEXT that minted it.
 *
 * The context changes how a paragraph breaks — inline drawings are measured as atoms only
 * when it is present — so two passes over the same bytes may not share cache entries just
 * because their per-block tokens agree. One helper for every key path (body blocks, table
 * cells, the section-prepass epoch), so the namespace cannot diverge per lane.
 */
export function withDrawingContext(token: string, inlineDrawingContext: boolean): string {
  return `${token}|${inlineDrawingContext ? 'drawing' : ''}`;
}

/**
 * One fixed-width digest per immutable element subtree.
 *
 * Tree edits are copy-on-write: every changed ancestor gets a new identity, while untouched
 * siblings keep theirs. Caching at each element therefore makes rehashing proportional to the
 * changed path instead of the size of an enclosing table. Text values, and elements without an
 * element grandchild (`keepsSubtreeMemo`), stay inline in their parent's token, avoiding a
 * WeakMap entry for every leaf and every node of leaves (`w:rPr`, `w:tcPr`, a plain `w:r`). No
 * inherited/contextual state enters this digest; every field below belongs to the node itself,
 * so identity reuse is always sound.
 */
interface LayoutKeyMemoMap<K extends object, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): unknown;
}

interface LayoutKeyMemoScope {
  readonly nodeDigests: LayoutKeyMemoMap<object, string>;
  readonly paragraphKeys: LayoutKeyMemoMap<object, ParagraphKeyMemo>;
}

/**
 * Content digests for live editing, shared by every live cache. A digest depends only on the
 * node's own immutable content, so two caches can never disagree about one. Sharing lets an
 * open compute them in short tasks before its first layout ({@link warmLayoutNodeDigests}).
 */
const liveNodeDigests = new WeakMap<object, string>();

function createLayoutKeyMemoScope(retainAcrossPasses: boolean): LayoutKeyMemoScope {
  return retainAcrossPasses
    ? {
        nodeDigests: liveNodeDigests,
        paragraphKeys: new WeakMap<object, ParagraphKeyMemo>(),
      }
    : {
        // A one-shot export owns the complete immutable tree until publication, so weak keys
        // cannot disappear during layout. Ordinary maps avoid ephemeron bookkeeping and, more
        // importantly, are discarded by ParagraphLayoutCache.clear() before review projection.
        nodeDigests: new Map<object, string>(),
        paragraphKeys: new Map<object, ParagraphKeyMemo>(),
      };
}

const sharedLayoutKeyMemoScope = createLayoutKeyMemoScope(true);

interface NodeTokenTestObserver {
  nodeVisits: number;
  active: boolean;
  readonly previous: NodeTokenTestObserver | null;
}

let nodeTokenTestObserver: NodeTokenTestObserver | null = null;

/** @internal Deterministic work recorder for recursive layout-key digest tests. */
export function layoutNodeTokenVisitTestRecorder(): {
  readonly nodeVisits: number;
  reset(): void;
  dispose(): void;
} {
  const observer: NodeTokenTestObserver = {
    nodeVisits: 0,
    active: true,
    previous: nodeTokenTestObserver,
  };
  nodeTokenTestObserver = observer;
  return {
    get nodeVisits() {
      return observer.nodeVisits;
    },
    reset() {
      observer.nodeVisits = 0;
    },
    dispose() {
      if (!observer.active) return;
      observer.active = false;
      // Restore a surrounding observer when recorders are nested. An out-of-order dispose
      // must not detach the newer observer that still owns the instrumentation slot.
      if (nodeTokenTestObserver !== observer) return;
      let restore = observer.previous;
      while (restore && !restore.active) restore = restore.previous;
      nodeTokenTestObserver = restore;
    },
  };
}

function nodeLayoutIdentity(node: OoxmlNode, scope: LayoutKeyMemoScope): string {
  if (node.kind === 'textValue') return layoutTokenDigest(computeNodeToken(node));
  const cached = scope.nodeDigests.get(node);
  if (cached !== undefined) return cached;
  const digest = layoutTokenDigest(computeNodeToken(node, scope));
  scope.nodeDigests.set(node, digest);
  return digest;
}

/**
 * Digest `nodes` into the live digest memo, so a later layout pass keys them without hashing
 * their content again. Hashing a long table's rows took about a second in the first pass.
 */
export function warmLayoutNodeDigests(nodes: readonly OoxmlNode[]): void {
  for (const node of nodes) {
    if (node.kind !== 'textValue') nodeLayoutIdentity(node, sharedLayoutKeyMemoScope);
  }
}

/** The layout digest of `node`'s content, from the live digest memo. */
export function layoutNodeDigest(node: OoxmlNode): string {
  return nodeLayoutIdentity(node, sharedLayoutKeyMemoScope);
}

/** An element whose children are all text values, or that has none. */
function holdsOnlyText(node: Exclude<OoxmlNode, { kind: 'textValue' }>): boolean {
  for (const child of node.children) if (child.kind !== 'textValue') return false;
  return true;
}

/**
 * A child read inline: text-only or empty, or without an element grandchild and narrower than
 * `WIDE_SUBTREE_CHILDREN`. Such a child re-reads in at most a few hundred node visits, about
 * what one digest costs, so it needs no entry. The choice depends only on the child's own
 * subtree, and the role framing tells an inline token from a digest.
 */
function readsInline(child: Exclude<OoxmlNode, { kind: 'textValue' }>): boolean {
  return holdsOnlyText(child) || !keepsSubtreeMemo(child);
}

/**
 * Short codes for common namespace URIs. A namespace URI is about 60 characters and repeats
 * on almost every attribute, so written out in full it was a large part of all hashed key
 * text on a long document.
 */
const KNOWN_NAMESPACE_TOKENS = new Map(
  [
    WML_NAMESPACE_URI,
    XML_NAMESPACE_URI,
    XMLNS_NAMESPACE_URI,
    MC_NAMESPACE_URI,
    XSI_NAMESPACE_URI,
    W14_NAMESPACE_URI,
    DRAWINGML_MAIN_NAMESPACE_URI,
    WP_NAMESPACE_URI,
    PIC_NAMESPACE_URI,
    RELATIONSHIPS_NAMESPACE_URI,
  ].map((uri, index) => [uri, `k${index}`])
);

/**
 * A short, injective token for an attribute namespace. A known URI becomes `k<index>`. Any
 * other value keeps its full text behind a `u` prefix, so file text cannot match a code.
 */
function namespaceToken(namespaceUri: string | undefined): string {
  if (namespaceUri === undefined) return '';
  return KNOWN_NAMESPACE_TOKENS.get(namespaceUri) ?? `u${namespaceUri}`;
}

function computeNodeToken(
  node: OoxmlNode,
  scope: LayoutKeyMemoScope = sharedLayoutKeyMemoScope
): string {
  if (nodeTokenTestObserver) nodeTokenTestObserver.nodeVisits += 1;
  if (node.kind === 'textValue') return framedTokenJoin(['text', node.value]);
  const attributes: string[] = [];
  const unsupported = unsupportedContentOf(node);
  if (unsupported)
    attributes.push(
      framedTokenJoin([
        'unsupported',
        unsupported.display,
        String(unsupported.width),
        String(unsupported.height),
      ])
    );
  // Attribute order is not semantic, but every tuple and sequence boundary must be. File
  // values may contain any printable delimiter, so length-prefix each component. Append in
  // a loop as OOXML is untrusted: spreading an attacker-sized attribute list can exceed the
  // engine's argument-count limit before the document reaches configured byte limits.
  for (const attribute of node.attributes) {
    attributes.push(
      framedTokenJoin([
        namespaceToken(attribute.namespaceUri),
        attribute.localName,
        attribute.value,
      ])
    );
  }
  attributes.sort();
  const children: string[] = [];
  for (const child of node.children) {
    // A digest is fixed-width and collision-resistant, so retaining one per immutable child
    // avoids both the old whole-table rewalk and quadratic retained recursive token strings.
    // A child of leaves (`w:rPr` of `w:b` and `w:sz`, or `w:t`) costs no more to re-read than
    // its digest and makes up most of a document's elements, so its token stays inline.
    // Frame each role as well as its value: no token can masquerade as another kind of child.
    children.push(
      child.kind === 'textValue'
        ? computeNodeToken(child)
        : readsInline(child)
          ? framedTokenJoin(['child-inline', computeNodeToken(child, scope)])
          : framedTokenJoin(['child-digest', nodeLayoutIdentity(child, scope)])
    );
  }
  return framedTokenJoin([
    'element',
    node.kind,
    node.localName,
    node.id,
    framedTokenJoin(attributes),
    framedTokenJoin(children),
  ]);
}

/**
 * Everything that decides whether a cached paragraph break is still valid.
 *
 * `producer` is in the key because a font arriving after first paint changes every advance in the
 * document while no content changes — without it the cache would serve the pre-font layout
 * forever.
 */
export interface ParagraphKeyInputs {
  readonly paragraph: OoxmlNode;
  readonly properties: readonly OoxmlProperty[];
  /** Available width, which decides where the lines break. */
  readonly width: number;
  /**
   * Who produced the measurements.
   *
   * Fonts loading after first paint change every advance while no content changes, so a
   * cache keyed on content alone would serve the pre-font layout forever.
   */
  readonly producer: string;
  /**
   * Inline drawing projection/resource epoch for this paragraph.
   *
   * Pending→ready/refused transitions and extent/hidden changes must invalidate breaks even
   * when paragraph text is unchanged.
   */
  readonly drawingToken?: string;
  /** Paragraph-local semantic projection identity (links and live metadata fields). */
  readonly projectionToken?: string;
  /** Active page exclusion zones affecting this paragraph's break. */
  readonly exclusionToken?: string;
}

/**
 * How each {@link ParagraphKeyInputs} field reaches the memo hit test in
 * {@link paragraphLayoutKey}. The `satisfies` clause makes a new input field a compile
 * error here until it is classified — the trap this map exists for is the memo: an input
 * folded into the joined key but missing from the memo comparison is SILENTLY INERT,
 * because the memo returns the previous key before the join ever runs.
 *
 * - `'memo-identity'`: the WeakMap key itself; its content reaches the key via a SHA-256 digest.
 * - `'memo-compared'`: compared verbatim (after normalization) in the memo hit test AND
 *   folded into the key.
 * - `'memo-derived'`: compared through a derived token (`propertiesToken`).
 */
export const PARAGRAPH_KEY_INPUT_ROLES = {
  paragraph: 'memo-identity',
  properties: 'memo-derived',
  width: 'memo-compared',
  producer: 'memo-compared',
  drawingToken: 'memo-compared',
  projectionToken: 'memo-compared',
  exclusionToken: 'memo-compared',
} as const satisfies Record<
  keyof ParagraphKeyInputs,
  'memo-identity' | 'memo-compared' | 'memo-derived'
>;

interface ParagraphKeyMemoEntry {
  readonly producerIdentity: string;
  readonly width: number;
  readonly drawingIdentity: string;
  readonly projectionIdentity: string;
  readonly exclusionIdentity: string;
  readonly propertiesToken: string;
  readonly key: ParagraphLayoutKey;
}

interface ParagraphKeyMemo {
  readonly entries: ParagraphKeyMemoEntry[];
}

/**
 * Small digest-match memo of compact keys per immutable paragraph/table node.
 *
 * The canonical tree is immutable: an edit replaces the affected node, while unchanged nodes
 * preserve identity. SHA-256 fingerprints every layout-affecting input without serializing an
 * entire OOXML subtree into every cache key. A few slots preserve the common prepass/placement
 * widths; eviction only causes a safe miss.
 */
// Keep the current probe and placement widths; older states can rebuild their keys.
const MAX_PARAGRAPH_KEY_SLOTS = 2;

/**
 * The cache key for one paragraph's measured break.
 *
 * Folds in the content, the available width, and the measurement producer. Anything that changes
 * where lines fall must be in here, or the cache serves a break taken under different conditions.
 */
export function paragraphLayoutKey(inputs: ParagraphKeyInputs): ParagraphLayoutKey {
  return paragraphLayoutKeyInScope(inputs, sharedLayoutKeyMemoScope);
}

function paragraphLayoutKeyInScope(
  inputs: ParagraphKeyInputs,
  scope: LayoutKeyMemoScope
): ParagraphLayoutKey {
  // Width is quantized to a thousandth of a point: a width that differs by less than that
  // cannot move a break, and keying on the raw float would miss on every scroll that
  // recomputes it.
  const width = Math.round(inputs.width * 1000);
  const drawingToken = inputs.drawingToken ?? '';
  const projectionToken = inputs.projectionToken ?? '';
  const exclusionToken = inputs.exclusionToken ?? '';
  const properties =
    immutablePropertyDigests.get(inputs.properties) ??
    reusableLayoutTokenDigest(propertiesToken(inputs.properties));
  const nodeIdentity = nodeLayoutIdentity(inputs.paragraph, scope);
  const producerIdentity = reusableLayoutTokenDigest(inputs.producer);
  const drawingIdentity = reusableLayoutTokenDigest(drawingToken);
  const projectionIdentity = reusableLayoutTokenDigest(projectionToken);
  const exclusionIdentity = reusableLayoutTokenDigest(exclusionToken);
  let memo = scope.paragraphKeys.get(inputs.paragraph);
  const entryIndex = memo?.entries.findIndex(
    (entry) =>
      entry.producerIdentity === producerIdentity &&
      entry.width === width &&
      entry.drawingIdentity === drawingIdentity &&
      entry.projectionIdentity === projectionIdentity &&
      entry.exclusionIdentity === exclusionIdentity &&
      entry.propertiesToken === properties
  );
  if (memo && entryIndex !== undefined && entryIndex >= 0) {
    const entry = memo.entries[entryIndex]!;
    if (entryIndex !== memo.entries.length - 1) {
      memo.entries.splice(entryIndex, 1);
      memo.entries.push(entry);
    }
    return entry.key;
  }
  const key = `plk:${nodeIdentity}:${producerIdentity}:${width}:${drawingIdentity}:${projectionIdentity}:${exclusionIdentity}:${properties}`;
  if (!memo) {
    memo = { entries: [] };
    scope.paragraphKeys.set(inputs.paragraph, memo);
  }
  const sharedProperties =
    memo.entries.find((entry) => entry.propertiesToken === properties)?.propertiesToken ??
    properties;
  memo.entries.push({
    producerIdentity,
    width,
    drawingIdentity,
    projectionIdentity,
    exclusionIdentity,
    propertiesToken: sharedProperties,
    key,
  });
  if (memo.entries.length > MAX_PARAGRAPH_KEY_SLOTS) memo.entries.shift();
  return key;
}

/** How large the paragraph cache grows before least-recently-used eviction. */
export interface ParagraphLayoutCacheOptions {
  /**
   * Entries retained before the least recently used are dropped.
   *
   * The default has to exceed a realistic document, or a full pass evicts exactly what the
   * next one needs and the cache costs more than it saves. Unset, an estimated byte budget
   * bounds the cache instead, because one cached break can be a hundred times another.
   */
  readonly maxEntries?: number;
  /** Keep placed breaks for later revisions. Default true; false bounds one-shot exporters. */
  readonly retainAcrossPasses?: boolean;
}

// Per table node, the cell keys a pass recorded (`table-cell-break-keys.ts`).
export {
  createTableCellBreakKeyCollector,
  registerTableCellBreakKeys,
  tableCellBreakKeysOf,
} from './table-cell-break-keys.ts';

/**
 * Retain a pass's live keys: its block keys plus the recorded cell keys of its tables.
 *
 * With a `collector` (the multi-section orchestrator's shared set) the keys are only
 * ADDED — the orchestrator retains once over the union, because retaining per section
 * evicted every other section's entries.
 */
export function retainLiveBreakKeys<T>(
  cache: ParagraphLayoutCache<T> | undefined,
  collector: Set<string> | undefined,
  blockKeys: readonly string[],
  tables: readonly object[]
): void {
  if (!cache) return;
  const retained = collector ?? new Set<string>();
  for (const key of blockKeys) retained.add(key);
  for (const table of tables)
    for (const chunk of tableCellBreakKeyChunksOf(table) ?? [])
      for (const key of chunk) retained.add(key);
  if (!collector) cache.retain(retained);
}

/**
 * Passes between document-wide retention sweeps.
 *
 * Retention only trims memory — the generation TTL tolerates deferral — while the union of
 * live keys it builds costs real time on a large document. So it runs on a stride of
 * published passes instead of on every keystroke; between sweeps the cache grows by at most
 * one re-keyed paragraph per pass. A pass that re-keys much of the document asks for its
 * sweep at once instead (see `retentionPassDue`). The tick lives on each cache instance
 * ({@link ParagraphLayoutCache.retentionPassDue}), so interleaved editors in one process
 * cannot starve each other's sweeps.
 */
const RETENTION_PASS_STRIDE = 8;

/**
 * How many retain generations an entry survives without being listed or touched.
 *
 * `retain` receives the keys a pass can NAME cheaply — the top-level block keys plus the
 * registered table-cell keys. Lanes that mint keys the pass cannot enumerate up front
 * (notes, textbox stories) live on this grace period instead: touched entries re-stamp, so
 * only keys no pass has wanted for this many retains are dropped. One retain runs per
 * published layout pass, so the window is "recent passes", not wall time.
 */
const RETAIN_GENERATION_TTL = 8;

/** @internal Retention budgets of one paragraph cache, in estimated retained bytes. */
export interface ParagraphLayoutCacheBudget {
  /** Above this, entries outside the current working set are evicted. */
  readonly softBytes: number;
  /** Above this, even the current working set is evicted, least recent first. */
  readonly hardBytes: number;
}

/**
 * Default budgets.
 *
 * The soft budget is the slack kept for entries no recent pass wanted: undo states, other
 * zoom levels. The hard budget is what the working set of a very large document may hold;
 * no entry larger than it is admitted. Both are in estimated bytes; see
 * `estimatedParagraphCacheEntryBytes` for what the estimate covers.
 */
export const DEFAULT_PARAGRAPH_CACHE_BUDGET: ParagraphLayoutCacheBudget = Object.freeze({
  softBytes: 16 * 1024 * 1024,
  // The estimate runs several times the retained heap. At 128 MiB a 1,400-page document's
  // working set no longer fit, so each footnote-reserve round broke thousands of evicted
  // paragraphs again; keeping that document whole cost under 20 MB of real heap.
  hardBytes: 512 * 1024 * 1024,
});

/**
 * A bounded least-recently-used cache with generation-scoped retention.
 *
 * Bounded because a long editing session touches far more paragraph states than a document
 * contains — every keystroke mints a new key for the paragraph being typed in — and an
 * unbounded cache would hold every intermediate state of the session.
 *
 * The bound never evicts the CURRENT working set: entries named by this generation's
 * retain or touched since it began are skipped, and the cache grows past its soft budget
 * when a document is larger than it — evicting live entries made every full pass on a
 * 500-page document re-measure the whole document.
 */
export function createParagraphLayoutCache<T>(
  options: ParagraphLayoutCacheOptions = {}
): ParagraphLayoutCache<T> {
  return createBudgetedParagraphLayoutCache(options, DEFAULT_PARAGRAPH_CACHE_BUDGET);
}

/** @internal {@link createParagraphLayoutCache} with explicit byte budgets. */
export function createBudgetedParagraphLayoutCache<T>(
  options: ParagraphLayoutCacheOptions,
  budget: ParagraphLayoutCacheBudget
): ParagraphLayoutCache<T> {
  const softEntries =
    options.maxEntries === undefined ? Number.POSITIVE_INFINITY : Math.max(1, options.maxEntries);
  // The absolute ceiling the working-set exemption below cannot exceed: a cache whose
  // owner never (or rarely) retains still may not grow without bound.
  const hardEntries = softEntries * 8;
  const softBytes = Math.max(0, budget.softBytes);
  const hardBytes = Math.max(softBytes, budget.hardBytes);
  const retainAcrossPasses = options.retainAcrossPasses ?? true;
  const entries = new ParagraphCacheLru<T>();
  let keyMemoScope = createLayoutKeyMemoScope(retainAcrossPasses);
  let generation = 0;
  let retentionTick = 0;
  // Bytes written since the last retain, and the live bytes that retain named. A pass that
  // re-keys a large part of the document (fonts arriving, zoom) asks for a sweep early.
  let admittedBytes = 0;
  let namedBytes = 0;
  let hits = 0;
  let misses = 0;
  let evictions = 0;
  let softLimitEvictions = 0;
  let hardLimitEvictions = 0;
  let staleEvictions = 0;
  let supersededEvictions = 0;
  let oversizedRefusals = 0;
  let releasedEntries = 0;
  let clearedEntries = 0;

  const overSoft = (): boolean => entries.bytes > softBytes || entries.size > softEntries;
  const overHard = (): boolean => entries.bytes > hardBytes || entries.size > hardEntries;
  const remove = (key: string): void => {
    entries.delete(key);
    evictions += 1;
  };
  /** Write one entry. A width transfer moves bytes rather than admitting new ones. */
  const store = (key: string, value: T, admitted: boolean): void => {
    const bytes = estimatedParagraphCacheEntryBytes(key, value);
    if (bytes > hardBytes) {
      // Never admitted: the caller already holds the lines, and a later miss re-breaks them.
      // An older value under the same key is dropped too, so the key cannot serve it.
      if (entries.delete(key)) evictions += 1;
      oversizedRefusals += 1;
      return;
    }
    entries.set(key, value, bytes, generation);
    if (admitted) admittedBytes += bytes;
    while (overSoft()) {
      const oldest = entries.oldest()!;
      // Never evict the entry being written; it fits the hard budget on its own.
      if (oldest.key === key) break;
      const hard = overHard();
      // The least recent entry is still part of the current working set: everything
      // after it is too, so the soft budget yields rather than thrash — up to the hard
      // ceiling, past which memory wins over reuse.
      if (Math.max(oldest.touched, oldest.named) >= generation && !hard) break;
      if (hard) hardLimitEvictions += 1;
      else softLimitEvictions += 1;
      remove(oldest.key);
    }
  };

  const cache: ParagraphLayoutCache<T> = {
    retainAcrossPasses,
    keyFor(inputs) {
      return paragraphLayoutKeyInScope(inputs, keyMemoScope);
    },
    get(key) {
      const entry = entries.entry(key, true);
      if (entry === undefined) {
        misses += 1;
        return undefined;
      }
      hits += 1;
      entry.touched = generation;
      return entry.value;
    },

    set(key, value) {
      store(key, value, true);
    },

    release(key) {
      if (!retainAcrossPasses && entries.delete(key)) releasedEntries += 1;
    },

    retentionPassDue() {
      retentionTick += 1;
      if (retentionTick % RETENTION_PASS_STRIDE === 0) return true;
      // A re-keying pass (fonts, zoom, a wholesale property change) left about a document's
      // worth of entries the next pass will never ask for. Sweep now rather than strides
      // later, so they do not hold memory or crowd out the new working set meanwhile.
      return retainAcrossPasses && admittedBytes > Math.max(softBytes, namedBytes / 2);
    },

    retain(keys) {
      const previous = generation;
      generation += 1;
      let named = 0;
      for (const key of keys) {
        const entry = entries.entry(key);
        if (!entry || entry.named === generation) continue;
        entry.named = generation;
        named += entry.bytes;
      }
      namedBytes = named;
      admittedBytes = 0;
      for (const entry of entries.fromOldest()) {
        if (generation - Math.max(entry.touched, entry.named) > RETAIN_GENERATION_TTL) {
          remove(entry.key);
          staleEvictions += 1;
        } else if (
          // Listed as live by the previous retain, not by this one, and untouched since:
          // the document no longer has this break. Only lanes retain can enumerate are
          // judged; notes, textboxes and furniture live on touches and the TTL alone.
          entry.named === previous &&
          entry.touched < previous &&
          overSoft()
        ) {
          remove(entry.key);
          supersededEvictions += 1;
        }
      }
    },

    clear() {
      clearedEntries += entries.size;
      entries.clear();
      admittedBytes = 0;
      namedBytes = 0;
      // Reset both weak live-editor memos and strong one-shot memos. For byte exports this is
      // the phase boundary before review projection/publication, not merely cache housekeeping.
      keyMemoScope = createLayoutKeyMemoScope(retainAcrossPasses);
    },

    get stats() {
      return { hits, misses, evictions, size: entries.size };
    },
  };
  if (retainAcrossPasses)
    registerWidthAlternativeReader(cache, (paragraph, key, accept) => {
      const memo = keyMemoScope.paragraphKeys.get(paragraph);
      const current = memo?.entries.find((entry) => entry.key === key);
      if (!current) return undefined;
      for (const entry of memo!.entries) {
        if (
          entry === current ||
          entry.producerIdentity !== current.producerIdentity ||
          entry.drawingIdentity !== current.drawingIdentity ||
          entry.projectionIdentity !== current.projectionIdentity ||
          entry.exclusionIdentity !== current.exclusionIdentity ||
          entry.propertiesToken !== current.propertiesToken
        )
          continue;
        const existing = entries.get(entry.key);
        if (!existing || !accept(existing)) continue;
        // Transfer the entry: retaining both widths would evict later rows before their turn.
        entries.delete(entry.key);
        store(key, existing, false);
        return existing;
      }
      return undefined;
    });
  registerParagraphCachePeek(cache, (key) => entries.get(key));
  registerParagraphCacheDiagnostics(cache, {
    snapshot() {
      let keyTextBytes = 0;
      for (const key of entries.keys()) keyTextBytes += key.length * 2;
      return {
        hits,
        misses,
        evictions,
        size: entries.size,
        softLimit: softEntries,
        hardLimit: hardEntries,
        estimatedBytes: entries.bytes,
        namedBytes,
        softLimitBytes: softBytes,
        hardLimitBytes: hardBytes,
        keyTextBytes,
        softLimitEvictions,
        hardLimitEvictions,
        staleEvictions,
        supersededEvictions,
        oversizedRefusals,
        releasedEntries,
        clearedEntries,
      };
    },
    visit(consume) {
      for (const value of entries.values()) consume(value);
    },
  });
  return cache;
}
