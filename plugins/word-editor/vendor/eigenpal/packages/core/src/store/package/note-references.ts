// Note reference resolution and load diagnostics.
//
// Fail-open on load (matching `resolveHeaderFooterParts`): dangling references are
// retained and reported. Mutation paths that target a missing note fail closed elsewhere.
//
// Scans are bounded by visited nodes (not hit count) and XML part count. Package-wide
// collectors share one budget so hostile parts cannot multiply a per-part cap. Mutation
// callers MUST treat `budget.truncated` as atomic failure — never apply a partial rewrite.

import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { resolveRelationship } from './relationships.ts';
import {
  findNoteById,
  isNormalNote,
  noteIdOf,
  noteKindOf,
  noteReferenceKindOf,
  type NoteKind,
  MAX_NOTES_PER_PART,
} from './note-nodes.ts';
import { noteSegmentsWithAncestorsOf, segmentsOf } from '../store/tree-op-segments.ts';

const FOOTNOTES_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const ENDNOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes';

/** Cap on nodes visited while scanning for note references across stories. */
export const MAX_NOTE_REFERENCE_SCAN = 20_000;

/**
 * Higher bounded cap for explicit note mutations. Diagnostics stay cheap at
 * `MAX_NOTE_REFERENCE_SCAN`; lifecycle commands must still work on ordinary long documents.
 */
export const MAX_NOTE_REFERENCE_MUTATION_SCAN = 1_000_000;

/**
 * Cap on XML parts walked in one package-wide note-reference scan (N/N+1 gate).
 * Soft targets are not allowed: exceeding this marks the shared budget truncated.
 */
export const MAX_NOTE_REFERENCE_PARTS = 256;

/**
 * A load-time note problem worth reporting.
 *
 * `dangling-note-reference` is a citation pointing at no note; `note-reference-scan-truncated`
 * says the scan hit its budget, so absence of further diagnostics is not proof of correctness.
 */
export type NoteDiagnosticCode = 'dangling-note-reference' | 'note-reference-scan-truncated';

/**
 * Load-time note diagnostics. Array API preserved; truncation is signaled as a typed
 * entry rather than by throwing or rejecting the package.
 */
export type NoteDiagnostic =
  | {
      readonly code: 'dangling-note-reference';
      readonly noteKind: NoteKind;
      readonly noteId: number;
      /** Paragraph / container node id when known. */
      readonly sourceNodeId?: string;
    }
  | {
      /** Hard visited/part budget or soft hit cap stopped the scan before full coverage. */
      readonly code: 'note-reference-scan-truncated';
    };

/** One note reference found in a story, with where it sits. */
export interface NoteReferenceHit {
  readonly noteKind: NoteKind;
  readonly noteId: number;
  readonly nodeId: string;
  readonly paragraphId: string;
  /** Canonical UTF-16 atom offset within {@link paragraphId} (U+FFFC model). */
  readonly atomOffset: number;
  readonly customMarkFollows: boolean;
  /** Canonical part name that owns this reference. */
  readonly partName: string;
}

/** Mutable visited-node + part budget shared across parts / package snapshots. */
export interface NoteReferenceScanBudget {
  visited: number;
  readonly maxVisited: number;
  parts: number;
  readonly maxParts: number;
  /** Set when a walk stops before finishing because a cap was hit. */
  truncated: boolean;
}

/** A bounded budget for scanning note references, so a crafted document cannot stall a load. */
export function createNoteReferenceScanBudget(
  maxVisited: number = MAX_NOTE_REFERENCE_SCAN,
  maxParts: number = MAX_NOTE_REFERENCE_PARTS
): NoteReferenceScanBudget {
  return { visited: 0, maxVisited, parts: 0, maxParts, truncated: false };
}

