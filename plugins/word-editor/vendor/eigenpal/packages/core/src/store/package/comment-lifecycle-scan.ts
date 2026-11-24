// Bounded, owner-aware walks for comment deletion.
//
// Marker remaining-scans, thread metadata, and comments-part indexing all walk
// attacker-controlled XML. A part-count cap is not enough: one hostile part can hold
// millions of nodes. Every walk here shares a visited-node + part budget; overflow is
// truncated, never an unbounded finish.

import { inlineCharacterTextOf } from './hyphen-text.ts';
import { resolveInternalTarget } from './opc-names.ts';
import { relationshipsOf, resolveContentTypeOf } from './package-edit.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { W14_NAMESPACE_URI } from './ooxml-shared.ts';
import { isValidParaId } from './para-id.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from './ooxml-tree.ts';
import { isLegacyVmlAtom } from './legacy-vml-projection.ts';

/** The `w15` namespace: `commentsExtended.xml` — `w15:commentEx`. */
export const W15_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2012/wordml';
/** The `w16cid` namespace: `@parentId` on `w:comment`, and `commentsIds.xml`. */
export const W16CID_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2016/wordml/cid';

export const COMMENTS_PART = '/word/comments.xml';
export const COMMENTS_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_EXTENDED_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml';
/** Word still authors the transitional Override on many real files. */
const COMMENTS_EXTENDED_TYPE_MS = 'application/vnd.ms-word.commentsExtended+xml';
const COMMENTS_EXTENDED_TYPES = [COMMENTS_EXTENDED_TYPE, COMMENTS_EXTENDED_TYPE_MS] as const;
const COMMENTS_EXTENDED_REL =
  'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const COMMENTS_IDS_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml';
const COMMENTS_IDS_TYPE_MS = 'application/vnd.ms-word.commentsIds+xml';
const COMMENTS_IDS_TYPES = [COMMENTS_IDS_TYPE, COMMENTS_IDS_TYPE_MS] as const;
const COMMENTS_IDS_REL = 'http://schemas.microsoft.com/office/2016/relationships/commentsIds';

/** Cap on XML parts walked in one remaining-marker / vanished-note scan. */
export const MAX_COMMENT_SCAN_PARTS = 512;
/** Cap on nodes visited in one deletion/reap scan. */
export const MAX_COMMENT_SCAN_VISITED = 50_000;
/** Nesting cap for one charged walk. Overflow marks the shared budget truncated. */
export const MAX_COMMENT_SCAN_DEPTH = 64;

/** Mutable visited-node + part budget shared across one deletion or reap. */
export interface CommentScanBudget {
  visited: number;
  readonly maxVisited: number;
  parts: number;
  readonly maxParts: number;
  truncated: boolean;
}

/** A fresh budget. Callers can supply operation-specific caps; tests can inject tighter limits. */
export function createCommentScanBudget(
  maxVisited: number = MAX_COMMENT_SCAN_VISITED,
  maxParts: number = MAX_COMMENT_SCAN_PARTS
): CommentScanBudget {
  return { visited: 0, maxVisited, parts: 0, maxParts, truncated: false };
}

export function chargeVisit(budget: CommentScanBudget): boolean {
  if (budget.visited >= budget.maxVisited) {
    budget.truncated = true;
    return false;
  }
  budget.visited += 1;
  return true;
}

export function chargePart(budget: CommentScanBudget): boolean {
  if (budget.parts >= budget.maxParts) {
    budget.truncated = true;
    return false;
  }
  budget.parts += 1;
  return true;
}

/**
 * Walk `root` charging every node. `visit` returning true skips children (a found marker,
 * a comment record). `onText` sees `textValue` nodes so covering can count content without a
 * second walk. Returns false when the budget truncates.
 */
export function walkCharged(
  root: OoxmlNode,
  budget: CommentScanBudget,
  visit: (node: OoxmlElement) => boolean,
  depth = 0,
  onText?: (value: string) => void
): boolean {
  if (!chargeVisit(budget)) return false;
  if (root.kind === 'textValue') {
    onText?.(root.value);
    return true;
  }
  if (depth > MAX_COMMENT_SCAN_DEPTH) {
    budget.truncated = true;
    return false;
  }
  if (visit(root)) return true;
  for (const child of root.children) {
    if (!walkCharged(child, budget, visit, depth + 1, onText)) return false;
  }
  return true;
}

