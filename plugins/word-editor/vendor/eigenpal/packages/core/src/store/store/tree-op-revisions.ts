import { revisionSiteRefusal, type RevisionSiteRefusal } from './revision-site-refusal.ts';
import {
  hasRevisionMarkerContent,
  heldOnlyResolvedMarks,
  isInertMarker,
} from './revision-marker-content.ts';
import { retainedNestedRowSites } from './revision-table-preserve-nested.ts';
import { unboundTableHistories } from './revision-table-unbound-history.ts';
import { keepAlignmentRows } from './revision-table-alignment-rows.ts';
import { trimDecidedExceptions } from './revision-row-exceptions.ts';
import { restoreDecisionEmptiedControls } from './content-control-prompt-restore.ts';
import { syncDecidedControlStates } from './content-control-decision-state.ts';
import { implicitTableRowProperties } from './revision-table-implicit-height.ts';
import { ordinaryMoveRanges, planOrdinaryMoves } from './revision-move-ranges.ts';
import {
  applyCellMerge,
  restoredCellRows,
  rebuildRevisionTable,
  compactRevisionGrid,
} from './revision-table-rebuild.ts';
import {
  CELL_REVISION_NAMES,
  validTableRevision,
  tableRevisionTarget,
  tableRevisionContentTarget,
  tableRevisionNeighbours,
  tableRevisionRemovals,
  tableMergeDependencies,
  revisionAttribute,
} from './revision-table-plan.ts';
// A revision is identified by the triple `(id, author, date)` WITHIN a part, never by id alone.
// `@w:id` is `ST_DecimalNumber` on `CT_Markup` with no uniqueness constraint and no author
// scoping, so two authors' revisions may legally share an id in one part, and one logical
// revision deliberately spans many elements sharing an id. Addressing by id would merge the
// first case and could not express the second.
//
//   - CONTAINMENT governs nesting. Resolving an outer wrapper settles whether its content
//     exists; an inner revision survives exactly when the content does. Because removal takes
//     the whole subtree and unwrapping leaves it intact, the rule falls out of the rebuild
//     rather than depending on which node the walker happens to reach first.
//   - A MOVE is one decision. Accepting a `moveTo` without its `moveFrom` duplicates the
//     content, so the pair resolves together, joined by `@w:name` on the range markers.
//
// Row/cell topology and property history have separate resolution plans. Malformed
// records are refused before any mutation; historical copies never become live decisions.

import {
  createNodeIdAllocator,
  findNode,
  parentNodeOf,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { isContentRevisionKind } from '../package/ooxml-shared.ts';
import {
  holdsContent,
  mergeRevisionParagraphs,
  tableParagraphMergeTarget,
} from './revision-paragraph-merge.ts';
import { joinedAtSeams } from './revision-piece-seams.ts';
import { DEPENDENCY_KEY_IDS } from '../registry/frozen-ids.ts';
import {
  rebuildReach,
  resolutionOf,
  withDeletedTextRestored,
  type Resolution,
  pushDecidedContent,
  type DecidedSpan,
  lockedControlShells,
} from './revision-rebuild-helpers.ts';
import {
  namedMoveRanges,
  rangesOverMovedMarks,
  type MovedMarkPlace,
} from './revision-named-move-ranges.ts';
import {
  REVISION_PROPERTY_CONTAINERS,
  preservedRevisionProperty,
  validRevisionPropertyRecord,
  restoredSectionProperties,
  validNumberingRevision,
} from './revision-property-records.ts';
import { recordedProperties } from './tree-op-tracked-properties.ts';
import { scopedRevisionRoot } from './tree-op-revision-scope.ts';
import type { RevisionAddress } from './tree-op-types.ts';
import { addressOf, revisionGroupKey, sameRevision, wmlAttribute } from './revision-address.ts';

export { revisionGroupKey };
import type { TreeOpEffect, TreeOpRejection } from './tree-op-validate.ts';

export { namedMoveRanges };

/** What resolving does to one wrapper. */

/** The shared property-history vocabulary prevents read/write classification drift. */
const PROPERTY_CHANGE_NAMES: ReadonlySet<string> = new Set(REVISION_PROPERTY_CONTAINERS.keys());
const MATH_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

/** The two members of `EG_ParaRPrTrackChanges` that record a MOVE of the paragraph mark. */
const MARK_MOVE_NAMES: ReadonlySet<string> = new Set(['moveFrom', 'moveTo']);

/** Cheap canonical preflight for an element that may produce a review revision item. @internal */
export function isPotentialRevisionElement(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    (isContentRevisionKind(node.kind) ||
      MARK_MOVE_NAMES.has(node.localName) ||
      CELL_REVISION_NAMES.has(node.localName) ||
      PROPERTY_CHANGE_NAMES.has(node.localName) ||
      node.localName === 'ins' ||
      node.localName === 'del' ||
      node.kind === 'moveFromRangeStart' ||
      node.kind === 'moveToRangeStart')
  );
}