function isWml(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

function attribute(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  for (const entry of node.attributes) {
    if (entry.localName !== localName) continue;
    if (entry.namespaceUri === WML_NAMESPACE_URI || entry.namespaceUri === '') return entry.value;
  }
  return undefined;
}

function customMarkFollowsOf(node: OoxmlNode): boolean {
  const raw = attribute(node, 'customMarkFollows');
  if (raw === undefined) {
    if (node.kind === 'textValue' || !('attributes' in node)) return false;
    return node.attributes.some(
      (entry) =>
        entry.localName === 'customMarkFollows' &&
        (entry.namespaceUri === WML_NAMESPACE_URI || entry.namespaceUri === '')
    );
  }
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

function charge(budget: NoteReferenceScanBudget): boolean {
  if (budget.visited >= budget.maxVisited) {
    budget.truncated = true;
    return false;
  }
  budget.visited += 1;
  return true;
}

function chargePart(budget: NoteReferenceScanBudget): boolean {
  if (budget.parts >= budget.maxParts) {
    budget.truncated = true;
    return false;
  }
  budget.parts += 1;
  return true;
}

/**
 * Resolve the footnotes or endnotes part via safe Internal document relationships.
 *
 * Unusable matching relationships (External, unsafe target, missing part, wrong root)
 * are skipped — never fetched, never accepted — so a decoy first match cannot hide a
 * later usable Internal notes part (same continue-past-bad pattern as settingsPartOf).
 */
export function resolveNotesPart(pkg: OoxmlPackage, noteKind: NoteKind): OoxmlPart | null {
  const typeUri = noteKind === 'footnote' ? FOOTNOTES_REL : ENDNOTES_REL;
  const expectedRoot = noteKind === 'footnote' ? 'footnotes' : 'endnotes';
  const relationships = pkg.relationships.get(pkg.mainDocumentPart) ?? [];
  for (const record of relationships) {
    if (record.type !== typeUri) continue;
    const resolved = resolveRelationship(record);
    if (resolved.mode !== 'Internal' || !resolved.target.ok) continue;
    const part = pkg.parts.get(resolved.target.partName);
    if (!part) continue;
    if (part.root.localName !== expectedRoot) continue;
    return part;
  }
  return null;
}

function pushReferenceHit(
  hits: NoteReferenceHit[],
  node: OoxmlNode,
  paragraphId: string,
  atomOffset: number,
  partName: string,
  maxHits: number
): void {
  const refKind = noteReferenceKindOf(node);
  if (!refKind) return;
  const noteId = noteIdOf(node);
  if (noteId === null || hits.length >= maxHits) return;
  hits.push({
    noteKind: refKind,
    noteId,
    nodeId: node.id,
    paragraphId,
    atomOffset,
    customMarkFollows: customMarkFollowsOf(node),
    partName,
  });
}

/**
 * Collect addressable note references inside one paragraph.
 *
 * `atomOffset` is taken from the canonical UTF-16 segment model (`segmentsOf`): typed
 * `noteReference` segment nodes only. Generic/demoted wrappers (inline SDT husks,
 * malformed refs) contribute no phantom atoms and must not shift later offsets.
 * Lifecycle still removes those hits by node id in typed stories; demoted content stays
 * preserved in-tree for fail-open load without inventing a second address space.
 */
function collectParagraphNoteReferences(
  paragraph: OoxmlParagraphNode,
  hits: NoteReferenceHit[],
  budget: NoteReferenceScanBudget,
  maxHits: number,
  partName: string,
  ancestors: readonly OoxmlNode[],
  includeReference?: (node: OoxmlNode, ancestors: readonly OoxmlNode[]) => boolean
): void {
  const projection = includeReference ? noteSegmentsWithAncestorsOf(paragraph) : null;
  const segments = projection?.segments ?? segmentsOf(paragraph);
  // The caller (walk) already returned on a truncated budget; only charge() can truncate
  // here, and it reports that by returning false.
  for (const segment of segments) {
    if (hits.length >= maxHits) return;
    if (!charge(budget)) return;
    if (segment.node.kind !== 'noteReference') continue;
    if (
      includeReference &&
      !includeReference(segment.node, [
        ...ancestors,
        ...(projection?.ancestorsByNodeId.get(segment.node.id) ?? []),
      ])
    ) {
      continue;
    }
    pushReferenceHit(hits, segment.node, paragraph.id, segment.start, partName, maxHits);
  }
}

const NO_NOTE_HITS: readonly NoteReferenceHit[] = Object.freeze([]);

/**
 * Budgeted subtree memo: the hits under one immutable node plus the exact visited-node
 * count the plain budgeted walk charges for that subtree (including the subtree root's
 * own charge).
 *
 * Every scan runs the one walk — budget-free entry points (layout's per-publish scans)
 * run it under a fresh effectively-unbounded budget — so this is the ONE memo for both.
 * A walk that reaches a memoized subtree bulk-charges the cached count and reuses the
 * hits without descending — but only when the cached count fits the remaining budget AND
 * appending the cached hits stays under `maxHits`. Otherwise the walk falls through to
 * the plain descent, which stops at exactly the node the unmemoized walk would stop at.
 * Every budgeted scan is therefore byte-identical to the unmemoized walk — hits,
 * `visited` and `truncated` alike — warm or cold, truncated or not, so downstream parts
 * sharing one budget behave identically and pre-truncation hit prefixes (which
 * `diagnoseNoteReferences` reports) survive.
 *
 * An entry is only ever written for a subtree the walk covered COMPLETELY — no budget
 * truncation, no maxHits clip, no deep-nesting prune anywhere inside it — so both modes
 * (fail-closed budgeted, prune-and-continue budget-free) can share entries: a complete
 * answer is the same answer under either mode.
 *
 * The entry records the depth and part name it was computed under. The 64-level cap
 * makes container results depth-dependent, so a shared subtree republished at a
 * different depth recomputes instead of serving an answer computed under the old cap
 * (same fix as `subtreeDeepParagraphIdsCache` in `review-reads.ts`). Paragraph answers
 * come from `segmentsOf` alone and never descend, so they are depth-invariant and reused
 * across depths. The part name makes the one-part-per-node assumption self-enforcing:
 * hits carry a baked-in `partName`, so a node reached under a second part name must
 * recompute rather than replay the first part's hits.
 */
interface BudgetedNoteScanEntry {
  readonly hits: readonly NoteReferenceHit[];
  readonly visited: number;
  readonly depth: number;
  readonly partName: string;
}

const budgetedNoteScanMemos = new WeakMap<OoxmlNode, BudgetedNoteScanEntry>();
const projectedNoteScanMemos = new WeakMap<OoxmlNode, Map<string, BudgetedNoteScanEntry>>();
const MAX_PROJECTED_NOTE_SCANS_PER_NODE = 8;

function cacheProjectedNoteScan(node: OoxmlNode, key: string, entry: BudgetedNoteScanEntry): void {
  let cache = projectedNoteScanMemos.get(node);
  if (!cache) {
    cache = new Map();
    projectedNoteScanMemos.set(node, cache);
  }
  if (!cache.has(key) && cache.size >= MAX_PROJECTED_NOTE_SCANS_PER_NODE) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, entry);
}

/**
 * Non-paragraph subtrees below this plain-walk cost carry no memo entry unless they hold
 * a hit. Their nearest memoized ancestor answers for them on an unchanged spine, and a
 * rebuilt spine re-walks them for less than an entry is worth — this keeps the memo from
 * retaining one entry per element of every non-story part. Paragraphs always get an
 * entry: they are the reuse unit when an edit rebuilds the story spine above them. The
 * part root (depth 0) always gets one too: a root entry is what serves the budget-free
 * warm path, and one entry per part is cheap even for a tiny hitless part.
 */
const MEMO_MIN_SUBTREE_VISITED = 64;

/**
 * Test-only observability: bulk memo reuses, counted per serve site so the freshness
 * differential can floor each on its own — a budgeted-walk regression must not hide
 * behind budget-free reuses, an in-walk regression must not hide behind the root fast
 * path, or the reverse.
 */
export const budgetedNoteScanMemoStats = {
  reuses: 0,
  budgetFreeReuses: 0,
  budgetFreeRootReuses: 0,
};

/**
 * Walk a part for addressable typed note references. Budgeted scans are bounded by
 * visited nodes and fail closed on deep hostile nesting (the shared budget is marked
 * truncated and the walk stops, so mutation callers refuse); budget-free scans are
 * bounded by the 64-level depth cap and `maxHits` alone and fail open (a too-deep
 * subtree is pruned and siblings still scan, so layout keeps every reachable citation).
 * When `budget` is supplied it is shared and mutated in place. Hits are segment-aligned
 * (`segmentsOf`); demoted wrappers never invent atomOffsets.
 */
function collectNoteReferencesWithProjection(
  part: OoxmlPart,
  options?: {
    readonly maxHits?: number;
    readonly budget?: NoteReferenceScanBudget;
    /** Optional layout projection gate, given the reference's outermost-first ancestry. */
    readonly includeReference?: (node: OoxmlNode, ancestors: readonly OoxmlNode[]) => boolean;
    /** Enables immutable-subtree reuse for a deterministic projection callback. */
    readonly includeReferenceCache?: {
      readonly projectionKey: string;
      ancestryKey(ancestors: readonly OoxmlNode[]): string;
    };
  }
): readonly NoteReferenceHit[] {
  // Hit count is a soft collector bound for diagnostics only. Mutation paths pass an
  // unbounded maxHits and rely on the visited-node budget (+ truncation) instead. A
  // fractional cap would make warm and cold scans disagree (slice truncates, `>=` does
  // not), and NaN fails every comparison, which would disable the cap entirely — floor
  // once here and reject NaN like a non-positive cap.
  const rawMaxHits = options?.maxHits ?? MAX_NOTE_REFERENCE_SCAN;
  const maxHits = Number.isNaN(rawMaxHits) ? 0 : Math.floor(rawMaxHits);
  if (maxHits <= 0) return NO_NOTE_HITS;
  const external = options?.budget;
  const includeReference = options?.includeReference;
  const includeReferenceCache = options?.includeReferenceCache;
  const projectedKey = (ancestors: readonly OoxmlNode[]): string | null =>
    includeReferenceCache
      ? `${includeReferenceCache.projectionKey};${includeReferenceCache.ancestryKey(ancestors)}`
      : null;

  // Budget-free warm path: a root entry is a complete document-order answer, so a part
  // whose last walk completed returns the same frozen array by identity, publish after
  // publish (sliced only when `maxHits` binds below the cached hit count).
  if (external === undefined && (includeReference === undefined || includeReferenceCache)) {
    const rootProjectedKey = projectedKey([]);
    const cached = rootProjectedKey
      ? projectedNoteScanMemos.get(part.root)?.get(rootProjectedKey)
      : budgetedNoteScanMemos.get(part.root);
    if (cached !== undefined && cached.depth === 0 && cached.partName === part.name) {
      budgetedNoteScanMemoStats.budgetFreeRootReuses += 1;
      return cached.hits.length > maxHits ? cached.hits.slice(0, maxHits) : cached.hits;
    }
  }

  // Budget-free callers run the same walk under a fresh effectively-unbounded budget.
  // `charge` accounting does not depend on the cap, so the memo entries this walk
  // writes are exactly the ones a budgeted walk writes and both paths share ONE memo.
  const budget =
    external ?? createNoteReferenceScanBudget(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const pruneDeep = external === undefined;
  const hits: NoteReferenceHit[] = [];
  // Deep-nesting prunes inside the current call, budget-free mode only. Any subtree a
  // prune happened under is incomplete and must not be memoized: a budgeted walk
  // reusing it would report hits and accounting the plain fail-closed walk never would.
  let prunes = 0;
  const ancestors: OoxmlNode[] = [];

  const walk = (node: OoxmlNode, depth: number): void => {
    if (hits.length >= maxHits || budget.truncated) return;
    if (depth > 64) {
      if (pruneDeep) {
        prunes += 1;
        return;
      }
      budget.truncated = true;
      return;
    }

    // Bulk reuse only when the outcome is provably the plain walk's: the cached charge
    // fits the remaining budget and the cached hits stay strictly under maxHits (at the
    // clip the plain walk stops charging mid-subtree, which the bulk charge cannot
    // reproduce). Anything else falls through to the plain descent below, which stops
    // at exactly the node the unmemoized walk stops at. Paragraph answers never depend
    // on depth (segmentsOf only, and depth ≤ 64 held to get here), so a paragraph
    // re-parented deeper by a structural edit still reuses its entry.
    const nodeProjectedKey = projectedKey(ancestors);
    const cached = nodeProjectedKey
      ? projectedNoteScanMemos.get(node)?.get(nodeProjectedKey)
      : includeReference === undefined
        ? budgetedNoteScanMemos.get(node)
        : undefined;
    if (
      cached !== undefined &&
      (cached.depth === depth || node.kind === 'paragraph') &&
      cached.partName === part.name &&
      cached.visited <= budget.maxVisited - budget.visited &&
      hits.length + cached.hits.length < maxHits
    ) {
      budget.visited += cached.visited;
      for (const hit of cached.hits) hits.push(hit);
      if (pruneDeep) budgetedNoteScanMemoStats.budgetFreeReuses += 1;
      else budgetedNoteScanMemoStats.reuses += 1;
      return;
    }

    const startVisited = budget.visited;
    const startHits = hits.length;
    const startPrunes = prunes;
    if (!charge(budget)) return;
    if (node.kind === 'textValue') return;

    if (node.kind === 'paragraph') {
      collectParagraphNoteReferences(
        node,
        hits,
        budget,
        maxHits,
        part.name,
        ancestors,
        includeReference
      );
    } else {
      ancestors.push(node);
      for (const child of node.children) walk(child, depth + 1);
      ancestors.pop();
    }

    // Memoize only subtrees the walk covered completely: a budget truncation, a maxHits
    // clip or a deep-nesting prune inside the subtree leaves nodes uncharged and hits
    // unrecorded, and caching that partial answer would replay it as a complete one.
    // (`>= maxHits` is ambiguous — the clip may have bound on the subtree's last hit —
    // so it never caches.)
    if (budget.truncated || hits.length >= maxHits || prunes > startPrunes) return;
    const visited = budget.visited - startVisited;
    const gotHits = hits.length > startHits;
    if (
      depth > 0 &&
      node.kind !== 'paragraph' &&
      node.kind !== 'tableRow' &&
      !gotHits &&
      visited < MEMO_MIN_SUBTREE_VISITED
    ) {
      return;
    }
    const entry = {
      hits: gotHits ? Object.freeze(hits.slice(startHits)) : NO_NOTE_HITS,
      visited,
      depth,
      partName: part.name,
    };
    if (nodeProjectedKey) cacheProjectedNoteScan(node, nodeProjectedKey, entry);
    else if (includeReference === undefined) budgetedNoteScanMemos.set(node, entry);
  };

  walk(part.root, 0);
  return hits;
}

/** Walk a part without applying a layout projection. */
export function collectNoteReferences(
  part: OoxmlPart,
  options?: {
    readonly maxHits?: number;
    readonly budget?: NoteReferenceScanBudget;
  }
): readonly NoteReferenceHit[] {
  return collectNoteReferencesWithProjection(part, options);
}

/**
 * Layout-internal projected collector. Kept out of the store barrel so projection
 * callbacks and their cache identity never become part of the public store contract.
 */
export function collectProjectedNoteReferences(
  part: OoxmlPart,
  projection: {
    readonly projectionKey: string;
    readonly ancestryKey: (ancestors: readonly OoxmlNode[]) => string;
    readonly includeReference: (node: OoxmlNode, ancestors: readonly OoxmlNode[]) => boolean;
  }
): readonly NoteReferenceHit[] {
  return collectNoteReferencesWithProjection(part, {
    includeReference: projection.includeReference,
    includeReferenceCache: {
      projectionKey: projection.projectionKey,
      ancestryKey: projection.ancestryKey,
    },
  });
}

/** Collect references across every XML part under one shared part + visited-node budget. */
export function collectPackageNoteReferences(
  pkg: OoxmlPackage,
  options?: {
    readonly budget?: NoteReferenceScanBudget;
    /** Soft hit cap for diagnostics. Omit / Infinity for mutation scans. */
    readonly maxHits?: number;
  }
): readonly NoteReferenceHit[] {
  const budget = options?.budget ?? createNoteReferenceScanBudget();
  const maxHits = options?.maxHits ?? MAX_NOTE_REFERENCE_SCAN;
  const hits: NoteReferenceHit[] = [];
  for (const part of pkg.parts.values()) {
    if (budget.truncated) break;
    if (!part.name.endsWith('.xml')) continue;
    if (!chargePart(budget)) break;
    const batch = collectNoteReferences(part, {
      maxHits: Number.isFinite(maxHits) ? Math.max(0, maxHits - hits.length) : maxHits,
      budget,
    });
    hits.push(...batch);
  }
  return hits;
}

/**
 * Load diagnostics for dangling note references. Fail-open: never throws or mutates;
 * returns diagnostics for callers to surface. Does not invent missing note bodies.
 *
 * When the hard visited/part budget truncates or the soft hit cap binds, appends a single
 * `note-reference-scan-truncated` entry so incomplete coverage is visible without breaking
 * consumers that filter on `dangling-note-reference`.
 */
export function diagnoseNoteReferences(pkg: OoxmlPackage): readonly NoteDiagnostic[] {
  const footnotes = resolveNotesPart(pkg, 'footnote');
  const endnotes = resolveNotesPart(pkg, 'endnote');
  const diagnostics: NoteDiagnostic[] = [];
  const budget = createNoteReferenceScanBudget();
  const maxHits = MAX_NOTE_REFERENCE_SCAN;
  const hits = collectPackageNoteReferences(pkg, { budget, maxHits });

  const noteExists = (kind: NoteKind, id: number): boolean => {
    const part = kind === 'footnote' ? footnotes : endnotes;
    if (!part) return false;
    const note = findNoteById(part.root, id);
    return note !== undefined && (isNormalNote(note) || noteKindOf(note) !== null);
  };

  for (const hit of hits) {
    if (noteExists(hit.noteKind, hit.noteId)) continue;
    diagnostics.push({
      code: 'dangling-note-reference',
      noteKind: hit.noteKind,
      noteId: hit.noteId,
      sourceNodeId: hit.nodeId,
    });
    if (diagnostics.length >= MAX_NOTES_PER_PART) break;
  }

  // Soft maxHits stops without setting budget.truncated; treat a full hit buffer as
  // incomplete coverage (≥ cap). Exact-cap packages are astronomically rare at 20k.
  if (budget.truncated || hits.length >= maxHits) {
    diagnostics.push({ code: 'note-reference-scan-truncated' });
  }
  return diagnostics;
}

/** Whether a notes-part root contains a note with the given id (any type). */
export function notesPartHasId(part: OoxmlPart, noteId: number): boolean {
  return findNoteById(part.root, noteId) !== undefined;
}

/** List normal (body) note ids in document order, bounded. */
export function normalNoteIds(part: OoxmlPart): readonly number[] {
  const ids: number[] = [];
  if (part.root.kind !== 'footnotes' && part.root.kind !== 'endnotes') return ids;
  for (const child of part.root.children) {
    if (ids.length >= MAX_NOTES_PER_PART) break;
    if (!isWml(child, 'footnote') && !isWml(child, 'endnote') && child.kind !== 'note') continue;
    if (!isNormalNote(child)) continue;
    const id = noteIdOf(child);
    if (id !== null && id > 0) ids.push(id);
  }
  return ids;
}
