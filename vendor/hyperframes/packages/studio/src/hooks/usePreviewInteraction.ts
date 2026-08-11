import { useCallback, useEffect, useRef } from "react";
import { liveTime, usePlayerStore } from "../player";
import { pauseStudioPreviewPlayback } from "../utils/studioPreviewHelpers";
import {
  STUDIO_MULTI_SELECTION_ENABLED,
  STUDIO_PREVIEW_SELECTION_ENABLED,
} from "../components/editor/manualEditingAvailability";
import { type DomEditSelection } from "../components/editor/domEditing";
import type { ApplyDomSelectionOptions, ResolveDomSelectionOptions } from "./useDomSelection";

declare global {
  interface Window {
    __hfPreviewTextSelectionSuppressUntil?: number;
  }
}

function isPreviewTextSelectionSuppressingCanvas(): boolean {
  return (window.__hfPreviewTextSelectionSuppressUntil ?? 0) > Date.now();
}

// ── Types ──

export interface UsePreviewInteractionParams {
  captionEditMode: boolean;
  compositionLoading: boolean;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;

  // From useDomSelection
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: ApplyDomSelectionOptions,
  ) => void;
  resolveDomSelectionFromPreviewPoint: (
    clientX: number,
    clientY: number,
    options?: ResolveDomSelectionOptions,
  ) => Promise<DomEditSelection | null>;
  updateDomEditHoverSelection: (selection: DomEditSelection | null) => void;

  onClickToSource?: (selection: DomEditSelection) => void;
}

export interface PreviewMouseDownOptions {
  preferClipAncestor?: boolean;
  hoverSelection?: DomEditSelection | null;
}

interface PreviewHoverRequest {
  clientX: number;
  clientY: number;
  preferClipAncestor: boolean;
  sequence: number;
}

// ── Hook ──

