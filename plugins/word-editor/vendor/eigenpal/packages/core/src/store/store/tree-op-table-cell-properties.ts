import { createTableReadCache } from './table-read-cache.ts';
// Selected-cell border and fill TreeDocOps (table-editing task 6).
//
// Physical grid ownership drives edge planning; property patches are in-place and lossless.

import {
  createNodeIdAllocator,
  replaceNode,
  applyEdits,
  type EditOptions,
} from '../package/ooxml-edit.ts';
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
  type OoxmlPart,
  type OoxmlTableCellNode,
  type OoxmlTableRowNode,
} from '../package/ooxml-tree.ts';
import {
  DEFAULT_TABLE_TOPOLOGY_LIMITS,
  MAX_TABLE_BORDER_SIZE_EIGHTHS,
  MAX_TABLE_CELL_SELECTION_COUNT,
  MAX_TABLE_COLUMNS,
  MIN_TABLE_BORDER_SIZE_EIGHTHS,
  resolveTableTopologyLimits,
  type TableTopologyLimits,
} from './table-constraints.ts';
import { TABLE_BORDER_STYLES } from '../table-border-style.ts';
import { patchTcPrChild, removeTcPrChild } from './tree-op-table-properties.ts';
import { fromEdit, ok, TEXT_DEPS } from './tree-op-nodes.ts';
import { isWmlElement, wmlAttributeValue, wmlChildNamed } from './tree-op-table-shared.ts';
import { readEditableTableTopology, type EditableTableTopology } from './tree-op-table-topology.ts';
import type {
  TreeDocColorValue,
  TableBorderEdgeTarget,
  TableBorderSpecInput,
  TreeOpEffect,
  TreeOpRejection,
  TreeOpResult,
} from './tree-op-types.ts';

export type TableCellPropertyOp =
  | {
      readonly op: 'setTableCellBorders';
      readonly tableId: string;
      readonly cellIds: readonly string[];
      readonly scope: 'none';
      readonly target: TableBorderEdgeTarget;
    }
  | {
      readonly op: 'setTableCellBorders';
      readonly tableId: string;
      readonly cellIds: readonly string[];
      readonly scope: TableBorderEdgeTarget;
      readonly spec: TableBorderSpecInput;
    }
  | {
      readonly op: 'setTableCellFill';
      readonly tableId: string;
      readonly cellIds: readonly string[];
      readonly color: TreeDocColorValue | null;
    }
  | {
      readonly op: 'setTableCellVerticalAlignment';
      readonly tableId: string;
      readonly cellIds: readonly string[];
      readonly alignment: 'top' | 'center' | 'bottom';
    };

type BorderSideName = 'top' | 'left' | 'bottom' | 'right';

interface SidePatch {
  readonly kind: 'set' | 'clear';
  readonly spec?: TableBorderSpecInput;
}

export interface PlacedCell {
  readonly rowIndex: number;
  readonly startCol: number;
  readonly span: number;
  readonly endCol: number;
  readonly cell: OoxmlTableCellNode;
  readonly vMergeKind: 'none' | 'restart' | 'continue';
  /** Precomputed visual merge owner — O(1) for continuations, self for restart/ordinary. */
  readonly visualOwner: PlacedCell;
}

interface OwnershipInterval {
  readonly start: number;
  readonly end: number;
  readonly entry: PlacedCell;
}

interface PhysicalGrid {
  readonly rowFrom: number;
  readonly rowTo: number;
  readonly colFrom: number;
  readonly colTo: number;
  readonly rows: readonly (readonly OwnershipInterval[])[];
}

export interface ValidatedCellSelection {
  readonly index: PlacedCellIndex;
  readonly selectedIds: ReadonlySet<string>;
  readonly grid: PhysicalGrid;
}

type SidePatchMap = Map<string, Map<BorderSideName, SidePatch>>;

const STRICT_HEX = /^[0-9A-Fa-f]{6}$/;
const TC_BORDERS_CHILD_ORDER = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] as const;
const BORDER_SIDE_WML_ATTRS = new Set([
  'val',
  'sz',
  'color',
  'themeColor',
  'themeTint',
  'themeShade',
]);
const SHD_FILL_WML_ATTRS = new Set(['fill', 'themeFill', 'themeFillTint', 'themeFillShade']);
const EDGE_TARGETS: readonly TableBorderEdgeTarget[] = [
  'all',
  'outside',
  'inside',
  'top',
  'bottom',
  'left',
  'right',
];

const WML_THEME_COLOR_SLOTS = new Set([
  'dark1',
  'light1',
  'dark2',
  'light2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hyperlink',
  'followedHyperlink',
  'none',
  'background1',
  'text1',
  'background2',
  'text2',
]);

const THEME_SLOT_ALIASES: Readonly<Record<string, string>> = {
  lt1: 'light1',
  dk1: 'dark1',
  lt2: 'light2',
  dk2: 'dark2',
  bg1: 'background1',
  tx1: 'text1',
  bg2: 'background2',
  tx2: 'text2',
  hlink: 'hyperlink',
  folhlink: 'followedHyperlink',
};

const NO_OP_BORDER_EFFECT: TreeOpEffect = {
  dirty: [],
  created: [],
  deleted: [],
  dependencyKeys: TEXT_DEPS,
  impact: 'flow-structural',
};

const NO_OP_FILL_EFFECT: TreeOpEffect = {
  dirty: [],
  created: [],
  deleted: [],
  dependencyKeys: TEXT_DEPS,
  impact: 'paragraph-local',
};

function mapTopologyRejection(
  reason: 'unknown-table' | 'duplicate-property-container' | 'duplicate-node-id' | 'resource-limit'
): TreeOpRejection {
  if (reason === 'duplicate-node-id') return 'unknown-table';
  return reason;
}

function hasOwnOpKey(op: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(op, key);
}

function ownNonEmptyString(op: object, key: string): string | null {
  if (!hasOwnOpKey(op, key)) return null;
  const value = (op as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value.length === 0) return null;
  return value;
}

function ownKeysExactly(op: object, allowed: readonly string[]): boolean {
  const keys = Object.keys(op);
  if (keys.length !== allowed.length) return false;
  for (const key of allowed) {
    if (!hasOwnOpKey(op, key)) return false;
  }
  return true;
}

function countWmlChildren(container: OoxmlElement, localName: string): number {
  let count = 0;
  for (const child of container.children) {
    if (isWmlElement(child, localName)) count += 1;
  }
  return count;
}

function readGridSpan(cellProperties: OoxmlElement | undefined): number {
  const raw = cellProperties && wmlChildNamed(cellProperties, 'gridSpan');
  const value = raw && wmlAttributeValue(raw, 'val');
  if (!value || !/^\d{1,7}$/.test(value)) return 1;
  const span = Number(value);
  return Number.isInteger(span) && span > 1 ? Math.min(span, MAX_TABLE_COLUMNS) : 1;
}