/**
 * Parents that make a `w:ins`/`w:del` a STRUCTURAL revision rather than a content one.
 *
 * `w:trPr/w:del` deletes a row; `w:numPr/w:ins` inserts a numbering reference. These need
 * explicit handling rather than wrapper removal. `w:pPr/w:rPr` — the paragraph mark — is
 * absent on purpose: it is resolved, below.
 */
const STRUCTURAL_REVISION_PARENTS: ReadonlySet<string> = new Set([
  'trPr',
  'tcPr',
  'tblPr',
  'tblPrEx',
  'numPr',
  'sectPr',
]);

export interface RevisionSite {
  readonly node: OoxmlElement;
  readonly parent: OoxmlElement | null;
  /** True when this site cannot be resolved and the whole op must refuse. */
  readonly refused: boolean;
  /** Why, when `refused` is true. */
  readonly refusal?: RevisionSiteRefusal;
  /** True for `w:pPr/w:rPr/w:ins|w:del` — the paragraph MARK, not content. */
  readonly paragraphMark: boolean;
  /** True for a supported property-history wrapper. */
  readonly propertyChange: boolean;
  /**
   * How many content-revision wrappers ENCLOSE this one, counted within its own paragraph.
   *
   * Revisions nest for real: `w:ins` wrapping `w:del` is content one reviewer added and another
   * struck, and both stay pending because each author has to be answered separately. The two
   * wrappers then cover exactly the same characters, so a range cannot tell them apart and
   * "which change is this text under" has only one honest answer — the innermost one, which is
   * the change that decides what the reader is looking at.
   *
   * Relative to the paragraph or table subtree, which is the unit the site walk memoizes. That
   * is enough and it is what keeps the memo valid: a content revision cannot enclose a
   * paragraph, and two sites can only cover one position if they are in the same paragraph.
   */
  readonly nesting: number;
}

/** Revision sites of one paragraph or table subtree, memoized on the immutable node. */
const subtreeSitesCache = new WeakMap<OoxmlNode, readonly RevisionSite[]>();

/**
 * Every revision-bearing element in the part, with the classification that decides whether it
 * can be resolved.
 *
 * One walk, so accept-all does not pay a traversal per revision — and paragraphs the last
 * commit did not touch are answered from {@link paragraphSitesCache} rather than re-walked.
 */
