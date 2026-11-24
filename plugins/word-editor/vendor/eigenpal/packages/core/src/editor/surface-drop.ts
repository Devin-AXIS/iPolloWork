import { createDropAutoScroll } from './surface-drop-autoscroll.ts';
import { createDropFeedback } from './surface-drop-feedback.ts';
import { isBottomToTopCaret } from '../layout/table-cell-text-direction.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { PaginatedSurfaceOptions } from './paginated-surface-options.ts';
import type { SemanticSelection, CaretGeometry } from '../layout/semantic-interaction.ts';
import { clipboardDropLandsText } from './clipboard-file-lane.ts';
import type { SurfacePointHit } from './surface-pointer.ts';
import type { SurfaceHostListeners } from './surface-host-listeners.ts';
import { plainTextFromTransfer } from './clipboard-plain-text.ts';
import { hostTimers, isDomNode } from './host-realm.ts';

const handledDrops = new WeakSet<Event>();

/**
 * Whether the engine or a custom drop handler consumed this native drop event.
 * Adapter image handlers check this before their default file insertion.
 * @public
 */
export function editorDropHandled(event: Event): boolean {
  return handledDrops.has(event);
}

/** A transient preview: never changes selection, history, or collaboration state. */
export function createSurfaceDrop(host: {
  readonly pagesLayer: HTMLElement;
  readonly layer: HTMLElement;
  readonly listeners: SurfaceHostListeners;
  scale(): number;
  writable(): boolean;
  version(): string;
  pointAt(x: number, y: number): SurfacePointHit | null;
  notify(kind: 'dragOver' | 'drop', event: DragEvent, point: SurfacePointHit): void;
  insertText(text: string, point: SurfacePointHit): void;
  translate?: (key: string) => string | undefined;
}) {
  const { pagesLayer, layer } = host;
  const timers = hostTimers(() => pagesLayer);
  let point: SurfacePointHit | null = null;
  let drag: { x: number; y: number; version: string; allowed: boolean; types: string } | null =
    null;
  const scroller = () => pagesLayer.closest<HTMLElement>('.docx-editor__scroll-container');
  const feedback = createDropFeedback(layer, scroller, host.translate);
  const autoScroll = createDropAutoScroll({
    scroller,
    frames: timers,
    active: () =>
      !!drag?.allowed &&
      host.writable() &&
      host.version() === drag.version &&
      pagesLayer.isConnected,
    moved: () => refresh(),
  });
  let frame: number | null = null;
  let marker: HTMLElement | null = null;

  function clear() {
    drag = null;
    autoScroll.stop();
    feedback.hide();
    point = null;
    if (frame !== null) timers.cancelAnimationFrame(frame);
    frame = null;
    marker?.remove();
  }

  function paint() {
    frame = null;
    try {
      paintNow();
    } catch (error) {
      clear();
      throw error;
    }
  }

  function paintNow() {
    const active = drag;
    if (!active || host.version() !== active.version) return clear();
    const reason = !host.writable() ? 'readOnly' : !active.allowed ? 'unsupported' : null;
    point = reason ? null : host.pointAt(active.x, active.y);
    if (!point) {
      marker?.remove();
      feedback.show(reason ?? 'noTarget', active.x, active.y);
      return;
    }
    feedback.hide();
    if (!marker) {
      marker = layer.ownerDocument.createElement('div');
      marker.dataset.docxDropCaret = '';
      marker.dataset.docxMarker = '';
      marker.className = 'docx-editor-one-surface__caret docx-editor-one-surface__caret--steady';
      marker.setAttribute('contenteditable', 'false');
      marker.setAttribute('aria-hidden', 'true');
      marker.style.position = 'absolute';
      marker.style.pointerEvents = 'none';
      marker.style.userSelect = 'none';
    }
    const scale = host.scale();
    marker.style.left = `${point.x * scale}px`;
    marker.style.top = `${point.y * scale}px`;
    marker.style.height = `${point.hit.caret.height * scale}px`;
    const vertical = isBottomToTopCaret(point.hit.caret);
    marker.style.transformOrigin = vertical ? '0 0' : '';
    marker.style.transform = vertical ? 'rotate(-90deg)' : '';
    if (!marker.isConnected) layer.append(marker);
  }

  function refresh() {
    if (!drag) return;
    if (host.version() !== drag.version) return clear();
    if (frame === null) frame = timers.requestAnimationFrame(paint);
  }

  function previewAt(x: number, y: number): SurfacePointHit | null {
    drag = { x, y, version: host.version(), allowed: true, types: 'internal' };
    point = host.writable() ? host.pointAt(x, y) : null;
    refresh();
    autoScroll.follow(x, y);
    return point;
  }

  function onDragOver(event: DragEvent) {
    const transfer = event.dataTransfer;
    if (!transfer) return clear();
    const types = Array.from(transfer.types).join('|');
    const items = Array.from(transfer.items);
    const hasFiles = items.some((item) => item.kind === 'file');
    const supported = hasFiles
      ? items.some(
          (item) =>
            item.kind === 'file' && ['image/png', 'image/jpeg', 'image/gif'].includes(item.type)
        ) || transfer.types.includes('text/html')
      : transfer.types.includes('text/plain') || transfer.types.includes('text/html');
    const next = host.writable() ? host.pointAt(event.clientX, event.clientY) : null;
    const version = host.version();
    if (next) {
      try {
        host.notify('dragOver', event, next);
      } catch (error) {
        clear();
        event.preventDefault();
        throw error;
      }
    }
    if (host.version() !== version) return clear();
    const claimed = event.defaultPrevented;
    const allowed = supported || claimed || (!next && drag?.types === types && drag.allowed);
    drag = { x: event.clientX, y: event.clientY, version, allowed: !!allowed, types };
    // Reject explicitly while still preventing browser navigation on file drops.
    event.preventDefault();
    transfer.dropEffect = next && host.writable() && allowed ? 'copy' : 'none';
    point = next;
    refresh();
    if (allowed && host.writable()) autoScroll.follow(event.clientX, event.clientY);
    else autoScroll.stop();
  }

  function onDrop(event: DragEvent) {
    clear();
    const next = host.writable() ? host.pointAt(event.clientX, event.clientY) : null;
    if (!next) {
      handledDrops.add(event);
      event.preventDefault();
      return;
    }
    const version = host.version();
    try {
      host.notify('drop', event, next);
      if (event.defaultPrevented || !host.writable() || host.version() !== version) {
        handledDrops.add(event);
        return;
      }
      const text = plainTextFromTransfer(event.dataTransfer);
      const hasImage =
        event.dataTransfer &&
        Array.from(event.dataTransfer.items).some(
          (item) => item.kind === 'file' && item.type.startsWith('image/')
        );
      if (text && (!hasImage || clipboardDropLandsText(event.dataTransfer))) {
        handledDrops.add(event);
        host.insertText(text, next);
      }
    } catch (error) {
      handledDrops.add(event);
      throw error;
    } finally {
      // The browser must never mutate the painted document or navigate to a dropped file.
      event.preventDefault();
    }
  }

  function onDragLeave(event: DragEvent) {
    if (!isDomNode(event.relatedTarget) || !pagesLayer.contains(event.relatedTarget)) clear();
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') clear();
  };
  pagesLayer.addEventListener('dragover', onDragOver);
  pagesLayer.addEventListener('drop', onDrop);
  pagesLayer.addEventListener('dragleave', onDragLeave);
  const unlisten = [
    host.listeners.onDocument('dragend', clear),
    host.listeners.onDocument('keydown', onKeyDown),
    host.listeners.onWindow('blur', clear),
    host.listeners.onWindow('scroll', refresh, { capture: true, passive: true }),
    host.listeners.onWindow('resize', refresh),
  ];
  return {
    clear,
    refresh,
    previewAt,
    destroy() {
      clear();
      pagesLayer.removeEventListener('dragover', onDragOver);
      pagesLayer.removeEventListener('drop', onDrop);
      pagesLayer.removeEventListener('dragleave', onDragLeave);
      for (const remove of unlisten) remove();
    },
  };
}