function readGridSkip(rowProperties: OoxmlElement | undefined, localName: string): number {
  const raw = rowProperties && wmlChildNamed(rowProperties, localName);
  const value = raw && wmlAttributeValue(raw, 'val');
  if (!value || !/^\d{1,7}$/.test(value)) return 0;
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? Math.min(count, MAX_TABLE_COLUMNS) : 0;
}

function readVMergeKind(cellProperties: OoxmlElement | undefined): 'none' | 'restart' | 'continue' {
  const vMerge = cellProperties && wmlChildNamed(cellProperties, 'vMerge');
  if (!vMerge) return 'none';
  return wmlAttributeValue(vMerge, 'val') === 'restart' ? 'restart' : 'continue';
}

function buildRowGridSlots(
  row: OoxmlTableRowNode
): readonly { startCol: number; span: number; vMergeKind: 'none' | 'restart' | 'continue' }[] {
  const trPr = wmlChildNamed(row, 'trPr');
  const gridBefore = readGridSkip(trPr, 'gridBefore');
  let cursor = gridBefore;
  const slots: { startCol: number; span: number; vMergeKind: 'none' | 'restart' | 'continue' }[] =
    [];
  for (const child of row.children) {
    if (child.kind !== 'tableCell') continue;
    const tcPr = wmlChildNamed(child, 'tcPr');
    const startCol = Math.min(cursor, MAX_TABLE_COLUMNS);
    const span = Math.min(readGridSpan(tcPr), Math.max(0, MAX_TABLE_COLUMNS - startCol));
    slots.push({ startCol, span, vMergeKind: readVMergeKind(tcPr) });
    cursor = startCol + span;
  }
  return slots;
}

export interface PlacedCellIndex {
  readonly placed: readonly PlacedCell[];
  readonly byId: ReadonlyMap<string, PlacedCell>;
  readonly byRow: ReadonlyMap<number, readonly PlacedCell[]>;
  readonly intervalAtRow: ReadonlyMap<number, ReadonlyMap<string, PlacedCell>>;
  /** Restart-owner id → every member cell id in the visual merge group. */
  readonly visualMembersByOwnerId: ReadonlyMap<string, readonly string[]>;
}

/** Test-only: counts hull slot probes inside physical-grid construction. */
export let testPhysicalGridSlotScanCount = 0;

/** Test-only: unique visual-owner groups validated during selection proof. */
export let testVisualOwnerGroupValidationCount = 0;

/** Test-only: member-id membership checks during selection proof. */
export let testVisualMemberCheckCount = 0;

export function resetTestPhysicalGridSlotScanCount(): void {
  testPhysicalGridSlotScanCount = 0;
}

export function resetTestVisualOwnerCounters(): void {
  testVisualOwnerGroupValidationCount = 0;
  testVisualMemberCheckCount = 0;
}

function intervalKey(startCol: number, span: number): string {
  return `${startCol}\0${span}`;
}

function createPlacedCell(
  base: Omit<PlacedCell, 'visualOwner'>,
  visualOwner?: PlacedCell
): PlacedCell {
  if (visualOwner) return { ...base, visualOwner };
  const cell: PlacedCell = { ...base, visualOwner: undefined! };
  (cell as { visualOwner: PlacedCell }).visualOwner = cell;
  return cell;
}

type PlacedCellIndexResult =
  | { readonly ok: true; readonly index: PlacedCellIndex }
  | { readonly ok: false; readonly reason: TreeOpRejection };
const cachedCellIndex = createTableReadCache<EditableTableTopology, PlacedCellIndexResult>();

export function buildPlacedCellIndex(
  topology: EditableTableTopology,
  limits: TableTopologyLimits
): PlacedCellIndexResult {
  return cachedCellIndex(topology, topology, limits, () => readPlacedCellIndex(topology, limits));
}

function readPlacedCellIndex(
  topology: EditableTableTopology,
  limits: TableTopologyLimits
):
  | { readonly ok: true; readonly index: PlacedCellIndex }
  | { readonly ok: false; readonly reason: TreeOpRejection } {
  const placed: PlacedCell[] = [];
  const byId = new Map<string, PlacedCell>();
  const byRow = new Map<number, PlacedCell[]>();
  const intervalAtRow = new Map<number, Map<string, PlacedCell>>();
  const openChains = new Map<string, string>();
  const visualMembersByOwnerId = new Map<string, string[]>();

  for (let rowIndex = 0; rowIndex < topology.rows.length; rowIndex += 1) {
    if (rowIndex >= limits.maxRows) return { ok: false, reason: 'resource-limit' };
    const entry = topology.rows[rowIndex]!;
    const slots = buildRowGridSlots(entry.row);
    let rowEntries = byRow.get(rowIndex);
    if (!rowEntries) {
      rowEntries = [];
      byRow.set(rowIndex, rowEntries);
    }
    let rowIntervals = intervalAtRow.get(rowIndex);
    if (!rowIntervals) {
      rowIntervals = new Map<string, PlacedCell>();
      intervalAtRow.set(rowIndex, rowIntervals);
    }

    for (let cellIndex = 0; cellIndex < entry.cells.length; cellIndex += 1) {
      const cell = entry.cells[cellIndex]!;
      const slot = slots[cellIndex]!;
      const interval = intervalKey(slot.startCol, slot.span);

      if (slot.vMergeKind === 'restart') {
        openChains.set(interval, cell.id);
        visualMembersByOwnerId.set(cell.id, [cell.id]);
        const placedCell = createPlacedCell({
          rowIndex,
          startCol: slot.startCol,
          span: slot.span,
          endCol: slot.startCol + slot.span - 1,
          cell,
          vMergeKind: slot.vMergeKind,
        });
        placed.push(placedCell);
        byId.set(cell.id, placedCell);
        rowEntries!.push(placedCell);
        rowIntervals!.set(interval, placedCell);
      } else if (slot.vMergeKind === 'continue') {
        const ownerId = openChains.get(interval);
        if (!ownerId) {
          return { ok: false, reason: 'tree-invariant' };
        }
        const owner = byId.get(ownerId)!;
        visualMembersByOwnerId.get(ownerId)!.push(cell.id);
        openChains.set(interval, ownerId);
        const placedCell = createPlacedCell(
          {
            rowIndex,
            startCol: slot.startCol,
            span: slot.span,
            endCol: slot.startCol + slot.span - 1,
            cell,
            vMergeKind: slot.vMergeKind,
          },
          owner
        );
        placed.push(placedCell);
        byId.set(cell.id, placedCell);
        rowEntries!.push(placedCell);
        rowIntervals!.set(interval, placedCell);
      } else {
        openChains.delete(interval);
        const placedCell = createPlacedCell({
          rowIndex,
          startCol: slot.startCol,
          span: slot.span,
          endCol: slot.startCol + slot.span - 1,
          cell,
          vMergeKind: slot.vMergeKind,
        });
        placed.push(placedCell);
        byId.set(cell.id, placedCell);
        rowEntries!.push(placedCell);
        rowIntervals!.set(interval, placedCell);
      }

      if (placed.length > limits.maxTraversalNodes) {
        return { ok: false, reason: 'resource-limit' };
      }
    }
  }

  const frozenMembers = new Map<string, readonly string[]>();
  for (const [ownerId, members] of visualMembersByOwnerId) {
    frozenMembers.set(ownerId, Object.freeze([...members]));
  }

  return {
    ok: true,
    index: { placed, byId, byRow, intervalAtRow, visualMembersByOwnerId: frozenMembers },
  };
}