function collectRevisionSitesIn(
  part: OoxmlPart,
  scopeRootId?: string,
  retainAcrossReads = true
): RevisionSite[] {
  const sites: RevisionSite[] = [];
  const visit = (
    node: OoxmlNode,
    parent: OoxmlElement | null,
    grandparent: OoxmlElement | null,
    nesting: number
  ): void => {
    if (node.kind === 'textValue') return;
    // Paragraphs, tables, and rows own the parents needed to classify their revision sites.
    // A row's structural markers sit inside its properties or cells, so an unchanged row
    // need not rescan those children after another row changes. Zero nesting makes its
    // content depth independent of an enclosing content revision.
    if (
      node.kind === 'paragraph' ||
      node.kind === 'table' ||
      (node.kind === 'tableRow' && nesting === 0)
    ) {
      const cached = retainAcrossReads ? subtreeSitesCache.get(node) : undefined;
      if (cached) {
        // A plain loop, not a spread: spreading is bounded by the engine's argument-count
        // limit, and one adversarial table can legally hold more tracked markers than that
        // — the first walk would succeed and every cache hit after it would throw.
        for (const site of cached) sites.push(site);
        return;
      }
      const before = sites.length;
      // Depth restarts at the subtree the cache is keyed on, so a cached list is correct
      // wherever that node sits. Nothing is lost: a content revision cannot enclose a
      // paragraph, so a content site's depth inside its paragraph IS its depth.
      for (const child of node.children) visit(child, node, parent, 0);
      const own = sites.slice(before);
      if (retainAcrossReads) subtreeSitesCache.set(node, own);
      return;
    }
    const parentName = parent?.namespaceUri === WML_NAMESPACE_URI ? parent.localName : undefined;
    const grandparentName =
      grandparent?.namespaceUri === WML_NAMESPACE_URI ? grandparent.localName : undefined;
    if (node.namespaceUri === WML_NAMESPACE_URI) {
      const isContent = isContentRevisionKind(node.kind);
      const markMove =
        parentName === 'rPr' && grandparentName === 'pPr' && MARK_MOVE_NAMES.has(node.localName);
      const isNamedRevision =
        isContent ||
        MARK_MOVE_NAMES.has(node.localName) ||
        CELL_REVISION_NAMES.has(node.localName) ||
        PROPERTY_CHANGE_NAMES.has(node.localName) ||
        node.localName === 'ins' ||
        node.localName === 'del' ||
        (node.localName === 'numberingChange' && parentName === 'numPr');
      if (
        isNamedRevision &&
        (wmlAttribute(node, 'id') !== undefined || part.root.localName === 'styles')
      ) {
        const misplacedMark =
          parentName === 'rPr' &&
          grandparentName !== 'pPr' &&
          (node.localName === 'ins' || node.localName === 'del');
        const tableRevision = validTableRevision(node, parent, grandparent);
        // `w:numberingChange` is the legacy list history: metadata that every decision drops.
        const numberingRevision =
          grandparentName === 'pPr' &&
          (validNumberingRevision(node, parent) || node.localName === 'numberingChange');
        const structural =
          misplacedMark ||
          CELL_REVISION_NAMES.has(node.localName) ||
          (PROPERTY_CHANGE_NAMES.has(node.localName)
            ? !validRevisionPropertyRecord(node, parent)
            : parentName !== undefined && STRUCTURAL_REVISION_PARENTS.has(parentName));
        const paragraphMark =
          (!isContent || markMove) &&
          parentName === 'rPr' &&
          grandparentName === 'pPr' &&
          !structural;
        // Generic content wrappers have unsupported children or placement. Removing
        // them would discard preserved content instead of resolving a known revision.
        const unsupportedContent =
          !isContent &&
          (node.localName === 'ins' ||
            node.localName === 'del' ||
            MARK_MOVE_NAMES.has(node.localName)) &&
          !paragraphMark &&
          !tableRevision &&
          !numberingRevision;
        const refusal = revisionSiteRefusal({
          unaddressed: addressOf(node) === null,
          misplacedMarker: unsupportedContent,
          nestedMarker:
            !isContent &&
            !PROPERTY_CHANGE_NAMES.has(node.localName) &&
            hasRevisionMarkerContent(node),
          unsupportedStructure: structural && !tableRevision && !numberingRevision,
        });
        sites.push({
          node,
          parent,
          refused: refusal !== undefined,
          ...(refusal ? { refusal } : {}),
          paragraphMark,
          propertyChange: PROPERTY_CHANGE_NAMES.has(node.localName),
          nesting,
        });
      }
      // A CHANGE RECORD'S CONTENTS ARE A COPY, NOT A DECISION. `CT_ParaRPrOriginal` admits
      // `EG_ParaRPrTrackChanges` and `CT_PPrBase` admits `w:numPr/w:ins`, so a Word-written
      // record legitimately holds revision elements — and they are the container as it WAS,
      // already answered by accepting or rejecting the record around them.
      //
      // Descending classified those copies as sites of their own. A `w:ins` inside
      // `w:pPr/w:rPr/w:rPrChange/w:rPr` has parent `rPr` and grandparent `rPrChange`, so it
      // read as a misplaced mark, and one refused site refuses the whole decision: Accept All
      // and Reject All failed for EVERY revision in a document Word had written normally,
      // with a reason no reviewer can act on.
      //
      // OUTSIDE the addressed-site branch, because a wrapper missing `@w:id` or `@w:author` is
      // still a record. `CT_TrackChange` requires the author and other generators omit it
      // anyway, so an unaddressed record is an ordinary file — and it reached the same refusal.
      if (PROPERTY_CHANGE_NAMES.has(node.localName)) return;
    }
    // Only a CONTENT wrapper deepens the count. A structural or property-change revision
    // encloses no run content, so counting it would rank an unrelated site as nested.
    const inner = isContentRevisionKind(node.kind) ? nesting + 1 : nesting;
    for (const child of node.children) visit(child, node, parent, inner);
  };
  const root = scopeRootId === undefined ? part.root : findNode(part, scopeRootId);
  if (root !== null) {
    visit(root, null, null, 0);
    for (const range of ordinaryMoveRanges(root))
      sites.push({
        node: range.start,
        parent: range.parent,
        refused: !range.supported,
        ...(range.supported ? {} : { refusal: 'unsupported-move' as const }),
        paragraphMark: false,
        propertyChange: false,
        nesting: 0,
      });
  }
  return sites;
}

/** Every revision-bearing element in the part. */
export function collectRevisionSites(part: OoxmlPart): RevisionSite[] {
  return collectRevisionSitesIn(part);
}

/** Export-only cold derivation that does not populate interactive subtree memos. @internal */
export function collectRevisionSitesTransient(part: OoxmlPart): RevisionSite[] {
  return collectRevisionSitesIn(part, undefined, false);
}

/** Word preserves a named destination with no source, including its paragraph mark. */
export function orphanMoveDestinationSites(
  root: OoxmlNode,
  sites: readonly RevisionSite[]
): ReadonlySet<string> {
  const addresses = new Set<string>();
  if (!sites.some((site) => site.node.localName === 'moveTo')) return new Set();
  const ids = new Set<string>();
  const sourceless = new Set<string>();
  for (const [name, range] of namedMoveRanges(root)) {
    if (range.wrappers.some((node) => node.kind === 'revisionMoveFrom')) continue;
    sourceless.add(name);
    for (const node of range.wrappers) {
      if (node.kind !== 'revisionMoveTo') continue;
      ids.add(node.id);
      const address = addressOf(node);
      if (address) addresses.add(revisionGroupKey(address, 'moveTo'));
    }
  }
  // A destination paragraph's mark carries its own `w:id`: it belongs to the move when the
  // range is still open where the mark stands, at the paragraph's end.
  const covering =
    sourceless.size > 0 ? rangesOverMovedMarks(root) : new Map<string, MovedMarkPlace>();
  for (const site of sites) {
    if (!site.paragraphMark || site.node.localName !== 'moveTo') continue;
    const address = addressOf(site.node);
    if (!address) continue;
    if (
      addresses.has(revisionGroupKey(address, 'moveTo')) ||
      (covering.get(site.node.id)?.ranges ?? []).some((name) => sourceless.has(name))
    )
      ids.add(site.node.id);
  }
  return ids;
}

