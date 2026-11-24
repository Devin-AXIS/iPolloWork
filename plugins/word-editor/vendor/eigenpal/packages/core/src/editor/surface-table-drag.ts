// Dragging a table by its select handle to a slot between its sibling blocks.

import type { ExecResult } from '../contracts/editor.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { HostTimers } from './host-realm.ts';
import { createDragAutoScroll } from './surface-drag-autoscroll.ts';
import type { SurfaceHostListeners } from './surface-host-listeners.ts';
import {
  nearestTableDropSlot,
  tableDropSlots,
  type TableDropSlot,
} from './surface-table-drop-slots.ts';
import type { TableCommandPlan } from './table-command-plan.ts';

/** Below this, a press on the handle is a click that selects the table. */
const DRAG_THRESHOLD_PX = 4;

export interface TableDragHost {
  readonly pagesLayer: HTMLElement;
  readonly layer: HTMLElement;
  readonly listeners: SurfaceHostListeners;
  readonly frames: Pick<HostTimers, 'requestAnimationFrame' | 'cancelAnimationFrame'>;
  scale(): number;
  pageOffsetX(pageIndex: number): number;
  layout(): SemanticLayout;
  partOf(tableId: string): OoxmlPart;
  applyTableCommandPlan(plan: TableCommandPlan): ExecResult;
}

/** `refuse` lets the gesture run to the write path, which records why it cannot move. */
export type TableDragMode = 'move' | 'refuse';

export interface TableDrag {
  /** Arm a drag from a press on the handle; it starts once the pointer travels. */
  press(event: PointerEvent, tableId: string, handle: HTMLElement, mode: TableDragMode): void;
  dragging(): boolean;
  cancel(): void;
  destroy(): void;
}

interface Press {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly tableId: string;
  readonly handle: HTMLElement;
  readonly mode: TableDragMode;
  lastX: number;
  lastY: number;
  slots: readonly TableDropSlot[] | null;
  slot: TableDropSlot | null;
}

export function moveTablePlan(tableId: string, beforeBlockId: string): TableCommandPlan {
  return {
    ok: true,
    ops: [{ op: 'moveTable', tableId, beforeBlockId }],
    selection: { kind: 'preserveSelection' },
  };
}

export function createTableDrag(host: TableDragHost): TableDrag {
  let press: Press | null = null;
  let unlistenKey: (() => void) | null = null;
  const indicator = host.layer.ownerDocument.createElement('div');
  indicator.className = 'docx-table-drop-indicator';
  indicator.style.position = 'absolute';
  indicator.style.pointerEvents = 'none';
  const autoScroll = createDragAutoScroll({
    scroller: () => host.pagesLayer.closest('.docx-editor__scroll-container'),
    frames: host.frames,
    onScroll: () => track(),
  });

  function track(): void {
    if (!press?.slots) return;
    const rect = host.pagesLayer.getBoundingClientRect();
    const scale = host.scale();
    press.slot = nearestTableDropSlot(
      press.slots,
      (press.lastX - rect.left) / scale,
      (press.lastY - rect.top) / scale,
      host.pageOffsetX
    );
    const slot = press.slot;
    if (!slot || slot.stays) {
      indicator.remove();
      return;
    }
    const left = slot.origin.x + slot.x + host.pageOffsetX(slot.pageIndex);
    indicator.style.left = `${left * scale}px`;
    indicator.style.top = `${(slot.origin.y + slot.y) * scale - 1}px`;
    indicator.style.width = `${slot.width * scale}px`;
    if (indicator.parentNode !== host.layer) host.layer.append(indicator);
  }

  function onMove(event: PointerEvent): void {
    if (!press || event.pointerId !== press.pointerId) return;
    press.lastX = event.clientX;
    press.lastY = event.clientY;
    if (!press.slots) {
      const travelled = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
      if (travelled < DRAG_THRESHOLD_PX) return;
      press.slots =
        press.mode === 'move'
          ? tableDropSlots(host.layout(), host.partOf(press.tableId), press.tableId)
          : [];
      press.handle.dataset.dragging = 'true';
    }
    track();
    autoScroll.follow(event.clientY);
  }

  function onUp(event: PointerEvent): void {
    if (!press || event.pointerId !== press.pointerId) return;
    const { tableId, slot, slots, mode } = press;
    finish();
    if (slot && !slot.stays) host.applyTableCommandPlan(moveTablePlan(tableId, slot.beforeBlockId));
    else if (mode === 'refuse' && slots)
      host.applyTableCommandPlan(moveTablePlan(tableId, tableId));
  }

  function onCancel(event: PointerEvent): void {
    if (press && event.pointerId === press.pointerId) finish();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !press?.slots) return;
    event.preventDefault();
    finish();
  }

  function finish(): void {
    autoScroll.stop();
    indicator.remove();
    unlistenKey?.();
    unlistenKey = null;
    if (!press) return;
    const { handle, pointerId } = press;
    delete handle.dataset.dragging;
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onCancel);
    press = null;
  }

  return {
    press(event, tableId, handle, mode) {
      if (event.button !== 0) return;
      finish();
      press = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        tableId,
        handle,
        mode,
        lastX: event.clientX,
        lastY: event.clientY,
        slots: null,
        slot: null,
      };
      handle.setPointerCapture?.(event.pointerId);
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onCancel);
      unlistenKey = host.listeners.onDocument('keydown', onKey);
    },
    dragging: () => (press?.slots ?? null) !== null,
    cancel: finish,
    destroy: finish,
  };
}