export function attribute(
  node: OoxmlElement,
  namespaceUri: string,
  localName: string
): string | undefined {
  for (const entry of node.attributes) {
    if (entry.localName === localName && entry.namespaceUri === namespaceUri) return entry.value;
  }
  return undefined;
}

function allowsContentType(allowed: string | readonly string[], actual: string | null): boolean {
  if (actual === null) return false;
  return typeof allowed === 'string' ? actual === allowed : allowed.includes(actual);
}

/** A related part of the given type, or null. Wrong types and unsafe targets are skipped. */
export function relatedTypedPart(
  pkg: OoxmlPackage,
  fromPartName: string,
  relationshipType: string,
  contentType: string | readonly string[]
): string | null {
  for (const record of relationshipsOf(pkg, fromPartName)) {
    if (record.type !== relationshipType) continue;
    const resolved = resolveInternalTarget(fromPartName, record.rawTarget);
    if (!resolved.ok) continue;
    if (!pkg.parts.has(resolved.partName)) continue;
    if (allowsContentType(contentType, resolveContentTypeOf(pkg, resolved.partName))) {
      return resolved.partName;
    }
  }
  return null;
}

/**
 * The comments part this story names, when it exists and really is one.
 *
 * Conventional `/word/comments.xml` is used only when no usable relationship exists AND the
 * part's content type is the comments type. A present wrong-typed part is not a comments part.
 */
export function commentsPartNameForStory(pkg: OoxmlPackage, storyPartName: string): string | null {
  const related = relatedTypedPart(pkg, storyPartName, COMMENTS_REL, COMMENTS_TYPE);
  if (related !== null) return related;
  // A document has ONE comments part, and Word resolves it only through the main document's
  // relationship (ECMA-376 §11.3.3). A header, a footer or a notes part normally declares no
  // relationships at all, so without this a story fell through to the conventional name and
  // any package that named its comments part something else lost every furniture comment.
  const viaMain = relatedTypedPart(pkg, pkg.mainDocumentPart, COMMENTS_REL, COMMENTS_TYPE);
  if (viaMain !== null) return viaMain;
  if (!pkg.parts.has(COMMENTS_PART)) return null;
  return resolveContentTypeOf(pkg, COMMENTS_PART) === COMMENTS_TYPE ? COMMENTS_PART : null;
}

/**
 * commentsExtended / commentsIds related from the story, from its comments part, or from the
 * main document.
 *
 * Still no conventional-NAME fallback: a story that declares its own comments part must not
 * inherit the body's `commentsExtended.xml` when paraIds collide. The main document is a
 * different matter — it is where Word puts the relationship, and a header that resolved its
 * comments part from there has to resolve the thread state from there too, or every reply in
 * furniture reads as a root comment and survives its own thread's deletion as an orphan.
 */
export function metadataPartNamesFor(
  pkg: OoxmlPackage,
  storyPartName: string,
  commentsPartName: string | null
): { readonly extended: string | null; readonly ids: string | null } {
  const from = (rel: string, type: string | readonly string[]): string | null => {
    const viaStory = relatedTypedPart(pkg, storyPartName, rel, type);
    if (viaStory !== null) return viaStory;
    if (commentsPartName !== null && commentsPartName !== storyPartName) {
      const viaComments = relatedTypedPart(pkg, commentsPartName, rel, type);
      if (viaComments !== null) return viaComments;
    }
    if (storyPartName === pkg.mainDocumentPart) return null;
    return relatedTypedPart(pkg, pkg.mainDocumentPart, rel, type);
  };
  return {
    extended: from(COMMENTS_EXTENDED_REL, COMMENTS_EXTENDED_TYPES),
    ids: from(COMMENTS_IDS_REL, COMMENTS_IDS_TYPES),
  };
}

export interface CommentRecord {
  readonly partName: string;
  readonly node: OoxmlElement;
}

/** First-wins index plus the ids that appeared more than once. Truncation is on the budget. */
export interface CommentRecordIndex {
  readonly byId: Map<string, CommentRecord>;
  readonly duplicateIds: ReadonlySet<string>;
}