/** The `w:p` a node sits inside, by id, or null when it is not inside one. */
function paragraphOwning(part: OoxmlPart, nodeId: string): string | null {
  let current = findNode(part, nodeId);
  while (current !== null) {
    if (current.kind === 'paragraph') return current.id;
    current = parentNodeOf(part, current.id);
  }
  return null;
}

function matchingRevisionSites(
  sites: readonly RevisionSite[],
  address: RevisionAddress | undefined,
  localName?: string,
  siteNodeIds?: ReadonlySet<string>
): RevisionSite[] {
  if (address === undefined && siteNodeIds === undefined) return [...sites];
  return sites.filter((site) => {
    if (siteNodeIds !== undefined && !siteNodeIds.has(site.node.id)) return false;
    if (address === undefined) return true;
    const own = addressOf(site.node);
    if (own === null || !sameRevision(own, address)) return false;
    return localName === undefined || site.node.localName === localName;
  });
}

/** Structural protection reach: node id → whether its descendant controls are removed. */
export function revisionStructuralReach(
  part: OoxmlPart,
  action: RevisionOpAction,
  address: RevisionAddress | undefined,
  options?: {
    readonly localName?: string;
    readonly scopeRootId?: string;
    readonly siteNodeIds?: readonly string[];
  }
): ReadonlyMap<string, boolean> {
  if (options?.scopeRootId !== undefined && scopedRevisionRoot(part, options.scopeRootId) === null)
    return new Map();
  const matched = matchingRevisionSites(
    collectRevisionSitesIn(part, options?.scopeRootId),
    address,
    options?.localName,
    options?.siteNodeIds === undefined ? undefined : new Set(options.siteNodeIds)
  );
  if (matched.some((site) => site.refused)) return new Map();
  const orphanDestinations = orphanMoveDestinationSites(
    options?.scopeRootId ? scopedRevisionRoot(part, options.scopeRootId)! : part.root,
    matched
  );
  const reach = new Map<string, boolean>();
  if (action === 'reject') {
    for (const row of implicitTableRowProperties(part, matched).values()) reach.set(row, false);
    for (const row of restoredCellRows(part, matched)) reach.set(row, false);
  }
  const moves = planOrdinaryMoves(
    options?.scopeRootId ? scopedRevisionRoot(part, options.scopeRootId)! : part.root,
    collectRevisionSitesIn(part, options?.scopeRootId),
    new Set(matched.map((site) => site.node.id)),
    action
  );
  for (const id of moves.markers) reach.set(id, false);
  for (const id of moves.remove) reach.set(id, true);
  for (const id of moves.relocate.keys()) {
    const parent = parentNodeOf(part, id);
    if (parent) reach.set(parent.id, false);
  }
  for (const id of tableRevisionNeighbours(part, matched, action).keys()) reach.set(id, false);
  const removed = new Set(tableRevisionRemovals(part, matched, action).keys());
  for (const id of removed) reach.set(id, true);
  for (const site of matched) {
    const target = tableRevisionContentTarget(part, site, action);
    if (target) reach.set(target.id, true);
  }
  // Child positions per container, built once: one lookup per resolved mark, not one scan.
  const positions = new Map<string, Map<string, number>>();
  for (const site of matched) {
    if (
      !site.paragraphMark ||
      orphanDestinations.has(site.node.id) ||
      !(
        (action === 'accept' && ['del', 'moveFrom'].includes(site.node.localName)) ||
        (action === 'reject' && ['ins', 'moveTo'].includes(site.node.localName))
      )
    )
      continue;
    const id = paragraphOwning(part, site.node.id);
    const container = id && parentNodeOf(part, id);
    if (!container) continue;
    let index = positions.get(container.id);
    if (!index) {
      index = new Map(container.children.map((n, i) => [n.id, i]));
      positions.set(container.id, index);
    }
    let next: OoxmlNode | undefined;
    for (let i = (index.get(id) ?? -1) + 1; i < container.children.length && !next; i++) {
      const n = container.children[i]!;
      const block = n.kind === 'paragraph' || n.kind === 'table' || n.kind === 'contentControl';
      if (block && !removed.has(n.id)) next = n;
    }
    if (next) {
      const target = tableParagraphMergeTarget(next, removed);
      if (target) reach.set(target.id, false);
    }
  }
  return reach;
}