/** Keep the surface's drop wiring in the controller's own lane. */
export function bindSurfaceDrop(
  surface: PaginatedSurface,
  pagesLayer: HTMLElement,
  layer: HTMLElement,
  listeners: SurfaceHostListeners,
  scale: () => number,
  writable: () => boolean,
  notify: PaginatedSurfaceOptions['onDragEvent'],
  select: (selection: SemanticSelection, caret: CaretGeometry) => void,
  translate?: (key: string) => string | undefined
) {
  const controller = createSurfaceDrop({
    pagesLayer,
    layer,
    listeners,
    scale,
    writable,
    translate,
    version: () =>
      `${surface.session.packageRevision()}:${JSON.stringify(surface.activeScope())}:${surface.editingMode()}`,
    pointAt: (x, y) => surface.pointAt(x, y),
    notify: (kind, event, point) => notify?.(kind, event, point.hit.position),
    insertText: (text, point) => {
      select({ anchor: point.hit.position, head: point.hit.position }, point.hit.caret);
      pagesLayer.focus({ preventScroll: true });
      surface.insertPlainText(text);
    },
  });
  controllers.set(surface, controller);
  return controller;
}

const controllers = new WeakMap<PaginatedSurface, ReturnType<typeof createSurfaceDrop>>();

/** Internal image gestures share the native drop preview and edge scrolling. */
export function previewSurfaceDrop(
  surface: PaginatedSurface,
  x: number,
  y: number
): SurfacePointHit | null {
  return controllers.get(surface)?.previewAt(x, y) ?? null;
}

/** End an internal image drag without changing document state. */
export function clearSurfaceDrop(surface: PaginatedSurface): void {
  controllers.get(surface)?.clear();
}