export function indexCommentRecords(
  pkg: OoxmlPackage,
  partName: string,
  budget: CommentScanBudget
): CommentRecordIndex {
  const byId = new Map<string, CommentRecord>();
  const duplicateIds = new Set<string>();
  const part = pkg.parts.get(partName);
  if (!part || !chargePart(budget)) return { byId, duplicateIds };
  walkCharged(part.root, budget, (node) => {
    if (node.kind !== 'comment') return false;
    const id = attribute(node, WML_NAMESPACE_URI, 'id');
    if (id !== undefined) {
      if (byId.has(id)) duplicateIds.add(id);
      else byId.set(id, { partName: part.name, node });
    }
    return true;
  });
  return { byId, duplicateIds };
}

/** `w:comment` records in one comments part. Truncation is on the budget. First id wins. */
export function commentRecordsIn(
  pkg: OoxmlPackage,
  partName: string,
  budget: CommentScanBudget
): Map<string, CommentRecord> {
  return indexCommentRecords(pkg, partName, budget).byId;
}

export interface KeyedMetadataEntry {
  readonly partName: string;
  readonly node: OoxmlElement;
}

function isKeyedMetadataNode(node: OoxmlElement): boolean {
  return (
    (node.namespaceUri === W15_NAMESPACE_URI && node.localName === 'commentEx') ||
    (node.namespaceUri === W16CID_NAMESPACE_URI && node.localName === 'commentId')
  );
}

/** Schema: `commentEx` / `commentId` are valid only as direct children of their part roots. */
function keyedMetadataBelongsOnRoot(root: OoxmlElement, node: OoxmlElement): boolean {
  if (node.namespaceUri === W15_NAMESPACE_URI && node.localName === 'commentEx') {
    return root.namespaceUri === W15_NAMESPACE_URI && root.localName === 'commentsEx';
  }
  if (node.namespaceUri === W16CID_NAMESPACE_URI && node.localName === 'commentId') {
    return root.namespaceUri === W16CID_NAMESPACE_URI && root.localName === 'commentsIds';
  }
  return false;
}

/**
 * `w15:commentEx` / `w16cid:commentId` in the named metadata parts only.
 *
 * Descendants of a keyed node are still walked: a nested duplicate is attacker-controlled
 * and must be visible to the fail-closed index, not skipped because the outer node matched.
 */
export function keyedMetadataIn(
  pkg: OoxmlPackage,
  partNames: readonly (string | null)[],
  budget: CommentScanBudget
): KeyedMetadataEntry[] {
  const entries: KeyedMetadataEntry[] = [];
  const seen = new Set<string>();
  for (const partName of partNames) {
    if (partName === null || seen.has(partName)) continue;
    seen.add(partName);
    const part = pkg.parts.get(partName);
    if (!part || !chargePart(budget)) break;
    const finished = walkCharged(part.root, budget, (node) => {
      if (!isKeyedMetadataNode(node)) return false;
      entries.push({ partName: part.name, node });
      return false;
    });
    if (!finished) break;
  }
  return entries;
}

