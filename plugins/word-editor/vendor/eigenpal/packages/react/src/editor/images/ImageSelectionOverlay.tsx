// Selection ring and eight resize handles for the selected drawing — geometry from layout records.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  beginInlineImageDrag,
  leaveGroupMember,
  drawingFramePressTarget,
  type DrawingFramePress,
  passDrawingFramePress,
  canMoveInlineImage,
  captureImageMutationPreconditions,
  computeMovedImagePosition,
  hostWindowOf,
  historyShortcutOf,
  IMAGE_OVERLAY_NUDGE_PT,
  IMAGE_OVERLAY_NUDGE_SHIFT_PT,
  isElementNode,
  isStaleImageInteractionCommit,
  openChartPaneFor,
  selectedDrawingOverlayTargetOf,
  textboxFrameReason,
  type ImageInteractionSession,
  type ImageOverlayScrollPort,
  type ImageResizeHandle,
  type SelectedDrawingOverlayTarget,
} from '@docx-editor.dev/core/editor';
import {
  computeImageResizeResult,
  createImageOverlayScrollPort,
  cssPixelsToLayoutPoints,
  finalizeImageOverlayInteraction,
  overlayFrameCssBox,
  overlayFrameToSheetCssPixels,
  overlayHostOrigin,
  resizePreservesAspect,
} from '@docx-editor.dev/core/editor';
import type { DrawingPositionInput } from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { guardToolbarMousedown } from '../toolbar/ToolbarButton';

const HANDLES: readonly ImageResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const AUTO_SCROLL_EDGE_PX = 40;
const AUTO_SCROLL_MAX_PT = 12;

interface PreviewState {
  readonly session: ImageInteractionSession;
  readonly bounds: SelectedDrawingOverlayTarget;
  readonly accumulatedScrollPt: number;
}

export interface ImageSelectionOverlayProps {
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly portalRef: RefObject<HTMLElement | null>;
  readonly scrollPort?: ImageOverlayScrollPort;
}

function handleLabelKey(handle: ImageResizeHandle): `imageOverlay.handle.${ImageResizeHandle}` {
  return `imageOverlay.handle.${handle}`;
}

function cursorForHandle(handle: ImageResizeHandle): string {
  switch (handle) {
    case 'nw':
    case 'se':
      return 'nwse-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    case 'n':
    case 's':
      return 'ns-resize';
    default:
      return 'ew-resize';
  }
}

function handlePosition(handle: ImageResizeHandle): { readonly x: string; readonly y: string } {
  const map: Record<ImageResizeHandle, { x: string; y: string }> = {
    nw: { x: '0%', y: '0%' },
    n: { x: '50%', y: '0%' },
    ne: { x: '100%', y: '0%' },
    e: { x: '100%', y: '50%' },
    se: { x: '100%', y: '100%' },
    s: { x: '50%', y: '100%' },
    sw: { x: '0%', y: '100%' },
    w: { x: '0%', y: '50%' },
  };
  return map[handle];
}

function handleFromDelta(dx: number, dy: number): ImageResizeHandle {
  if (dx > 0 && dy > 0) return 'se';
  if (dx > 0 && dy < 0) return 'ne';
  if (dx < 0 && dy > 0) return 'sw';
  if (dx < 0 && dy < 0) return 'nw';
  if (dx > 0) return 'e';
  if (dx < 0) return 'w';
  if (dy > 0) return 's';
  return 'n';
}