export function validateVMergeChains(index: PlacedCellIndex): boolean {
  const openChains = new Map<string, number>();
  for (const entry of index.placed) {
    const key = intervalKey(entry.startCol, entry.span);
    if (entry.vMergeKind === 'restart') {
      openChains.set(key, entry.rowIndex);
      continue;
    }
    if (entry.vMergeKind === 'continue') {
      const lastRow = openChains.get(key);
      if (lastRow === undefined) return false;
      if (entry.rowIndex !== lastRow + 1) return false;
      openChains.set(key, entry.rowIndex);
      continue;
    }
    openChains.delete(key);
  }
  return true;
}

function estimatePhysicalSelectionWork(
  index: PlacedCellIndex,
  cellIds: readonly string[],
  rowFrom: number,
  rowTo: number,
  colFrom: number,
  colTo: number,
  limits: TableTopologyLimits
): TreeOpRejection | null {
  const rowSpan = rowTo - rowFrom + 1;
  const colSpan = colTo - colFrom + 1;
  if (rowSpan <= 0 || colSpan <= 0) return 'invalidArgs';
  const hullArea = rowSpan * colSpan;
  if (hullArea > limits.maxTraversalNodes) return 'resource-limit';

  let cellsInHullRows = 0;
  for (let rowIndex = rowFrom; rowIndex <= rowTo; rowIndex += 1) {
    cellsInHullRows += index.byRow.get(rowIndex)?.length ?? 0;
  }

  const validatedOwnerIds = new Set<string>();
  let memberChecks = 0;
  for (const id of cellIds) {
    const entry = index.byId.get(id)!;
    const ownerId = entry.visualOwner.cell.id;
    if (validatedOwnerIds.has(ownerId)) continue;
    validatedOwnerIds.add(ownerId);
    const members = index.visualMembersByOwnerId.get(ownerId);
    memberChecks += members ? members.length : 1;
  }

  const ownerLinks = index.placed.length;
  const projected =
    ownerLinks +
    hullArea +
    cellsInHullRows +
    rowSpan +
    ownerLinks +
    memberChecks +
    validatedOwnerIds.size +
    hullArea;
  if (projected > limits.maxTraversalNodes) return 'resource-limit';
  return null;
}

function buildRowOwnership(
  rowEntries: readonly PlacedCell[],
  colFrom: number,
  colTo: number
): OwnershipInterval[] | null {
  type Event = {
    readonly x: number;
    readonly kind: 0 | 1;
    readonly entry: PlacedCell;
    readonly cellIndex: number;
  };
  const events: Event[] = [];
  rowEntries.forEach((entry, cellIndex) => {
    if (entry.span <= 0) return;
    const start = entry.startCol;
    const end = entry.endCol + 1;
    if (start >= end) return;
    if (end <= colFrom || start > colTo) return;
    events.push({ x: start, kind: 1, entry, cellIndex });
    events.push({ x: end, kind: 0, entry, cellIndex });
  });
  if (events.length === 0) return [];

  events.sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x;
    if (a.kind !== b.kind) return a.kind - b.kind;
    return a.cellIndex - b.cellIndex;
  });

  const active = new Map<number, PlacedCell>();
  let winner: PlacedCell | undefined;
  let prevX = events[0]!.x;
  const out: OwnershipInterval[] = [];

  const recomputeWinner = (): void => {
    winner = undefined;
    let bestIndex = Number.POSITIVE_INFINITY;
    for (const [cellIndex, entry] of active) {
      if (cellIndex < bestIndex) {
        bestIndex = cellIndex;
        winner = entry;
      }
    }
  };

  for (const event of events) {
    if (event.x > prevX && winner) {
      const last = out[out.length - 1];
      if (last && last.end === prevX && last.entry.cell.id === winner.cell.id) {
        out[out.length - 1] = { start: last.start, end: event.x, entry: winner };
      } else {
        out.push({ start: prevX, end: event.x, entry: winner });
      }
    }
    if (event.kind === 1) active.set(event.cellIndex, event.entry);
    else active.delete(event.cellIndex);
    recomputeWinner();
    prevX = event.x;
  }

  return out;
}

function ownerAtColumn(
  intervals: readonly OwnershipInterval[],
  col: number
): PlacedCell | undefined {
  for (const interval of intervals) {
    if (col >= interval.start && col < interval.end) return interval.entry;
  }
  return undefined;
}

function buildPhysicalGrid(
  index: PlacedCellIndex,
  rowFrom: number,
  rowTo: number,
  colFrom: number,
  colTo: number
): { readonly ok: true; readonly grid: PhysicalGrid } | { readonly ok: false } {
  const rows: OwnershipInterval[][] = [];
  for (let rowIndex = rowFrom; rowIndex <= rowTo; rowIndex += 1) {
    const rowEntries = index.byRow.get(rowIndex) ?? [];
    for (const entry of rowEntries) {
      if (entry.span <= 0) return { ok: false };
    }
    const intervals = buildRowOwnership(rowEntries, colFrom, colTo);
    if (intervals === null) return { ok: false };
    for (let col = colFrom; col <= colTo; col += 1) {
      testPhysicalGridSlotScanCount += 1;
      if (!ownerAtColumn(intervals, col)) return { ok: false };
    }
    rows.push(intervals);
  }
  return {
    ok: true,
    grid: { rowFrom, rowTo, colFrom, colTo, rows },
  };
}

function ownerAtGrid(grid: PhysicalGrid, rowIndex: number, col: number): PlacedCell {
  const intervals = grid.rows[rowIndex - grid.rowFrom]!;
  const entry = ownerAtColumn(intervals, col)!;
  return entry.visualOwner;
}

function rejectDuplicateCellProperties(cell: OoxmlTableCellNode): TreeOpRejection | null {
  const tcPr = wmlChildNamed(cell, 'tcPr');
  if (!tcPr) return null;
  if (countWmlChildren(tcPr, 'tcBorders') > 1) return 'duplicate-property-container';
  if (countWmlChildren(tcPr, 'shd') > 1) return 'duplicate-property-container';
  const tcBorders = wmlChildNamed(tcPr, 'tcBorders');
  if (tcBorders) {
    for (const side of TC_BORDERS_CHILD_ORDER) {
      if (countWmlChildren(tcBorders, side) > 1) return 'duplicate-property-container';
    }
  }
  return null;
}

