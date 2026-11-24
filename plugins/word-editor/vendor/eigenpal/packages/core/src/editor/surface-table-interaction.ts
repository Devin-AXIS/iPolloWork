// Table interaction furniture for the paginated surface.
//
// A contenteditable=false sibling layer over painted pages. Geometry and targets come only
// from semantic layout records — never from painted table DOM.

import type { ExecResult } from '../contracts/editor.ts';
import type { SemanticLayout, SemanticSelection } from '@docx-editor.dev/core/layout';
import { readTwipsMeasure, type OoxmlElement } from '@docx-editor.dev/core/store';
import { validateTableResizeGrid } from '../store/store/table-resize-grid.ts';
import { readEditableTableTopology } from '../store/store/tree-op-table-topology.ts';
import { wmlAttributeValue } from '../store/store/tree-op-table-shared.ts';
import {
  MIN_TABLE_COLUMN_WIDTH_TWIPS,
  MIN_TABLE_ROW_HEIGHT_TWIPS,
} from '../store/store/table-constraints.ts';
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import { findTableOnPage, offeredHit, partOfTableIn } from './surface-table-story.ts';
import type { CellSelection } from '../layout/semantic-cell-selection.ts';
import type { SurfaceEditingMode } from './paginated-surface-contract.ts';
import { hostTimers, isDomNode, isHTMLElementTag } from './host-realm.ts';
import type { SurfaceHostListeners } from './surface-host-listeners.ts';
import {
  planTableCommand,
  planTableRowHeightResize,
  type TableCommandPlan,
} from './table-command-plan.ts';
import { pageAtY } from '../layout/semantic-hit-test.ts';
import {
  findTableInteractionAt,
  resolveTableInteractionInsertHit,
  tableInteractionHitIdentity,
  tableInteractionIndex,
  tableInteractionTargetIdentity,
  type TableInteractionHit,
  type TableInteractionIndex,
} from '../layout/semantic-table-interaction.ts';
import type {
  TableColumnDividerResizeTarget,
  TableRightEdgeResizeTarget,
} from '@docx-editor.dev/core/contracts/editor';
import {
  findTableOccurrence,
  tableColumnDividerResizeTargetFrom,
  tableColumnOccurrenceTargetFrom,
  tableRightEdgeResizeTargetFrom,
  tableRowOccurrenceTargetFrom,
  type TableOccurrenceRef,
  type TableRowOccurrenceTarget,
} from '../layout/table-interaction-targets.ts';
import type { TableInteractionLabelKey } from './table-chrome.ts';

const HOVER_HIDE_MS = 120;
const PT_TO_TWIPS = 20;

/** i18n keys for core-owned table insertion furniture — canonical in table-chrome.ts. @public */
export type { TableInteractionLabelKey } from './table-chrome.ts';

export interface SurfaceTableInteractionInput {
  readonly layout: SemanticLayout;
  readonly storeRevision: number;
  readonly selection: SemanticSelection;
  readonly cellSelection: CellSelection | null;
  readonly editingMode: SurfaceEditingMode;
  readonly themeColors: readonly import('../binding/document-theme.ts').DocumentThemeColorEntry[];
}

export interface SurfaceTableInteractionHost {
  readonly pagesLayer: HTMLElement;
  readonly furnitureLayer: HTMLElement;
  /** Document-level listeners that follow the pages to another window. */
  readonly listeners: SurfaceHostListeners;
  scale(): number;
  pageOffsetX(pageIndex: number): number;
  read(): SurfaceTableInteractionInput;
  session(): TreeDocxSessionView;
  applyTableCommandPlan(plan: TableCommandPlan): ExecResult;
  label(key: TableInteractionLabelKey): string;
}

export interface SurfaceTableInteraction {
  update(): void;
  /** Repaint visible insertion furniture labels from the current resolver. */
  refreshLabels(): void;
  /** Drop a border drag in progress: the surface is moving to another window. */
  cancelDrag(): void;
  destroy(): void;
}

