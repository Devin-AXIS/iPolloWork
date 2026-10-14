/** @jsxImportSource react */
import { useCallback, useEffect, useRef } from "react";

import {
  DEFAULT_WORKSPACE_LEFT_SIDEBAR_WIDTH,
  DEFAULT_WORKSPACE_RIGHT_SIDEBAR_COLLAPSED_WIDTH,
  DEFAULT_WORKSPACE_RIGHT_SIDEBAR_EXPANDED_WIDTH,
  MAX_WORKSPACE_LEFT_SIDEBAR_WIDTH,
  MAX_WORKSPACE_RIGHT_SIDEBAR_WIDTH,
  MIN_WORKSPACE_LEFT_SIDEBAR_WIDTH,
  MIN_WORKSPACE_RIGHT_SIDEBAR_WIDTH,
  useUiStateStore,
} from "./ui-state-store";

type WorkspaceShellLayoutOptions = {
  onLeftCollapse?: () => void;
  onLeftExpand?: () => void;
  defaultLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  collapsedRightWidth?: number;
  expandedRightWidth: number;
  minRightWidth?: number;
  maxRightWidth?: number;
};

export const WORKSPACE_SNAP_DISTANCE = 48;
export const WORKSPACE_SNAP_RELEASE_DISTANCE = 24;
export const WORKSPACE_TRANSITION_MS = 220;
export const WORKSPACE_TRANSITION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export function getWorkspaceSnapIntent(
  requestedWidth: number,
  minWidth: number,
  maxWidth: number,
  previous: "collapse" | "expand" | null,
): "collapse" | "expand" | null {
  if (requestedWidth <= minWidth - (previous === "collapse" ? WORKSPACE_SNAP_RELEASE_DISTANCE : WORKSPACE_SNAP_DISTANCE)) {
    return "collapse";
  }
  if (requestedWidth >= maxWidth + (previous === "expand" ? WORKSPACE_SNAP_RELEASE_DISTANCE : WORKSPACE_SNAP_DISTANCE)) {
    return "expand";
  }
  return null;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function useWorkspaceShellLayout(options: WorkspaceShellLayoutOptions) {
  const minLeftWidth = Math.max(180, options.minLeftWidth ?? MIN_WORKSPACE_LEFT_SIDEBAR_WIDTH);
  const maxLeftWidth = Math.max(minLeftWidth, options.maxLeftWidth ?? MAX_WORKSPACE_LEFT_SIDEBAR_WIDTH);
  const defaultLeftWidth = clampNumber(
    options.defaultLeftWidth ?? DEFAULT_WORKSPACE_LEFT_SIDEBAR_WIDTH,
    minLeftWidth,
    maxLeftWidth,
  );
  const collapsedRightWidth = Math.max(
    56,
    options.collapsedRightWidth ?? DEFAULT_WORKSPACE_RIGHT_SIDEBAR_COLLAPSED_WIDTH,
  );
  const expandedRightWidth = Math.max(collapsedRightWidth, options.expandedRightWidth);
  const minRightWidth = Math.max(collapsedRightWidth, options.minRightWidth ?? MIN_WORKSPACE_RIGHT_SIDEBAR_WIDTH);
  const maxRightWidth = Math.max(minRightWidth, options.maxRightWidth ?? MAX_WORKSPACE_RIGHT_SIDEBAR_WIDTH);
  const defaultRightWidth = clampNumber(
    expandedRightWidth || DEFAULT_WORKSPACE_RIGHT_SIDEBAR_EXPANDED_WIDTH,
    minRightWidth,
    maxRightWidth,
  );

  const leftSidebarWidth = useUiStateStore((state) =>
    clampNumber(state.workspaceLeftSidebarWidth || defaultLeftWidth, minLeftWidth, maxLeftWidth),
  );
  const leftSidebarResizing = useUiStateStore((state) => state.workspaceLeftSidebarResizing);
  const rightSidebarExpanded = useUiStateStore((state) => state.workspaceRightSidebarExpanded);
  const rightSidebarExpandedWidth = useUiStateStore((state) =>
    clampNumber(state.workspaceRightSidebarExpandedWidth || defaultRightWidth, minRightWidth, maxRightWidth),
  );
  const setLeftSidebarWidth = useUiStateStore((state) => state.setWorkspaceLeftSidebarWidth);
  const setLeftSidebarResizing = useUiStateStore((state) => state.setWorkspaceLeftSidebarResizing);
  const setRightSidebarExpanded = useUiStateStore((state) => state.setWorkspaceRightSidebarExpanded);
  const setRightSidebarExpandedWidth = useUiStateStore((state) => state.setWorkspaceRightSidebarExpandedWidth);
  const toggleRightSidebar = useUiStateStore((state) => state.toggleWorkspaceRightSidebar);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const stopLeftSidebarResize = useCallback(() => {
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
    setLeftSidebarResizing(false);
    if (typeof document === "undefined") return;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, [setLeftSidebarResizing]);

  const startLeftSidebarResize = useCallback(
    (event: PointerEvent | React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || typeof window === "undefined") return;

      stopLeftSidebarResize();
      setLeftSidebarResizing(true);
      const initialX = event.clientX;
      const initialWidth = leftSidebarWidth;
      const resizeHandle = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
      const sidebarWrapper = resizeHandle?.closest<HTMLElement>('[data-slot="sidebar-wrapper"]') ?? null;
      let nextWidth = initialWidth;
      let frameId: number | null = null;
      let snapPending: "collapse" | null = null;

      const applyPendingWidth = () => {
        frameId = null;
        sidebarWrapper?.style.setProperty("--sidebar-width", `${nextWidth}px`);
      };

      let collapseAnimation: Animation | null = null;
      const handleMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        const requestedWidth = initialWidth + moveEvent.clientX - initialX;
        const intent = getWorkspaceSnapIntent(requestedWidth, minLeftWidth, maxLeftWidth, snapPending);
        if (options.onLeftCollapse && intent === "collapse") {
          if (snapPending === "collapse") return;
          if (frameId !== null) window.cancelAnimationFrame(frameId);
          frameId = null;
          const renderedWidth = sidebarWrapper?.querySelector<HTMLElement>('[data-slot="sidebar-gap"]')?.getBoundingClientRect().width ?? nextWidth;
          snapPending = "collapse";
          resizeHandle?.setAttribute("data-snap-pending", "collapse");
          sidebarWrapper?.style.setProperty("--sidebar-width", `${initialWidth}px`);
          setLeftSidebarResizing(false);
          if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            collapseAnimation = sidebarWrapper?.querySelector<HTMLElement>('[data-slot="sidebar-gap"]')?.animate(
              [{ width: `${renderedWidth}px` }, { width: "0px" }],
              { duration: WORKSPACE_TRANSITION_MS, easing: WORKSPACE_TRANSITION_EASING },
            ) ?? null;
          }
          options.onLeftCollapse();
          return;
        }
        if (snapPending === "collapse") {
          const gap = sidebarWrapper?.querySelector<HTMLElement>('[data-slot="sidebar-gap"]');
          const renderedWidth = gap?.getBoundingClientRect().width ?? 0;
          collapseAnimation?.cancel();
          snapPending = null;
          resizeHandle?.removeAttribute("data-snap-pending");
          options.onLeftExpand?.();
          if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            collapseAnimation = gap?.animate(
              [{ width: `${renderedWidth}px` }, { width: `${initialWidth}px` }],
              { duration: WORKSPACE_TRANSITION_MS, easing: WORKSPACE_TRANSITION_EASING },
            ) ?? null;
          }
          nextWidth = initialWidth;
          return;
        }
        nextWidth = clampNumber(requestedWidth, minLeftWidth, maxLeftWidth);
        setLeftSidebarResizing(true);
        if (frameId === null) frameId = window.requestAnimationFrame(applyPendingWidth);
      };

      const handleStop = (stopEvent: PointerEvent) => {
        if (stopEvent.pointerId !== event.pointerId) return;
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
          applyPendingWidth();
        }
        const canceled = stopEvent.type === "pointercancel";
        const finalWidth = snapPending === "collapse" || canceled ? initialWidth : nextWidth;
        sidebarWrapper?.style.setProperty("--sidebar-width", `${finalWidth}px`);
        setLeftSidebarWidth(finalWidth);
        stopLeftSidebarResize();
        if (canceled) {
          collapseAnimation?.cancel();
          if (snapPending === "collapse") options.onLeftExpand?.();
        }
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleStop);
      window.addEventListener("pointercancel", handleStop);
      dragCleanupRef.current = () => {
        if (frameId !== null) window.cancelAnimationFrame(frameId);
        resizeHandle?.removeAttribute("data-snap-pending");
        sidebarWrapper?.style.setProperty("--sidebar-width", `${leftSidebarWidth}px`);
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleStop);
        window.removeEventListener("pointercancel", handleStop);
        if (resizeHandle?.hasPointerCapture(event.pointerId)) {
          resizeHandle.releasePointerCapture(event.pointerId);
        }
      };
      resizeHandle?.setPointerCapture(event.pointerId);

      if (typeof document !== "undefined") {
        Object.assign(document.body.style, {
          cursor: "ew-resize",
          userSelect: "none",
        });
      }

      event.preventDefault();
    },
    [leftSidebarWidth, maxLeftWidth, minLeftWidth, options.onLeftCollapse, options.onLeftExpand, setLeftSidebarResizing, setLeftSidebarWidth, stopLeftSidebarResize],
  );

  const handleLeftSidebarResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 32 : 16;
    if (event.key === "ArrowLeft" && leftSidebarWidth <= minLeftWidth && options.onLeftCollapse) {
      event.preventDefault();
      options.onLeftCollapse();
      return;
    }
    const width = event.key === "ArrowLeft" ? leftSidebarWidth - step
      : event.key === "ArrowRight" ? leftSidebarWidth + step
      : event.key === "Home" ? minLeftWidth
      : event.key === "End" ? maxLeftWidth : null;
    if (width === null) return;
    event.preventDefault();
    setLeftSidebarWidth(clampNumber(width, minLeftWidth, maxLeftWidth));
  }, [leftSidebarWidth, minLeftWidth, maxLeftWidth, options.onLeftCollapse, setLeftSidebarWidth]);

  useEffect(() => {
    return () => {
      stopLeftSidebarResize();
    };
  }, [stopLeftSidebarResize]);

  return {
    leftSidebarWidth,
    leftSidebarResizing,
    rightSidebarExpanded,
    rightSidebarExpandedWidth,
    rightSidebarWidth: rightSidebarExpanded ? rightSidebarExpandedWidth : collapsedRightWidth,
    setRightSidebarExpanded,
    setRightSidebarExpandedWidth,
    startLeftSidebarResize,
    handleLeftSidebarResizeKeyDown,
    minLeftWidth,
    maxLeftWidth,
    toggleRightSidebar,
  };
}