export function validateCellSelection(
  topology: EditableTableTopology,
  cellIds: readonly string[],
  limits: TableTopologyLimits
):
  | { readonly ok: true; readonly selection: ValidatedCellSelection }
  | { readonly ok: false; readonly reason: TreeOpRejection } {
  if (!Array.isArray(cellIds) || cellIds.length === 0) return { ok: false, reason: 'invalidArgs' };
  if (
    cellIds.length > MAX_TABLE_CELL_SELECTION_COUNT ||
    cellIds.length > limits.maxRows * limits.maxColumns
  ) {
    return { ok: false, reason: 'resource-limit' };
  }

  const seen = new Set<string>();
  for (const id of cellIds) {
    if (typeof id !== 'string' || id.length === 0) return { ok: false, reason: 'invalidArgs' };
    if (seen.has(id)) return { ok: false, reason: 'invalidArgs' };
    seen.add(id);
  }

  const built = buildPlacedCellIndex(topology, limits);
  if (!built.ok) return { ok: false, reason: built.reason };
  const { index } = built;
  const { byId } = index;

  for (const id of cellIds) {
    if (!byId.has(id)) return { ok: false, reason: 'invalidArgs' };
    const duplicate = rejectDuplicateCellProperties(byId.get(id)!.cell);
    if (duplicate) return { ok: false, reason: duplicate };
  }

  let rowFrom = Number.POSITIVE_INFINITY;
  let rowTo = Number.NEGATIVE_INFINITY;
  let colFrom = Number.POSITIVE_INFINITY;
  let colTo = Number.NEGATIVE_INFINITY;
  for (const id of cellIds) {
    const entry = byId.get(id)!;
    rowFrom = Math.min(rowFrom, entry.rowIndex);
    rowTo = Math.max(rowTo, entry.rowIndex);
    colFrom = Math.min(colFrom, entry.startCol);
    colTo = Math.max(colTo, entry.endCol);
  }

  const budgetRejection = estimatePhysicalSelectionWork(
    index,
    cellIds,
    rowFrom,
    rowTo,
    colFrom,
    colTo,
    limits
  );
  if (budgetRejection) return { ok: false, reason: budgetRejection };

  if (!validateVMergeChains(index)) return { ok: false, reason: 'tree-invariant' };

  resetTestPhysicalGridSlotScanCount();
  resetTestVisualOwnerCounters();
  const gridResult = buildPhysicalGrid(index, rowFrom, rowTo, colFrom, colTo);
  if (!gridResult.ok) return { ok: false, reason: 'invalidArgs' };

  for (let rowIndex = rowFrom; rowIndex <= rowTo; rowIndex += 1) {
    for (let col = colFrom; col <= colTo; col += 1) {
      const intervals = gridResult.grid.rows[rowIndex - rowFrom]!;
      const entry = ownerAtColumn(intervals, col);
      if (!entry || !seen.has(entry.cell.id)) return { ok: false, reason: 'invalidArgs' };
    }
  }

  const validatedOwnerIds = new Set<string>();
  for (const id of cellIds) {
    const entry = byId.get(id)!;
    const ownerId = entry.visualOwner.cell.id;
    if (validatedOwnerIds.has(ownerId)) continue;
    validatedOwnerIds.add(ownerId);
    testVisualOwnerGroupValidationCount += 1;
    const members = index.visualMembersByOwnerId.get(ownerId);
    if (members) {
      for (const memberId of members) {
        testVisualMemberCheckCount += 1;
        if (!seen.has(memberId)) return { ok: false, reason: 'invalidArgs' };
      }
      continue;
    }
    testVisualMemberCheckCount += 1;
    if (!seen.has(ownerId)) return { ok: false, reason: 'invalidArgs' };
  }

  return {
    ok: true,
    selection: {
      index,
      selectedIds: seen,
      grid: gridResult.grid,
    },
  };
}

function normalizeThemeSlot(slot: string): string | null {
  const lower = slot.toLowerCase();
  if (WML_THEME_COLOR_SLOTS.has(lower)) return lower;
  return THEME_SLOT_ALIASES[lower] ?? null;
}

function validateThemeFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;
}

function validateTreeDocColorValue(color: unknown): color is TreeDocColorValue {
  if (!color || typeof color !== 'object') return false;
  const kind = (color as { kind?: unknown }).kind;
  if (kind === 'hex') {
    if (!ownKeysExactly(color, ['kind', 'value'])) return false;
    const value = (color as { value: unknown }).value;
    return typeof value === 'string' && STRICT_HEX.test(value);
  }
  if (kind === 'auto') {
    if (!ownKeysExactly(color, ['kind', 'resolvedHex'])) return false;
    const resolvedHex = (color as { resolvedHex: unknown }).resolvedHex;
    return typeof resolvedHex === 'string' && STRICT_HEX.test(resolvedHex);
  }
  if (kind === 'theme') {
    const c = color as { slot?: unknown; resolvedHex?: unknown; tint?: unknown; shade?: unknown };
    const keys = ['kind', 'slot', 'resolvedHex'];
    if (c.tint !== undefined) keys.push('tint');
    if (c.shade !== undefined) keys.push('shade');
    if (!ownKeysExactly(color, keys)) return false;
    if (typeof c.slot !== 'string' || normalizeThemeSlot(c.slot) === null) return false;
    if (typeof c.resolvedHex !== 'string' || !STRICT_HEX.test(c.resolvedHex)) return false;
    if (c.tint !== undefined && !validateThemeFraction(c.tint)) return false;
    if (c.shade !== undefined && !validateThemeFraction(c.shade)) return false;
    return true;
  }
  return false;
}

function validateTableBorderSpec(spec: unknown): spec is TableBorderSpecInput {
  if (!spec || typeof spec !== 'object') return false;
  if (!ownKeysExactly(spec, ['style', 'size', 'color'])) return false;
  const style = (spec as { style: unknown }).style;
  if (typeof style !== 'string' || !(TABLE_BORDER_STYLES as readonly string[]).includes(style))
    return false;
  const size = (spec as { size: unknown }).size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < MIN_TABLE_BORDER_SIZE_EIGHTHS)
    return false;
  if (size > MAX_TABLE_BORDER_SIZE_EIGHTHS) return false;
  return validateTreeDocColorValue((spec as { color: unknown }).color);
}

function themeModifierHex(fraction: number): string {
  return Math.round(fraction * 255)
    .toString(16)
    .toUpperCase()
    .padStart(2, '0');
}

function literalColorHex(color: TreeDocColorValue, themeAttr: 'themeColor' | 'themeFill'): string {
  if (color.kind === 'hex') return color.value.toUpperCase();
  if (color.kind === 'auto') {
    return themeAttr === 'themeColor' ? 'auto' : color.resolvedHex.toUpperCase();
  }
  return color.resolvedHex.toUpperCase();
}