interface DragState {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startEdgePt: number;
  readonly leftTwips: number;
  readonly rightTwips: number;
  readonly tableWidthTwips: number;
  /** Grid twips per laid-out twip: a stated table width can stretch or shrink the grid. */
  readonly gridScale: number;
  readonly rowHeightTwips: number;
  readonly target: Extract<
    TableInteractionHit,
    { kind: 'columnDivider' | 'rightEdge' | 'rowDivider' }
  >;
  readonly ref: TableOccurrenceRef;
  readonly resizeTarget:
    TableColumnDividerResizeTarget | TableRightEdgeResizeTarget | TableRowOccurrenceTarget;
  readonly captureElement: HTMLElement;
  readonly rightEdge: boolean;
  readonly vertical: boolean;
  cancelled: boolean;
}

interface LastPointerSheet {
  readonly x: number;
  readonly y: number;
  readonly pageIndex: number;
}

function gridWidthTwips(element: OoxmlElement): number {
  return readTwipsMeasure(wmlAttributeValue(element, 'w')) ?? 0;
}

function clientToSheet(
  host: SurfaceTableInteractionHost,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const rect = host.pagesLayer.getBoundingClientRect();
  const scale = host.scale();
  return {
    x: (clientX - rect.left) / scale,
    y: (clientY - rect.top) / scale,
  };
}

function plannerMode(input: SurfaceTableInteractionInput): { editable: boolean; viewing: boolean } {
  const viewing = input.editingMode === 'view';
  return { editable: !viewing, viewing };
}

function occurrenceRef(
  layout: SemanticLayout,
  hit: Extract<
    TableInteractionHit,
    { kind: 'columnDivider' | 'rightEdge' | 'rowDivider' | 'insertRow' | 'insertColumn' }
  >
): TableOccurrenceRef | null {
  if (hit.kind === 'insertColumn') {
    return findTableOccurrence(layout, hit.tableId, hit.rowId, hit.isHeaderRepeat);
  }
  if ('rowId' in hit) {
    return findTableOccurrence(layout, hit.tableId, hit.rowId, hit.isHeaderRepeat);
  }
  return null;
}

/** Grid twips per laid-out twip of a table whose painted columns match its grid. */
function gridScaleOf(
  columnEdges: readonly number[] | undefined,
  gridColumns: number,
  gridTwips: number
): number {
  if (!columnEdges || columnEdges.length !== gridColumns + 1 || !(gridTwips > 0)) return 1;
  const laidOutTwips = (columnEdges.at(-1)! - columnEdges[0]!) * PT_TO_TWIPS;
  return laidOutTwips > 0 ? gridTwips / laidOutTwips : 1;
}

/**
 * The least height a row drag commits. A row already shorter than the minimum, such as an
 * authored spacer row, keeps its height as the floor: dragging it up must not make it taller.
 */
function rowHeightFloor(startTwips: number): number {
  return Math.min(MIN_TABLE_ROW_HEIGHT_TWIPS, startTwips);
}