interface RebuildPlan {
  /** Wrapper node id → what to do with it. */
  readonly actions: ReadonlyMap<string, Resolution>;
  readonly relocate: ReadonlyMap<string, readonly OoxmlNode[]>;
  /** Nodes to drop outright: resolved paragraph marks and spent move-range markers. */
  readonly dropMarks: ReadonlySet<string>;
  /** Inserted marks accepted for good: a container left holding nothing goes with them. */
  readonly acceptedMarks: ReadonlySet<string>;
  /** Property-change wrappers, node id → restore the recorded properties into the parent. */
  readonly restoreProperties: ReadonlySet<string>;
  /**
   * Paragraphs whose mark is resolved away, so they merge with the paragraph that follows.
   *
   * Accepting `w:pPr/w:rPr/w:del` means the paragraph mark is gone, and a paragraph without
   * its mark is not a paragraph — it runs into the next one. Removing only the `w:del`
   * element would report the deletion applied while leaving two paragraphs, which is the same
   * class of error as removing a `w:trPr/w:del` and leaving the row.
   */
  readonly mergeForward: ReadonlySet<string>;
  /** Rejected inserted marks: their join keeps the first paragraph, as undoing the split does. */
  readonly first: ReadonlyMap<string, boolean>;
  /** Accepting: a cell's emptied last paragraph joins the one before (rejecting keeps it). */
  readonly accepting: boolean;
  /** Removed cells, rows, and tables, including containers emptied by this decision. */
  readonly removeStructures: ReadonlySet<string>;
  readonly mergeCells: ReadonlyMap<string, OoxmlElement>;
  readonly mint: () => string;
  readonly tables: ReadonlySet<string>;
  /** The nodes on a path to a target; every other subtree is kept as it is. */
  readonly reach: ReadonlySet<string>;
}

/**
 * Rebuild one child list, applying every action that targets a child of THIS node.
 *
 * Separated from `rebuild` because unwrapping a wrapper has to run its children through the
 * same logic. Recursing into the child directly would skip the child's OWN action, so a
 * rejected insertion inside a rejected deletion survived: the outer unwrap consumed the inner
 * wrapper as ordinary content.
 */
function rebuildChildren(
  children: readonly OoxmlNode[],
  plan: RebuildPlan,
  cell = false,
  container = ''
): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  let decided: DecidedSpan | null = null;
  // Where a child left nothing or was unwrapped: pieces of one change that met there join.
  const seams: number[] = [];
  let pushed = -1;
  for (const child of children) {
    if (pushed === out.length) seams.push(out.length);
    pushed = out.length;
    const before = decided;
    decided = null;
    if (child.kind !== 'textValue' && !plan.reach.has(child.id)) {
      out.push(child);
      continue;
    }
    const relocated = plan.relocate.get(child.id);
    if (relocated) {
      const removeStructures = new Set(plan.removeStructures);
      for (const node of relocated) removeStructures.delete(node.id);
      out.push(...rebuildChildren(relocated, { ...plan, removeStructures }));
    }
    if (child.kind !== 'textValue' && plan.removeStructures.has(child.id)) continue;
    if (child.kind !== 'textValue' && plan.dropMarks.has(child.id)) continue;
    if (child.kind !== 'textValue' && plan.restoreProperties.has(child.id)) continue;
    const action = child.kind === 'textValue' ? undefined : plan.actions.get(child.id);
    if (action === 'remove') {
      out.push(...lockedControlShells(child));
      continue;
    }
    if (child.kind !== 'textValue' && (action === 'unwrap' || action === 'restore')) {
      // The wrapper goes; its content stays and is rebuilt under the same plan, so an inner
      // revision that survives is preserved verbatim rather than resolved on its author's
      // behalf — and one that does not survive is still resolved.
      const kept = rebuildChildren(child.children, plan).map((node) =>
        action === 'restore' ? withDeletedTextRestored(node) : node
      );
      seams.push(out.length);
      decided = pushDecidedContent(out, child, kept, before, plan.mint);
      seams.push(out.length);
      continue;
    }

    const rebuilt = rebuild(child, plan);
    // A run CONTAINER the resolution emptied goes with its content. A `w:fldSimple` with no
    // runs is not a field any more — striking a simple field puts the `w:del` INSIDE it, since
    // `CT_RunTrackChange` takes `EG_ContentRunContent` and that has no `fldSimple` in it, so
    // accepting leaves a hollow one still occupying the model position the reviewer agreed to
    // remove. A `w:hyperlink` with no runs is a link to nowhere holding a relationship alive.
    // An untracked delete over the same range removes both, and the decision matches it. An
    // equation the decision emptied goes the same way.
    const survivor = rebuilt[0];
    const hollow =
      rebuilt.length === 1 && survivor !== undefined && survivor.kind !== 'textValue'
        ? survivor
        : null;
    const container =
      child.kind === 'fldSimple' ||
      child.kind === 'hyperlink' ||
      (child.kind !== 'textValue' &&
        child.namespaceUri === MATH_NAMESPACE &&
        (child.localName === 'oMath' || child.localName === 'oMathPara'));
    // An equation paragraph keeps its properties but holds no equation.
    const empty = (entry: OoxmlNode) =>
      entry.kind === 'textValue' ||
      (child.kind !== 'textValue' &&
        child.localName === 'oMathPara' &&
        entry.namespaceUri === MATH_NAMESPACE &&
        entry.localName === 'oMathParaPr');
    if (container && hollow?.children.every(empty)) continue;
    if (
      hollow?.children.length === 0 &&
      heldOnlyResolvedMarks(child, plan.dropMarks, plan.acceptedMarks)
    )
      continue;
    // A revision wrapper the resolution emptied goes the same way. Accepting one author's
    // deletion of another author's insertion removes the deleted runs and leaves the `w:ins`
    // holding no characters to decide about — yet it carded as a blank entry and kept the
    // document reporting tracked changes. "Emptied" means no CONTENT left: Word writes
    // bookmark, comment-range and proofing markers directly inside a wrapper, and a wrapper
    // reduced to those is as hollow as one with nothing. The markers themselves are hoisted,
    // not dropped, because each pairs with a counterpart elsewhere. Move halves sweep too: the
    // range markers are siblings of the wrapper, so the other half still resolves by name.
    // Only a wrapper THIS resolution emptied is swept — one that arrived empty is not this
    // decision's to remove.
    if (
      hollow !== null &&
      child.kind !== 'textValue' &&
      isContentRevisionKind(child.kind) &&
      child.children.some((entry) => !isInertMarker(entry)) &&
      hollow.children.every(isInertMarker)
    ) {
      for (const marker of hollow.children) out.push(marker);
      continue;
    }
    out.push(...rebuilt);
  }

  const joined = joinedAtSeams(plan.mint, out, seams);
  return mergeRevisionParagraphs(joined, plan.mergeForward, plan.mint, cell, container, plan.first);
}