function colorAttributes(
  color: TreeDocColorValue,
  wml: WmlFreshNamespaceContext,
  themeAttr: 'themeColor' | 'themeFill'
): OoxmlAttribute[] {
  const attributes: OoxmlAttribute[] = [
    {
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName: themeAttr === 'themeFill' ? 'fill' : 'color',
      prefix: wml.attributePrefix,
      value: literalColorHex(color, themeAttr),
    } as const,
  ];
  if (color.kind === 'theme') {
    const slot = normalizeThemeSlot(color.slot)!;
    attributes.push({
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName: themeAttr,
      prefix: wml.attributePrefix,
      value: slot,
    } as const);
    const tintName = themeAttr === 'themeFill' ? 'themeFillTint' : 'themeTint';
    const shadeName = themeAttr === 'themeFill' ? 'themeFillShade' : 'themeShade';
    if (color.tint !== undefined) {
      attributes.push({
        kind: 'genericExtension',
        namespaceUri: WML_NAMESPACE_URI,
        localName: tintName,
        prefix: wml.attributePrefix,
        value: themeModifierHex(color.tint),
      } as const);
    }
    if (color.shade !== undefined) {
      attributes.push({
        kind: 'genericExtension',
        namespaceUri: WML_NAMESPACE_URI,
        localName: shadeName,
        prefix: wml.attributePrefix,
        value: themeModifierHex(color.shade),
      } as const);
    }
  }
  return attributes;
}

function freshWmlElement(
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

function freshBorderSideElement(
  side: BorderSideName,
  nextId: () => string,
  wml: WmlFreshNamespaceContext,
  patch: SidePatch
): OoxmlElement {
  if (patch.kind === 'clear') {
    return freshWmlElement(side, nextId, wml, [
      {
        kind: 'wmlVal',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'val',
        prefix: wml.attributePrefix,
        value: 'none',
      } as const,
    ]);
  }
  const spec = patch.spec!;
  return freshWmlElement(side, nextId, wml, [
    {
      kind: 'wmlVal',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'val',
      prefix: wml.attributePrefix,
      value: spec.style,
    } as const,
    {
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'sz',
      prefix: wml.attributePrefix,
      value: String(spec.size),
    } as const,
    ...colorAttributes(spec.color, wml, 'themeColor'),
  ]);
}

function attributesEqual(a: readonly OoxmlAttribute[], b: readonly OoxmlAttribute[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]!;
    const right = b[index]!;
    if (
      left.namespaceUri !== right.namespaceUri ||
      left.localName !== right.localName ||
      left.value !== right.value
    ) {
      return false;
    }
  }
  return true;
}

function upsertWmlAttribute(
  attributes: readonly OoxmlAttribute[],
  localName: string,
  value: string,
  wml: WmlFreshNamespaceContext,
  asVal = false
): OoxmlAttribute[] {
  const out: OoxmlAttribute[] = [];
  let replaced = false;
  for (const attribute of attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName) {
      if (!replaced) {
        out.push(
          asVal
            ? ({
                kind: 'wmlVal',
                namespaceUri: WML_NAMESPACE_URI,
                localName: 'val',
                prefix: wml.attributePrefix,
                value,
              } as const)
            : ({
                kind: 'genericExtension',
                namespaceUri: WML_NAMESPACE_URI,
                localName,
                prefix: wml.attributePrefix,
                value,
              } as const)
        );
        replaced = true;
      }
      continue;
    }
    out.push(attribute);
  }
  if (!replaced) {
    out.push(
      asVal
        ? ({
            kind: 'wmlVal',
            namespaceUri: WML_NAMESPACE_URI,
            localName: 'val',
            prefix: wml.attributePrefix,
            value,
          } as const)
        : ({
            kind: 'genericExtension',
            namespaceUri: WML_NAMESPACE_URI,
            localName,
            prefix: wml.attributePrefix,
            value,
          } as const)
    );
  }
  return out;
}

function removeWmlAttributes(
  attributes: readonly OoxmlAttribute[],
  localNames: ReadonlySet<string>
): OoxmlAttribute[] {
  return attributes.filter(
    (attribute) =>
      attribute.namespaceUri !== WML_NAMESPACE_URI || !localNames.has(attribute.localName)
  );
}

function patchSideAttributesInPlace(
  side: OoxmlElement,
  patch: SidePatch,
  wml: WmlFreshNamespaceContext
): OoxmlElement | null {
  if (patch.kind === 'clear') {
    let attributes = removeWmlAttributes(side.attributes, BORDER_SIDE_WML_ATTRS);
    attributes = upsertWmlAttribute(attributes, 'val', 'none', wml, true);
    if (attributesEqual(side.attributes, attributes)) return null;
    return Object.freeze({ ...side, attributes }) as OoxmlElement;
  }
  const spec = patch.spec!;
  let attributes = removeWmlAttributes(side.attributes, BORDER_SIDE_WML_ATTRS);
  attributes = upsertWmlAttribute(attributes, 'val', spec.style, wml, true);
  attributes = upsertWmlAttribute(attributes, 'sz', String(spec.size), wml);
  for (const attribute of colorAttributes(spec.color, wml, 'themeColor')) {
    attributes = upsertWmlAttribute(attributes, attribute.localName, attribute.value, wml);
  }
  if (attributesEqual(side.attributes, attributes)) return null;
  return Object.freeze({ ...side, attributes }) as OoxmlElement;
}

function tcBordersChildRank(localName: string): number {
  const index = TC_BORDERS_CHILD_ORDER.indexOf(
    localName as (typeof TC_BORDERS_CHILD_ORDER)[number]
  );
  return index === -1 ? TC_BORDERS_CHILD_ORDER.length : index;
}

function insertTcBordersChild(children: OoxmlNode[], node: OoxmlElement): OoxmlNode[] {
  const rank = tcBordersChildRank(node.localName);
  let insertAt = children.length;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === WML_NAMESPACE_URI && tcBordersChildRank(child.localName) > rank) {
      insertAt = index;
      break;
    }
  }
  const out = [...children];
  out.splice(insertAt, 0, node);
  return out;
}

function patchTcBordersInPlace(
  existing: OoxmlElement | undefined,
  sidePatches: ReadonlyMap<BorderSideName, SidePatch>,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): { readonly container: OoxmlElement | null; readonly changed: boolean } {
  if (sidePatches.size === 0) return { container: existing ?? null, changed: false };

  let changed = false;
  let children = existing ? [...existing.children] : [];

  for (const side of ['top', 'left', 'bottom', 'right'] as const) {
    const patch = sidePatches.get(side);
    if (!patch) continue;
    const index = children.findIndex((child) => isWmlElement(child, side));
    if (index >= 0) {
      const patched = patchSideAttributesInPlace(children[index] as OoxmlElement, patch, wml);
      if (patched) {
        children[index] = patched;
        changed = true;
      }
      continue;
    }
    children = insertTcBordersChild(children, freshBorderSideElement(side, nextId, wml, patch));
    changed = true;
  }

  if (!changed) return { container: existing ?? null, changed: false };
  if (!existing)
    return { container: freshWmlElement('tcBorders', nextId, wml, [], children), changed: true };
  return { container: Object.freeze({ ...existing, children }) as OoxmlElement, changed: true };
}

