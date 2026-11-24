// Paragraph-order indexes shared by interactive review derivation and editor positioning.

import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { createSubtreeAggregateMemo, keepsSubtreeMemo } from '../package/subtree-memo-policy.ts';
import { createRecentRootCache } from './recent-root-cache.ts';

/**
 * Paragraph node id → document position, from the tree rather than from layout.
 *
 * Memoized on the immutable root: a derivation pass can ask repeatedly, and the shared answer
 * stays read-only so a caller cannot poison later readers.
 */
export function paragraphOrderOfPart(part: OoxmlPart): ReadonlyMap<string, number> {
  const cached = paragraphOrderCache.get(part.root);
  if (cached) return cached;
  const order = new Map<string, number>();
  const walk = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    if (node.kind === 'paragraph') {
      if (!order.has(node.id)) order.set(node.id, order.size);
      return;
    }
    // An unchanged table returns its paragraph list instead of being re-descended after an edit
    // elsewhere in the document.
    if (node.kind === 'table') {
      let ids = tableParagraphIdsCache.get(node);
      if (!ids) {
        const found: string[] = [];
        const collect = (candidate: OoxmlNode, nestedDepth: number): void => {
          if (candidate.kind === 'textValue' || nestedDepth > 64) return;
          if (candidate.kind === 'paragraph') {
            found.push(candidate.id);
            return;
          }
          for (const child of candidate.children) collect(child, nestedDepth + 1);
        };
        for (const child of node.children) collect(child, 0);
        ids = found;
        tableParagraphIdsCache.set(node, ids, ids.length);
      }
      for (const id of ids) {
        if (!order.has(id)) order.set(id, order.size);
      }
      return;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(part.root, 0);
  paragraphOrderCache.set(part.root, order);
  return order;
}

// The current root, plus the ones undo and redo restore: each map holds every paragraph.
const paragraphOrderCache = createRecentRootCache<Map<string, number>>(3);

/**
 * Like {@link paragraphOrderOfPart}, but descends into paragraphs so textbox paragraphs rank
 * immediately after their host. Shallow order remains available for separate-story walks.
 */
export function deepParagraphOrderOfPart(part: OoxmlPart): ReadonlyMap<string, number> {
  const cached = deepParagraphOrderCache.get(part.root);
  if (cached) return cached;
  const order = new Map<string, number>();
  for (const id of subtreeDeepParagraphIds(part.root, 0)) {
    if (!order.has(id)) order.set(id, order.size);
  }
  deepParagraphOrderCache.set(part.root, order);
  return order;
}

const EMPTY_DEEP_PARAGRAPH_IDS: readonly string[] = Object.freeze([]);

const MAX_DEEP_PARAGRAPH_DEPTH = 64;

interface DeepParagraphIds {
  readonly depth: number;
  readonly ids: readonly string[];
}

/** One shared entry per depth for the subtrees that hold no paragraph. */
const EMPTY_DEEP_PARAGRAPH_ENTRIES: readonly DeepParagraphIds[] = Array.from(
  { length: MAX_DEEP_PARAGRAPH_DEPTH + 1 },
  (_, depth) => Object.freeze({ depth, ids: EMPTY_DEEP_PARAGRAPH_IDS })
);

/**
 * Deep paragraph ids under one immutable node, memoized per node. The depth is part of the
 * entry because republishing a shared subtree at another depth can cross the hostile-input cap.
 * Only nodes `keepsSubtreeMemo` admits get an entry: a node of leaves answers from them.
 */
const subtreeDeepParagraphIdsCache = createSubtreeAggregateMemo<DeepParagraphIds>();

function subtreeDeepParagraphIds(node: OoxmlNode, depth: number): readonly string[] {
  if (node.kind === 'textValue' || depth > MAX_DEEP_PARAGRAPH_DEPTH)
    return EMPTY_DEEP_PARAGRAPH_IDS;
  // Property leaves cannot contain paragraphs. Empty paragraphs still contribute their id.
  if (node.kind !== 'paragraph' && node.children.length === 0) return EMPTY_DEEP_PARAGRAPH_IDS;
  const cached = subtreeDeepParagraphIdsCache.get(node);
  if (cached && cached.depth === depth) return cached.ids;
  let found: string[] | null = null;
  if (node.kind === 'paragraph') {
    (found ??= []).push(node.id);
    for (const id of nestedParagraphIdsOf(node, depth)) found.push(id);
    return found;
  }
  for (const child of node.children) {
    if (child.kind === 'paragraph' && depth + 1 <= MAX_DEEP_PARAGRAPH_DEPTH) {
      // A paragraph is its own id and the few it nests: read from its memo, not its runs.
      (found ??= []).push(child.id);
      for (const id of nestedParagraphIdsOf(child, depth + 1)) found.push(id);
      continue;
    }
    const ids = subtreeDeepParagraphIds(child, depth + 1);
    if (ids.length === 0) continue;
    found ??= [];
    for (const id of ids) found.push(id);
  }
  // A run answers from its few children again: an entry per run is most of the memo.
  if (node.kind !== 'run' && keepsSubtreeMemo(node))
    subtreeDeepParagraphIdsCache.set(
      node,
      found ? { depth, ids: found } : EMPTY_DEEP_PARAGRAPH_ENTRIES[depth]!,
      found?.length ?? 0
    );
  return found ?? EMPTY_DEEP_PARAGRAPH_IDS;
}

/**
 * The paragraphs nested inside one paragraph (a text box's), at `depth`, memoized per paragraph
 * for every paragraph: a long document's paragraphs are mostly too small for the subtree memo,
 * and re-reading every run of every paragraph after a split was most of a new order's cost.
 * Almost always the shared empty list.
 */
const nestedParagraphIdsCache = new WeakMap<OoxmlNode, DeepParagraphIds>();

function nestedParagraphIdsOf(paragraph: OoxmlNode, depth: number): readonly string[] {
  if (paragraph.kind === 'textValue') return EMPTY_DEEP_PARAGRAPH_IDS;
  const cached = nestedParagraphIdsCache.get(paragraph);
  if (cached && cached.depth === depth) return cached.ids;
  let nested: string[] | null = null;
  for (const child of paragraph.children) {
    const ids = subtreeDeepParagraphIds(child, depth + 1);
    if (ids.length === 0) continue;
    nested ??= [];
    for (const id of ids) nested.push(id);
  }
  nestedParagraphIdsCache.set(
    paragraph,
    nested ? { depth, ids: nested } : EMPTY_DEEP_PARAGRAPH_ENTRIES[depth]!
  );
  return nested ?? EMPTY_DEEP_PARAGRAPH_IDS;
}

const deepParagraphOrderCache = createRecentRootCache<Map<string, number>>(3);
const tableParagraphIdsCache = createSubtreeAggregateMemo<readonly string[]>();
