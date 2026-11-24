// Row insertion and deletion for canonical tables (table-editing task 3).
//
// Validates complete targets before mutation, copies only safe row/cell property skeletons,
// and publishes one flow-structural effect per operation. A row inserted inside a vertical
// merge repeats `w:vMerge` for the covered cells, so the merge grows by one row.

import { actorScopedSeed } from '../package/actor-scoped-ids.ts';
import {
  createNodeIdAllocator,
  insertChildren,
  removeNode,
  replaceNode,
  applyEdits,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import {
  mintedParagraphIdentityAttributes,
  mintParaId,
  usedParaIds,
  w14PrefixInScopeAt,
} from '../package/para-id.ts';
import {
  wmlFreshNamespaceContextAt,
  namespaceBindingsAt,
  type WmlFreshNamespaceContext,
} from '../package/wml-namespace.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
  type OoxmlTableCellNode,
  type OoxmlTableRowNode,
} from '../package/ooxml-tree.ts';
import {
  DEFAULT_TABLE_TOPOLOGY_LIMITS,
  MAX_TABLE_COLUMN_WIDTH_TWIPS,
  MAX_TABLE_WIDTH_TWIPS,
  MIN_TABLE_COLUMN_WIDTH_TWIPS,
  resolveTableTopologyLimits,
  type TableTopologyLimits,
} from './table-constraints.ts';
import {
  CT_TCPR_SEQUENCE,
  CT_TRPR_SEQUENCE,
  patchTblGridColumn,
  patchTblPrChild,
  patchTcPrChild,
  patchTrPrChild,
} from './tree-op-table-properties.ts';
import { resizedGridCells, validateTableResizeGrid } from './table-resize-grid.ts';
import { readTwipsMeasure } from '../units.ts';
import { paragraphIdsWithin } from './tree-op-blocks.ts';
import { fromEdit, TEXT_DEPS } from './tree-op-nodes.ts';
import { isWmlElement, wmlAttributeValue, wmlChildNamed } from './tree-op-table-shared.ts';
import { readEditableTableTopology, type EditableTableTopology } from './tree-op-table-topology.ts';
import {
  rowHasVerticalMerge,
  rowHidesCellInWrapper,
  tableHidesRowBetween,
  verticalMergeContinuationCells,
} from './tree-op-table-vmerge.ts';
import {
  planVerticalMergeHeadRepairs,
  verticalMergeHeadRepairDirtyIds,
  rowRemovalEdits,
} from './tree-op-table-vmerge-removal.ts';
import { nextRevisionId } from './tree-op-revision-ids.ts';
import {
  insertedCellParagraphContent,
  insertedCellParagraphNodeCount,
} from './tree-op-table-row-paragraph.ts';
import {
  invalidRevisionAttribution,
  type RevisionAttributionInput,
  type TreeOpEffect,
  type TreeOpRejection,
  type TreeOpResult,
} from './tree-op-types.ts';

const TR_PR_STRIP = new Set(['ins', 'del', 'trPrChange']);
const TC_PR_STRIP = new Set(['vMerge', 'hMerge', 'cellIns', 'cellDel', 'cellMerge', 'tcPrChange']);
const COLUMN_TC_PR_STRIP = new Set([...TC_PR_STRIP, 'gridSpan']);

export const SAFE_TRPR_LEAVES: readonly string[] = CT_TRPR_SEQUENCE.filter(
  (name) => !TR_PR_STRIP.has(name)
);
const SAFE_TCPR_LEAVES: readonly string[] = CT_TCPR_SEQUENCE.filter(
  (name) => !TC_PR_STRIP.has(name)
);
export const COLUMN_SAFE_TCPR_LEAVES: readonly string[] = CT_TCPR_SEQUENCE.filter(
  (name) => !COLUMN_TC_PR_STRIP.has(name)
);

const COMPOUND_PROPERTY_CHILDREN: Readonly<Record<string, readonly string[]>> = {
  tcBorders: ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'],
  tcMar: ['top', 'left', 'bottom', 'right'],
};

export type TableRowDocOp =
  | {
      readonly op: 'insertTableRow';
      readonly tableId: string;
      readonly rowId: string;
      readonly where: 'above' | 'below';
      readonly revision?: RevisionAttributionInput;
    }
  | {
      readonly op: 'deleteTableRow';
      readonly tableId: string;
      readonly rowId: string;
      readonly referenceCellId?: string;
      readonly revision?: RevisionAttributionInput;
    };

export type TableColumnDocOp =
  | {
      readonly op: 'insertTableColumn';
      readonly tableId: string;
      readonly where: 'left' | 'right';
      readonly gridColumnId: string;
    }
  | {
      readonly op: 'insertTableColumn';
      readonly tableId: string;
      readonly where: 'left' | 'right';
      readonly referenceCellId: string;
    }
  | {
      readonly op: 'deleteTableColumn';
      readonly tableId: string;
      readonly gridColumnId: string;
    };

export type TableResizeDocOp =
  | {
      readonly op: 'setTableColumnWidths';
      readonly tableId: string;
      readonly leftGridColumnId: string;
      readonly rightGridColumnId: string;
      readonly leftWidthTwips: number;
      readonly rightWidthTwips: number;
    }
  | {
      readonly op: 'setTableRightEdgeWidth';
      readonly tableId: string;
      readonly gridColumnId: string;
      readonly columnWidthTwips: number;
      readonly tableWidthTwips: number;
    }
  | {
      readonly op: 'setTableRowHeight';
      readonly tableId: string;
      readonly rowId: string;
      readonly heightTwips: number;
    };

interface RowInsertionPlan {
  readonly sourceRow: OoxmlTableRowNode;
  readonly cellCount: number;
  readonly structureBudget: number;
  /** Source-row cell indexes whose vertical merge continues through the inserted row. */
  readonly continuations: ReadonlySet<number>;
}

export function mapTopologyRejection(
  reason: 'unknown-table' | 'duplicate-property-container' | 'duplicate-node-id' | 'resource-limit'
): TreeOpRejection {
  if (reason === 'duplicate-node-id') return 'unknown-table';
  return reason;
}

const VAL_ATTRS = ['val'] as const;
const WIDTH_ATTRS = ['w', 'type'] as const;
const SHD_ATTRS = [
  'val',
  'fill',
  'color',
  'themeFill',
  'themeFillTint',
  'themeFillShade',
  'themeColor',
  'themeTint',
  'themeShade',
] as const;
const BORDER_SIDE_ATTRS = [
  'val',
  'sz',
  'color',
  'space',
  'shadow',
  'frame',
  'themeColor',
  'themeTint',
  'themeShade',
] as const;
const TR_HEIGHT_ATTRS = ['val', 'hRule'] as const;

const PROPERTY_LEAF_ATTRS: Readonly<Record<string, readonly string[]>> = {
  cnfStyle: VAL_ATTRS,
  divId: VAL_ATTRS,
  gridBefore: VAL_ATTRS,
  gridAfter: VAL_ATTRS,
  gridSpan: VAL_ATTRS,
  wBefore: WIDTH_ATTRS,
  wAfter: WIDTH_ATTRS,
  tcW: WIDTH_ATTRS,
  cantSplit: VAL_ATTRS,
  trHeight: TR_HEIGHT_ATTRS,
  tblHeader: VAL_ATTRS,
  tblCellSpacing: WIDTH_ATTRS,
  jc: VAL_ATTRS,
  hidden: VAL_ATTRS,
  shd: SHD_ATTRS,
  noWrap: VAL_ATTRS,
  textDirection: VAL_ATTRS,
  tcFitText: VAL_ATTRS,
  vAlign: VAL_ATTRS,
  hideMark: VAL_ATTRS,
};

const PRESENCE_ONLY_PROPERTY_LEAVES = new Set([
  'cantSplit',
  'tblHeader',
  'noWrap',
  'tcFitText',
  'hideMark',
]);