export function createSurfaceTableInteraction(
  host: SurfaceTableInteractionHost
): SurfaceTableInteraction {
  const layer = host.furnitureLayer;
  layer.className = 'docx-table-furniture';
  layer.setAttribute('contenteditable', 'false');
  layer.style.position = 'absolute';
  layer.style.left = '0';
  layer.style.top = '0';
  layer.style.pointerEvents = 'none';

  const timers = hostTimers(() => layer);
  let hideTimer: number | null = null;
  let hoverHit: TableInteractionHit | null = null;
  let index: TableInteractionIndex | null = null;
  let indexedLayoutRevision: number | null = null;
  let indexedStoreRevision: number | null = null;
  let drag: DragState | null = null;
  let overInsertControl = false;
  let lastMoveClientX = 0;
  let lastMoveClientY = 0;
  let lastPointerSheet: LastPointerSheet | null = null;
  let insertButton: HTMLButtonElement | null = null;
  let insertHit: TableInteractionHit | null = null;

  function isInsertButton(node: Node): node is HTMLButtonElement {
    return (
      isHTMLElementTag(node, 'button') &&
      (node.classList.contains('docx-table-insert-row') ||
        node.classList.contains('docx-table-insert-column'))
    );
  }

  function focusedInsertButton(): HTMLButtonElement | null {
    const active = layer.ownerDocument.activeElement;
    if (
      active !== null &&
      isInsertButton(active) &&
      active.closest('.docx-table-furniture') === layer
    ) {
      return active;
    }
    return null;
  }

  function removeExtraInsertButtons(keep: HTMLButtonElement | null): void {
    for (const child of [...layer.children]) {
      if (isInsertButton(child) && child !== keep) child.remove();
    }
  }

  function resetInsertState(): void {
    insertButton = null;
    insertHit = null;
  }

  function clearTimers(): void {
    if (hideTimer !== null) {
      timers.clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function clearFurniture(): void {
    for (const child of [...layer.children]) {
      if (!isInsertButton(child)) child.remove();
    }
    const focused = focusedInsertButton();
    if (!focused) {
      removeExtraInsertButtons(null);
      resetInsertState();
      return;
    }
    insertButton = focused;
    removeExtraInsertButtons(focused);
  }

  function clearAllFurniture(restorePagesFocus: boolean): void {
    const button = insertButton ?? focusedInsertButton();
    const wasFocused = button !== null && layer.ownerDocument.activeElement === button;
    resetInsertState();
    layer.replaceChildren();
    if (restorePagesFocus && wasFocused) host.pagesLayer.focus({ preventScroll: true });
  }

  function clearNonInsertFurniture(): void {
    for (const child of [...layer.children]) {
      if (!isInsertButton(child)) child.remove();
    }
  }

  /**
   * A story-local point to CSS pixels on the sheet.
   *
   * `origin` is the box the coordinates are relative to. It defaults to the page's content
   * box, which is right for the body and wrong for every other story: a header's fragments
   * are laid out from the header's own box, so drawing their chrome against the page origin
   * puts every handle down in the body.
   */
  function cssPoint(
    pageIndex: number,
    contentX: number,
    contentY: number,
    origin?: { readonly x: number; readonly y: number }
  ): { left: number; top: number } {
    const input = host.read();
    const page = input.layout.pages[pageIndex];
    if (!page) return { left: 0, top: 0 };
    const from = origin ?? page.contentBox;
    const scale = host.scale();
    const offsetX = host.pageOffsetX(pageIndex);
    return {
      left: (from.x + contentX + offsetX) * scale,
      top: (from.y + contentY) * scale,
    };
  }

  function paintPreview(
    edgePt: number,
    hit: Extract<TableInteractionHit, { kind: 'columnDivider' | 'rightEdge' | 'rowDivider' }>
  ): void {
    const input = host.read();
    const found = findTableOnPage(input.layout, hit.tableId, hit.pageIndex);
    if (!found) return;
    const { table, origin } = found;
    const preview = layer.ownerDocument.createElement('div');
    preview.className = 'docx-table-resize-preview';
    preview.style.position = 'absolute';
    preview.style.pointerEvents = 'none';
    const vertical = hit.kind !== 'rowDivider';
    const pos = cssPoint(
      hit.pageIndex,
      vertical ? table.box.x + edgePt : table.box.x,
      vertical ? table.box.y : table.box.y + edgePt,
      origin
    );
    preview.style.left = `${pos.left}px`;
    preview.style.top = `${pos.top}px`;
    preview.style.width = vertical ? '2px' : `${table.box.width * host.scale()}px`;
    preview.style.height = vertical ? `${table.box.height * host.scale()}px` : '2px';
    layer.append(preview);
  }

  function createInsertButtonShell(): HTMLButtonElement {
    const button = layer.ownerDocument.createElement('button');
    button.type = 'button';
    button.textContent = '+';
    button.style.position = 'absolute';
    button.style.pointerEvents = 'auto';
    return button;
  }

  function onInsertClick(event: Event): void {
    guardInsertPointer(event);
    const hit = insertHit;
    if (!hit) return;
    const input = host.read();
    if (hit.kind === 'insertRow') commitInsertRow(hit, input);
    else if (hit.kind === 'insertColumn') commitInsertColumn(hit, input);
  }

  function onInsertBlur(): void {
    queueMicrotask(() => {
      if (!insertButton || layer.ownerDocument.activeElement === insertButton) return;
      if (overInsertControl) return;
      if (hoverHit?.kind === 'insertRow' || hoverHit?.kind === 'insertColumn') return;
      insertButton.remove();
      resetInsertState();
    });
  }

  function ensureInsertButton(): HTMLButtonElement {
    if (insertButton && layer.contains(insertButton)) return insertButton;
    const focused = focusedInsertButton();
    if (focused) {
      insertButton = focused;
      return focused;
    }
    const button = createInsertButtonShell();
    button.addEventListener('pointerenter', () => {
      overInsertControl = true;
      clearTimers();
    });
    button.addEventListener('pointerleave', () => {
      overInsertControl = false;
    });
    button.addEventListener('pointerdown', guardInsertPointer);
    button.addEventListener('mousedown', guardInsertPointer);
    button.addEventListener('click', onInsertClick);
    button.addEventListener('blur', onInsertBlur);
    insertButton = button;
    return button;
  }

  function paintInsertControl(
    hit: Extract<TableInteractionHit, { kind: 'insertRow' | 'insertColumn' }>,
    input: SurfaceTableInteractionInput
  ): void {
    const found = findTableOnPage(input.layout, hit.tableId, hit.pageIndex);
    if (!found) return;
    const { table, origin } = found;
    const button = ensureInsertButton();
    removeExtraInsertButtons(button);
    insertHit = hit;
    button.dataset.tableId = hit.tableId;

    if (hit.kind === 'insertRow') {
      const row = table.rows.find((candidate) => candidate.id === hit.rowId);
      if (!row) return;
      button.dataset.rowId = hit.rowId;
      delete button.dataset.gridColumnId;
      button.className = 'docx-table-insert-row';
      button.setAttribute('aria-label', host.label('table.insertRowBelow'));
      const rowMidY = row.box.y + row.box.height / 2;
      const pos = cssPoint(hit.pageIndex, table.box.x - 14, rowMidY, origin);
      button.style.left = `${pos.left}px`;
      button.style.top = `${pos.top - 8}px`;
    } else {
      const cell = table.rows[0]?.cells.find(
        (candidate) => candidate.gridColumnId === hit.gridColumnId
      );
      if (!cell) return;
      button.dataset.gridColumnId = hit.gridColumnId;
      delete button.dataset.rowId;
      const left = table.columnEdges[cell.gridColumn] ?? 0;
      const right = table.columnEdges[cell.gridColumn + 1] ?? table.box.width;
      button.className = 'docx-table-insert-column';
      button.setAttribute('aria-label', host.label('table.insertColumnRight'));
      const pos = cssPoint(
        hit.pageIndex,
        table.box.x + (left + right) / 2 - 8,
        table.box.y - 14,
        origin
      );
      button.style.left = `${pos.left}px`;
      button.style.top = `${pos.top}px`;
    }
    if (!layer.contains(button)) layer.append(button);
  }

  function guardInsertPointer(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  function paintHover(hit: TableInteractionHit, input: SurfaceTableInteractionInput): void {
    clearNonInsertFurniture();
    removeExtraInsertButtons(insertButton ?? focusedInsertButton());
    if (drag || input.editingMode === 'view') return;

    if ((hit.kind === 'columnDivider' || hit.kind === 'rightEdge') && !hit.isHeaderRepeat) {
      const found = findTableOnPage(input.layout, hit.tableId, hit.pageIndex);
      if (!found) return;
      const { table, origin } = found;
      const handle = layer.ownerDocument.createElement('div');
      handle.className =
        hit.kind === 'rightEdge'
          ? 'docx-table-edge-handle-right layout-table-edge-handle-right'
          : 'docx-table-divider-handle layout-table-resize-handle';
      handle.style.position = 'absolute';
      handle.style.pointerEvents = 'auto';
      handle.style.cursor = 'col-resize';
      handle.dataset.active = 'true';
      const pos = cssPoint(hit.pageIndex, table.box.x + hit.edgeX, table.box.y, origin);
      handle.style.left = `${pos.left - 3}px`;
      handle.style.top = `${pos.top}px`;
      handle.style.width = '6px';
      handle.style.height = `${table.box.height * host.scale()}px`;
      handle.addEventListener('pointerdown', onDividerPointerDown);
      layer.append(handle);
    }

    if (hit.kind === 'rowDivider' && !hit.isHeaderRepeat) {
      const found = findTableOnPage(input.layout, hit.tableId, hit.pageIndex);
      if (!found) return;
      const { table, origin } = found;
      const handle = layer.ownerDocument.createElement('div');
      handle.className = 'docx-table-row-divider-handle layout-table-row-resize-handle';
      handle.style.position = 'absolute';
      handle.style.pointerEvents = 'auto';
      handle.style.cursor = 'row-resize';
      handle.dataset.active = 'true';
      const pos = cssPoint(hit.pageIndex, table.box.x, table.box.y + hit.edgeY, origin);
      handle.style.left = `${pos.left}px`;
      handle.style.top = `${pos.top - 3}px`;
      handle.style.width = `${table.box.width * host.scale()}px`;
      handle.style.height = '6px';
      handle.addEventListener('pointerdown', onDividerPointerDown);
      layer.append(handle);
    }

    if (hit.kind === 'insertRow' && !hit.isHeaderRepeat) {
      paintInsertControl(hit, input);
    }

    if (hit.kind === 'insertColumn' && !hit.isHeaderRepeat) {
      paintInsertControl(hit, input);
    }
  }

  function commitInsertRow(
    hit: Extract<TableInteractionHit, { kind: 'insertRow' }>,
    input: SurfaceTableInteractionInput
  ): void {
    const ref = occurrenceRef(input.layout, hit);
    if (!ref) return;
    const mode = plannerMode(input);
    const plan = planTableCommand({
      command: {
        type: 'insertRow',
        where: 'below',
        target: tableRowOccurrenceTargetFrom(hit.sourceRevision, ref),
      },
      part: partOfTableIn(host.session(), hit.tableId),
      layout: input.layout,
      storeRevision: input.storeRevision,
      selection: input.selection,
      cellSelection: input.cellSelection,
      themeColors: input.themeColors,
      ...mode,
    });
    host.applyTableCommandPlan(plan);
  }

  function commitInsertColumn(
    hit: Extract<TableInteractionHit, { kind: 'insertColumn' }>,
    input: SurfaceTableInteractionInput
  ): void {
    const ref = occurrenceRef(input.layout, hit);
    if (!ref) return;
    const cell = ref.row.cells.find((candidate) => candidate.gridColumnId === hit.gridColumnId);
    if (!cell) return;
    const target = tableColumnOccurrenceTargetFrom(hit.sourceRevision, ref, cell);
    if (!target) return;
    const mode = plannerMode(input);
    const plan = planTableCommand({
      command: { type: 'insertColumn', where: 'right', target },
      part: partOfTableIn(host.session(), hit.tableId),
      layout: input.layout,
      storeRevision: input.storeRevision,
      selection: input.selection,
      cellSelection: input.cellSelection,
      themeColors: input.themeColors,
      ...mode,
    });
    host.applyTableCommandPlan(plan);
  }

  function onDividerPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const input = host.read();
    if (input.editingMode === 'view') return;
    if (
      !hoverHit ||
      (hoverHit.kind !== 'columnDivider' &&
        hoverHit.kind !== 'rightEdge' &&
        hoverHit.kind !== 'rowDivider')
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const target = hoverHit;
    const ref = occurrenceRef(input.layout, target);
    if (!ref) return;
    const topo = readEditableTableTopology(
      partOfTableIn(host.session(), target.tableId).root,
      target.tableId
    );
    if (
      !topo.ok ||
      (target.kind !== 'rowDivider' && validateTableResizeGrid(topo.topology) !== null)
    )
      return;

    let leftTwips = 0;
    let rightTwips = 0;
    let rowHeightTwips = 0;
    const tableWidthTwips = topo.topology.gridColumns.reduce(
      (sum, col) => sum + gridWidthTwips(col),
      0
    );

    let resizeTarget:
      TableColumnDividerResizeTarget | TableRightEdgeResizeTarget | TableRowOccurrenceTarget;
    if (target.kind === 'columnDivider') {
      const leftCol = topo.topology.gridColumns.find((col) => col.id === target.leftGridColumnId);
      const rightCol = topo.topology.gridColumns.find((col) => col.id === target.rightGridColumnId);
      if (!leftCol || !rightCol) return;
      leftTwips = gridWidthTwips(leftCol);
      rightTwips = gridWidthTwips(rightCol);
      resizeTarget = tableColumnDividerResizeTargetFrom(
        target.sourceRevision,
        ref,
        target.leftGridColumnId,
        target.rightGridColumnId
      );
    } else if (target.kind === 'rightEdge') {
      const lastCol = topo.topology.gridColumns.find((col) => col.id === target.gridColumnId);
      if (!lastCol) return;
      leftTwips = gridWidthTwips(lastCol);
      rightTwips = 0;
      resizeTarget = tableRightEdgeResizeTargetFrom(
        target.sourceRevision,
        ref,
        target.gridColumnId
      );
    } else {
      rowHeightTwips = Math.max(20, Math.round(ref.row.box.height * PT_TO_TWIPS));
      resizeTarget = tableRowOccurrenceTargetFrom(target.sourceRevision, ref);
    }

    const captureElement = event.currentTarget as HTMLElement;
    captureElement.setPointerCapture(event.pointerId);
    lastMoveClientX = event.clientX;
    lastMoveClientY = event.clientY;

    drag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startEdgePt: target.kind === 'rowDivider' ? target.edgeY : target.edgeX,
      leftTwips,
      rightTwips,
      tableWidthTwips,
      gridScale: gridScaleOf(
        ref?.table.columnEdges,
        topo.topology.gridColumns.length,
        tableWidthTwips
      ),
      rowHeightTwips,
      target,
      ref,
      resizeTarget,
      captureElement,
      rightEdge: target.kind === 'rightEdge',
      vertical: target.kind === 'rowDivider',
      cancelled: false,
    };
    for (const child of [...layer.children]) {
      if (child !== captureElement) child.remove();
    }
    paintPreview(target.kind === 'rowDivider' ? target.edgeY : target.edgeX, target);
  }

  function cancelDrag(): void {
    if (!drag) return;
    try {
      if (drag.captureElement.hasPointerCapture(drag.pointerId)) {
        drag.captureElement.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // ignore release failures in test hosts
    }
    drag.cancelled = true;
    drag = null;
    clearFurniture();
    hoverHit = null;
  }

  function commitDrag(): void {
    if (!drag || drag.cancelled) {
      drag = null;
      clearFurniture();
      return;
    }
    const activeDrag = drag;
    drag = null;
    try {
      if (activeDrag.captureElement.hasPointerCapture(activeDrag.pointerId)) {
        activeDrag.captureElement.releasePointerCapture(activeDrag.pointerId);
      }
    } catch {
      // ignore release failures in test hosts
    }

    if (
      activeDrag.vertical
        ? lastMoveClientY === activeDrag.startClientY
        : lastMoveClientX === activeDrag.startClientX
    ) {
      clearFurniture();
      return;
    }

    const input = host.read();
    const mode = plannerMode(input);
    const movePt =
      (activeDrag.vertical
        ? lastMoveClientY - activeDrag.startClientY
        : lastMoveClientX - activeDrag.startClientX) / host.scale();
    const moveTwips = Math.round(movePt * PT_TO_TWIPS);

    let plan: TableCommandPlan;
    if (activeDrag.target.kind === 'rowDivider') {
      plan = planTableRowHeightResize(
        {
          part: partOfTableIn(host.session(), activeDrag.target.tableId),
          layout: input.layout,
          storeRevision: input.storeRevision,
          selection: input.selection,
          cellSelection: input.cellSelection,
          themeColors: input.themeColors,
          ...mode,
        },
        activeDrag.resizeTarget as TableRowOccurrenceTarget,
        Math.max(rowHeightFloor(activeDrag.rowHeightTwips), activeDrag.rowHeightTwips + moveTwips)
      );
    } else if (activeDrag.rightEdge && activeDrag.target.kind === 'rightEdge') {
      const columnWidthTwips = Math.max(
        MIN_TABLE_COLUMN_WIDTH_TWIPS,
        activeDrag.leftTwips + moveTwips
      );
      const tableWidthTwips = Math.max(columnWidthTwips, activeDrag.tableWidthTwips + moveTwips);
      plan = planTableCommand({
        command: {
          type: 'commitTableRightEdgeResize',
          target: activeDrag.resizeTarget as TableRightEdgeResizeTarget,
          columnWidthTwips,
          tableWidthTwips,
        },
        part: partOfTableIn(host.session(), activeDrag.target.tableId),
        layout: input.layout,
        storeRevision: input.storeRevision,
        selection: input.selection,
        cellSelection: input.cellSelection,
        themeColors: input.themeColors,
        ...mode,
      });
    } else if (activeDrag.target.kind === 'columnDivider') {
      const gridMove = Math.round(moveTwips * activeDrag.gridScale);
      let leftTwips = activeDrag.leftTwips + gridMove;
      let rightTwips = activeDrag.rightTwips - gridMove;
      leftTwips = Math.max(MIN_TABLE_COLUMN_WIDTH_TWIPS, leftTwips);
      rightTwips = Math.max(MIN_TABLE_COLUMN_WIDTH_TWIPS, rightTwips);
      const sum = activeDrag.leftTwips + activeDrag.rightTwips;
      if (leftTwips + rightTwips !== sum) {
        if (leftTwips > sum - MIN_TABLE_COLUMN_WIDTH_TWIPS) {
          leftTwips = sum - MIN_TABLE_COLUMN_WIDTH_TWIPS;
          rightTwips = MIN_TABLE_COLUMN_WIDTH_TWIPS;
        } else {
          rightTwips = sum - leftTwips;
        }
      }
      plan = planTableCommand({
        command: {
          type: 'commitTableColumnDividerResize',
          target: activeDrag.resizeTarget as TableColumnDividerResizeTarget,
          leftWidthTwips: leftTwips,
          rightWidthTwips: rightTwips,
        },
        part: partOfTableIn(host.session(), activeDrag.target.tableId),
        layout: input.layout,
        storeRevision: input.storeRevision,
        selection: input.selection,
        cellSelection: input.cellSelection,
        themeColors: input.themeColors,
        ...mode,
      });
    } else {
      clearFurniture();
      return;
    }

    host.applyTableCommandPlan(plan);
    clearFurniture();
  }

  function hitAtLastPointer(input: SurfaceTableInteractionInput): TableInteractionHit | null {
    if (!lastPointerSheet) return null;
    index ??= tableInteractionIndex(input.layout);
    const pageOffsetX = host.pageOffsetX(lastPointerSheet.pageIndex);
    return findTableInteractionAt(
      index,
      lastPointerSheet.x,
      lastPointerSheet.y,
      input.layout,
      pageOffsetX,
      lastPointerSheet.pageIndex
    );
  }

  function refreshHoverAfterRelayout(input: SurfaceTableInteractionInput): void {
    if (!hoverHit || drag || input.editingMode === 'view') return;
    clearTimers();
    const hit = hitAtLastPointer(input);
    const offered = offeredHit(host.session(), hit, input.selection.head.paragraphId);
    if (!offered) {
      hoverHit = null;
      clearFurniture();
      return;
    }
    if (tableInteractionTargetIdentity(offered) !== tableInteractionTargetIdentity(hoverHit)) {
      hoverHit = null;
      clearFurniture();
      return;
    }
    hoverHit = offered;
    paintHover(offered, input);
  }

  function retireRetainedInsertButton(): void {
    const button = insertButton ?? focusedInsertButton();
    const wasFocused = button !== null && layer.ownerDocument.activeElement === button;
    resetInsertState();
    if (button && layer.contains(button)) button.remove();
    if (wasFocused) host.pagesLayer.focus({ preventScroll: true });
  }

  function refreshRetainedInsertAfterRelayout(input: SurfaceTableInteractionInput): void {
    if (drag || input.editingMode === 'view') return;
    const retained = insertButton ?? focusedInsertButton();
    if (!retained || !layer.contains(retained)) {
      if (insertHit) resetInsertState();
      return;
    }
    insertButton = retained;
    if (!insertHit || (insertHit.kind !== 'insertRow' && insertHit.kind !== 'insertColumn')) return;
    index ??= tableInteractionIndex(input.layout);

    const priorTarget = tableInteractionTargetIdentity(insertHit);
    const resolved = resolveTableInteractionInsertHit(index, insertHit);
    if (!resolved || tableInteractionTargetIdentity(resolved) !== priorTarget) {
      retireRetainedInsertButton();
      return;
    }
    insertHit = resolved;
    paintInsertControl(resolved, input);
  }

  function onPointerMove(event: PointerEvent): void {
    const input = host.read();
    if (drag && event.pointerId === drag.pointerId) {
      lastMoveClientX = event.clientX;
      lastMoveClientY = event.clientY;
      let deltaPt =
        (drag.vertical ? event.clientY - drag.startClientY : event.clientX - drag.startClientX) /
        host.scale();
      // The preview stops where the commit does: a row keeps its minimum height.
      if (drag.target.kind === 'rowDivider')
        deltaPt = Math.max(
          deltaPt,
          (rowHeightFloor(drag.rowHeightTwips) - drag.rowHeightTwips) / 20
        );
      for (const child of [...layer.children]) {
        if (child !== drag.captureElement) child.remove();
      }
      paintPreview(drag.startEdgePt + deltaPt, drag.target);
      return;
    }
    if (input.editingMode === 'view') {
      clearAllFurniture(false);
      return;
    }
    // The insert control can overlap another table's hit region. Keep its target
    // stable while the pointer moves onto it, so it survives through the click.
    if (isDomNode(event.target) && insertButton?.contains(event.target)) {
      clearTimers();
      return;
    }
    const sheet = clientToSheet(host, event.clientX, event.clientY);
    const pageIndex = pageAtY(input.layout, sheet.y);
    if (pageIndex >= 0) {
      lastPointerSheet = { x: sheet.x, y: sheet.y, pageIndex };
    }
    const pageOffsetX = pageIndex >= 0 ? host.pageOffsetX(pageIndex) : 0;
    index ??= tableInteractionIndex(input.layout);
    const hit = index
      ? findTableInteractionAt(
          index,
          sheet.x,
          sheet.y,
          input.layout,
          pageOffsetX,
          pageIndex >= 0 ? pageIndex : undefined
        )
      : null;
    const offered = offeredHit(host.session(), hit, input.selection.head.paragraphId);
    if (!offered) {
      if (overInsertControl) return;
      timers.migrate();
      if (!hideTimer && hoverHit) {
        hideTimer = timers.setTimeout(() => {
          hideTimer = null;
          hoverHit = null;
          clearFurniture();
        }, HOVER_HIDE_MS);
      }
      return;
    }
    if (hideTimer) {
      timers.clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (
      hoverHit &&
      tableInteractionHitIdentity(offered) === tableInteractionHitIdentity(hoverHit)
    ) {
      return;
    }
    hoverHit = offered;
    paintHover(offered, input);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (host.read().editingMode === 'view') {
      cancelDrag();
      return;
    }
    commitDrag();
  }

  function onPointerCancel(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    cancelDrag();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !drag) return;
    cancelDrag();
  }

  host.pagesLayer.addEventListener('pointermove', onPointerMove);
  const unlisten = [
    host.listeners.onDocument('pointermove', onPointerMove),
    host.listeners.onDocument('pointerup', onPointerUp),
    host.listeners.onDocument('pointercancel', onPointerCancel),
  ];
  host.pagesLayer.addEventListener('keydown', onKeyDown);

  return {
    update() {
      const input = host.read();
      const previousLayoutRevision = indexedLayoutRevision;
      const previousStoreRevision = indexedStoreRevision;
      index = null;
      indexedLayoutRevision = input.layout.revision;
      indexedStoreRevision = input.storeRevision;
      if (input.editingMode === 'view') {
        cancelDrag();
        hoverHit = null;
        clearTimers();
        clearAllFurniture(true);
      } else if (
        previousLayoutRevision !== null &&
        (previousLayoutRevision !== input.layout.revision ||
          previousStoreRevision !== input.storeRevision)
      ) {
        if (hoverHit !== null) {
          refreshHoverAfterRelayout(input);
        }
        refreshRetainedInsertAfterRelayout(input);
      }
      layer.style.width = host.pagesLayer.style.width;
      layer.style.height = host.pagesLayer.style.height;
    },
    cancelDrag,
    refreshLabels() {
      const input = host.read();
      if (input.editingMode === 'view') return;
      const retained = insertButton ?? focusedInsertButton();
      if (
        retained &&
        layer.contains(retained) &&
        insertHit &&
        (insertHit.kind === 'insertRow' || insertHit.kind === 'insertColumn')
      ) {
        paintInsertControl(insertHit, input);
        return;
      }
      if (hoverHit && (hoverHit.kind === 'insertRow' || hoverHit.kind === 'insertColumn')) {
        paintInsertControl(hoverHit, input);
      }
    },
    destroy() {
      clearTimers();
      cancelDrag();
      resetInsertState();
      clearFurniture();
      host.pagesLayer.removeEventListener('pointermove', onPointerMove);
      for (const remove of unlisten) remove();
      host.pagesLayer.removeEventListener('keydown', onKeyDown);
      layer.remove();
    },
  };
}