export function ImageSelectionOverlay({
  containerRef,
  portalRef,
  scrollPort: scrollPortOverride,
}: ImageSelectionOverlayProps): React.ReactPortal | null {
  const editor = useDocxEditor();
  const { t } = useTranslation();
  const [target, setTarget] = useState<SelectedDrawingOverlayTarget | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  // Where the surface's box begins inside the overlay's containing block. The surface
  // centres itself with an auto margin, so a viewport resize moves this origin without any
  // engine event firing. Held in state and measured in the observer (and once per
  // selection), never per render: `overlayHostOrigin` reads offsetLeft/offsetTop, which
  // forces layout, and preview renders arrive at pointermove frequency during a drag.
  const [origin, setOrigin] = useState<{ readonly left: number; readonly top: number }>({
    left: 0,
    top: 0,
  });
  const previewRef = useRef<PreviewState | null>(null);
  previewRef.current = preview;
  const pointerStartRef = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const captureTargetRef = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const focusRequestedForDrawingRef = useRef<string | null>(null);
  const scrollPortRef = useRef<ImageOverlayScrollPort | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const element = isElementNode(event.target) ? event.target : null;
      if (element?.closest('.docx-drawing-textbox-content')) {
        focusRequestedForDrawingRef.current = null;
        return;
      }
      // A drawing behind the text paints under it, so the hit names what the press reaches.
      const drawingId =
        element
          ?.closest<HTMLElement>('[data-drawing-node-id]')
          ?.getAttribute('data-drawing-node-id') ??
        editor?.surface?.pointAt(event.clientX, event.clientY)?.hit.drawing?.drawingNodeId;
      // A press on the frame goes where the frame hands it: text keeps the keyboard with the
      // editor, another drawing takes it once selected.
      const onFrame = !!editor && !!drawingId && drawingId === target?.id;
      const press: DrawingFramePress = onFrame ? drawingFramePressTarget(editor, event) : 'frame';
      focusRequestedForDrawingRef.current =
        press === 'text' ? null : press === 'frame' ? (drawingId ?? null) : press.drawingNodeId;
      if (onFrame && press === 'frame') {
        queueMicrotask(() => overlayRef.current?.focus({ preventScroll: true }));
      }
    };
    container.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => container.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [containerRef, editor, target?.id]);

  const refreshOrigin = useCallback(() => {
    setOrigin((previous) => {
      const next = overlayHostOrigin(containerRef.current);
      return next.left === previous.left && next.top === previous.top ? previous : next;
    });
  }, [containerRef]);

  useEffect(() => {
    if (!editor) {
      setTarget(null);
      return undefined;
    }
    const sync = (): void => {
      setTarget(selectedDrawingOverlayTargetOf(editor.surface));
    };
    // A selection of a drawing measures the origin again, as a new target used to: the
    // target keeps its object while its values hold, and content above the pages can move
    // the origin without resizing what the observer watches.
    const onSelectionChange = (): void => {
      const next = selectedDrawingOverlayTargetOf(editor.surface);
      setTarget(next);
      if (next) refreshOrigin();
    };
    // Document `change` can fire synchronously from inside a surface commit (the facade
    // listens on the session and emits before `selectionAfter` runs). Running overlay
    // sync in that window used to re-enter React and leave table structural edits on the
    // pre-commit caret — `insertRowAbove` kept reading A1. Defer to a microtask so the
    // engine finishes adopting the committed caret first; `selectionChange` stays immediate.
    const syncAfterCommit = (): void => {
      queueMicrotask(sync);
    };
    sync();
    const off = [
      editor.on('change', syncAfterCommit),
      editor.on('selectionChange', onSelectionChange),
    ];
    return () => {
      for (const unsubscribe of off) unsubscribe();
    };
  }, [editor, refreshOrigin]);

  useEffect(() => {
    // Once per target too: keyed on `target`, so a portal that mounted after the first pass
    // still gets its observer. A repeated selection of the same drawing re-measures in the
    // `selectionChange` handler, since its target keeps the same object.
    refreshOrigin();
    const portal = portalRef.current;
    const Observer = hostWindowOf(portal).ResizeObserver;
    if (!portal || typeof Observer !== 'function') return undefined;
    const observer = new Observer(refreshOrigin);
    observer.observe(portal);
    // The origin is a function of BOTH boxes: the surface's own width moves the centring
    // margin at a constant portal box (a page-size change), so observe the surface too.
    const container = containerRef.current;
    if (container) observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, portalRef, refreshOrigin, target]);

  useEffect(() => {
    if (scrollPortOverride) {
      scrollPortRef.current = scrollPortOverride;
      return undefined;
    }
    const container = containerRef.current;
    if (!container || !editor?.surface) return undefined;
    const scroller = container.closest('.docx-editor__scroll-container') as HTMLElement | null;
    if (!scroller) return undefined;
    const coordinates = editor.surface.overlayCoordinates();
    scrollPortRef.current = createImageOverlayScrollPort(scroller, coordinates.paintScale);
    return () => {
      scrollPortRef.current = null;
    };
  }, [containerRef, editor, scrollPortOverride]);

  const clearPreview = useCallback(() => {
    setPreview(null);
    pointerStartRef.current = null;
    const captured = captureTargetRef.current;
    captureTargetRef.current = null;
    if (captured) {
      try {
        captured.releasePointerCapture(
          (captured as HTMLElement & { _lastPointerId?: number })._lastPointerId ?? 0
        );
      } catch {
        // Already released.
      }
    }
  }, []);

  const beginSession = useCallback(
    (
      mode: 'move' | 'resize',
      handle: ImageResizeHandle | null,
      active: SelectedDrawingOverlayTarget,
      clientX: number,
      clientY: number,
      captureTarget: HTMLElement,
      pointerId: number
    ) => {
      if (!editor?.surface) return;
      // The flushing read FIRST: a pass still parked on the scheduler's timer would
      // otherwise publish mid-drag and fail the commit's staleness check for nothing, so
      // the session is stamped against the flushed layout. Preconditions are captured
      // after it, so a flush that lands buffered input cannot stamp a selection the
      // flush is about to move.
      const scope = editor.surface.activeScope();
      if (scope.kind === 'frame' && !editor.surface.selectDrawing(active.id, scope.hostParagraphId))
        return;
      const layout = editor.surface.layout();
      const pre = captureImageMutationPreconditions(editor);
      if (!pre) return;
      pointerStartRef.current = Object.freeze({ x: clientX, y: clientY });
      captureTargetRef.current = captureTarget;
      (captureTarget as HTMLElement & { _lastPointerId?: number })._lastPointerId = pointerId;
      try {
        captureTarget.setPointerCapture(pointerId);
      } catch {
        // Capture is best-effort.
      }
      setPreview({
        session: Object.freeze({
          drawingNodeId: active.id,
          startBounds: Object.freeze({
            x: active.x,
            y: active.y,
            width: active.width,
            height: active.height,
          }),
          startWidthEmu: active.widthEmu,
          startHeightEmu: active.heightEmu,
          startPosition: active.position,
          anchorFrameOrigin: active.anchorFrameOrigin,
          transform: active.transform,
          mode,
          handle,
          preconditions: pre,
          layoutRevision: layout.revision,
          packageRevision: editor.surface.session.packageRevision(),
          kind: active.kind,
        }),
        bounds: active,
        accumulatedScrollPt: 0,
      });
      overlayRef.current?.focus({ preventScroll: true });
    },
    [editor]
  );

  const commitSession = useCallback(
    (
      session: ImageInteractionSession,
      widthEmu: number,
      heightEmu: number,
      _bounds: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      },
      position: DrawingPositionInput | null
    ) => {
      if (!editor) return;
      const stale = isStaleImageInteractionCommit(editor, session);
      if (stale) {
        clearPreview();
        return;
      }
      if (session.mode === 'resize') {
        editor.exec({
          type: 'setImageProperties',
          widthEmu,
          heightEmu,
          ...(position?.mode === 'simple'
            ? {
                horizontalEmu: position.horizontalEmu,
                verticalEmu: position.verticalEmu,
              }
            : {}),
          ...(position?.mode === 'frame'
            ? {
                ...(position.horizontalEmu !== undefined
                  ? { horizontalEmu: position.horizontalEmu }
                  : {}),
                ...(position.verticalEmu !== undefined
                  ? { verticalEmu: position.verticalEmu }
                  : {}),
              }
            : {}),
        });
      } else if (session.mode === 'move' && position) {
        editor.exec({ type: 'setImagePosition', ...position });
      }
      clearPreview();
    },
    [clearPreview, editor]
  );

  const onOverlayKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!editor) return;
      const active = previewRef.current?.bounds ?? selectedDrawingOverlayTargetOf(editor.surface);
      if (!active) return;
      if (previewRef.current && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        clearPreview();
        return;
      }
      if (previewRef.current) return;
      // Escape on a shape inside a group selects the group again.
      if (event.key === 'Escape' && leaveGroupMember(editor)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // Focus sits on the overlay, not the text surface, so history keys stop here unless
      // the overlay forwards them. Undo usually reverts the resize or move just made.
      const history = historyShortcutOf(event);
      if (history) {
        event.preventDefault();
        event.stopPropagation();
        editor.exec({ type: history });
        return;
      }
      const step = event.shiftKey ? IMAGE_OVERLAY_NUDGE_SHIFT_PT : IMAGE_OVERLAY_NUDGE_PT;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        // The frame goes with the drawing: the caret it leaves keeps the keyboard, for undo.
        if (editor.exec({ type: 'deleteImage' }).ok) editor.focus();
        return;
      }
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      if (event.altKey) {
        if (!active.canResize) return;
        const handle = handleFromDelta(dx, dy);
        const resized = computeImageResizeResult({
          handle,
          startWidthEmu: active.widthEmu,
          startHeightEmu: active.heightEmu,
          startBounds: { x: active.x, y: active.y, width: active.width, height: active.height },
          startPosition: active.position,
          anchorFrameOrigin: active.anchorFrameOrigin,
          deltaXPt: dx,
          deltaYPt: dy,
          transform: active.transform,
          preserveAspect: resizePreservesAspect(
            handle,
            active.aspectLocked,
            event.shiftKey,
            active.textbox
          ),
          kind: active.kind,
        });
        editor.exec({
          type: 'setImageProperties',
          widthEmu: resized.widthEmu,
          heightEmu: resized.heightEmu,
          ...(resized.position?.mode === 'simple'
            ? {
                horizontalEmu: resized.position.horizontalEmu,
                verticalEmu: resized.position.verticalEmu,
              }
            : {}),
          ...(resized.position?.mode === 'frame'
            ? {
                ...(resized.position.horizontalEmu !== undefined
                  ? { horizontalEmu: resized.position.horizontalEmu }
                  : {}),
                ...(resized.position.verticalEmu !== undefined
                  ? { verticalEmu: resized.position.verticalEmu }
                  : {}),
              }
            : {}),
        });
        return;
      }
      if (active.kind !== 'anchored' || !active.canMove || !active.position) return;
      const moved = computeMovedImagePosition(active.position, dx, dy);
      editor.exec({ type: 'setImagePosition', ...moved });
    },
    [clearPreview, editor]
  );

  // Keyed on the drag being active, not on each preview: every pointer move sets a new
  // preview, and the handlers read the current one through `previewRef`.
  const dragging = preview !== null;
  useEffect(() => {
    if (!dragging || !editor?.surface) return undefined;
    const coordinates = editor.surface.overlayCoordinates();
    const onPointerMove = (event: PointerEvent) => {
      const current = previewRef.current;
      const startPointer = pointerStartRef.current;
      if (!current || !startPointer) return;
      const deltaX = cssPixelsToLayoutPoints(
        event.clientX - startPointer.x,
        coordinates.paintScale
      );
      const deltaY = cssPixelsToLayoutPoints(
        event.clientY - startPointer.y,
        coordinates.paintScale
      );
      if (current.session.mode === 'move') {
        let scrollDelta = 0;
        const scrollPort = scrollPortRef.current;
        const scroller = containerRef.current?.closest(
          '.docx-editor__scroll-container'
        ) as HTMLElement | null;
        if (scrollPort && scroller) {
          const scrollerRect = scroller.getBoundingClientRect();
          if (event.clientY > scrollerRect.bottom - AUTO_SCROLL_EDGE_PX)
            scrollDelta = AUTO_SCROLL_MAX_PT;
          else if (event.clientY < scrollerRect.top + AUTO_SCROLL_EDGE_PX)
            scrollDelta = -AUTO_SCROLL_MAX_PT;
          if (scrollDelta !== 0) scrollDelta = scrollPort.scrollBy(scrollDelta);
        }
        const accumulatedScrollPt = current.accumulatedScrollPt + scrollDelta;
        setPreview({
          ...current,
          accumulatedScrollPt,
          bounds: Object.freeze({
            ...current.bounds,
            x: current.session.startBounds.x + deltaX,
            y: current.session.startBounds.y + deltaY + accumulatedScrollPt,
          }),
        });
        return;
      }
      if (!current.session.handle) return;
      const resized = computeImageResizeResult({
        handle: current.session.handle,
        startWidthEmu: current.session.startWidthEmu,
        startHeightEmu: current.session.startHeightEmu,
        startBounds: current.session.startBounds,
        startPosition: current.session.startPosition,
        anchorFrameOrigin: current.session.anchorFrameOrigin,
        deltaXPt: deltaX,
        deltaYPt: deltaY,
        transform: current.session.transform,
        preserveAspect: resizePreservesAspect(
          current.session.handle,
          current.bounds.aspectLocked,
          event.shiftKey,
          current.bounds.textbox
        ),
        kind: current.session.kind,
      });
      setPreview({
        ...current,
        bounds: Object.freeze({
          ...current.bounds,
          x: resized.previewBounds.x,
          y: resized.previewBounds.y,
          width: resized.previewBounds.width,
          height: resized.previewBounds.height,
          widthEmu: resized.widthEmu,
          heightEmu: resized.heightEmu,
        }),
      });
    };
    const finish = (event: PointerEvent) => {
      const current = previewRef.current;
      if (!current) return;
      if (event.type === 'pointerup') {
        const deltaX = cssPixelsToLayoutPoints(
          event.clientX - (pointerStartRef.current?.x ?? event.clientX),
          coordinates.paintScale
        );
        const deltaY = cssPixelsToLayoutPoints(
          event.clientY - (pointerStartRef.current?.y ?? event.clientY),
          coordinates.paintScale
        );
        const finalized = finalizeImageOverlayInteraction({
          session: current.session,
          deltaXPt: deltaX,
          deltaYPt: deltaY,
          accumulatedScrollPt: current.accumulatedScrollPt,
          aspectLocked: current.bounds.aspectLocked,
          textbox: current.bounds.textbox,
          shiftKey: event.shiftKey,
          anchorFrameOrigin: current.session.anchorFrameOrigin,
        });
        commitSession(
          current.session,
          finalized.widthEmu,
          finalized.heightEmu,
          finalized.previewBounds,
          finalized.position
        );
      } else clearPreview();
    };
    // The surface's own window: a drag in a pop-out window never reaches the opener's.
    const win = hostWindowOf(containerRef.current);
    win.addEventListener('pointermove', onPointerMove);
    win.addEventListener('pointerup', finish);
    win.addEventListener('pointercancel', finish);
    return () => {
      win.removeEventListener('pointermove', onPointerMove);
      win.removeEventListener('pointerup', finish);
      win.removeEventListener('pointercancel', finish);
    };
  }, [clearPreview, commitSession, containerRef, dragging, editor]);

  useEffect(() => {
    if (!target || focusRequestedForDrawingRef.current !== target.id) return;
    focusRequestedForDrawingRef.current = null;
    overlayRef.current?.focus({ preventScroll: true });
  }, [target]);

  const active = preview?.bounds ?? target;
  const rendered = useMemo(() => {
    if (!editor?.surface || !active) return null;
    const layout = editor.surface.publishedLayout();
    const coordinates = editor.surface.overlayCoordinates();
    const sheetRect = overlayFrameToSheetCssPixels(
      layout,
      {
        pageIndex: active.pageIndex,
        x: active.x,
        y: active.y,
        width: active.width,
        height: active.height,
      },
      coordinates
    );
    // Sheet-space is surface-relative; the overlay's containing block is not the surface.
    const rect = {
      left: sheetRect.left + origin.left,
      top: sheetRect.top + origin.top,
      width: sheetRect.width,
      height: sheetRect.height,
    };
    // A turned shape's frame rings its unturned extent, turned; a drag preview keeps the turn.
    const frame = overlayFrameCssBox(rect, target?.turn, coordinates.paintScale);
    const showHandles = active.canResize;
    const showMove = active.kind === 'anchored' && active.canMove;
    const showInlineMove = active.kind === 'inline' && canMoveInlineImage(editor, active.id);
    // A text box frame says why it takes no caret or offers no handles.
    const frameReason = textboxFrameReason(active, editor.surface.editingMode());
    const frameLabel = frameReason ? t(frameReason) : undefined;
    return (
      <div
        ref={overlayRef}
        className="docx-image-selection-overlay"
        data-drawing-node-id={active.id}
        tabIndex={0}
        onKeyDown={onOverlayKeyDown}
      >
        <div
          className={`docx-image-selection-overlay__frame${
            showMove || showInlineMove ? ' docx-editor-one-surface__overlay-control' : ''
          }`}
          data-textbox={active.textbox ? 'true' : undefined}
          data-turned={frame.transform ? 'true' : undefined}
          // To pointer and screen reader users alike.
          title={frameLabel}
          aria-description={frameLabel}
          role="group"
          aria-label={t(active.shape ? 'imageOverlay.selectionShape' : 'imageOverlay.selection')}
          style={{
            left: `${frame.left}px`,
            top: `${frame.top}px`,
            width: `${frame.width}px`,
            height: `${frame.height}px`,
            transform: frame.transform,
            cursor: showMove || showInlineMove ? 'move' : 'default',
          }}
          // A double press on a chart opens the Chart pane, as Edit chart does.
          onDoubleClick={(event) => {
            if (editor && openChartPaneFor(editor, active.id)) event.preventDefault();
          }}
          onPointerDown={(event) => {
            // Over text in front of a drawing behind it, the text takes the press.
            const passed = passDrawingFramePress(editor, event.nativeEvent);
            if (passed !== 'frame') {
              // The forwarded press ran the capture listener again; the frame's answer wins.
              focusRequestedForDrawingRef.current = passed === 'text' ? null : passed.drawingNodeId;
              return;
            }
            if (showInlineMove && beginInlineImageDrag(editor, event.nativeEvent, active.id))
              return;
            guardToolbarMousedown(event);
            if (!showMove || !active.position) return;
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            beginSession(
              'move',
              null,
              active,
              event.clientX,
              event.clientY,
              event.currentTarget,
              event.pointerId
            );
          }}
        />
        {showHandles
          ? HANDLES.map((handle) => {
              const pos = handlePosition(handle);
              return (
                <button
                  key={handle}
                  type="button"
                  className="docx-image-selection-overlay__handle"
                  aria-label={t(handleLabelKey(handle))}
                  tabIndex={0}
                  style={{
                    left: `calc(${rect.left}px + ${rect.width}px * ${parseFloat(pos.x) / 100} - 5px)`,
                    top: `calc(${rect.top}px + ${rect.height}px * ${parseFloat(pos.y) / 100} - 5px)`,
                    cursor: cursorForHandle(handle),
                  }}
                  onPointerDown={(event) => {
                    guardToolbarMousedown(event);
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    beginSession(
                      'resize',
                      handle,
                      active,
                      event.clientX,
                      event.clientY,
                      event.currentTarget,
                      event.pointerId
                    );
                  }}
                />
              );
            })
          : null}
      </div>
    );
  }, [active, beginSession, editor, onOverlayKeyDown, origin.left, origin.top, t, target]);

  if (!rendered || !portalRef.current) return null;
  return createPortal(rendered, portalRef.current);
}
