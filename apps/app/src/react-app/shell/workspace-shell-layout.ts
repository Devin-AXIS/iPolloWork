/** @jsxImportSource react */
import { useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";

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

export const WORKSPACE_SNAP_DISTANCE = 80;
export const WORKSPACE_SNAP_RELEASE_DISTANCE = 40;
export const WORKSPACE_TRANSITION_MS = 220;
export const WORKSPACE_TRANSITION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export function getWorkspaceSnapIntent(
  requestedWidth: number,
  minWidth: number,
  maxWidth: number,
  previous: "collapse" | "expand" | null,
  boundaryWidth?: number,
): "collapse" | "expand" | null {
  if (requestedWidth <= (boundaryWidth ?? minWidth) - (previous === "collapse" ? WORKSPACE_SNAP_RELEASE_DISTANCE : WORKSPACE_SNAP_DISTANCE)) {
    return "collapse";
  }
  if (requestedWidth >= (boundaryWidth ?? maxWidth) + (previous === "expand" ? WORKSPACE_SNAP_RELEASE_DISTANCE : WORKSPACE_SNAP_DISTANCE)) {
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
  const leftMotionCleanupRef = useRef<(() => void) | null>(null);

  const stopLeftSidebarResize = useCallback(() => {
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
    if (!leftMotionCleanupRef.current) setLeftSidebarResizing(false);
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
      let boundaryWidth: number | undefined;

      const applyPendingWidth = () => {
        frameId = null;
        sidebarWrapper?.style.setProperty("--sidebar-width", `${nextWidth}px`);
      };

      const animateLeftSidebar = (open: boolean) => {
        const gap = sidebarWrapper?.querySelector<HTMLElement>('[data-slot="sidebar-gap"]');
        const container = sidebarWrapper?.querySelector<HTMLElement>('[data-slot="sidebar-container"]');
        const gapWidth = gap?.getBoundingClientRect().width ?? nextWidth;
        const rect = container?.getBoundingClientRect();
        leftMotionCleanupRef.current?.();
        const commit = () => {
          sidebarWrapper?.style.setProperty("--sidebar-width", `${initialWidth}px`);
          setLeftSidebarResizing(false);
          if (open) options.onLeftExpand?.();
          else options.onLeftCollapse?.();
        };
        if (!gap || !container || !rect || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          commit();
          return;
        }
        // Keep the visible sidebar at its current width while it retreats.
        // The remembered width is restored only once the sidebar is offscreen.
        gap.style.transition = "none";
        container.style.transition = "none";
        container.style.width = `${rect.width}px`;
        const animationOptions: KeyframeAnimationOptions = {
          duration: WORKSPACE_TRANSITION_MS, easing: WORKSPACE_TRANSITION_EASING, fill: "both",
        };
        const animations = [
          gap.animate([{ width: `${gapWidth}px` }, { width: `${open ? initialWidth : 0}px` }], animationOptions),
          container.animate([
            { left: `${rect.left}px`, width: `${rect.width}px` },
            { left: `${open ? 0 : -rect.width}px`, width: `${open ? initialWidth : rect.width}px` },
          ], animationOptions),
        ];
        for (const animation of animations) animation.pause();
        let motionFrame: number | null = null;
        const cleanup = () => {
          if (motionFrame !== null) window.cancelAnimationFrame(motionFrame);
          for (const animation of animations) animation.cancel();
          container.style.removeProperty("width");
          // Settle the committed CSS layout before re-enabling button transitions.
          container.getBoundingClientRect();
          gap.style.removeProperty("transition");
          container.style.removeProperty("transition");
          leftMotionCleanupRef.current = null;
        };
        leftMotionCleanupRef.current = cleanup;
        motionFrame = window.requestAnimationFrame(() => {
          motionFrame = null;
          const startTime = performance.now();
          for (const animation of animations) {
            animation.play();
            animation.startTime = startTime;
          }
        });
        void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
          if (leftMotionCleanupRef.current !== cleanup) return;
          flushSync(commit);
          if (leftMotionCleanupRef.current === cleanup) cleanup();
        });
      };
      const handleMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        const requestedWidth = initialWidth + moveEvent.clientX - initialX;
        if (snapPending !== "collapse") {
          if (requestedWidth > minLeftWidth) boundaryWidth = undefined;
          else boundaryWidth ??= requestedWidth;
        }
        const intent = frameId === null
          ? getWorkspaceSnapIntent(requestedWidth, minLeftWidth, maxLeftWidth, snapPending, boundaryWidth)
          : null;
        if (options.onLeftCollapse && intent === "collapse") {
          if (snapPending === "collapse") return;
          if (frameId !== null) window.cancelAnimationFrame(frameId);
          frameId = null;
          snapPending = "collapse";
          resizeHandle?.setAttribute("data-snap-pending", "collapse");
          animateLeftSidebar(false);
          return;
        }
        if (snapPending === "collapse") {
          boundaryWidth = undefined;
          snapPending = null;
          resizeHandle?.removeAttribute("data-snap-pending");
          animateLeftSidebar(true);
          nextWidth = initialWidth;
          return;
        }
        if (leftMotionCleanupRef.current) return;
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
        if (canceled && (snapPending === "collapse" || leftMotionCleanupRef.current)) animateLeftSidebar(true);
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
      leftMotionCleanupRef.current?.();
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