function rebuild(node: OoxmlNode, plan: RebuildPlan): OoxmlNode[] {
  const rebuilt = rebuildNode(node, plan);
  return rebuilt.map((result) => {
    if (result.kind === 'textValue') return result;
    if (result.kind === 'table') {
      return plan.tables.has(result.id)
        ? compactRevisionGrid(
            rebuildRevisionTable(
              node as OoxmlElement,
              result,
              plan.removeStructures,
              plan.mint,
              plan.mergeCells,
              plan.restoreProperties
            ),
            plan.mint
          )
        : result;
    }
    const merge = plan.mergeCells.get(result.id);
    if (merge) result = applyCellMerge(result, revisionAttribute(merge, 'vMerge'), plan.mint);
    if (
      result.kind === 'tableCell' &&
      !result.children.some(
        (child) =>
          child.kind === 'paragraph' || child.kind === 'table' || child.kind === 'contentControl'
      )
    ) {
      return {
        ...result,
        children: [
          ...result.children,
          {
            ...result,
            id: plan.mint(),
            kind: 'paragraph',
            localName: 'p',
            attributes: [],
            children: [],
          },
        ],
      } as OoxmlElement;
    }
    return result;
  });
}

function rebuildNode(node: OoxmlNode, plan: RebuildPlan): OoxmlNode[] {
  if (node.kind === 'textValue') return [node];

  // A property-change reject replaces the CONTAINER's children with what the wrapper recorded,
  // so it is handled by the container rather than by the wrapper itself.
  const restoring = node.children.find(
    (child) => child.kind !== 'textValue' && plan.restoreProperties.has(child.id)
  );
  if (restoring !== undefined && restoring.kind !== 'textValue') {
    const recorded = recordedProperties(restoring);
    if (recorded !== null) {
      // Property snapshots exclude independently tracked paragraph/section marks.
      // Preserve their live versions, ignoring historical copies, and run them
      // through this plan so bulk resolution still resolves selected marks.
      const preserved = rebuildChildren(
        node.children.filter((child) => preservedRevisionProperty(restoring.localName, child)),
        plan
      );
      let base = recorded.filter((child) => !preservedRevisionProperty(restoring.localName, child));
      if (restoring.localName === 'sectPrChange')
        base = restoredSectionProperties(
          node.children.filter(
            (child) =>
              child.id !== restoring.id && !preservedRevisionProperty(restoring.localName, child)
          ),
          base
        );
      const children =
        restoring.localName === 'rPrChange' || restoring.localName === 'sectPrChange'
          ? [...preserved, ...base]
          : [...base, ...preserved];
      return [{ ...node, children } as OoxmlElement];
    }
  }

  // An untouched subtree keeps its identity, so layout and digest caches still hit.
  const children = rebuildChildren(
    node.children,
    plan,
    plan.accepting && node.kind === 'tableCell',
    node.localName
  );
  const same =
    children.length === node.children.length && children.every((c, i) => c === node.children[i]);
  return [same ? node : ({ ...node, children } as OoxmlElement)];
}

export type RevisionOpAction = 'accept' | 'reject';