/** True when any keyed node is nested or sitting on the wrong root. */
export function keyedMetadataMisplaced(
  pkg: OoxmlPackage,
  entries: readonly KeyedMetadataEntry[]
): boolean {
  const directByPart = new Map<string, Set<string>>();
  for (const entry of entries) {
    let direct = directByPart.get(entry.partName);
    if (!direct) {
      const part = pkg.parts.get(entry.partName);
      if (!part) return true;
      direct = new Set<string>();
      for (const child of part.root.children) {
        if (child.kind !== 'textValue') direct.add(child.id);
      }
      directByPart.set(entry.partName, direct);
    }
    const part = pkg.parts.get(entry.partName);
    if (
      part === undefined ||
      !direct.has(entry.node.id) ||
      !keyedMetadataBelongsOnRoot(part.root, entry.node)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Comment ids that still have a marker in a story that uses `commentsPartName`.
 *
 * A header with its own comments part can reuse `w:id` 1; that marker does not keep the
 * body's `w:comment`. `ignoreRoot` is the owner story about to lose its markers — those
 * hits must not keep the record. Truncation fails closed: every queried id is treated as
 * still marked.
 */
export function idsStillMarked(
  pkg: OoxmlPackage,
  commentIds: ReadonlySet<string>,
  commentsPartName: string | null,
  budget: CommentScanBudget,
  ignoreRoot?: OoxmlNode | null
): { readonly marked: ReadonlySet<string>; readonly truncated: boolean } {
  const still = new Set<string>();
  if (commentIds.size === 0) return { marked: still, truncated: budget.truncated };
  for (const part of pkg.parts.values()) {
    if (!part.name.endsWith('.xml')) continue;
    if (!chargePart(budget)) {
      return { marked: commentIds, truncated: true };
    }
    if (ignoreRoot != null && ignoreRoot === part.root) continue;
    const finished = walkCharged(part.root, budget, (node) => {
      if (ignoreRoot != null && node === ignoreRoot) return true;
      if (
        node.kind !== 'commentRangeStart' &&
        node.kind !== 'commentRangeEnd' &&
        node.kind !== 'commentReference'
      ) {
        return false;
      }
      const id = attribute(node, WML_NAMESPACE_URI, 'id');
      if (id === undefined || !commentIds.has(id)) return true;
      if (commentsPartNameForStory(pkg, part.name) === commentsPartName) still.add(id);
      return true;
    });
    if (!finished) return { marked: commentIds, truncated: true };
    if (still.size === commentIds.size) return { marked: still, truncated: false };
  }
  return { marked: still, truncated: budget.truncated };
}

export interface MarkerHits {
  readonly doomed: string[];
  readonly emptiedRuns: string[];
  readonly truncated: boolean;
}

/** Markers (and emptied reference-only runs) naming `commentIds` under `root`. */
export function collectOwnerMarkers(
  root: OoxmlNode,
  commentIds: ReadonlySet<string>,
  budget: CommentScanBudget
): MarkerHits {
  const doomed: string[] = [];
  const emptiedRuns: string[] = [];
  const finished = walkCharged(root, budget, (node) => {
    if (
      node.kind === 'commentRangeStart' ||
      node.kind === 'commentRangeEnd' ||
      node.kind === 'commentReference'
    ) {
      const id = attribute(node, WML_NAMESPACE_URI, 'id');
      if (id !== undefined && commentIds.has(id)) doomed.push(node.id);
      return true;
    }
    if (node.kind === 'run') {
      const survivors = node.children.filter(
        (child) =>
          !(
            child.kind === 'commentReference' &&
            commentIds.has(attribute(child, WML_NAMESPACE_URI, 'id') ?? '')
          ) && child.kind !== 'runProperties'
      );
      if (
        survivors.length === 0 &&
        node.children.some((child) => child.kind === 'commentReference')
      ) {
        emptiedRuns.push(node.id);
        return true;
      }
    }
    return false;
  });
  return { doomed, emptiedRuns, truncated: !finished || budget.truncated };
}

/** What one owner root still says about each comment's markers. */
export interface OwnerAnchorState {
  readonly covering: boolean;
  readonly paired: boolean;
  readonly anyMarker: boolean;
}

/**
 * Pair start/end in document order under `root` and count content units between them.
 *
 * One charged walk: no per-note re-filter of a full-part anchor list. Truncation is on the
 * budget; callers must not treat a partial map as complete.
 */
export function collectOwnerAnchorStates(
  root: OoxmlNode,
  budget: CommentScanBudget
): { readonly states: Map<string, OwnerAnchorState>; readonly truncated: boolean } {
  const states = new Map<string, OwnerAnchorState>();
  const openUnits = new Map<string, number>();
  let units = 0;
  const note = (id: string, covering: boolean, paired: boolean): void => {
    const previous = states.get(id);
    states.set(id, {
      covering: covering || (previous?.covering ?? false),
      paired: paired || (previous?.paired ?? false),
      anyMarker: true,
    });
  };
  const finished = walkCharged(
    root,
    budget,
    (node) => {
      if (node.kind === 'commentRangeStart') {
        const id = attribute(node, WML_NAMESPACE_URI, 'id');
        if (id !== undefined) {
          openUnits.set(id, units);
          note(id, false, false);
        }
        return true;
      }
      if (node.kind === 'commentRangeEnd') {
        const id = attribute(node, WML_NAMESPACE_URI, 'id');
        if (id !== undefined) {
          const opened = openUnits.get(id);
          openUnits.delete(id);
          note(id, opened !== undefined && units > opened, opened !== undefined);
        }
        return true;
      }
      if (node.kind === 'commentReference') {
        const id = attribute(node, WML_NAMESPACE_URI, 'id');
        if (id !== undefined) note(id, false, false);
        return true;
      }
      if (
        node.kind === 'tab' ||
        node.kind === 'hardBreak' ||
        node.kind === 'noteReference' ||
        node.kind === 'drawing' ||
        isLegacyVmlAtom(node) ||
        inlineCharacterTextOf(node) !== null
      ) {
        units += 1;
        return true;
      }
      return false;
    },
    0,
    (value) => {
      units += value.length;
    }
  );
  return { states, truncated: !finished || budget.truncated };
}

/** Exact start/end of one comment's range markers under an owner root. */
export interface CommentMarkerSpan {
  readonly startParagraphId: string;
  readonly startOffset: number;
  readonly endParagraphId: string;
  readonly endOffset: number;
}

/**
 * Paragraph-local start/end of each comment range under `root`.
 *
 * Same charged walk as {@link collectOwnerAnchorStates}: one owner story, never the whole
 * package. Last complete pair wins when a comment is marked more than once in the story.
 */
export function collectOwnerCommentSpans(
  root: OoxmlNode,
  budget: CommentScanBudget
): { readonly spans: Map<string, CommentMarkerSpan>; readonly truncated: boolean } {
  const spans = new Map<string, CommentMarkerSpan>();
  const open = new Map<string, { readonly paragraphId: string; readonly offset: number }>();
  let paragraphId: string | null = null;
  let offset = 0;
  const finished = walkCharged(
    root,
    budget,
    (node) => {
      if (node.kind === 'paragraph') {
        paragraphId = node.id;
        offset = 0;
        return false;
      }
      if (node.kind === 'commentRangeStart') {
        const id = attribute(node, WML_NAMESPACE_URI, 'id');
        if (id !== undefined && paragraphId !== null) open.set(id, { paragraphId, offset });
        return true;
      }
      if (node.kind === 'commentRangeEnd') {
        const id = attribute(node, WML_NAMESPACE_URI, 'id');
        if (id !== undefined && paragraphId !== null) {
          const start = open.get(id);
          open.delete(id);
          if (start !== undefined) {
            spans.set(id, {
              startParagraphId: start.paragraphId,
              startOffset: start.offset,
              endParagraphId: paragraphId,
              endOffset: offset,
            });
          }
        }
        return true;
      }
      if (node.kind === 'commentReference') return true;
      if (
        node.kind === 'tab' ||
        node.kind === 'hardBreak' ||
        node.kind === 'noteReference' ||
        node.kind === 'drawing' ||
        isLegacyVmlAtom(node) ||
        inlineCharacterTextOf(node) !== null
      ) {
        offset += 1;
        return true;
      }
      return false;
    },
    0,
    (value) => {
      offset += value.length;
    }
  );
  return { spans, truncated: !finished || budget.truncated };
}

/**
 * Every valid `w14:paraId` in modelled XML parts, charged against the shared budget.
 *
 * Resolution mints from this set. Truncation refuses the write rather than risking a
 * colliding id from an unseen part.
 */
export function collectUsedParaIds(
  pkg: OoxmlPackage,
  budget: CommentScanBudget
): { readonly used: Set<string>; readonly truncated: boolean } {
  const used = new Set<string>();
  for (const part of pkg.parts.values()) {
    if (!part.name.endsWith('.xml')) continue;
    if (!chargePart(budget)) return { used, truncated: true };
    const finished = walkCharged(part.root, budget, (node) => {
      const value = attribute(node, W14_NAMESPACE_URI, 'paraId');
      if (value !== undefined && isValidParaId(value)) used.add(value.toUpperCase());
      return false;
    });
    if (!finished) return { used, truncated: true };
  }
  return { used, truncated: budget.truncated };
}
