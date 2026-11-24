// Whole-table insertion — the tree op behind Insert › Table.
//
// Every other table op RESTRUCTURES a table the document already holds, so it copies the
// property skeleton it finds. This one authors a table from two numbers, which makes it
// the only place the store decides what a fresh table looks like: an even grid, explicit
// single-line borders on every edge, and one empty paragraph per cell.
//
// Explicit `w:tblBorders` rather than a `w:tblStyle` reference, because a style id is a
// promise about styles.xml this op cannot keep — a document that defines no `TableGrid`
// would get an invisible table, which reads as "insert did nothing".

import { actorScopedSeed } from '../package/actor-scoped-ids.ts';
import {
  createNodeIdAllocator,
  findNode,
  insertChildren,
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
  type WmlFreshNamespaceContext,
} from '../package/wml-namespace.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlParagraphPropertiesNode,
  type OoxmlPart,
  type OoxmlTableCellNode,
  type OoxmlTableNode,
  type OoxmlTableRowNode,
} from '../package/ooxml-tree.ts';
import {
  MAX_INSERT_TABLE_CELLS,
  MAX_INSERT_TABLE_COLUMNS,
  MAX_INSERT_TABLE_ROWS,
  MAX_TABLE_COLUMN_WIDTH_TWIPS,
  MAX_TABLE_WIDTH_TWIPS,
  MIN_TABLE_COLUMN_WIDTH_TWIPS,
} from './table-constraints.ts';
import {
  effectiveContentLockAt,
  fromEdit,
  isBoundAt,
  parentOf,
  TEXT_DEPS,
} from './tree-op-nodes.ts';
import type { InsertTableOp } from './table-placement-op-types.ts';
import type { TreeOpEffect, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';
import {
  invalidRevisionAttribution,
  type RevisionAttributionInput,
} from './tree-op-revision-attribution.ts';
import { nextRevisionId } from './tree-op-revision-ids.ts';
import { trackedRevisionAttributes } from './tree-op-tables.ts';

/**
 * Story containers a block-level table may be inserted into.
 *
 * Named positively rather than "anything that is not a paragraph": the parent of a
 * paragraph can also be a `w:p`-shaped revision container or a run-level wrapper, and a
 * `w:tbl` under one of those is not a block, it is corruption that survives validation.
 */
export const BLOCK_CONTAINERS = new Set([
  'body',
  'hdr',
  'ftr',
  'tc',
  'sdtContent',
  'footnote',
  'endnote',
]);

function fresh(
  localName: string,
  nextId: () => string,
  wml: WmlFreshNamespaceContext,
  attributes: readonly OoxmlAttribute[] = [],
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

function attribute(
  localName: string,
  value: string,
  wml: WmlFreshNamespaceContext
): OoxmlAttribute {
  return {
    kind: 'genericExtension',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: wml.attributePrefix,
    value,
  };
}

/** One `w:tblBorders` / `w:tcBorders` side: a hairline single rule in the automatic colour. */
function borderSide(
  side: string,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlElement {
  return fresh(side, nextId, wml, [
    attribute('val', 'single', wml),
    attribute('sz', '4', wml),
    attribute('space', '0', wml),
    attribute('color', 'auto', wml),
  ]);
}

function tableProperties(nextId: () => string, wml: WmlFreshNamespaceContext): OoxmlNode {
  const borders = fresh(
    'tblBorders',
    nextId,
    wml,
    [],
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((side) =>
      borderSide(side, nextId, wml)
    )
  );
  // `w:tblW` 0/auto with a full `w:tblGrid`: the grid carries the widths, and an
  // authored total would fight the section the table is later moved into.
  const width = fresh('tblW', nextId, wml, [
    attribute('w', '0', wml),
    attribute('type', 'auto', wml),
  ]);
  // Word's own default for a new table: banding off, first row and first column
  // emphasised if a style is later applied.
  const look = fresh('tblLook', nextId, wml, [
    attribute('val', '04A0', wml),
    attribute('firstRow', '1', wml),
    attribute('lastRow', '0', wml),
    attribute('firstColumn', '1', wml),
    attribute('lastColumn', '0', wml),
    attribute('noHBand', '0', wml),
    attribute('noVBand', '1', wml),
  ]);
  return {
    id: nextId(),
    kind: 'tableProperties',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'tblPr',
    ...(wml.elementPrefix === undefined ? {} : { prefix: wml.elementPrefix }),
    namespaceBindings: [],
    attributes: [],
    children: [width, borders, look],
  } as OoxmlNode;
}

function tableGrid(
  cols: number,
  columnWidthTwips: number,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlNode {
  const columns: OoxmlNode[] = [];
  for (let index = 0; index < cols; index += 1) {
    columns.push(fresh('gridCol', nextId, wml, [attribute('w', String(columnWidthTwips), wml)]));
  }
  return {
    id: nextId(),
    kind: 'tableGrid',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'tblGrid',
    ...(wml.elementPrefix === undefined ? {} : { prefix: wml.elementPrefix }),
    namespaceBindings: [],
    attributes: [],
    children: columns,
  } as OoxmlNode;
}

export function emptyParagraph(
  w14Prefix: string | null,
  seed: string,
  usedParagraphIds: Set<string>,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlParagraphNode {
  const identity: OoxmlAttribute[] = [];
  if (w14Prefix !== null) {
    const paraId = mintParaId(actorScopedSeed(seed), usedParagraphIds);
    usedParagraphIds.add(paraId);
    identity.push(...mintedParagraphIdentityAttributes(w14Prefix, paraId));
  }
  return {
    id: nextId(),
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    ...(wml.elementPrefix === undefined ? {} : { prefix: wml.elementPrefix }),
    namespaceBindings: [],
    attributes: identity,
    children: [],
  } as OoxmlParagraphNode;
}

/** The attribution one tracked table insertion stamps on every marker it writes. */
export interface TableRevision {
  readonly id: string;
  readonly revision: RevisionAttributionInput;
}

function revisionMarker(
  { id, revision }: TableRevision,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlElement {
  return fresh('ins', nextId, wml, trackedRevisionAttributes(id, revision, wml));
}

/** `w:pPr` holding an inserted paragraph mark. */
export function insertedMarkProperties(
  revision: TableRevision,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlParagraphPropertiesNode {
  const rPr = {
    ...fresh('rPr', nextId, wml, [], [revisionMarker(revision, nextId, wml)]),
    kind: 'runProperties',
  } as OoxmlElement;
  return {
    ...fresh('pPr', nextId, wml, [], [rPr]),
    kind: 'paragraphProperties',
  } as OoxmlParagraphPropertiesNode;
}

interface BuiltTable {
  readonly table: OoxmlTableNode;
  readonly cellIds: readonly string[];
  readonly paragraphIds: readonly string[];
}

function buildTable(
  op: InsertTableOp,
  w14Prefix: string | null,
  usedParagraphIds: Set<string>,
  nextId: () => string,
  wml: WmlFreshNamespaceContext,
  marked?: TableRevision
): BuiltTable {
  const cellIds: string[] = [];
  const paragraphIds: string[] = [];
  const rows: OoxmlNode[] = [];
  for (let rowIndex = 0; rowIndex < op.rows; rowIndex += 1) {
    const cells: OoxmlNode[] = [];
    for (let colIndex = 0; colIndex < op.cols; colIndex += 1) {
      const cellWidth = fresh('tcW', nextId, wml, [
        attribute('w', String(op.columnWidthTwips), wml),
        attribute('type', 'dxa', wml),
      ]);
      const cellProperties = fresh('tcPr', nextId, wml, [], [cellWidth]);
      const empty = emptyParagraph(
        w14Prefix,
        `${op.beforeParagraphId}:r${rowIndex}c${colIndex}`,
        usedParagraphIds,
        nextId,
        wml
      );
      // A tracked table marks each cell's paragraph mark inserted, as well as each row.
      const paragraph = marked
        ? { ...empty, children: [insertedMarkProperties(marked, nextId, wml)] }
        : empty;
      paragraphIds.push(paragraph.id);
      const cell = {
        id: nextId(),
        kind: 'tableCell',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'tc',
        ...(wml.elementPrefix === undefined ? {} : { prefix: wml.elementPrefix }),
        namespaceBindings: [],
        attributes: [],
        children: [cellProperties, paragraph],
      } as OoxmlTableCellNode;
      cellIds.push(cell.id);
      cells.push(cell);
    }
    const row = {
      id: nextId(),
      kind: 'tableRow',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'tr',
      ...(wml.elementPrefix === undefined ? {} : { prefix: wml.elementPrefix }),
      namespaceBindings: [],
      attributes: [],
      // No `w:cellIns` on the cells: a whole inserted row is its `w:trPr` marker. Cell
      // insertion markers in a new row also made rejecting the table lose text.
      children: marked
        ? [fresh('trPr', nextId, wml, [], [revisionMarker(marked, nextId, wml)]), ...cells]
        : cells,
    } as OoxmlTableRowNode;
    rows.push(row);
  }
  const table = {
    id: nextId(),
    kind: 'table',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'tbl',
    ...(wml.elementPrefix === undefined ? {} : { prefix: wml.elementPrefix }),
    // The generated alias, when WML was only the default namespace, is declared here:
    // every `w:`-prefixed attribute below this node needs it in scope.
    namespaceBindings: wml.rowBinding ? [wml.rowBinding] : [],
    attributes: [],
    children: [
      tableProperties(nextId, wml),
      tableGrid(op.cols, op.columnWidthTwips, nextId, wml),
      ...rows,
    ],
  } as OoxmlTableNode;
  return { table, cellIds, paragraphIds };
}

function boundedInteger(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function validateInsertTable(part: OoxmlPart, op: InsertTableOp): TreeOpRejection | null {
  if (op.revision !== undefined && invalidRevisionAttribution(op.revision)) return 'invalidArgs';
  if (typeof op.beforeParagraphId !== 'string' || op.beforeParagraphId.length === 0) {
    return 'invalidArgs';
  }
  if (!boundedInteger(op.rows, 1, MAX_INSERT_TABLE_ROWS)) return 'invalidArgs';
  if (!boundedInteger(op.cols, 1, MAX_INSERT_TABLE_COLUMNS)) return 'invalidArgs';
  // The cell cap binds before either dimension cap, and it is checked on the PRODUCT so a
  // request cannot slip past two individually legal numbers into a 2-million-node build.
  if (op.rows * op.cols > MAX_INSERT_TABLE_CELLS) return 'resource-limit';
  if (
    !boundedInteger(op.columnWidthTwips, MIN_TABLE_COLUMN_WIDTH_TWIPS, MAX_TABLE_COLUMN_WIDTH_TWIPS)
  ) {
    return 'invalid-property-value';
  }
  if (op.columnWidthTwips * op.cols > MAX_TABLE_WIDTH_TWIPS) return 'invalid-property-value';

  const paragraph = findNode(part, op.beforeParagraphId);
  if (!paragraph) return 'unknown-paragraph';
  if (paragraph.kind !== 'paragraph') return 'not-a-paragraph';
  const parent = parentOf(part, paragraph.id);
  if (!parent || !BLOCK_CONTAINERS.has(parent.localName)) return 'not-a-block';
  if (isBoundAt(part, paragraph.id)) return 'bound';
  if (effectiveContentLockAt(part, paragraph.id).content) return 'locked';
  return null;
}

export function applyInsertTable(
  part: OoxmlPart,
  op: InsertTableOp,
  options?: EditOptions
): TreeOpResult {
  const rejection = validateInsertTable(part, op);
  if (rejection) return { ok: false, reason: rejection };

  const paragraph = findNode(part, op.beforeParagraphId);
  const parent = paragraph ? parentOf(part, paragraph.id) : null;
  if (!paragraph || !parent) return { ok: false, reason: 'unknown-paragraph' };
  const index = parent.children.findIndex((child) => child.id === paragraph.id);
  if (index < 0) return { ok: false, reason: 'tree-invariant' };

  const nextId = createNodeIdAllocator(part);
  const wml = wmlFreshNamespaceContextAt(part, parent);
  const w14Prefix = w14PrefixInScopeAt(part, parent);
  const usedParagraphIds = new Set(usedParaIds(part.root));
  const marked = op.revision
    ? { id: options?.revisionIds?.() ?? nextRevisionId(part)(), revision: op.revision }
    : undefined;
  const built = buildTable(op, w14Prefix, usedParagraphIds, nextId, wml, marked);

  // Two `w:tbl` siblings are ONE table when Word reopens the file. An empty paragraph
  // between them is the separator Word itself authors, and it has to be minted here
  // rather than left to a later normalization pass: by then the tables have merged.
  const previous = index > 0 ? parent.children[index - 1] : undefined;
  let separator =
    previous && previous.kind !== 'textValue' && previous.localName === 'tbl'
      ? emptyParagraph(w14Prefix, `${op.beforeParagraphId}:sep`, usedParagraphIds, nextId, wml)
      : null;

  if (separator && marked)
    separator = { ...separator, children: [insertedMarkProperties(marked, nextId, wml)] };

  const inserted: OoxmlNode[] = separator ? [separator, built.table] : [built.table];
  const effect: TreeOpEffect = {
    dirty: [parent.id, built.table.id],
    created: [
      ...(separator ? [separator.id] : []),
      built.table.id,
      ...built.cellIds,
      ...built.paragraphIds,
    ],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
    // Word leaves the caret in the first cell, which is also where typing continues the
    // gesture the user just made.
    caret: { paragraphId: built.paragraphIds[0]! },
  };

  return fromEdit(insertChildren(part, parent.id, index, inserted, options), effect);
}