export interface RevisionResolveResult {
  readonly ok: boolean;
  readonly reason?: TreeOpRejection;
  readonly part?: OoxmlPart;
  readonly effect?: TreeOpEffect;
}

interface RevisionResolutionOperation {
  readonly revision?: RevisionAddress;
  readonly localName?: string;
  readonly siteNodeIds?: readonly string[];
  readonly scopeRootId?: string;
}

/** Adapt one revision tree operation to the shared resolver. */
export function resolveRevisionOperation(
  part: OoxmlPart,
  action: RevisionOpAction,
  operation: RevisionResolutionOperation,
  options?: EditOptions
): RevisionResolveResult {
  return resolveRevisions(part, action, operation.revision, {
    ...options,
    ...(operation.localName === undefined ? {} : { localName: operation.localName }),
    ...(operation.siteNodeIds === undefined ? {} : { siteNodeIds: operation.siteNodeIds }),
    ...(operation.scopeRootId === undefined ? {} : { scopeRootId: operation.scopeRootId }),
  });
}

/** Resolve the selected canonical sites atomically; refuse unsupported sites without mutation. */
export function resolveRevisions(
  part: OoxmlPart,
  action: RevisionOpAction,
  address: RevisionAddress | undefined,
  options?: EditOptions & {
    readonly localName?: string;
    readonly scopeRootId?: string;
    readonly siteNodeIds?: readonly string[];
  }
): RevisionResolveResult {
  const scopeRoot =
    options?.scopeRootId === undefined ? part.root : scopedRevisionRoot(part, options.scopeRootId);
  if (scopeRoot === null || scopeRoot.kind === 'textValue') {
    return { ok: false, reason: 'invalid-property-value' };
  }
  const sites = collectRevisionSitesIn(part, options?.scopeRootId);
  const unboundHistories = unboundTableHistories(part, sites);
  const retainedRows = retainedNestedRowSites(part, sites, action);
  let matched = matchingRevisionSites(
    sites,
    address,
    options?.localName,
    options?.siteNodeIds === undefined ? undefined : new Set(options.siteNodeIds)
  );
  if (matched.length === 0) return { ok: false, reason: 'unknown-revision' };
  const movePlan = planOrdinaryMoves(
    scopeRoot,
    sites,
    new Set(matched.map((site) => site.node.id)),
    action
  );
  const selected = movePlan.selected;
  matched = sites.filter((site) => selected.has(site.node.id));
  const mergeIds = new Set(
    sites.filter((site) => site.node.localName === 'cellMerge').map((site) => site.node.id)
  );
  if (
    mergeIds.size &&
    tableMergeDependencies({ ...part, root: scopeRoot }, action).some(
      (group) =>
        group.some((id) => mergeIds.has(id)) &&
        group.some((id) => selected.has(id)) &&
        group.some((id) => !selected.has(id))
    )
  )
    return { ok: false, reason: 'unsupported-revision' };
  if (
    matched.some(
      (site) =>
        site.refused ||
        (action === 'reject' && site.propertyChange && recordedProperties(site.node) === null)
    )
  )
    return { ok: false, reason: 'unsupported-revision' };

  const orphanDestinations = orphanMoveDestinationSites(scopeRoot, sites);
  const actions = new Map<string, Resolution>();
  const dropMarks = new Set(movePlan.markers);
  const acceptedMarks = new Set<string>();
  if (action === 'reject')
    for (const id of implicitTableRowProperties(part, matched).keys()) dropMarks.add(id);
  const restoreProperties = new Set<string>();
  const mergeForward = new Set<string>();
  const first = new Map<string, boolean>();
  const removeStructures = new Set([
    ...tableRevisionRemovals(part, matched, action).keys(),
    ...movePlan.remove,
  ]);
  const mergeCells = new Map<string, OoxmlElement>();
  const tables = new Set<string>();
  // A cell its deleted paragraphs empty goes with no table marker of its own.
  for (const id of removeStructures) {
    let table = parentNodeOf(part, id);
    while (table && table.kind !== 'table') table = parentNodeOf(part, table.id);
    if (table && ['tableCell', 'tableRow'].includes(findNode(part, id)?.kind ?? ''))
      tables.add(table.id);
  }
  for (const site of matched) {
    if (
      !tableRevisionTarget(part, site) &&
      !(
        site.propertyChange &&
        !['rPrChange', 'pPrChange', 'sectPrChange'].includes(site.node.localName)
      )
    )
      continue;
    let ancestor = site.parent;
    while (ancestor) {
      if (ancestor.kind === 'table') {
        tables.add(ancestor.id);
        break;
      }
      ancestor = parentNodeOf(part, ancestor.id);
    }
  }

  const addWrapper = (node: OoxmlElement): void => {
    actions.set(
      node.id,
      movePlan.wrapperActions.get(node.id) ??
        (orphanDestinations.has(node.id) ? 'unwrap' : resolutionOf(node, action))
    );
  };

  for (const site of matched) {
    if (retainedRows.has(site.node.id)) continue;
    if (site.node.kind === 'moveFromRangeStart' || site.node.kind === 'moveToRangeStart') continue;
    if (tableRevisionTarget(part, site)) {
      dropMarks.add(site.node.id);
      if (site.node.localName === 'cellMerge' && site.parent) {
        const value = revisionAttribute(site.node, action === 'accept' ? 'vMerge' : 'vMergeOrig');
        mergeCells.set(tableRevisionTarget(part, site)!.id, {
          ...site.node,
          attributes: site.node.attributes
            .filter((attribute) => attribute.localName !== 'vMerge')
            .concat(
              value === undefined
                ? []
                : [
                    {
                      kind: 'genericExtension' as const,
                      namespaceUri: WML_NAMESPACE_URI,
                      prefix: site.node.prefix,
                      localName: 'vMerge',
                      value,
                    },
                  ]
            ),
        });
      }
      continue;
    }
    if (site.propertyChange) {
      if (action === 'accept' || unboundHistories.has(site.node.id)) dropMarks.add(site.node.id);
      else restoreProperties.add(site.node.id);
      continue;
    }
    if (site.paragraphMark) {
      // `w:pPr/w:rPr/w:ins|w:del` marks the paragraph MARK itself, which is how Word records a
      // split or a merge. Accepting a deleted mark, or rejecting an inserted one, removes the
      // mark — and the paragraph then runs into the one after it. Removing only the element
      // would report the decision applied while leaving the split in place.
      // `moveFrom` and `moveTo` are the same two decisions under another name: accepting a
      // move removes the mark the paragraph left, rejecting one removes the mark it arrived
      // at. Both then run the paragraph into the one after it, exactly as `del`/`ins` do.
      const removesMark =
        (action === 'accept' &&
          (site.node.localName === 'del' || site.node.localName === 'moveFrom')) ||
        (action === 'reject' &&
          (site.node.localName === 'ins' || site.node.localName === 'moveTo'));
      dropMarks.add(site.node.id);
      if (action === 'accept' && !removesMark) acceptedMarks.add(site.node.id);
      if (removesMark && !orphanDestinations.has(site.node.id)) {
        const paragraph = paragraphOwning(part, site.node.id);
        if (paragraph === null) return { ok: false, reason: 'unsupported-revision' };
        mergeForward.add(paragraph);
        if (action === 'reject' && site.node.localName === 'ins')
          first.set(paragraph, !holdsContent(findNode(part, paragraph)));
      }
      continue;
    }
    if (site.node.localName === 'numberingChange') {
      dropMarks.add(site.node.id);
      continue;
    }
    addWrapper(site.node);
  }

  const movesMatched = matched.filter(
    (site) => site.node.kind === 'revisionMoveFrom' || site.node.kind === 'revisionMoveTo'
  );
  if (movesMatched.length > 0) {
    for (const [, range] of namedMoveRanges(scopeRoot)) {
      if (
        range.wrappers.some((wrapper) => movePlan.wrapperActions.has(wrapper.id)) ||
        !range.wrappers.some((wrapper) => actions.has(wrapper.id))
      )
        continue;
      for (const wrapper of range.wrappers) addWrapper(wrapper);
      // Legacy paired wrappers consume their range metadata together.
      for (const marker of range.markers) dropMarks.add(marker.id);
    }
  }

  const plan: RebuildPlan = {
    actions,
    relocate: movePlan.relocate,
    dropMarks,
    acceptedMarks,
    restoreProperties,
    mergeForward,
    first,
    accepting: action === 'accept',
    removeStructures,
    mergeCells,
    tables,
    mint: createNodeIdAllocator(part),
    reach: rebuildReach(part, [
      ...actions.keys(),
      ...movePlan.relocate.keys(),
      ...dropMarks,
      ...restoreProperties,
      ...mergeForward,
      ...removeStructures,
      ...mergeCells.keys(),
      ...tables,
    ]),
  };
  const rebuilt = rebuild(part.root, plan);
  const root = rebuilt[0];
  if (rebuilt.length !== 1 || root === undefined || root.kind === 'textValue') {
    return { ok: false, reason: 'tree-invariant' };
  }
  const replaced = replaceChildren(part, part.root.id, root.children, options);
  const decided = new Set(matched.map((site) => site.node.id));
  const aligned =
    replaced.ok && keepAlignmentRows(part, sites, decided, action, replaced.part, options);
  const settled = aligned && trimDecidedExceptions(part, matched, aligned, options);
  if (!settled) {
    return { ok: false, reason: 'tree-invariant' };
  }
  return {
    ok: true,
    part: syncDecidedControlStates(
      part,
      decided,
      restoreDecisionEmptiedControls(part, decided, settled, options),
      options
    ),
    effect: {
      dirty: [],
      created: [],
      deleted: [],
      // Resolving a revision can remove a paragraph's entire content and re-flow every page
      // after it, so it is never narrower than a structural change.
      dependencyKeys: [DEPENDENCY_KEY_IDS.story],
      impact: 'flow-structural',
    },
  };
}

export type { RevisionAddress };