function patchShdFillInPlace(
  existing: OoxmlElement | undefined,
  color: TreeDocColorValue | null,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): { readonly container: OoxmlElement | null; readonly changed: boolean } {
  if (color === null) {
    if (!existing) return { container: null, changed: false };
    // A `w:shd` with no pattern still paints no colour over the table style once its fill
    // goes, so clearing removes the whole element and lets the style show. That includes a
    // leftover element with no fill at all, which earlier clears wrote.
    const val = wmlAttributeValue(existing, 'val');
    if (val === undefined || val === 'clear' || val === 'nil')
      return { container: null, changed: true };
    const attributes = removeWmlAttributes(existing.attributes, SHD_FILL_WML_ATTRS);
    if (attributesEqual(existing.attributes, attributes))
      return { container: existing, changed: false };
    return { container: Object.freeze({ ...existing, attributes }) as OoxmlElement, changed: true };
  }

  const desired = colorAttributes(color, wml, 'themeFill');
  if (!existing) {
    const attributes = [
      {
        kind: 'wmlVal',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'val',
        prefix: wml.attributePrefix,
        value: 'clear',
      } as const,
      ...desired,
    ];
    return { container: freshWmlElement('shd', nextId, wml, attributes), changed: true };
  }

  let attributes = removeWmlAttributes(existing.attributes, SHD_FILL_WML_ATTRS);
  const existingVal = existing.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'val'
  )?.value;
  if (existingVal === 'nil') {
    attributes = upsertWmlAttribute(attributes, 'val', 'clear', wml, true);
  }
  for (const attribute of desired) {
    attributes = upsertWmlAttribute(
      attributes,
      attribute.localName,
      attribute.value,
      wml,
      attribute.localName === 'val'
    );
  }
  if (attributesEqual(existing.attributes, attributes))
    return { container: existing, changed: false };
  return { container: Object.freeze({ ...existing, attributes }) as OoxmlElement, changed: true };
}

function setSidePatch(
  map: SidePatchMap,
  cellId: string,
  side: BorderSideName,
  patch: SidePatch
): void {
  let sides = map.get(cellId);
  if (!sides) {
    sides = new Map();
    map.set(cellId, sides);
  }
  sides.set(side, patch);
}

function activeEdgeTarget(scope: TableBorderEdgeTarget): TableBorderEdgeTarget {
  return scope;
}

function planScopedEdges(
  selection: ValidatedCellSelection,
  target: TableBorderEdgeTarget,
  kind: 'set' | 'clear',
  spec: TableBorderSpecInput | undefined,
  map: SidePatchMap
): void {
  const { grid } = selection;
  const patchFor = (cellId: string, side: BorderSideName): void => {
    setSidePatch(map, cellId, side, kind === 'clear' ? { kind: 'clear' } : { kind: 'set', spec });
  };
  const { rowFrom, rowTo, colFrom, colTo } = grid;
  const edgeTarget = activeEdgeTarget(target);

  const patchPair = (aboveId: string, belowId: string): void => {
    patchFor(aboveId, 'bottom');
    patchFor(belowId, 'top');
  };
  const patchVerticalPair = (leftId: string, rightId: string): void => {
    patchFor(leftId, 'right');
    patchFor(rightId, 'left');
  };

  if (edgeTarget === 'all') {
    const owners = new Set<string>();
    for (let rowIndex = rowFrom; rowIndex <= rowTo; rowIndex += 1) {
      for (let col = colFrom; col <= colTo; col += 1) {
        owners.add(ownerAtGrid(grid, rowIndex, col).cell.id);
      }
    }
    for (const id of owners) {
      for (const side of ['top', 'left', 'bottom', 'right'] as const) patchFor(id, side);
    }
    return;
  }

  if (edgeTarget === 'outside') {
    for (let col = colFrom; col <= colTo; col += 1) {
      patchFor(ownerAtGrid(grid, rowFrom, col).cell.id, 'top');
      patchFor(ownerAtGrid(grid, rowTo, col).cell.id, 'bottom');
    }
    for (let rowIndex = rowFrom; rowIndex <= rowTo; rowIndex += 1) {
      patchFor(ownerAtGrid(grid, rowIndex, colFrom).cell.id, 'left');
      patchFor(ownerAtGrid(grid, rowIndex, colTo).cell.id, 'right');
    }
    return;
  }

  if (edgeTarget === 'inside') {
    for (let rowIndex = rowFrom; rowIndex < rowTo; rowIndex += 1) {
      for (let col = colFrom; col <= colTo; col += 1) {
        const above = ownerAtGrid(grid, rowIndex, col);
        const below = ownerAtGrid(grid, rowIndex + 1, col);
        if (above.cell.id === below.cell.id) continue;
        patchPair(above.cell.id, below.cell.id);
      }
    }
    for (let col = colFrom; col < colTo; col += 1) {
      for (let rowIndex = rowFrom; rowIndex <= rowTo; rowIndex += 1) {
        const left = ownerAtGrid(grid, rowIndex, col);
        const right = ownerAtGrid(grid, rowIndex, col + 1);
        if (left.cell.id === right.cell.id) continue;
        patchVerticalPair(left.cell.id, right.cell.id);
      }
    }
    return;
  }

  if (edgeTarget === 'top') {
    for (let col = colFrom; col <= colTo; col += 1) {
      patchFor(ownerAtGrid(grid, rowFrom, col).cell.id, 'top');
    }
    return;
  }
  if (edgeTarget === 'bottom') {
    for (let col = colFrom; col <= colTo; col += 1) {
      patchFor(ownerAtGrid(grid, rowTo, col).cell.id, 'bottom');
    }
    return;
  }
  if (edgeTarget === 'left') {
    for (let rowIndex = rowFrom; rowIndex <= rowTo; rowIndex += 1) {
      patchFor(ownerAtGrid(grid, rowIndex, colFrom).cell.id, 'left');
    }
    return;
  }
  for (let rowIndex = rowFrom; rowIndex <= rowTo; rowIndex += 1) {
    patchFor(ownerAtGrid(grid, rowIndex, colTo).cell.id, 'right');
  }
}

function planBorderSidePatches(
  selection: ValidatedCellSelection,
  scope: 'none',
  target: TableBorderEdgeTarget
): SidePatchMap;
function planBorderSidePatches(
  selection: ValidatedCellSelection,
  scope: TableBorderEdgeTarget,
  spec: TableBorderSpecInput
): SidePatchMap;
function planBorderSidePatches(
  selection: ValidatedCellSelection,
  scope: 'none' | TableBorderEdgeTarget,
  specOrTarget: TableBorderSpecInput | TableBorderEdgeTarget
): SidePatchMap {
  const map: SidePatchMap = new Map();
  if (scope === 'none') {
    planScopedEdges(selection, specOrTarget as TableBorderEdgeTarget, 'clear', undefined, map);
    return map;
  }
  planScopedEdges(selection, scope, 'set', specOrTarget as TableBorderSpecInput, map);
  return map;
}