function projectWmlAttributes(
  source: OoxmlElement,
  allowedLocalNames: readonly string[],
  wml: WmlFreshNamespaceContext
): OoxmlAttribute[] {
  const allowed = new Set(allowedLocalNames);
  const projected: OoxmlAttribute[] = [];
  for (const attribute of source.attributes) {
    if (attribute.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (!allowed.has(attribute.localName)) continue;
    projected.push(
      attribute.localName === 'val'
        ? ({
            kind: 'wmlVal',
            namespaceUri: WML_NAMESPACE_URI,
            localName: 'val',
            prefix: wml.attributePrefix,
            value: attribute.value,
          } as const)
        : ({
            kind: 'genericExtension',
            namespaceUri: WML_NAMESPACE_URI,
            localName: attribute.localName,
            prefix: wml.attributePrefix,
            value: attribute.value,
          } as const)
    );
  }
  return projected;
}

export function freshWmlElement(
  localName: string,
  nextId: () => string,
  wml: WmlFreshNamespaceContext,
  attributes: readonly OoxmlAttribute[],
  children: readonly OoxmlNode[] = []
): OoxmlElement {
  return {
    id: nextId(),
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    ...(wml.elementPrefix === undefined ? {} : { prefix: wml.elementPrefix }),
    namespaceBindings: [],
    attributes,
    children,
  } as OoxmlElement;
}

export function trackedRevisionAttributes(
  revisionId: string,
  revision: RevisionAttributionInput,
  wml: WmlFreshNamespaceContext
): OoxmlAttribute[] {
  const attribute = (localName: string, value: string): OoxmlAttribute => ({
    kind: 'genericExtension',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: wml.attributePrefix,
    value,
  });
  return [
    attribute('id', revisionId),
    attribute('author', revision.author),
    ...(revision.date === undefined ? [] : [attribute('date', revision.date)]),
  ];
}

export function withTrackedRowMarker(
  row: OoxmlTableRowNode,
  markerKind: 'ins' | 'del',
  revisionId: string,
  revision: RevisionAttributionInput,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlTableRowNode {
  const rowMarker = freshWmlElement(
    markerKind,
    nextId,
    wml,
    trackedRevisionAttributes(revisionId, revision, wml)
  );
  const existingTrPr = wmlChildNamed(row, 'trPr');
  const trPr = existingTrPr ?? freshWmlElement('trPr', nextId, wml, []);
  const patchedTrPr = patchTrPrChild(trPr, rowMarker);
  if (!patchedTrPr.ok) return row;

  const cellMarkerKind = markerKind === 'ins' ? 'cellIns' : 'cellDel';
  const children = row.children.map((child): OoxmlNode => {
    if (child.kind !== 'tableCell') {
      return child === existingTrPr ? patchedTrPr.container : child;
    }
    const marker = freshWmlElement(
      cellMarkerKind,
      nextId,
      wml,
      trackedRevisionAttributes(revisionId, revision, wml)
    );
    const existingTcPr = wmlChildNamed(child, 'tcPr');
    const tcPr = existingTcPr ?? freshWmlElement('tcPr', nextId, wml, []);
    const patchedTcPr = patchTcPrChild(tcPr, marker);
    if (!patchedTcPr.ok) return child;
    const cellChildren = existingTcPr
      ? child.children.map((candidate) =>
          candidate === existingTcPr ? patchedTcPr.container : candidate
        )
      : [patchedTcPr.container, ...child.children];
    return Object.freeze({ ...child, children: cellChildren }) as OoxmlTableCellNode;
  });
  if (!existingTrPr) children.unshift(patchedTrPr.container);
  return Object.freeze({ ...row, children }) as OoxmlTableRowNode;
}

export function freshTableRow(
  nextId: () => string,
  children: readonly OoxmlNode[],
  wml: WmlFreshNamespaceContext
): OoxmlTableRowNode {
  return {
    id: nextId(),
    kind: 'tableRow',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'tr',
    ...(wml.elementPrefix === undefined ? {} : { prefix: wml.elementPrefix }),
    namespaceBindings: wml.rowBinding ? [wml.rowBinding] : [],
    attributes: [],
    children,
  } as OoxmlTableRowNode;
}

export function freshTableCell(
  nextId: () => string,
  children: readonly OoxmlNode[],
  wml: WmlFreshNamespaceContext
): OoxmlTableCellNode {
  return {
    id: nextId(),
    kind: 'tableCell',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'tc',
    ...(wml.elementPrefix === undefined ? {} : { prefix: wml.elementPrefix }),
    namespaceBindings: [],
    attributes: [],
    children,
  } as OoxmlTableCellNode;
}

function hasUnexpectedWmlChildren(source: OoxmlElement): boolean {
  return source.children.some(
    (child) => child.kind !== 'textValue' && child.namespaceUri === WML_NAMESPACE_URI
  );
}

function canProjectSidePropertyLeaf(
  source: OoxmlElement,
  allowedLocalNames: readonly string[],
  wml: WmlFreshNamespaceContext
): boolean {
  if (source.children.some((child) => child.kind === 'textValue')) return false;
  if (hasUnexpectedWmlChildren(source)) return false;
  return projectWmlAttributes(source, allowedLocalNames, wml).length > 0;
}

function projectSidePropertyLeaf(
  source: OoxmlElement,
  nextId: () => string,
  allowedLocalNames: readonly string[],
  wml: WmlFreshNamespaceContext
): OoxmlElement | null {
  if (!canProjectSidePropertyLeaf(source, allowedLocalNames, wml)) return null;
  return freshWmlElement(
    source.localName,
    nextId,
    wml,
    projectWmlAttributes(source, allowedLocalNames, wml)
  );
}

function canProjectSimplePropertyLeaf(
  source: OoxmlElement,
  wml: WmlFreshNamespaceContext
): boolean {
  if (source.children.some((child) => child.kind === 'textValue')) return false;
  if (hasUnexpectedWmlChildren(source)) return false;
  const allowlist = PROPERTY_LEAF_ATTRS[source.localName];
  if (!allowlist) return false;
  const attributes = projectWmlAttributes(source, allowlist, wml);
  if (attributes.length > 0) return true;
  return PRESENCE_ONLY_PROPERTY_LEAVES.has(source.localName);
}

function projectSimplePropertyLeaf(
  source: OoxmlElement,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlElement | null {
  if (!canProjectSimplePropertyLeaf(source, wml)) return null;
  const allowlist = PROPERTY_LEAF_ATTRS[source.localName]!;
  return freshWmlElement(
    source.localName,
    nextId,
    wml,
    projectWmlAttributes(source, allowlist, wml)
  );
}

function projectCompoundPropertyLeaf(
  source: OoxmlElement,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlElement | null {
  const allowedChildren = COMPOUND_PROPERTY_CHILDREN[source.localName];
  if (!allowedChildren) return null;
  const sideAttrs = source.localName === 'tcMar' ? WIDTH_ATTRS : BORDER_SIDE_ATTRS;
  const children: OoxmlNode[] = [];
  for (const name of allowedChildren) {
    const child = source.children.find((candidate) => isWmlElement(candidate, name));
    if (!child || child.kind === 'textValue') continue;
    const projected = projectSidePropertyLeaf(child, nextId, sideAttrs, wml);
    if (projected) children.push(projected);
  }
  if (children.length === 0) return null;
  return freshWmlElement(source.localName, nextId, wml, [], children);
}

function projectPropertyLeaf(
  source: OoxmlElement,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlElement | null {
  if (COMPOUND_PROPERTY_CHILDREN[source.localName])
    return projectCompoundPropertyLeaf(source, nextId, wml);
  return projectSimplePropertyLeaf(source, nextId, wml);
}

export function copySafePropertyContainer(
  container: OoxmlElement,
  allowedLeaves: readonly string[],
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlElement | null {
  const children: OoxmlNode[] = [];
  for (const name of allowedLeaves) {
    const child = container.children.find((candidate) => isWmlElement(candidate, name));
    if (!child || child.kind === 'textValue') continue;
    const projected = projectPropertyLeaf(child, nextId, wml);
    if (projected) children.push(projected);
  }
  if (children.length === 0) return null;
  return freshWmlElement(container.localName, nextId, wml, [], children);
}

function countProjectedPropertyLeaf(source: OoxmlElement, wml: WmlFreshNamespaceContext): number {
  if (COMPOUND_PROPERTY_CHILDREN[source.localName]) {
    const allowedChildren = COMPOUND_PROPERTY_CHILDREN[source.localName]!;
    const sideAttrs = source.localName === 'tcMar' ? WIDTH_ATTRS : BORDER_SIDE_ATTRS;
    let count = 1;
    for (const name of allowedChildren) {
      const child = source.children.find((candidate) => isWmlElement(candidate, name));
      if (
        !child ||
        child.kind === 'textValue' ||
        !canProjectSidePropertyLeaf(child, sideAttrs, wml)
      )
        continue;
      count += 1;
    }
    return count > 1 ? count : 0;
  }
  return canProjectSimplePropertyLeaf(source, wml) ? 1 : 0;
}

const PLANNING_WML_CONTEXT: WmlFreshNamespaceContext = Object.freeze({
  elementPrefix: 'w',
  attributePrefix: 'w',
  rowBinding: null,
});

function countAllowlistedLeaves(container: OoxmlElement, allowedLeaves: readonly string[]): number {
  let count = 1;
  for (const name of allowedLeaves) {
    const child = container.children.find((candidate) => isWmlElement(candidate, name));
    if (!child || child.kind === 'textValue') continue;
    const leafCount = countProjectedPropertyLeaf(child, PLANNING_WML_CONTEXT);
    if (leafCount > 0) count += leafCount;
  }
  return count;
}

function planRowInsertion(
  sourceRow: OoxmlTableRowNode,
  continuations: ReadonlySet<number>
): RowInsertionPlan | null {
  const cells = sourceRow.children.filter((child) => child.kind === 'tableCell');
  if (cells.length === 0) return null;
  let structureBudget = 1;
  for (let index = 0; index < cells.length; index += 1) {
    structureBudget += 2;
    const tcPr = wmlChildNamed(cells[index]!, 'tcPr');
    if (tcPr) structureBudget += countAllowlistedLeaves(tcPr, SAFE_TCPR_LEAVES);
    structureBudget += insertedCellParagraphNodeCount(cells[index]!);
    // A continued merge adds `w:vMerge`, plus a `w:tcPr` to carry it whenever the copy has
    // none — including a source `w:tcPr` whose every leaf is stripped. Budget the ceiling.
    if (continuations.has(index)) structureBudget += 2;
  }
  const trPr = wmlChildNamed(sourceRow, 'trPr');
  if (trPr) structureBudget += countAllowlistedLeaves(trPr, SAFE_TRPR_LEAVES);
  return { sourceRow, cellCount: cells.length, structureBudget, continuations };
}

export function emptyParagraph(
  part: OoxmlPart,
  targetTable: OoxmlElement,
  nextId: () => string,
  seed: string,
  used: Set<string>,
  wml: WmlFreshNamespaceContext,
  content: readonly OoxmlNode[] = []
): OoxmlParagraphNode {
  const w14Prefix = w14PrefixInScopeAt(part, targetTable);
  const identity: OoxmlAttribute[] = [];
  if (w14Prefix !== null) {
    const paraIdValue = mintParaId(actorScopedSeed(seed), used);
    used.add(paraIdValue);
    identity.push(...mintedParagraphIdentityAttributes(w14Prefix, paraIdValue));
  }
  return {
    id: nextId(),
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    ...(wml.elementPrefix === undefined ? {} : { prefix: wml.elementPrefix }),
    namespaceBindings: [],
    attributes: identity,
    children: content,
  } as OoxmlParagraphNode;
}

/**
 * Repeat `w:vMerge` so the inserted row extends the covering cell instead of severing it.
 *
 * `patchTcPrChild` rejects only an expanded-name mismatch, and it derives the name it checks
 * from the element handed to it — one minted here, in the WML namespace. The refusal branch
 * is unreachable by construction, so this returns a container rather than splitting `can()`
 * from `exec()` over a case that cannot arise.
 */
function withVerticalMergeContinuation(
  copiedTcPr: OoxmlElement | null,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlElement {
  const container = copiedTcPr ?? freshWmlElement('tcPr', nextId, wml, []);
  const patched = patchTcPrChild(container, freshWmlElement('vMerge', nextId, wml, []));
  return patched.ok ? patched.container : container;
}

function buildFreshCell(
  sourceCell: OoxmlTableCellNode,
  part: OoxmlPart,
  targetTable: OoxmlElement,
  nextId: () => string,
  seed: string,
  used: Set<string>,
  wml: WmlFreshNamespaceContext,
  continuesVerticalMerge: boolean
): OoxmlTableCellNode {
  const tcPr = wmlChildNamed(sourceCell, 'tcPr');
  const copiedTcPr = tcPr ? copySafePropertyContainer(tcPr, SAFE_TCPR_LEAVES, nextId, wml) : null;
  const finalTcPr = continuesVerticalMerge
    ? withVerticalMergeContinuation(copiedTcPr, nextId, wml)
    : copiedTcPr;
  const children: OoxmlNode[] = [];
  if (finalTcPr) children.push(finalTcPr);
  const content = insertedCellParagraphContent(sourceCell, nextId, wml);
  children.push(emptyParagraph(part, targetTable, nextId, `${seed}:p`, used, wml, content));
  return freshTableCell(nextId, children, wml);
}

function buildInsertedRow(
  plan: RowInsertionPlan,
  part: OoxmlPart,
  targetTable: OoxmlElement,
  nextId: () => string
): {
  readonly row: OoxmlTableRowNode;
  readonly paragraphIds: readonly string[];
  /** First paragraph the caret can reach: merge continuations paint no content of their own. */
  readonly caretParagraphId: string | undefined;
} {
  const wml = wmlFreshNamespaceContextAt(part, targetTable);
  const sourceRow = plan.sourceRow;
  const trPr = wmlChildNamed(sourceRow, 'trPr');
  const copiedTrPr = trPr
    ? copySafePropertyContainer(trPr, SAFE_TRPR_LEAVES, nextId, wml)
    : undefined;
  const used = new Set(usedParaIds(part.root));
  const children: OoxmlNode[] = [];
  const paragraphIds: string[] = [];
  let caretParagraphId: string | undefined;
  if (copiedTrPr) children.push(copiedTrPr);
  let cellIndex = 0;
  for (const child of sourceRow.children) {
    if (child.kind !== 'tableCell') continue;
    const continues = plan.continuations.has(cellIndex);
    const fresh = buildFreshCell(
      child,
      part,
      targetTable,
      nextId,
      `${sourceRow.id}:c${cellIndex}`,
      used,
      wml,
      continues
    );
    cellIndex += 1;
    const paragraphId = fresh.children.find((c) => c.kind === 'paragraph')!.id;
    paragraphIds.push(paragraphId);
    if (!continues && caretParagraphId === undefined) caretParagraphId = paragraphId;
    children.push(fresh);
  }
  const row = freshTableRow(nextId, children, wml);
  return { row, paragraphIds, caretParagraphId };
}

function rowChildIndex(table: OoxmlElement, rowId: string): number {
  return table.children.findIndex((child) => child.id === rowId);
}

/**
 * Refuse an insertion whose row shape the grid walk cannot read.
 *
 * `w:sdt` and `w:customXml` may legally hold a `w:tc`, and neither advances the grid cursor,
 * so every later cell of that row maps one column too far left. Only a merge turns that into
 * a wrong write, so the guard first asks whether any `w:vMerge` is in reach — a question that
 * reads markers rather than the grid, and so survives the very shape it is judging. A
 * merge-free table keeps the behaviour it had before this change.
 */
function wrappedShapeRejection(
  topology: EditableTableTopology,
  rowIndex: number,
  where: 'above' | 'below'
): TreeOpRejection | null {
  const boundaryIndex = where === 'above' ? rowIndex : rowIndex + 1;
  // Above the first row or below the last there is no boundary to read, so no marker can be
  // written and the row's shape decides nothing. Matches `verticalMergeContinuationCells`.
  if (boundaryIndex <= 0 || boundaryIndex >= topology.rows.length) return null;
  const source = topology.rows[rowIndex]!;
  const upper = topology.rows[boundaryIndex - 1];
  const lower = topology.rows[boundaryIndex];
  const mergeInReach =
    rowHasVerticalMerge(source.row) ||
    (upper !== undefined && rowHasVerticalMerge(upper.row)) ||
    (lower !== undefined && rowHasVerticalMerge(lower.row));
  if (!mergeInReach) return null;
  if (rowHidesCellInWrapper(source.row)) return 'row-hides-cell';
  if (!upper || !lower) return null;
  if (rowHidesCellInWrapper(upper.row) || rowHidesCellInWrapper(lower.row)) {
    return 'row-hides-cell';
  }
  return tableHidesRowBetween(topology.table, upper.row.id, lower.row.id) ? 'row-hides-cell' : null;
}

function validateRowInsertionPlan(
  _part: OoxmlPart,
  topology: EditableTableTopology,
  rowIndex: number,
  where: 'above' | 'below',
  limits: TableTopologyLimits
): TreeOpRejection | null {
  if (topology.rows.length >= limits.maxRows) return 'resource-limit';
  const wrapperRejection = wrappedShapeRejection(topology, rowIndex, where);
  if (wrapperRejection) return wrapperRejection;
  const continuations = verticalMergeContinuationCells(topology, rowIndex, where);
  const plan = planRowInsertion(topology.rows[rowIndex]!.row, continuations);
  if (plan === null) return 'tree-invariant';
  if (plan.structureBudget > limits.maxTraversalNodes) return 'resource-limit';
  return null;
}

export function validateTableRowOp(
  part: OoxmlPart,
  op: TableRowDocOp,
  limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS
): TreeOpRejection | null {
  if (op.revision !== undefined && invalidRevisionAttribution(op.revision)) {
    return 'invalid-property-value';
  }
  const resolved = resolveTableTopologyLimits(limits);
  const topologyResult = readEditableTableTopology(part.root, op.tableId, resolved);
  if (!topologyResult.ok) return mapTopologyRejection(topologyResult.reason);

  const { topology } = topologyResult;
  const rowIndex = topology.rows.findIndex((entry) => entry.row.id === op.rowId);
  if (rowIndex === -1) return 'unknown-row';

  if (op.op === 'deleteTableRow') {
    if (topology.rows.length === 1) return 'block-required';
    if (op.revision) {
      const { row, cells } = topology.rows[rowIndex]!;
      const trPr = wmlChildNamed(row, 'trPr');
      if (trPr && (wmlChildNamed(trPr, 'ins') || wmlChildNamed(trPr, 'del')))
        return 'unsupported-revision';
      for (const cell of cells) {
        const tcPr = wmlChildNamed(cell, 'tcPr');
        if (
          tcPr &&
          (wmlChildNamed(tcPr, 'cellIns') ||
            wmlChildNamed(tcPr, 'cellDel') ||
            wmlChildNamed(tcPr, 'cellMerge'))
        )
          return 'unsupported-revision';
      }
      if (
        !topology.rows.some(({ row }, index) => {
          if (index === rowIndex) return false;
          const properties = wmlChildNamed(row, 'trPr');
          return !properties || !wmlChildNamed(properties, 'del');
        })
      )
        return 'block-required';
      // The row stays until the deletion is accepted, so no merge changes here.
      return null;
    }
    const repairs = planVerticalMergeHeadRepairs(part, op.rowId);
    return repairs.ok ? null : repairs.reason;
  }

  return validateRowInsertionPlan(part, topology, rowIndex, op.where, resolved);
}

export function applyInsertTableRow(
  part: OoxmlPart,
  op: Extract<TableRowDocOp, { op: 'insertTableRow' }>,
  options?: EditOptions,
  limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS
): TreeOpResult {
  const rejection = validateTableRowOp(part, op, limits);
  if (rejection) return { ok: false, reason: rejection };

  const resolved = resolveTableTopologyLimits(limits);
  const topologyResult = readEditableTableTopology(part.root, op.tableId, resolved);
  if (!topologyResult.ok) return { ok: false, reason: mapTopologyRejection(topologyResult.reason) };

  const { topology } = topologyResult;
  const rowIndex = topology.rows.findIndex((entry) => entry.row.id === op.rowId);
  if (rowIndex === -1) return { ok: false, reason: 'unknown-row' };

  const continuations = verticalMergeContinuationCells(topology, rowIndex, op.where);
  const plan = planRowInsertion(topology.rows[rowIndex]!.row, continuations);
  if (plan === null) return { ok: false, reason: 'tree-invariant' };

  const nextId = createNodeIdAllocator(part);
  const built = buildInsertedRow(plan, part, topology.table, nextId);
  const insertedRow = op.revision
    ? withTrackedRowMarker(
        built.row,
        'ins',
        nextRevisionId(part)(),
        op.revision,
        nextId,
        wmlFreshNamespaceContextAt(part, topology.table)
      )
    : built.row;
  const paragraphIds = built.paragraphIds;
  const insertAt = rowChildIndex(topology.table, op.rowId);
  if (insertAt === -1) return { ok: false, reason: 'unknown-row' };
  const childIndex = op.where === 'above' ? insertAt : insertAt + 1;

  const effect: TreeOpEffect = {
    dirty: [topology.table.id, insertedRow.id],
    created: [
      insertedRow.id,
      ...insertedRow.children.filter((c) => c.kind === 'tableCell').map((c) => c.id),
      ...paragraphIds,
    ],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
    ...(built.caretParagraphId === undefined
      ? {}
      : { caret: { paragraphId: built.caretParagraphId } }),
  };

  return fromEdit(
    insertChildren(part, topology.table.id, childIndex, [insertedRow], options),
    effect
  );
}

export function applyDeleteTableRow(
  part: OoxmlPart,
  op: Extract<TableRowDocOp, { op: 'deleteTableRow' }>,
  options?: EditOptions,
  limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS
): TreeOpResult {
  const rejection = validateTableRowOp(part, op, limits);
  if (rejection) return { ok: false, reason: rejection };

  const topologyResult = readEditableTableTopology(
    part.root,
    op.tableId,
    resolveTableTopologyLimits(limits)
  );
  if (!topologyResult.ok) return { ok: false, reason: mapTopologyRejection(topologyResult.reason) };

  const row = topologyResult.topology.rows.find((entry) => entry.row.id === op.rowId)?.row;
  if (!row) return { ok: false, reason: 'unknown-row' };

  const rowIndex = topologyResult.topology.rows.findIndex((entry) => entry.row.id === op.rowId);
  const deletedRowEntry = topologyResult.topology.rows[rowIndex]!;
  const caretRowIndex = rowIndex > 0 ? rowIndex - 1 : rowIndex + 1;
  const caretRowEntry = topologyResult.topology.rows[caretRowIndex];
  let caretCell = caretRowEntry?.cells[0];
  if (op.referenceCellId && caretRowEntry) {
    const anchorIndex = deletedRowEntry.cells.findIndex((cell) => cell.id === op.referenceCellId);
    if (anchorIndex >= 0 && caretRowEntry.cells[anchorIndex]) {
      caretCell = caretRowEntry.cells[anchorIndex]!;
    }
  }
  const caretParagraphId = caretCell ? firstParagraphId(caretCell) : null;
  if (!caretParagraphId) return { ok: false, reason: 'tree-invariant' };

  const paragraphs = paragraphIdsWithin(row);
  if (op.revision) {
    const nextId = createNodeIdAllocator(part);
    const trackedRow = withTrackedRowMarker(
      row,
      'del',
      nextRevisionId(part)(),
      op.revision,
      nextId,
      wmlFreshNamespaceContextAt(part, topologyResult.topology.table)
    );
    const effect: TreeOpEffect = {
      dirty: [op.tableId, op.rowId],
      created: [],
      deleted: [],
      dependencyKeys: TEXT_DEPS,
      impact: 'flow-structural',
      caret: { paragraphId: caretParagraphId },
    };
    return fromEdit(replaceNode(part, op.rowId, trackedRow, options), effect);
  }
  const repairs = planVerticalMergeHeadRepairs(part, op.rowId);
  if (!repairs.ok) return { ok: false, reason: repairs.reason };
  const effect: TreeOpEffect = {
    dirty: [op.tableId, ...verticalMergeHeadRepairDirtyIds(repairs.repairs)],
    created: [],
    deleted: [op.rowId, ...paragraphs],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
    caret: { paragraphId: caretParagraphId },
  };
  if (repairs.repairs.length === 0) return fromEdit(removeNode(part, op.rowId, options), effect);
  const edits = rowRemovalEdits(repairs.repairs, op.rowId, options);
  return fromEdit(applyEdits(part, edits, options), effect);
}

export function applyTableRowOp(
  part: OoxmlPart,
  op: TableRowDocOp,
  options?: EditOptions
): TreeOpResult {
  if (op.op === 'insertTableRow') return applyInsertTableRow(part, op, options);
  return applyDeleteTableRow(part, op, options);
}

function readTcWidthTwipsForGrid(cell: OoxmlTableCellNode): string | undefined {
  const tcPr = wmlChildNamed(cell, 'tcPr');
  const tcW = tcPr && wmlChildNamed(tcPr, 'tcW');
  if (!tcW) return undefined;
  const rawType = wmlAttributeValue(tcW, 'type');
  if (rawType !== undefined && rawType !== 'dxa') return undefined;
  const width = readTwipsMeasure(wmlAttributeValue(tcW, 'w'));
  // Written back as whole twips, so a decimal width does not carry into a new grid column.
  return width !== null && width >= 0 ? String(width) : undefined;
}

type InsertTableColumnOp = Extract<TableColumnDocOp, { op: 'insertTableColumn' }>;

function hasOwnOpKey(op: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(op, key);
}

function ownNonEmptyString(op: object, key: string): string | null {
  if (!hasOwnOpKey(op, key)) return null;
  const value = (op as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value.length === 0) return null;
  return value;
}

function parseInsertColumnTarget(
  op: InsertTableColumnOp
):
  | { readonly kind: 'gridColumn'; readonly id: string }
  | { readonly kind: 'referenceCell'; readonly id: string }
  | null {
  const hasGridColumnKey = hasOwnOpKey(op, 'gridColumnId');
  const hasReferenceCellKey = hasOwnOpKey(op, 'referenceCellId');
  if (hasGridColumnKey === hasReferenceCellKey) return null;
  if (hasGridColumnKey) {
    const id = ownNonEmptyString(op, 'gridColumnId');
    return id ? { kind: 'gridColumn', id } : null;
  }
  const id = ownNonEmptyString(op, 'referenceCellId');
  return id ? { kind: 'referenceCell', id } : null;
}

function resolveGridColumnIndex(
  topology: EditableTableTopology,
  gridColumnId: string
): number | null {
  const index = topology.gridColumns.findIndex((column) => column.id === gridColumnId);
  return index === -1 ? null : index;
}

function resolveReferenceCellColumnIndex(
  topology: EditableTableTopology,
  referenceCellId: string
): number | null {
  const firstRow = topology.rows[0];
  if (!firstRow) return null;
  const index = firstRow.cells.findIndex((cell) => cell.id === referenceCellId);
  return index === -1 ? null : index;
}

function tableHasColumnMergeMarkers(topology: EditableTableTopology): boolean {
  for (const { cells } of topology.rows) {
    for (const cell of cells) {
      const tcPr = wmlChildNamed(cell, 'tcPr');
      if (!tcPr) continue;
      if (wmlChildNamed(tcPr, 'gridSpan')) return true;
      if (wmlChildNamed(tcPr, 'hMerge')) return true;
      if (wmlChildNamed(tcPr, 'vMerge')) return true;
    }
  }
  return false;
}

export function validateRegularColumnTable(
  topology: EditableTableTopology
): TreeOpRejection | null {
  if (tableHasColumnMergeMarkers(topology)) return 'table-has-merge';
  if (topology.rows.length === 0) return 'tree-invariant';
  const cellCount = topology.rows[0]!.cells.length;
  if (cellCount === 0) return 'tree-invariant';
  for (const { row, cells } of topology.rows) {
    if (cells.length !== cellCount) return 'tree-invariant';
    const trPr = wmlChildNamed(row, 'trPr');
    if (trPr && (wmlChildNamed(trPr, 'gridBefore') || wmlChildNamed(trPr, 'gridAfter'))) {
      return 'tree-invariant';
    }
  }
  if (topology.grid && topology.gridColumns.length !== cellCount) return 'tree-invariant';
  return null;
}

function referenceGridWidthTwips(
  topology: EditableTableTopology,
  columnIndex: number
): string | undefined {
  const gridColumn = topology.gridColumns[columnIndex];
  if (gridColumn) {
    const width = readTwipsMeasure(wmlAttributeValue(gridColumn, 'w'));
    return width !== null && width >= 0 ? String(width) : undefined;
  }
  return readTcWidthTwipsForGrid(topology.rows[0]!.cells[columnIndex]!);
}

export function freshGridCol(
  nextId: () => string,
  wml: WmlFreshNamespaceContext,
  widthTwips: string | undefined
): OoxmlElement {
  const attributes: OoxmlAttribute[] = [];
  if (widthTwips) {
    attributes.push({
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'w',
      prefix: wml.attributePrefix,
      value: widthTwips,
    } as const);
  }
  return freshWmlElement('gridCol', nextId, wml, attributes);
}

function tblGridChildInsertIndex(table: OoxmlElement): number {
  let index = 0;
  for (const child of table.children) {
    if (child.kind === 'textValue') continue;
    if (isWmlElement(child, 'tblPr')) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function insertGridColumnAdjacent(
  grid: OoxmlElement,
  targetGridColumnId: string,
  where: 'left' | 'right',
  column: OoxmlElement
): OoxmlElement | null {
  if (grid.children.some((child) => child.id === column.id)) return null;
  const rawIndex = grid.children.findIndex((child) => child.id === targetGridColumnId);
  if (rawIndex === -1) return null;
  const at = where === 'left' ? rawIndex : rawIndex + 1;
  const children = [...grid.children];
  children.splice(at, 0, column);
  return Object.freeze({ ...grid, children }) as OoxmlElement;
}

function synthesizeTblGrid(
  topology: EditableTableTopology,
  nextId: () => string,
  wml: WmlFreshNamespaceContext,
  insertedIndex: number,
  insertedWidth: string | undefined
): OoxmlElement {
  const columnCount = topology.rows[0]!.cells.length + 1;
  const cols: OoxmlNode[] = [];
  for (let index = 0; index < columnCount; index += 1) {
    if (index === insertedIndex) {
      cols.push(freshGridCol(nextId, wml, insertedWidth));
      continue;
    }
    const sourceIndex = index > insertedIndex ? index - 1 : index;
    cols.push(freshGridCol(nextId, wml, referenceGridWidthTwips(topology, sourceIndex)));
  }
  return {
    id: nextId(),
    kind: 'tableGrid',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'tblGrid',
    ...(wml.elementPrefix === undefined ? {} : { prefix: wml.elementPrefix }),
    namespaceBindings: [],
    attributes: [],
    children: cols,
  } as OoxmlElement;
}

function directCellInsertIndex(row: OoxmlTableRowNode, cellIndex: number): number {
  let seen = 0;
  for (let index = 0; index < row.children.length; index += 1) {
    const child = row.children[index]!;
    if (child.kind !== 'tableCell') continue;
    if (seen === cellIndex) return index;
    seen += 1;
  }
  return row.children.length;
}

function firstParagraphId(cell: OoxmlTableCellNode): string | null {
  const paragraph = cell.children.find((child) => child.kind === 'paragraph');
  return paragraph?.id ?? null;
}

export function tableWithDeclaredWmlBinding(
  table: OoxmlElement,
  part: OoxmlPart,
  wml: WmlFreshNamespaceContext
): OoxmlElement {
  if (!wml.rowBinding) return table;
  const bindings = namespaceBindingsAt(part, table);
  if (bindings.has(wml.rowBinding.prefix)) return table;
  return Object.freeze({
    ...table,
    namespaceBindings: [...table.namespaceBindings, wml.rowBinding],
  }) as OoxmlElement;
}

interface ColumnInsertionPlan {
  readonly referenceIndex: number;
  readonly insertIndex: number;
  readonly referenceWidth: string | undefined;
  readonly structureBudget: number;
  readonly referenceCells: readonly OoxmlTableCellNode[];
  readonly synthesizeGrid: boolean;
  readonly targetGridColumnId: string | null;
}

function planColumnInsertion(
  topology: EditableTableTopology,
  referenceIndex: number,
  where: 'left' | 'right',
  wml: WmlFreshNamespaceContext
): ColumnInsertionPlan {
  const insertIndex = where === 'left' ? referenceIndex : referenceIndex + 1;
  const referenceCells = topology.rows.map((entry) => entry.cells[referenceIndex]!);
  let structureBudget = topology.grid ? 2 : topology.rows[0]!.cells.length + 3;
  for (const cell of referenceCells) {
    structureBudget += 2;
    const tcPr = wmlChildNamed(cell, 'tcPr');
    if (tcPr) structureBudget += countAllowlistedLeaves(tcPr, COLUMN_SAFE_TCPR_LEAVES);
    structureBudget += insertedCellParagraphNodeCount(cell);
  }
  void wml;
  return {
    referenceIndex,
    insertIndex,
    referenceWidth: referenceGridWidthTwips(topology, referenceIndex),
    structureBudget,
    referenceCells,
    synthesizeGrid: !topology.grid || topology.gridColumns.length === 0,
    targetGridColumnId: topology.gridColumns[referenceIndex]?.id ?? null,
  };
}

function buildFreshColumnCell(
  sourceCell: OoxmlTableCellNode,
  part: OoxmlPart,
  targetTable: OoxmlElement,
  nextId: () => string,
  seed: string,
  used: Set<string>,
  wml: WmlFreshNamespaceContext
): OoxmlTableCellNode {
  const tcPr = wmlChildNamed(sourceCell, 'tcPr');
  const copiedTcPr = tcPr
    ? copySafePropertyContainer(tcPr, COLUMN_SAFE_TCPR_LEAVES, nextId, wml)
    : undefined;
  const children: OoxmlNode[] = [];
  if (copiedTcPr) children.push(copiedTcPr);
  const content = insertedCellParagraphContent(sourceCell, nextId, wml);
  children.push(emptyParagraph(part, targetTable, nextId, `${seed}:p`, used, wml, content));
  return freshTableCell(nextId, children, wml);
}

function validateInsertColumnShape(
  op: InsertTableColumnOp,
  topology: EditableTableTopology
): TreeOpRejection | null {
  if (!hasOwnOpKey(op, 'where') || (op.where !== 'left' && op.where !== 'right'))
    return 'invalidArgs';
  const target = parseInsertColumnTarget(op);
  if (!target) return 'invalidArgs';
  const hasGrid = topology.grid !== undefined && topology.gridColumns.length > 0;
  if (target.kind === 'gridColumn') {
    if (!hasGrid) return 'invalidArgs';
    if (resolveGridColumnIndex(topology, target.id) === null) return 'unknown-grid-column';
    return null;
  }
  if (hasGrid) return 'invalidArgs';
  if (resolveReferenceCellColumnIndex(topology, target.id) === null) return 'unknown-grid-column';
  return null;
}

export function validateTableColumnOp(
  part: OoxmlPart,
  op: TableColumnDocOp,
  limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS
): TreeOpRejection | null {
  if (!ownNonEmptyString(op, 'tableId')) return 'invalidArgs';

  const resolved = resolveTableTopologyLimits(limits);
  const topologyResult = readEditableTableTopology(part.root, op.tableId, resolved);
  if (!topologyResult.ok) return mapTopologyRejection(topologyResult.reason);

  const { topology } = topologyResult;
  const regular = validateRegularColumnTable(topology);
  if (regular) return regular;

  if (op.op === 'deleteTableColumn') {
    if (!ownNonEmptyString(op, 'gridColumnId')) return 'invalidArgs';
    if (!topology.grid || topology.gridColumns.length === 0) return 'unknown-grid-column';
    const columnIndex = resolveGridColumnIndex(topology, op.gridColumnId);
    if (columnIndex === null) return 'unknown-grid-column';
    if (topology.gridColumns.length === 1) return 'block-required';
    return null;
  }

  const shape = validateInsertColumnShape(op, topology);
  if (shape) return shape;

  const target = parseInsertColumnTarget(op)!;
  const referenceIndex =
    target.kind === 'gridColumn'
      ? resolveGridColumnIndex(topology, target.id)!
      : resolveReferenceCellColumnIndex(topology, target.id)!;

  const nextColumnCount =
    topology.gridColumns.length > 0
      ? topology.gridColumns.length + 1
      : topology.rows[0]!.cells.length + 1;
  if (nextColumnCount > resolved.maxColumns) return 'resource-limit';

  const wml = wmlFreshNamespaceContextAt(part, topology.table);
  const plan = planColumnInsertion(topology, referenceIndex, op.where, wml);
  if (plan.structureBudget > resolved.maxTraversalNodes) return 'resource-limit';

  return null;
}

export function applyInsertTableColumn(
  part: OoxmlPart,
  op: InsertTableColumnOp,
  options?: EditOptions,
  limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS
): TreeOpResult {
  const rejection = validateTableColumnOp(part, op, limits);
  if (rejection) return { ok: false, reason: rejection };

  const resolved = resolveTableTopologyLimits(limits);
  const topologyResult = readEditableTableTopology(part.root, op.tableId, resolved);
  if (!topologyResult.ok) return { ok: false, reason: mapTopologyRejection(topologyResult.reason) };

  const { topology } = topologyResult;
  const target = parseInsertColumnTarget(op);
  if (!target) return { ok: false, reason: 'invalidArgs' };

  const referenceIndex =
    target.kind === 'gridColumn'
      ? resolveGridColumnIndex(topology, target.id)
      : resolveReferenceCellColumnIndex(topology, target.id);
  if (referenceIndex === null) return { ok: false, reason: 'unknown-grid-column' };

  const plan = planColumnInsertion(
    topology,
    referenceIndex,
    op.where,
    wmlFreshNamespaceContextAt(part, topology.table)
  );
  const wml = wmlFreshNamespaceContextAt(part, topology.table);
  const nextId = createNodeIdAllocator(part);
  const used = new Set(usedParaIds(part.root));
  const patchedTable = tableWithDeclaredWmlBinding(topology.table, part, wml);

  const insertedCells: OoxmlTableCellNode[] = [];
  const paragraphIds: string[] = [];
  for (let rowIndex = 0; rowIndex < topology.rows.length; rowIndex += 1) {
    const referenceCell = plan.referenceCells[rowIndex]!;
    const freshCell = buildFreshColumnCell(
      referenceCell,
      part,
      patchedTable,
      nextId,
      `${topology.table.id}:col:${referenceIndex}:r${rowIndex}`,
      used,
      wml
    );
    insertedCells.push(freshCell);
    paragraphIds.push(freshCell.children.find((child) => child.kind === 'paragraph')!.id);
  }

  let newGrid: OoxmlElement;
  let createdGridColIds: string[];
  if (plan.synthesizeGrid) {
    newGrid = synthesizeTblGrid(topology, nextId, wml, plan.insertIndex, plan.referenceWidth);
    createdGridColIds = newGrid.children
      .filter((child) => child.kind !== 'textValue' && child.localName === 'gridCol')
      .map((child) => child.id);
  } else {
    const newGridCol = freshGridCol(nextId, wml, plan.referenceWidth);
    const patched = insertGridColumnAdjacent(
      topology.grid!,
      plan.targetGridColumnId!,
      op.where,
      newGridCol
    );
    if (!patched) return { ok: false, reason: 'tree-invariant' };
    newGrid = patched;
    createdGridColIds = [newGridCol.id];
  }

  const edits: ((current: OoxmlPart) => ReturnType<typeof insertChildren>)[] = [];
  if (patchedTable !== topology.table) {
    edits.push((current) => replaceNode(current, topology.table.id, patchedTable, options));
  }
  for (let rowIndex = 0; rowIndex < topology.rows.length; rowIndex += 1) {
    const row = topology.rows[rowIndex]!.row;
    const at = directCellInsertIndex(row, plan.insertIndex);
    const cell = insertedCells[rowIndex]!;
    edits.push((current) => insertChildren(current, row.id, at, [cell], options));
  }

  if (plan.synthesizeGrid) {
    edits.push((current) =>
      insertChildren(
        current,
        topology.table.id,
        tblGridChildInsertIndex(topology.table),
        [newGrid],
        options
      )
    );
  } else {
    edits.push((current) => replaceNode(current, topology.grid!.id, newGrid, options));
  }

  const dirty = [topology.table.id, ...topology.rows.map((entry) => entry.row.id)];
  if (!plan.synthesizeGrid) dirty.push(topology.grid!.id);

  const created = plan.synthesizeGrid
    ? [newGrid.id, ...createdGridColIds, ...insertedCells.map((cell) => cell.id), ...paragraphIds]
    : [...createdGridColIds, ...insertedCells.map((cell) => cell.id), ...paragraphIds];

  const caretParagraphId = paragraphIds[0]!;
  const effect: TreeOpEffect = {
    dirty,
    created,
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
    caret: { paragraphId: caretParagraphId },
  };

  return fromEdit(applyEdits(part, edits, options), effect);
}

export function applyDeleteTableColumn(
  part: OoxmlPart,
  op: Extract<TableColumnDocOp, { op: 'deleteTableColumn' }>,
  options?: EditOptions,
  limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS
): TreeOpResult {
  const rejection = validateTableColumnOp(part, op, limits);
  if (rejection) return { ok: false, reason: rejection };

  const topologyResult = readEditableTableTopology(
    part.root,
    op.tableId,
    resolveTableTopologyLimits(limits)
  );
  if (!topologyResult.ok) return { ok: false, reason: mapTopologyRejection(topologyResult.reason) };

  const { topology } = topologyResult;
  const columnIndex = resolveGridColumnIndex(topology, op.gridColumnId);
  if (columnIndex === null || !topology.grid) return { ok: false, reason: 'unknown-grid-column' };

  const deletedCells = topology.rows.map((entry) => entry.cells[columnIndex]!);
  const deletedParagraphs = deletedCells.flatMap((cell) => paragraphIdsWithin(cell));
  const caretSourceIndex =
    columnIndex < topology.gridColumns.length - 1 ? columnIndex + 1 : columnIndex - 1;
  const caretParagraphId = firstParagraphId(topology.rows[0]!.cells[caretSourceIndex]!);
  if (!caretParagraphId) return { ok: false, reason: 'tree-invariant' };

  const gridPatch = patchTblGridColumn(topology.grid, op.gridColumnId, null);
  if (!gridPatch.ok) {
    return {
      ok: false,
      reason: gridPatch.reason === 'unknown-grid-column' ? 'unknown-grid-column' : 'tree-invariant',
    };
  }

  const edits: ((current: OoxmlPart) => ReturnType<typeof removeNode>)[] = [];
  for (const cell of deletedCells) {
    edits.push((current) => removeNode(current, cell.id, options));
  }
  edits.push((current) => replaceNode(current, topology.grid!.id, gridPatch.grid, options));

  const effect: TreeOpEffect = {
    dirty: [topology.table.id, topology.grid.id, ...topology.rows.map((entry) => entry.row.id)],
    created: [],
    deleted: [op.gridColumnId, ...deletedCells.map((cell) => cell.id), ...deletedParagraphs],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
    caret: { paragraphId: caretParagraphId },
  };

  return fromEdit(applyEdits(part, edits, options), effect);
}

export function applyTableColumnOp(
  part: OoxmlPart,
  op: TableColumnDocOp,
  options?: EditOptions
): TreeOpResult {
  if (op.op === 'insertTableColumn') return applyInsertTableColumn(part, op, options);
  return applyDeleteTableColumn(part, op, options);
}

function ownResizeWidthTwips(op: object, key: string): number | null {
  if (!hasOwnOpKey(op, key)) return null;
  const value = (op as Record<string, unknown>)[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  if (value < MIN_TABLE_COLUMN_WIDTH_TWIPS || value > MAX_TABLE_COLUMN_WIDTH_TWIPS) return null;
  return value;
}

function ownTableWidthTwips(op: object, key: string): number | null {
  if (!hasOwnOpKey(op, key)) return null;
  const value = (op as Record<string, unknown>)[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  if (value < MIN_TABLE_COLUMN_WIDTH_TWIPS || value > MAX_TABLE_WIDTH_TWIPS) return null;
  return value;
}

function readGridColWidthTwips(column: OoxmlElement): number | null {
  const value = readTwipsMeasure(wmlAttributeValue(column, 'w'));
  return value !== null && value >= 0 ? value : null;
}

function gridColWithWidth(
  column: OoxmlElement,
  widthTwips: number,
  wml: WmlFreshNamespaceContext
): OoxmlElement {
  const widthStr = String(widthTwips);
  const attributes = column.attributes.filter(
    (attribute) => !(attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'w')
  );
  attributes.push({
    kind: 'genericExtension',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'w',
    prefix: wml.attributePrefix,
    value: widthStr,
  } as const);
  return Object.freeze({ ...column, attributes }) as OoxmlElement;
}

function freshWidthDxaElement(
  localName: string,
  nextId: () => string,
  wml: WmlFreshNamespaceContext,
  widthTwips: number
): OoxmlElement {
  return freshWmlElement(localName, nextId, wml, [
    {
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'w',
      prefix: wml.attributePrefix,
      value: String(widthTwips),
    } as const,
    {
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'type',
      prefix: wml.attributePrefix,
      value: 'dxa',
    } as const,
  ]);
}

function freshTblLayoutFixed(nextId: () => string, wml: WmlFreshNamespaceContext): OoxmlElement {
  return freshWmlElement('tblLayout', nextId, wml, [
    {
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'type',
      prefix: wml.attributePrefix,
      value: 'fixed',
    } as const,
  ]);
}

function buildFixedLayoutTblPr(
  table: OoxmlElement,
  nextId: () => string,
  wml: WmlFreshNamespaceContext,
  tableWidthTwips?: number
):
  | { readonly ok: true; readonly tblPr: OoxmlElement; readonly insert: boolean }
  | { readonly ok: false } {
  const existing = wmlChildNamed(table, 'tblPr');
  let tblPr = existing ?? freshWmlElement('tblPr', nextId, wml, [], []);
  const layoutPatch = patchTblPrChild(tblPr, freshTblLayoutFixed(nextId, wml));
  if (!layoutPatch.ok) return { ok: false };
  tblPr = layoutPatch.container;
  if (tableWidthTwips !== undefined) {
    const widthPatch = patchTblPrChild(
      tblPr,
      freshWidthDxaElement('tblW', nextId, wml, tableWidthTwips)
    );
    if (!widthPatch.ok) return { ok: false };
    tblPr = widthPatch.container;
  }
  return { ok: true, tblPr, insert: existing === undefined };
}

function queueTblPrResizeEdits(
  edits: ((current: OoxmlPart) => ReturnType<typeof replaceNode | typeof insertChildren>)[],
  table: OoxmlElement,
  nextId: () => string,
  wml: WmlFreshNamespaceContext,
  options: EditOptions | undefined,
  tableWidthTwips?: number
): TreeOpRejection | null {
  const existingTblPr = wmlChildNamed(table, 'tblPr');
  const built = buildFixedLayoutTblPr(table, nextId, wml, tableWidthTwips);
  if (!built.ok) return 'tree-invariant';
  if (built.insert) {
    edits.push((current) =>
      insertChildren(current, table.id, tblGridChildInsertIndex(table), [built.tblPr], options)
    );
    return null;
  }
  if (built.tblPr !== existingTblPr) {
    edits.push((current) => replaceNode(current, existingTblPr!.id, built.tblPr, options));
  }
  return null;
}

function patchCellTcWidthDxa(
  cell: OoxmlTableCellNode,
  widthTwips: number,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlTableCellNode {
  const tcW = freshWidthDxaElement('tcW', nextId, wml, widthTwips);
  const existingTcPr = wmlChildNamed(cell, 'tcPr');
  if (existingTcPr) {
    const patched = patchTcPrChild(existingTcPr, tcW);
    if (!patched.ok) return cell;
    if (patched.container === existingTcPr) return cell;
    const children = cell.children.map((child) =>
      child === existingTcPr ? patched.container : child
    );
    return Object.freeze({ ...cell, children }) as OoxmlTableCellNode;
  }
  const tcPr = freshWmlElement('tcPr', nextId, wml, [], [tcW]);
  let insertAt = 0;
  for (let index = 0; index < cell.children.length; index += 1) {
    const child = cell.children[index]!;
    if (child.kind === 'paragraph' || child.kind === 'table') break;
    insertAt = index + 1;
  }
  const children: OoxmlNode[] = [...cell.children];
  children.splice(insertAt, 0, tcPr);
  return Object.freeze({ ...cell, children }) as OoxmlTableCellNode;
}

function validateResizeGridReadable(topology: EditableTableTopology): TreeOpRejection | null {
  if (!topology.grid || topology.gridColumns.length === 0) return 'unknown-grid-column';
  for (const column of topology.gridColumns) {
    if (readGridColWidthTwips(column) === null) return 'tree-invariant';
  }
  return null;
}

function validateSetTableColumnWidthsShape(
  op: Extract<TableResizeDocOp, { op: 'setTableColumnWidths' }>
): TreeOpRejection | null {
  if (!ownNonEmptyString(op, 'leftGridColumnId')) return 'invalidArgs';
  if (!ownNonEmptyString(op, 'rightGridColumnId')) return 'invalidArgs';
  if (ownResizeWidthTwips(op, 'leftWidthTwips') === null) return 'invalidArgs';
  if (ownResizeWidthTwips(op, 'rightWidthTwips') === null) return 'invalidArgs';
  if (op.leftGridColumnId === op.rightGridColumnId) return 'invalidArgs';
  return null;
}

function validateSetTableRightEdgeWidthShape(
  op: Extract<TableResizeDocOp, { op: 'setTableRightEdgeWidth' }>
): TreeOpRejection | null {
  if (!ownNonEmptyString(op, 'gridColumnId')) return 'invalidArgs';
  if (ownResizeWidthTwips(op, 'columnWidthTwips') === null) return 'invalidArgs';
  if (ownTableWidthTwips(op, 'tableWidthTwips') === null) return 'invalidArgs';
  return null;
}

function validateSetTableRowHeightShape(
  op: Extract<TableResizeDocOp, { op: 'setTableRowHeight' }>
): TreeOpRejection | null {
  if (!ownNonEmptyString(op, 'rowId')) return 'invalidArgs';
  if (!hasOwnOpKey(op, 'heightTwips')) return 'invalidArgs';
  if (
    typeof op.heightTwips !== 'number' ||
    !Number.isInteger(op.heightTwips) ||
    op.heightTwips < 20 ||
    op.heightTwips > 31_680
  ) {
    return 'invalidArgs';
  }
  return null;
}

export function validateTableResizeOp(
  part: OoxmlPart,
  op: TableResizeDocOp,
  limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS
): TreeOpRejection | null {
  if (!ownNonEmptyString(op, 'tableId')) return 'invalidArgs';

  const shape =
    op.op === 'setTableColumnWidths'
      ? validateSetTableColumnWidthsShape(op)
      : op.op === 'setTableRightEdgeWidth'
        ? validateSetTableRightEdgeWidthShape(op)
        : validateSetTableRowHeightShape(op);
  if (shape) return shape;

  const resolved = resolveTableTopologyLimits(limits);
  const topologyResult = readEditableTableTopology(part.root, op.tableId, resolved);
  if (!topologyResult.ok) return mapTopologyRejection(topologyResult.reason);

  const { topology } = topologyResult;
  if (op.op === 'setTableRowHeight') {
    return topology.rows.some((entry) => entry.row.id === op.rowId) ? null : 'unknown-row';
  }

  const regular = validateTableResizeGrid(topology);
  if (regular) return regular;

  const readable = validateResizeGridReadable(topology);
  if (readable) return readable;

  if (op.op === 'setTableColumnWidths') {
    const leftIndex = resolveGridColumnIndex(topology, op.leftGridColumnId);
    const rightIndex = resolveGridColumnIndex(topology, op.rightGridColumnId);
    if (leftIndex === null || rightIndex === null) return 'unknown-grid-column';
    if (rightIndex !== leftIndex + 1) return 'invalidArgs';

    const leftCurrent = readGridColWidthTwips(topology.gridColumns[leftIndex]!)!;
    const rightCurrent = readGridColWidthTwips(topology.gridColumns[rightIndex]!)!;
    const leftWidth = op.leftWidthTwips;
    const rightWidth = op.rightWidthTwips;
    if (leftWidth + rightWidth !== leftCurrent + rightCurrent) return 'invalidArgs';
    if (leftWidth === leftCurrent && rightWidth === rightCurrent) return 'invalidArgs';
    return null;
  }

  const lastIndex = topology.gridColumns.length - 1;
  const columnIndex = resolveGridColumnIndex(topology, op.gridColumnId);
  if (columnIndex === null) return 'unknown-grid-column';
  if (columnIndex !== lastIndex) return 'invalidArgs';

  const lastCurrent = readGridColWidthTwips(topology.gridColumns[lastIndex]!)!;
  let currentTotal = 0;
  for (const column of topology.gridColumns) {
    currentTotal += readGridColWidthTwips(column)!;
  }
  if (op.columnWidthTwips === lastCurrent && op.tableWidthTwips === currentTotal)
    return 'invalidArgs';

  let expectedTotal = 0;
  for (let index = 0; index < topology.gridColumns.length; index += 1) {
    const width =
      index === lastIndex
        ? op.columnWidthTwips
        : readGridColWidthTwips(topology.gridColumns[index]!)!;
    expectedTotal += width;
  }
  if (op.tableWidthTwips !== expectedTotal) return 'invalidArgs';
  return null;
}

function applySetTableColumnWidths(
  part: OoxmlPart,
  op: Extract<TableResizeDocOp, { op: 'setTableColumnWidths' }>,
  options?: EditOptions,
  limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS
): TreeOpResult {
  const rejection = validateTableResizeOp(part, op, limits);
  if (rejection) return { ok: false, reason: rejection };

  const topologyResult = readEditableTableTopology(
    part.root,
    op.tableId,
    resolveTableTopologyLimits(limits)
  );
  if (!topologyResult.ok) return { ok: false, reason: mapTopologyRejection(topologyResult.reason) };

  const { topology } = topologyResult;
  const leftIndex = resolveGridColumnIndex(topology, op.leftGridColumnId);
  const rightIndex = resolveGridColumnIndex(topology, op.rightGridColumnId);
  if (leftIndex === null || rightIndex === null || !topology.grid) {
    return { ok: false, reason: 'unknown-grid-column' };
  }

  const wml = wmlFreshNamespaceContextAt(part, topology.table);
  const targetTable = tableWithDeclaredWmlBinding(topology.table, part, wml);
  const nextId = createNodeIdAllocator(part);

  const leftCol = gridColWithWidth(topology.gridColumns[leftIndex]!, op.leftWidthTwips, wml);
  const rightCol = gridColWithWidth(topology.gridColumns[rightIndex]!, op.rightWidthTwips, wml);

  let patchedGrid: OoxmlElement = topology.grid;
  let gridPatch = patchTblGridColumn(patchedGrid, op.leftGridColumnId, leftCol);
  if (!gridPatch.ok) {
    return {
      ok: false,
      reason: gridPatch.reason === 'unknown-grid-column' ? 'unknown-grid-column' : 'tree-invariant',
    };
  }
  patchedGrid = gridPatch.grid;
  gridPatch = patchTblGridColumn(patchedGrid, op.rightGridColumnId, rightCol);
  if (!gridPatch.ok) {
    return {
      ok: false,
      reason: gridPatch.reason === 'unknown-grid-column' ? 'unknown-grid-column' : 'tree-invariant',
    };
  }
  patchedGrid = gridPatch.grid;

  const edits: ((current: OoxmlPart) => ReturnType<typeof replaceNode | typeof insertChildren>)[] =
    [];
  if (targetTable !== topology.table) {
    edits.push((current) => replaceNode(current, topology.table.id, targetTable, options));
  }
  if (patchedGrid !== topology.grid) {
    edits.push((current) => replaceNode(current, topology.grid!.id, patchedGrid, options));
  }
  const tblPrRejection = queueTblPrResizeEdits(edits, targetTable, nextId, wml, options);
  if (tblPrRejection) return { ok: false, reason: tblPrRejection };

  for (const { cell, width } of resizedGridCells(
    topology,
    new Map([
      [leftIndex, op.leftWidthTwips],
      [rightIndex, op.rightWidthTwips],
    ])
  )) {
    const patched = patchCellTcWidthDxa(cell, width, nextId, wml);
    if (patched !== cell)
      edits.push((current) => replaceNode(current, patched.id, patched, options));
  }

  const dirty = [
    topology.table.id,
    topology.grid!.id,
    ...topology.rows.map((entry) => entry.row.id),
  ];
  const effect: TreeOpEffect = {
    dirty,
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };

  return fromEdit(applyEdits(part, edits, options), effect);
}

function applySetTableRightEdgeWidth(
  part: OoxmlPart,
  op: Extract<TableResizeDocOp, { op: 'setTableRightEdgeWidth' }>,
  options?: EditOptions,
  limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS
): TreeOpResult {
  const rejection = validateTableResizeOp(part, op, limits);
  if (rejection) return { ok: false, reason: rejection };

  const topologyResult = readEditableTableTopology(
    part.root,
    op.tableId,
    resolveTableTopologyLimits(limits)
  );
  if (!topologyResult.ok) return { ok: false, reason: mapTopologyRejection(topologyResult.reason) };

  const { topology } = topologyResult;
  const lastIndex = topology.gridColumns.length - 1;
  if (!topology.grid || resolveGridColumnIndex(topology, op.gridColumnId) !== lastIndex) {
    return { ok: false, reason: 'invalidArgs' };
  }

  const wml = wmlFreshNamespaceContextAt(part, topology.table);
  const targetTable = tableWithDeclaredWmlBinding(topology.table, part, wml);
  const nextId = createNodeIdAllocator(part);

  const lastCol = gridColWithWidth(topology.gridColumns[lastIndex]!, op.columnWidthTwips, wml);
  const gridPatch = patchTblGridColumn(topology.grid, op.gridColumnId, lastCol);
  if (!gridPatch.ok) {
    return {
      ok: false,
      reason: gridPatch.reason === 'unknown-grid-column' ? 'unknown-grid-column' : 'tree-invariant',
    };
  }
  const grid = gridPatch.grid;

  const edits: ((current: OoxmlPart) => ReturnType<typeof replaceNode | typeof insertChildren>)[] =
    [];
  if (targetTable !== topology.table) {
    edits.push((current) => replaceNode(current, topology.table.id, targetTable, options));
  }
  edits.push((current) => replaceNode(current, topology.grid!.id, grid, options));
  const tblPrRejection = queueTblPrResizeEdits(
    edits,
    targetTable,
    nextId,
    wml,
    options,
    op.tableWidthTwips
  );
  if (tblPrRejection) return { ok: false, reason: tblPrRejection };

  for (const { cell, width } of resizedGridCells(
    topology,
    new Map([[lastIndex, op.columnWidthTwips]])
  )) {
    const patched = patchCellTcWidthDxa(cell, width, nextId, wml);
    if (patched !== cell)
      edits.push((current) => replaceNode(current, patched.id, patched, options));
  }

  const dirty = [
    topology.table.id,
    topology.grid!.id,
    ...topology.rows.map((entry) => entry.row.id),
  ];
  const effect: TreeOpEffect = {
    dirty,
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };

  return fromEdit(applyEdits(part, edits, options), effect);
}

function applySetTableRowHeight(
  part: OoxmlPart,
  op: Extract<TableResizeDocOp, { op: 'setTableRowHeight' }>,
  options?: EditOptions
): TreeOpResult {
  const rejection = validateTableResizeOp(part, op);
  if (rejection) return { ok: false, reason: rejection };

  const topologyResult = readEditableTableTopology(part.root, op.tableId);
  if (!topologyResult.ok) return { ok: false, reason: mapTopologyRejection(topologyResult.reason) };
  const row = topologyResult.topology.rows.find((entry) => entry.row.id === op.rowId)?.row;
  if (!row) return { ok: false, reason: 'unknown-row' };

  const nextId = createNodeIdAllocator(part);
  const wml = wmlFreshNamespaceContextAt(part, row);
  const attribute = (localName: string, value: string): OoxmlAttribute => ({
    kind: 'genericExtension',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: wml.attributePrefix,
    value,
  });
  const trHeight = freshWmlElement('trHeight', nextId, wml, [
    attribute('val', String(op.heightTwips)),
    attribute('hRule', 'exact'),
  ]);
  const existingTrPr = wmlChildNamed(row, 'trPr');
  const trPr = existingTrPr ?? freshWmlElement('trPr', nextId, wml, []);
  const patched = patchTrPrChild(trPr, trHeight);
  if (!patched.ok) return { ok: false, reason: 'tree-invariant' };
  const children = existingTrPr
    ? row.children.map((child) => (child === existingTrPr ? patched.container : child))
    : [patched.container, ...row.children];
  const resizedRow = Object.freeze({ ...row, children }) as OoxmlTableRowNode;
  const effect: TreeOpEffect = {
    dirty: [row.id, ...paragraphIdsWithin(row)],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };
  return fromEdit(replaceNode(part, row.id, resizedRow, options), effect);
}

export function applyTableResizeOp(
  part: OoxmlPart,
  op: TableResizeDocOp,
  options?: EditOptions
): TreeOpResult {
  if (op.op === 'setTableColumnWidths') return applySetTableColumnWidths(part, op, options);
  if (op.op === 'setTableRightEdgeWidth') return applySetTableRightEdgeWidth(part, op, options);
  return applySetTableRowHeight(part, op, options);
}

export {
  applyTableCellPropertyOp,
  validateTableCellPropertyOp,
  type TableCellPropertyOp,
} from './tree-op-table-cell-properties.ts';
