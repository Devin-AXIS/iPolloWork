// The handle at a table's top-left corner that selects the whole table.
//
// Its own sheet, not the table furniture's: that layer is cleared on every hover change, and
// this handle has to outlive those while the caret is in the table.

import type { SemanticLayout, SemanticSelection } from '@docx-editor.dev/core/layout';
import type { TableInteractionLabelKey } from '@docx-editor.dev/core/contracts/editor';
import { caretAt } from '../layout/semantic-interaction.ts';
import {
  tableContextAt,
  wholeTableCellSelection,
  type CellSelection,
} from '../layout/semantic-cell-selection.ts';
import { pageAtY } from '../layout/semantic-hit-test.ts';
import type {
  BlockFragmentRecord,
  LayoutBox,
  TableFragmentRecord,
} from '../layout/semantic-records.ts';
import {
  findTableInteractionAt,
  tableInteractionIndex,
} from '../layout/semantic-table-interaction.ts';
import type { ExecResult } from '../contracts/editor.ts';
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { SurfaceEditingMode } from './paginated-surface-contract.ts';
import { hostTimers } from './host-realm.ts';
import type { SurfaceHostListeners } from './surface-host-listeners.ts';
import { createTableDrag } from './surface-table-drag.ts';
import { tableChromeIconPaths } from './table-chrome.ts';
import { partOfTableIn } from './surface-table-story.ts';
import { sameStoryPart } from './surface-scope.ts';
import type { TableCommandPlan } from './table-command-plan.ts';

const HOVER_HIDE_MS = 120;
/** CSS pixels, not points, so the gap to the table stays the same at every zoom. */
const HANDLE_SIZE_PX = 16;
const HANDLE_GAP_PX = 2;

export interface SurfaceTableSelectHandleHost {
  readonly pagesLayer: HTMLElement;
  readonly layer: HTMLElement;
  readonly listeners: SurfaceHostListeners;
  scale(): number;
  pageOffsetX(pageIndex: number): number;
  read(): {
    readonly layout: SemanticLayout;
    readonly selection: SemanticSelection;
    readonly editingMode: SurfaceEditingMode;
  };
  label(key: TableInteractionLabelKey): string;
  setCellSelection(cells: CellSelection): void;
  session(): TreeDocxSessionView;
  applyTableCommandPlan(plan: TableCommandPlan): ExecResult;
}

export interface SurfaceTableSelectHandle {
  update(): void;
  destroy(): void;
}

interface Target {
  readonly tableId: string;
  readonly pageIndex: number;
}

interface OutermostTable {
  readonly table: TableFragmentRecord;
  readonly origin: LayoutBox;
}

function containsTable(block: TableFragmentRecord, tableId: string): boolean {
  if (block.tableId === tableId) return true;
  return block.rows.some((row) =>
    row.cells.some((cell) =>
      cell.blocks.some((child) => child.kind === 'table' && containsTable(child, tableId))
    )
  );
}

/** The top-level table on a page that holds `tableId`, itself or nested, with its story's origin. */
function outermostTableOnPage(
  layout: SemanticLayout,
  tableId: string,
  pageIndex: number
): OutermostTable | null {
  const page = layout.pages[pageIndex];
  if (!page) return null;
  const find = (blocks: readonly BlockFragmentRecord[]): TableFragmentRecord | null =>
    blocks.find(
      (block): block is TableFragmentRecord =>
        block.kind === 'table' && containsTable(block, tableId)
    ) ?? null;
  const inBody = find(page.fragments);
  if (inBody) return { table: inBody, origin: page.contentBox };
  for (const story of [page.header, page.footer]) {
    const found = story ? find(story.fragments) : null;
    if (found && story) return { table: found, origin: story.box };
  }
  return null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function moveIcon(document: Document): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 -960 960 960');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const data of tableChromeIconPaths('open_with')) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', data);
    svg.append(path);
  }
  return svg;
}