function patchCellBorderSides(
  cell: OoxmlTableCellNode,
  sidePatches: ReadonlyMap<BorderSideName, SidePatch>,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlTableCellNode | null {
  const existingTcPr = wmlChildNamed(cell, 'tcPr');
  const existingTcBorders = existingTcPr && wmlChildNamed(existingTcPr, 'tcBorders');
  const merged = patchTcBordersInPlace(existingTcBorders, sidePatches, nextId, wml);
  if (!merged.changed) return null;

  let tcPr = existingTcPr;
  if (merged.container === null) return null;

  if (tcPr) {
    const patched = patchTcPrChild(tcPr, merged.container);
    if (!patched.ok) return null;
    tcPr = patched.container;
  } else {
    tcPr = freshWmlElement('tcPr', nextId, wml, [], [merged.container]);
  }

  if (tcPr === existingTcPr) return null;

  if (existingTcPr) {
    const children = cell.children.map((child) => (child === existingTcPr ? tcPr! : child));
    return Object.freeze({ ...cell, children }) as OoxmlTableCellNode;
  }

  let insertAt = 0;
  for (let index = 0; index < cell.children.length; index += 1) {
    const child = cell.children[index]!;
    if (child.kind === 'paragraph' || child.kind === 'table') break;
    insertAt = index + 1;
  }
  const children: OoxmlNode[] = [...cell.children];
  children.splice(insertAt, 0, tcPr!);
  return Object.freeze({ ...cell, children }) as OoxmlTableCellNode;
}

function patchCellFill(
  cell: OoxmlTableCellNode,
  color: TreeDocColorValue | null,
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlTableCellNode | null {
  const existingTcPr = wmlChildNamed(cell, 'tcPr');
  const existingShd = existingTcPr && wmlChildNamed(existingTcPr, 'shd');
  const merged = patchShdFillInPlace(existingShd, color, nextId, wml);
  if (!merged.changed) return null;
  if (merged.container === null && !existingShd) return null;

  let tcPr = existingTcPr;
  if (merged.container === null) {
    if (!tcPr) return null;
    const removed = removeTcPrChild(tcPr, 'shd');
    if (!removed.ok) return null;
    tcPr = removed.container;
  } else if (tcPr) {
    const patched = patchTcPrChild(tcPr, merged.container);
    if (!patched.ok) return null;
    tcPr = patched.container;
  } else {
    tcPr = freshWmlElement('tcPr', nextId, wml, [], [merged.container]);
  }

  if (tcPr === existingTcPr) return null;

  if (existingTcPr) {
    const children = cell.children.map((child) => (child === existingTcPr ? tcPr! : child));
    return Object.freeze({ ...cell, children }) as OoxmlTableCellNode;
  }

  let insertAt = 0;
  for (let index = 0; index < cell.children.length; index += 1) {
    const child = cell.children[index]!;
    if (child.kind === 'paragraph' || child.kind === 'table') break;
    insertAt = index + 1;
  }
  const children: OoxmlNode[] = [...cell.children];
  children.splice(insertAt, 0, tcPr!);
  return Object.freeze({ ...cell, children }) as OoxmlTableCellNode;
}

function patchCellVerticalAlignment(
  cell: OoxmlTableCellNode,
  alignment: 'top' | 'center' | 'bottom',
  nextId: () => string,
  wml: WmlFreshNamespaceContext
): OoxmlTableCellNode | null {
  const existingTcPr = wmlChildNamed(cell, 'tcPr');
  const existing = existingTcPr && wmlChildNamed(existingTcPr, 'vAlign');
  if (existing && wmlAttributeValue(existing, 'val') === alignment) return null;
  const property = freshWmlElement('vAlign', nextId, wml, [
    {
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'val',
      prefix: wml.attributePrefix,
      value: alignment,
    },
  ]);
  const tcPr = existingTcPr ?? freshWmlElement('tcPr', nextId, wml, []);
  const patched = patchTcPrChild(tcPr, property);
  if (!patched.ok) return null;
  if (existingTcPr) {
    const children = cell.children.map((child) =>
      child === existingTcPr ? patched.container : child
    );
    return Object.freeze({ ...cell, children }) as OoxmlTableCellNode;
  }
  const children: OoxmlNode[] = [patched.container, ...cell.children];
  return Object.freeze({ ...cell, children }) as OoxmlTableCellNode;
}

function isEdgeTarget(value: unknown): value is TableBorderEdgeTarget {
  return typeof value === 'string' && (EDGE_TARGETS as readonly string[]).includes(value);
}

function validateSetTableCellBordersShape(
  op: Extract<TableCellPropertyOp, { op: 'setTableCellBorders' }>
): TreeOpRejection | null {
  if (!ownNonEmptyString(op, 'tableId')) return 'invalidArgs';
  if (!Array.isArray(op.cellIds)) return 'invalidArgs';
  if (!hasOwnOpKey(op, 'scope')) return 'invalidArgs';

  if (op.scope === 'none') {
    if (!ownKeysExactly(op, ['op', 'tableId', 'cellIds', 'scope', 'target'])) return 'invalidArgs';
    if (!isEdgeTarget(op.target)) return 'invalidArgs';
    return null;
  }

  if (!ownKeysExactly(op, ['op', 'tableId', 'cellIds', 'scope', 'spec'])) return 'invalidArgs';
  if (!isEdgeTarget(op.scope)) return 'invalidArgs';
  return null;
}

function validateSetTableCellFillShape(
  op: Extract<TableCellPropertyOp, { op: 'setTableCellFill' }>
): TreeOpRejection | null {
  if (!ownNonEmptyString(op, 'tableId')) return 'invalidArgs';
  if (!Array.isArray(op.cellIds)) return 'invalidArgs';
  if (!ownKeysExactly(op, ['op', 'tableId', 'cellIds', 'color'])) return 'invalidArgs';
  if (op.color !== null && !validateTreeDocColorValue(op.color)) return 'invalid-property-value';
  return null;
}

function validateSetTableCellVerticalAlignmentShape(
  op: Extract<TableCellPropertyOp, { op: 'setTableCellVerticalAlignment' }>
): TreeOpRejection | null {
  if (!ownNonEmptyString(op, 'tableId')) return 'invalidArgs';
  if (!Array.isArray(op.cellIds)) return 'invalidArgs';
  if (!ownKeysExactly(op, ['op', 'tableId', 'cellIds', 'alignment'])) return 'invalidArgs';
  if (!['top', 'center', 'bottom'].includes(op.alignment)) return 'invalid-property-value';
  return null;
}

export function validateTableCellPropertyOp(
  part: OoxmlPart,
  op: TableCellPropertyOp,
  limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS
): TreeOpRejection | null {
  const shape =
    op.op === 'setTableCellBorders'
      ? validateSetTableCellBordersShape(op)
      : op.op === 'setTableCellFill'
        ? validateSetTableCellFillShape(op)
        : validateSetTableCellVerticalAlignmentShape(op);
  if (shape) return shape;

  const resolved = resolveTableTopologyLimits(limits);
  const topologyResult = readEditableTableTopology(part.root, op.tableId, resolved);
  if (!topologyResult.ok) return mapTopologyRejection(topologyResult.reason);

  const selectionResult = validateCellSelection(topologyResult.topology, op.cellIds, resolved);
  if (!selectionResult.ok) return selectionResult.reason;

  if (op.op === 'setTableCellFill' && op.color !== null && !validateTreeDocColorValue(op.color)) {
    return 'invalid-property-value';
  }

  if (op.op === 'setTableCellBorders' && op.scope !== 'none') {
    if (!validateTableBorderSpec(op.spec)) return 'invalid-property-value';
  }

  return null;
}

function tableWithDeclaredWmlBinding(
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

function applySetTableCellBorders(
  part: OoxmlPart,
  op: Extract<TableCellPropertyOp, { op: 'setTableCellBorders' }>,
  options?: EditOptions,
  limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS
): TreeOpResult {
  const rejection = validateTableCellPropertyOp(part, op, limits);
  if (rejection) return { ok: false, reason: rejection };

  const resolved = resolveTableTopologyLimits(limits);
  const topologyResult = readEditableTableTopology(part.root, op.tableId, resolved);
  if (!topologyResult.ok) return { ok: false, reason: mapTopologyRejection(topologyResult.reason) };
  const selectionResult = validateCellSelection(topologyResult.topology, op.cellIds, resolved);
  if (!selectionResult.ok) return { ok: false, reason: selectionResult.reason };

  const sidePatches =
    op.scope === 'none'
      ? planBorderSidePatches(selectionResult.selection, 'none', op.target)
      : planBorderSidePatches(selectionResult.selection, op.scope, op.spec);

  const wml = wmlFreshNamespaceContextAt(part, topologyResult.topology.table);
  const nextId = createNodeIdAllocator(part);

  const edits: ((current: OoxmlPart) => ReturnType<typeof replaceNode>)[] = [];
  const dirty = new Set<string>();
  let changed = false;

  for (const [cellId, patches] of sidePatches) {
    const placed = selectionResult.selection.index.byId.get(cellId);
    if (!placed) continue;
    const patched = patchCellBorderSides(placed.cell, patches, nextId, wml);
    if (!patched) continue;
    changed = true;
    dirty.add(cellId);
    edits.push((current) => replaceNode(current, cellId, patched, options));
  }

  if (!changed) return ok(part, NO_OP_BORDER_EFFECT);

  const targetTable = tableWithDeclaredWmlBinding(topologyResult.topology.table, part, wml);
  if (targetTable !== topologyResult.topology.table) {
    dirty.add(topologyResult.topology.table.id);
    edits.unshift((current) =>
      replaceNode(current, topologyResult.topology.table.id, targetTable, options)
    );
  }

  const effect: TreeOpEffect = {
    dirty: [...dirty],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };
  return fromEdit(applyEdits(part, edits, options), effect);
}

function applySetTableCellFill(
  part: OoxmlPart,
  op: Extract<TableCellPropertyOp, { op: 'setTableCellFill' }>,
  options?: EditOptions,
  limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS
): TreeOpResult {
  const rejection = validateTableCellPropertyOp(part, op, limits);
  if (rejection) return { ok: false, reason: rejection };

  const resolved = resolveTableTopologyLimits(limits);
  const topologyResult = readEditableTableTopology(part.root, op.tableId, resolved);
  if (!topologyResult.ok) return { ok: false, reason: mapTopologyRejection(topologyResult.reason) };
  const selectionResult = validateCellSelection(topologyResult.topology, op.cellIds, resolved);
  if (!selectionResult.ok) return { ok: false, reason: selectionResult.reason };

  const wml = wmlFreshNamespaceContextAt(part, topologyResult.topology.table);
  const nextId = createNodeIdAllocator(part);

  const edits: ((current: OoxmlPart) => ReturnType<typeof replaceNode>)[] = [];
  const dirty = new Set<string>();
  let changed = false;

  for (const id of selectionResult.selection.selectedIds) {
    const placed = selectionResult.selection.index.byId.get(id);
    if (!placed) continue;
    const patched = patchCellFill(placed.cell, op.color, nextId, wml);
    if (!patched) continue;
    changed = true;
    dirty.add(id);
    edits.push((current) => replaceNode(current, id, patched, options));
  }

  if (!changed) return ok(part, NO_OP_FILL_EFFECT);

  const targetTable = tableWithDeclaredWmlBinding(topologyResult.topology.table, part, wml);
  if (targetTable !== topologyResult.topology.table) {
    dirty.add(topologyResult.topology.table.id);
    edits.unshift((current) =>
      replaceNode(current, topologyResult.topology.table.id, targetTable, options)
    );
  }

  const effect: TreeOpEffect = {
    dirty: [...dirty],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'paragraph-local',
  };
  return fromEdit(applyEdits(part, edits, options), effect);
}

function applySetTableCellVerticalAlignment(
  part: OoxmlPart,
  op: Extract<TableCellPropertyOp, { op: 'setTableCellVerticalAlignment' }>,
  options?: EditOptions,
  limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS
): TreeOpResult {
  const rejection = validateTableCellPropertyOp(part, op, limits);
  if (rejection) return { ok: false, reason: rejection };
  const resolved = resolveTableTopologyLimits(limits);
  const topologyResult = readEditableTableTopology(part.root, op.tableId, resolved);
  if (!topologyResult.ok) return { ok: false, reason: mapTopologyRejection(topologyResult.reason) };
  const selectionResult = validateCellSelection(topologyResult.topology, op.cellIds, resolved);
  if (!selectionResult.ok) return { ok: false, reason: selectionResult.reason };

  const wml = wmlFreshNamespaceContextAt(part, topologyResult.topology.table);
  const nextId = createNodeIdAllocator(part);
  const edits: ((current: OoxmlPart) => ReturnType<typeof replaceNode>)[] = [];
  const dirty = new Set<string>();
  for (const id of selectionResult.selection.selectedIds) {
    const placed = selectionResult.selection.index.byId.get(id);
    if (!placed) continue;
    const patched = patchCellVerticalAlignment(placed.cell, op.alignment, nextId, wml);
    if (!patched) continue;
    dirty.add(id);
    edits.push((current) => replaceNode(current, id, patched, options));
  }
  if (edits.length === 0) return ok(part, NO_OP_FILL_EFFECT);
  const targetTable = tableWithDeclaredWmlBinding(topologyResult.topology.table, part, wml);
  if (targetTable !== topologyResult.topology.table) {
    dirty.add(topologyResult.topology.table.id);
    edits.unshift((current) =>
      replaceNode(current, topologyResult.topology.table.id, targetTable, options)
    );
  }
  const effect: TreeOpEffect = {
    dirty: [...dirty],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };
  return fromEdit(applyEdits(part, edits, options), effect);
}

export function applyTableCellPropertyOp(
  part: OoxmlPart,
  op: TableCellPropertyOp,
  options?: EditOptions
): TreeOpResult {
  if (op.op === 'setTableCellBorders') return applySetTableCellBorders(part, op, options);
  if (op.op === 'setTableCellFill') return applySetTableCellFill(part, op, options);
  return applySetTableCellVerticalAlignment(part, op, options);
}
