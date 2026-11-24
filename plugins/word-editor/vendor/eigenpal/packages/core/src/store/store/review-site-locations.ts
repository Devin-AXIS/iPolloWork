// Where every node of a story sits, in the model offset space its paragraph defines.
//
// Split from `review-reads.ts` (which stays the review QUEUE derivation) purely along the
// "where is this node" seam: this module owns the site index, its per-paragraph and
// per-row memos, and the tracked-row anchors; the queue asks it for ranges.

import { currentFieldResultsMode, FieldResultsModeMemo } from '../package/field-result-mode.ts';
import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { paragraphOffsetIndex, transientParagraphOffsetIndex } from './tree-op-segments.ts';
import { createRecentRootCache } from './recent-root-cache.ts';
import { setLatestPerPart } from './latest-per-part.ts';

/** The `w:p` a node sits inside, and the model offset it starts at within that paragraph. */
export interface SiteLocation {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Locate every revision site in one walk.
 *
 * One walk rather than a lookup per site: `resolveRevisions` learned the same lesson the hard
 * way, where a per-site tree walk inside a per-site loop made accept-all quadratic.
 *
 * Offsets come from `paragraphOffsetIndex`, which is `segmentsOf`'s walk. A private one here
 * measured a run by summing its text and gave a note reference, an atomic field and a field's
 * instruction text the wrong lengths, so every card in a paragraph holding one reported a
 * range the caret and the ops disagreed with.
 */
export function locateSites(part: OoxmlPart): ReadonlyMap<string, SiteLocation> {
  return locateSitesWithPolicy(part, true);
}

/** Export-only cold derivation that does not populate interactive location memos. @internal */
export function locateSitesTransient(part: OoxmlPart): ReadonlyMap<string, SiteLocation> {
  return locateSitesWithPolicy(part, false);
}

function locateSitesWithPolicy(
  part: OoxmlPart,
  retainAcrossReads: boolean
): ReadonlyMap<string, SiteLocation> {
  // Memoized on the immutable root: the merged index is a pure function of the tree, and
  // every caller in one derivation pass — the revision cards, the pro custom-node cards, an
  // automation read — asks for the same one. Rebuilding it merged 80k+ entries per call on
  // a long document. The instance is SHARED, so the return type is ReadonlyMap: a caller
  // mutating it would poison every later reader of this root, undo included.
  const merged = retainAcrossReads
    ? locatedSitesCaches[currentFieldResultsMode()].get(part.root)
    : undefined;
  if (merged) return merged;
  const mode = currentFieldResultsMode();
  // An edit replaces the root, the body and the blocks it touched; every other block is the
  // same object. Patching the previous index for those blocks replaces a walk of every
  // paragraph per edit.
  const lastKey = `${mode}\u0000${part.name}`;
  const previousRoot = retainAcrossReads ? lastLocatedRoots.get(lastKey)?.deref() : undefined;
  const previous = previousRoot ? locatedSitesCaches[mode].get(previousRoot) : undefined;
  const located =
    (previousRoot &&
      previous &&
      patchedLocations(previousRoot, previous, part.root, retainAcrossReads)) ||
    fullLocations(part.root, retainAcrossReads);
  if (retainAcrossReads) {
    locatedSitesCaches[mode].set(part.root, located);
    setLatestPerPart(lastLocatedRoots, lastKey, new WeakRef(part.root));
  }
  return located;
}

/**
 * `WeakRef` is ES2021 and the workspace tsconfigs pin `lib` at ES2020, so the global is
 * declared here, as `recent-root-cache.ts` does.
 */
interface RootWeakRef {
  deref(): OoxmlNode | undefined;
}
declare const WeakRef: new (target: OoxmlNode) => RootWeakRef;

/**
 * The root each story part last indexed per mode, weakly: a closed document leaves nothing
 * here but a dead reference per part name. Per part, because one derivation indexes the body,
 * then every header, footer and note part; a shared slot always held the last one of those.
 */
const lastLocatedRoots = new Map<string, RootWeakRef>();

/** Blocks changed past this many are indexed from scratch. */
const MAX_PATCHED_BLOCKS = 256;

function fullLocations(root: OoxmlNode, retainAcrossReads: boolean): Map<string, SiteLocation> {
  const located = new Map<string, SiteLocation>();
  locateWithin(root, 0, located, retainAcrossReads);
  return located;
}

/**
 * Every location under `node`: its paragraph offsets first, then its row anchors over them.
 *
 * Both passes only ever write keys of nodes inside `node`, so running them per block gives
 * the same entries as running each over the whole story.
 */
function locateWithin(
  node: OoxmlNode,
  depth: number,
  located: Map<string, SiteLocation>,
  retainAcrossReads: boolean
): void {
  walkLocations(node, depth, located, retainAcrossReads);
  anchorTrackedRows(node, depth, located, retainAcrossReads);
}

/**
 * The body blocks that left and arrived between two versions of a story root, or null when
 * the roots differ outside their body, or in more than {@link MAX_PATCHED_BLOCKS} blocks.
 * Every other block is the same object in both.
 */
export function changedBodyBlocks(
  previousRoot: OoxmlNode,
  root: OoxmlNode
): { readonly removed: readonly OoxmlNode[]; readonly added: readonly OoxmlNode[] } | null {
  if (previousRoot.kind === 'textValue' || root.kind === 'textValue') return null;
  const before = previousRoot.children;
  const after = root.children;
  if (before.length !== after.length) return null;
  let bodyIndex = -1;
  for (let index = 0; index < after.length; index += 1) {
    const a = before[index]!;
    const b = after[index]!;
    if (a === b) continue;
    if (bodyIndex >= 0 || a.kind !== 'body' || b.kind !== 'body' || a.id !== b.id) return null;
    bodyIndex = index;
  }
  if (bodyIndex < 0) return null;
  const oldBlocks = (before[bodyIndex] as Exclude<OoxmlNode, { kind: 'textValue' }>).children;
  const newBlocks = (after[bodyIndex] as Exclude<OoxmlNode, { kind: 'textValue' }>).children;
  let start = 0;
  while (
    start < oldBlocks.length &&
    start < newBlocks.length &&
    oldBlocks[start] === newBlocks[start]
  )
    start += 1;
  let oldEnd = oldBlocks.length;
  let newEnd = newBlocks.length;
  while (oldEnd > start && newEnd > start && oldBlocks[oldEnd - 1] === newBlocks[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  // Several edits since the last read sit apart, so the middle can be long while few blocks
  // in it changed. Which blocks left and which arrived is all a caller needs, not where.
  const oldMiddle = new Set(oldBlocks.slice(start, oldEnd));
  const newMiddle = new Set(newBlocks.slice(start, newEnd));
  const removed = [...oldMiddle].filter((block) => !newMiddle.has(block));
  const added = [...newMiddle].filter((block) => !oldMiddle.has(block));
  if (removed.length + added.length > MAX_PATCHED_BLOCKS) return null;
  return { removed, added };
}

/**
 * `previous` (the index of `previousRoot`) moved to `root`, or null when the two roots differ
 * in more than some body blocks. Keys are unique to their block, so the changed blocks leave
 * and enter whole.
 */
function patchedLocations(
  previousRoot: OoxmlNode,
  previous: ReadonlyMap<string, SiteLocation>,
  root: OoxmlNode,
  retainAcrossReads: boolean
): Map<string, SiteLocation> | null {
  const changed = changedBodyBlocks(previousRoot, root);
  if (!changed) return null;
  const located = new Map(previous);
  // Root depth 0, body 1, its blocks 2: the depth guard counts the same as a full walk.
  for (const block of changed.removed) {
    const gone = new Map<string, SiteLocation>();
    locateWithin(block, 2, gone, retainAcrossReads);
    for (const key of gone.keys()) located.delete(key);
  }
  for (const block of changed.added) locateWithin(block, 2, located, retainAcrossReads);
  return located;
}

/** The index already built for `part`'s root, without building one. */
export function locatedSitesIfKnown(
  part: OoxmlPart
): ReadonlyMap<string, SiteLocation> | undefined {
  return locatedSitesCaches[currentFieldResultsMode()].get(part.root);
}

function walkLocations(
  node: OoxmlNode,
  depth: number,
  located: Map<string, SiteLocation>,
  retainAcrossReads: boolean
): void {
  if (node.kind === 'textValue' || depth > 64) return;
  if (node.kind === 'paragraph') {
    // Paragraph-local by construction: every offset here is measured inside this paragraph,
    // so an unchanged paragraph's answer is still true and is reused rather than re-walked.
    // A keystroke otherwise re-derived the location of every node in the document.
    let memo = retainAcrossReads ? paragraphLocationsCache.get(node) : undefined;
    if (!memo) {
      const own = new Map<string, SiteLocation>();
      locateInParagraph(node, own, retainAcrossReads);
      if (retainAcrossReads) paragraphLocationsCache.set(node, own);
      memo = own;
    }
    for (const [id, location] of memo) located.set(id, location);
    return;
  }
  for (const child of node.children) walkLocations(child, depth + 1, located, retainAcrossReads);
}

function anchorTrackedRows(
  node: OoxmlNode,
  depth: number,
  located: Map<string, SiteLocation>,
  retainAcrossReads: boolean
): void {
  if (node.kind === 'textValue' || depth > 64) return;
  // A paragraph CAN hold table rows — a textbox in a run holds block content, tables
  // included — so paragraph subtrees are walked, not pruned. Memoized per paragraph
  // like the location walk above: the ordinary paragraph with no textbox costs one
  // cached empty answer instead of a descent through every run.
  if (node.kind === 'paragraph') {
    let entries = retainAcrossReads ? paragraphRowAnchorsCache.get(node) : undefined;
    if (!entries) {
      const own: (readonly [string, SiteLocation])[] = [];
      collectRowAnchorEntries(node, 0, own, retainAcrossReads);
      entries = own;
      if (retainAcrossReads) paragraphRowAnchorsCache.set(node, entries);
    }
    for (const [markerId, location] of entries) located.set(markerId, location);
    return;
  }
  if (node.kind === 'table' || node.kind === 'tableRow' || node.kind === 'tableCell') {
    // Anchor each property's decision in its own table, row, or cell subtree.
    let entries = retainAcrossReads ? rowMarkerAnchorsCache.get(node) : undefined;
    if (!entries) {
      entries = computeRowMarkerAnchors(node);
      if (retainAcrossReads) rowMarkerAnchorsCache.set(node, entries);
    }
    for (const [markerId, location] of entries) located.set(markerId, location);
  }
  for (const child of node.children)
    anchorTrackedRows(child, depth + 1, located, retainAcrossReads);
}

/**
 * Every row-marker anchor under a node, in the same emit order the outer walk uses —
 * outer rows first, nested rows after, so a later entry for the same marker wins.
 */
function collectRowAnchorEntries(
  node: OoxmlNode,
  depth: number,
  out: (readonly [string, SiteLocation])[],
  retainAcrossReads: boolean
): void {
  if (node.kind === 'textValue' || depth > 64) return;
  if (node.kind === 'table' || node.kind === 'tableRow' || node.kind === 'tableCell') {
    let entries = retainAcrossReads ? rowMarkerAnchorsCache.get(node) : undefined;
    if (!entries) {
      entries = computeRowMarkerAnchors(node);
      if (retainAcrossReads) rowMarkerAnchorsCache.set(node, entries);
    }
    for (const entry of entries) out.push(entry);
  }
  for (const child of node.children) {
    collectRowAnchorEntries(child, depth + 1, out, retainAcrossReads);
  }
}

/** Structural property anchors of one table, row, or cell, memoized on the immutable row. */
function computeRowMarkerAnchors(row: OoxmlNode): readonly (readonly [string, SiteLocation])[] {
  let paragraph: OoxmlParagraphNode | null = null;
  const firstParagraph = (candidate: OoxmlNode, nestedDepth: number): void => {
    if (paragraph || candidate.kind === 'textValue' || nestedDepth > 64) return;
    if (candidate.kind === 'paragraph') {
      paragraph = candidate;
      return;
    }
    for (const child of candidate.children) firstParagraph(child, nestedDepth + 1);
  };
  firstParagraph(row, 0);
  if (!paragraph) return EMPTY_ROW_ANCHORS;
  const anchor: SiteLocation = {
    paragraphId: (paragraph as OoxmlParagraphNode).id,
    start: 0,
    end: 0,
  };
  const entries: (readonly [string, SiteLocation])[] = [];
  // Inspect only this container's properties. Descendant cells/rows receive their own
  // anchors, so a change to the second cell never selects the first cell by accident.
  if (row.kind === 'textValue') return entries;
  for (const properties of row.children) {
    if (
      properties.kind === 'textValue' ||
      !['tblPr', 'tblGrid', 'tblPrEx', 'trPr', 'tcPr'].includes(properties.localName)
    )
      continue;
    for (const marker of properties.children) {
      if (marker.kind === 'textValue') continue;
      const expected =
        marker.localName === `${properties.localName}Change` ||
        (properties.localName === 'trPr' && ['ins', 'del'].includes(marker.localName)) ||
        (properties.localName === 'tcPr' &&
          ['cellIns', 'cellDel', 'cellMerge'].includes(marker.localName));
      if (expected) {
        entries.push([marker.id, anchor]);
      }
    }
  }
  return entries;
}

const EMPTY_ROW_ANCHORS: readonly (readonly [string, SiteLocation])[] = [];

/** Node id → paragraph-local offsets, memoized on the immutable paragraph node. */
const paragraphLocationsCache = new FieldResultsModeMemo<
  OoxmlNode,
  ReadonlyMap<string, SiteLocation>
>();

/**
 * The merged site index per part root, bounded to recent roots.
 *
 * Bounded because the undo history retains old roots by reference: a plain WeakMap would
 * keep one O(document) index alive per retained root. Per-NODE memos above are exempt —
 * unchanged nodes are shared across roots, so those caches stay O(document) in total.
 */
const locatedSitesCaches = {
  atomic: createRecentRootCache<Map<string, SiteLocation>>(8),
  editable: createRecentRootCache<Map<string, SiteLocation>>(8),
};

/** Marker anchors per immutable table, row, or cell. */
const rowMarkerAnchorsCache = new FieldResultsModeMemo<
  OoxmlNode,
  readonly (readonly [string, SiteLocation])[]
>();

/** Row-marker anchors under one immutable paragraph (a textbox can hold a table). */
const paragraphRowAnchorsCache = new FieldResultsModeMemo<
  OoxmlNode,
  readonly (readonly [string, SiteLocation])[]
>();

/** Text boxes inside text boxes past this depth get no review range. */
const MAX_BOX_DEPTH = 8;

function locateInParagraph(
  paragraph: OoxmlParagraphNode,
  located: Map<string, SiteLocation>,
  retainAcrossReads: boolean,
  /** How many text boxes deep this paragraph sits. */
  boxDepth = 0
): void {
  const offsets = retainAcrossReads
    ? paragraphOffsetIndex(paragraph)
    : transientParagraphOffsetIndex(paragraph);
  const place = (node: OoxmlNode, start: number, end: number, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    located.set(node.id, { paragraphId: paragraph.id, start, end });
    for (const child of node.children) place(child, start, end, depth + 1);
  };
  // A text box rides in a run and holds paragraphs of its own. Its changes sit in THOSE
  // paragraphs, at their offsets: stopping at the run left them with no range, so they
  // listed in the pane but could not be opened or reached by Next and Previous.
  const nestedParagraphs = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64 || boxDepth >= MAX_BOX_DEPTH) return;
    if (node.kind === 'paragraph') {
      locateInParagraph(node, located, retainAcrossReads, boxDepth + 1);
      return;
    }
    for (const child of node.children) nestedParagraphs(child, depth + 1);
  };
  const visit = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    const span = offsets.spanOf(node);
    if (node.kind === 'fldSimple' && span) {
      // The field result is one atomic model span. Its nested revision wrappers must
      // use that same span rather than disappear from sidebar placement/navigation.
      place(node, span.start, span.end, depth);
      return;
    }
    if (node.kind === 'run') {
      if (!span) return;
      located.set(node.id, { paragraphId: paragraph.id, start: span.start, end: span.end });
      // A run's OWN properties anchor over the run. `w:rPrChange` is a revision that
      // decorates no characters and lives in `w:rPr`, so stopping at the run left it with
      // no geometry at all: its card sorted to the end of the rail, painted no band, and
      // the caret in tracked-formatted text activated nothing while accept and reject
      // stayed on offer.
      for (const child of node.children) {
        if (child.kind === 'runProperties') place(child, span.start, span.end, depth + 1);
        else nestedParagraphs(child, depth + 1);
      }
      return;
    }
    if (span) located.set(node.id, { paragraphId: paragraph.id, start: span.start, end: span.end });
    for (const child of node.children) visit(child, depth + 1);
  };
  for (const child of paragraph.children) {
    if (child.kind === 'paragraphProperties') continue;
    visit(child, 0);
  }
  // The paragraph MARK is the pilcrow — it sits at the END of the paragraph, not at
  // offset 0 where its `w:pPr` happens to be written. Anchored at 0, a tracked Enter's
  // card never opened when the caret was at the break that made it, `setActiveReviewItem`
  // threw the caret to the paragraph start, and the zero-width range painted no band.
  const properties = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  if (properties) place(properties, offsets.length, offsets.length, 0);
}