export function createSurfaceTableSelectHandle(
  host: SurfaceTableSelectHandleHost
): SurfaceTableSelectHandle {
  const { layer } = host;
  const timers = hostTimers(() => layer);
  let hovered: Target | null = null;
  let hideTimer: number | null = null;
  let shownTableId: string | null = null;
  // Positioned tables move by their anchor properties, which the editor does not edit yet.
  let shownFloating = false;
  const drag = createTableDrag({
    pagesLayer: host.pagesLayer,
    layer,
    listeners: host.listeners,
    frames: timers,
    scale: () => host.scale(),
    pageOffsetX: (pageIndex) => host.pageOffsetX(pageIndex),
    layout: () => host.read().layout,
    partOf: (tableId) => partOfTableIn(host.session(), tableId),
    applyTableCommandPlan: (plan) => host.applyTableCommandPlan(plan),
  });

  const button = layer.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = 'docx-table-select-handle';
  button.append(moveIcon(layer.ownerDocument));
  button.style.position = 'absolute';
  button.style.pointerEvents = 'auto';
  const guard = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  button.addEventListener('pointerdown', (event) => {
    guard(event);
    const mode = host.read().editingMode;
    if (!shownTableId || shownFloating || mode === 'view') return;
    clearHideTimer();
    drag.press(event, shownTableId, button, mode === 'suggest' ? 'refuse' : 'move');
  });
  button.addEventListener('mousedown', guard);
  button.addEventListener('click', (event) => {
    guard(event);
    const cells = shownTableId ? wholeTableCellSelection(host.read().layout, shownTableId) : null;
    if (!cells) return;
    host.setCellSelection(cells);
    host.pagesLayer.focus({ preventScroll: true });
  });
  button.addEventListener('pointerenter', () => clearHideTimer());

  function clearHideTimer(): void {
    if (hideTimer === null) return;
    timers.clearTimeout(hideTimer);
    hideTimer = null;
  }

  function caretTarget(layout: SemanticLayout, selection: SemanticSelection): Target | null {
    const tableId = tableContextAt(layout, selection.head.paragraphId)?.tableId;
    const pageIndex =
      tableId === undefined ? undefined : caretAt(layout, selection.head)?.pageIndex;
    return tableId === undefined || pageIndex === undefined ? null : { tableId, pageIndex };
  }

  function update(): void {
    const { layout, selection, editingMode } = host.read();
    const caretParagraphId = selection.head.paragraphId;
    // A hover names a table on a page. After an edit moves that table (a drag to another
    // page, a page break above it, a collaborator's edit), the hover names nothing; the
    // caret's table then decides.
    const hoveredFound = hovered
      ? outermostTableOnPage(layout, hovered.tableId, hovered.pageIndex)
      : null;
    if (hovered && !hoveredFound) {
      hovered = null;
      clearHideTimer();
    }
    const useHover =
      editingMode !== 'view' &&
      hovered !== null &&
      hoveredFound !== null &&
      sameStoryPart(host.session(), hovered.tableId, caretParagraphId);
    const target =
      editingMode === 'view' ? null : useHover ? hovered : caretTarget(layout, selection);
    const found = !target
      ? null
      : useHover
        ? hoveredFound
        : outermostTableOnPage(layout, target.tableId, target.pageIndex);
    if (!target || !found) {
      shownTableId = null;
      // A drag that lost its handle cannot end with a drop; end it where it stands.
      if (drag.dragging()) drag.cancel();
      button.remove();
      return;
    }
    const { table, origin } = found;
    const scale = host.scale();
    const offsetX = host.pageOffsetX(target.pageIndex);
    shownTableId = table.tableId;
    shownFloating = table.floatingWrap !== undefined;
    button.dataset.tableId = table.tableId;
    button.dataset.draggable = String(!shownFloating && editingMode === 'edit');
    button.setAttribute('aria-label', host.label('table.selectTable'));
    button.title = host.label('table.selectTable');
    const inset = HANDLE_SIZE_PX + HANDLE_GAP_PX;
    button.style.left = `${(origin.x + table.box.x + offsetX) * scale - inset}px`;
    button.style.top = `${(origin.y + table.box.y) * scale - inset}px`;
    if (button.parentNode !== layer) layer.append(button);
  }

  function onPointerMove(event: PointerEvent): void {
    // Read from the event, not from enter/leave state: a button moved or removed under a
    // still pointer gets no `pointerleave`.
    const over = button.contains(event.target as Node | null);
    if (over || drag.dragging()) return;
    const { layout } = host.read();
    const rect = host.pagesLayer.getBoundingClientRect();
    const scale = host.scale();
    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;
    const pageIndex = pageAtY(layout, y);
    const hit =
      pageIndex >= 0
        ? findTableInteractionAt(
            tableInteractionIndex(layout),
            x,
            y,
            layout,
            host.pageOffsetX(pageIndex),
            pageIndex
          )
        : null;
    if (hit) {
      clearHideTimer();
      if (hovered?.tableId === hit.tableId && hovered.pageIndex === hit.pageIndex) return;
      hovered = { tableId: hit.tableId, pageIndex: hit.pageIndex };
      update();
      return;
    }
    if (!hovered || hideTimer !== null) return;
    timers.migrate();
    hideTimer = timers.setTimeout(() => {
      hideTimer = null;
      hovered = null;
      update();
    }, HOVER_HIDE_MS);
  }

  const unlisten = host.listeners.onDocument('pointermove', onPointerMove);

  return {
    update,
    destroy() {
      clearHideTimer();
      drag.destroy();
      unlisten();
      layer.remove();
    },
  };
}