export function usePreviewInteraction({
  captionEditMode,
  compositionLoading,
  previewIframeRef,
  showToast,
  applyDomSelection,
  resolveDomSelectionFromPreviewPoint,
  updateDomEditHoverSelection,
  onClickToSource,
}: UsePreviewInteractionParams) {
  const hoverFrameRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<PreviewHoverRequest | null>(null);
  const hoverSequenceRef = useRef(0);

  const cancelPendingHover = useCallback(() => {
    hoverSequenceRef.current += 1;
    pendingHoverRef.current = null;
    if (hoverFrameRef.current !== null) {
      cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = null;
    }
  }, []);

  useEffect(() => cancelPendingHover, [cancelPendingHover]);

  const pausePreviewPlayback = useCallback(() => {
    const pausedTime = pauseStudioPreviewPlayback(previewIframeRef.current);
    const playerStore = usePlayerStore.getState();
    playerStore.setIsPlaying(false);
    if (pausedTime != null) {
      playerStore.setCurrentTime(pausedTime);
      liveTime.notify(pausedTime);
    }
  }, [previewIframeRef]);

  const handlePreviewCanvasMouseDown = useCallback(
    // fallow-ignore-next-line complexity
    async (e: React.MouseEvent<HTMLDivElement>, options?: PreviewMouseDownOptions) => {
      if (isPreviewTextSelectionSuppressingCanvas()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!STUDIO_PREVIEW_SELECTION_ENABLED || captionEditMode || compositionLoading) return;

      const wasPlaying = usePlayerStore.getState().isPlaying;
      pausePreviewPlayback();
      // A click that resolves to nothing (dead-zone / deselect) shouldn't leave
      // playback paused — pausing before sampling only exists to keep the hit
      // target stable while resolving; resume if nothing was selected.
      const resumeIfNothingSelected = () => {
        if (wasPlaying) usePlayerStore.getState().setIsPlaying(true);
      };

      if (STUDIO_MULTI_SELECTION_ENABLED && e.shiftKey) {
        // Additive selection — no cycling
        const nextSelection =
          (await resolveDomSelectionFromPreviewPoint(e.clientX, e.clientY, {
            preferClipAncestor: options?.preferClipAncestor ?? false,
          })) ??
          options?.hoverSelection ??
          null;
        if (!nextSelection) {
          resumeIfNothingSelected();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        applyDomSelection(nextSelection, { additive: true });
        return;
      }

      // Every click resolves the deepest authored child at this point.
      const nextSelection = await resolveDomSelectionFromPreviewPoint(e.clientX, e.clientY, {
        preferClipAncestor: options?.preferClipAncestor ?? false,
      });
      // The fresh point hit-test is authoritative for a plain click. Falling
      // back to the prior hover cache here makes a direct click on blank space
      // reselect the element the pointer just left instead of clearing it.
      const resolvedSelection = nextSelection;
      if (!resolvedSelection) {
        e.preventDefault();
        e.stopPropagation();
        updateDomEditHoverSelection(null);
        applyDomSelection(null, { revealPanel: false });
        resumeIfNothingSelected();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      applyDomSelection(resolvedSelection);

      if (!e.shiftKey && e.altKey && onClickToSource) {
        onClickToSource(resolvedSelection);
      }
    },
    [
      applyDomSelection,
      captionEditMode,
      compositionLoading,
      onClickToSource,
      pausePreviewPlayback,
      resolveDomSelectionFromPreviewPoint,
      updateDomEditHoverSelection,
    ],
  );

  const resolveAndPublishHover = useCallback(
    async (request: PreviewHoverRequest) => {
      const nextSelection = await resolveDomSelectionFromPreviewPoint(
        request.clientX,
        request.clientY,
        {
          preferClipAncestor: request.preferClipAncestor,
          skipSourceProbe: true,
        },
      );
      // Point resolution crosses the iframe boundary and can finish out of order.
      // Only the newest pointer sample is allowed to update the hover selection.
      if (request.sequence !== hoverSequenceRef.current) return null;
      updateDomEditHoverSelection(nextSelection);
      return nextSelection;
    },
    [resolveDomSelectionFromPreviewPoint, updateDomEditHoverSelection],
  );

  const handlePreviewCanvasPointerMove = useCallback(
    // fallow-ignore-next-line complexity
    async (e: React.PointerEvent<HTMLDivElement>, options?: { preferClipAncestor?: boolean }) => {
      if (isPreviewTextSelectionSuppressingCanvas()) {
        cancelPendingHover();
        updateDomEditHoverSelection(null);
        return null;
      }
      if (!STUDIO_PREVIEW_SELECTION_ENABLED || captionEditMode || compositionLoading) {
        cancelPendingHover();
        updateDomEditHoverSelection(null);
        return null;
      }

      const request: PreviewHoverRequest = {
        clientX: e.clientX,
        clientY: e.clientY,
        preferClipAncestor: options?.preferClipAncestor ?? false,
        sequence: ++hoverSequenceRef.current,
      };

      // Context-menu hit testing reuses this callback and awaits its result, so
      // keep non-pointermove calls synchronous from the caller's perspective.
      if (e.type !== "pointermove") return resolveAndPublishHover(request);

      pendingHoverRef.current = request;
      if (hoverFrameRef.current === null) {
        hoverFrameRef.current = requestAnimationFrame(() => {
          hoverFrameRef.current = null;
          const latest = pendingHoverRef.current;
          pendingHoverRef.current = null;
          if (latest) void resolveAndPublishHover(latest);
        });
      }
      return null;
    },
    [
      cancelPendingHover,
      captionEditMode,
      compositionLoading,
      resolveAndPublishHover,
      updateDomEditHoverSelection,
    ],
  );

  const handlePreviewCanvasPointerLeave = useCallback(() => {
    cancelPendingHover();
    updateDomEditHoverSelection(null);
  }, [cancelPendingHover, updateDomEditHoverSelection]);

  const handleBlockedDomMove = useCallback(
    (selection: DomEditSelection) => {
      showToast(
        selection.capabilities.reasonIfDisabled ??
          "This element can't be adjusted directly from the preview.",
        "info",
      );
    },
    [showToast],
  );

  const handleDomManualDragStart = useCallback(() => {
    pausePreviewPlayback();
  }, [pausePreviewPlayback]);

  return {
    handlePreviewCanvasMouseDown,
    handlePreviewCanvasPointerMove,
    handlePreviewCanvasPointerLeave,
    handleBlockedDomMove,
    handleDomManualDragStart,
  };
}
