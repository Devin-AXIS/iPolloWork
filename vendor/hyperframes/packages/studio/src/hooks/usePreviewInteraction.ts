import { useCallback } from "react";
import { liveTime, usePlayerStore } from "../player";
import { pauseStudioPreviewPlayback } from "../utils/studioPreviewHelpers";
import { STUDIO_PREVIEW_SELECTION_ENABLED } from "../components/editor/manualEditingAvailability";
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

      if (e.shiftKey) {
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
      const resolvedSelection = nextSelection ?? options?.hoverSelection ?? null;
      if (!resolvedSelection) {
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
    ],
  );

  const handlePreviewCanvasPointerMove = useCallback(
    // fallow-ignore-next-line complexity
    async (e: React.PointerEvent<HTMLDivElement>, options?: { preferClipAncestor?: boolean }) => {
      if (isPreviewTextSelectionSuppressingCanvas()) {
        updateDomEditHoverSelection(null);
        return null;
      }
      if (!STUDIO_PREVIEW_SELECTION_ENABLED || captionEditMode || compositionLoading) {
        updateDomEditHoverSelection(null);
        return null;
      }

      const nextSelection = await resolveDomSelectionFromPreviewPoint(e.clientX, e.clientY, {
        preferClipAncestor: options?.preferClipAncestor ?? false,
        skipSourceProbe: true,
      });
      updateDomEditHoverSelection(nextSelection);
      return nextSelection;
    },
    [
      captionEditMode,
      compositionLoading,
      resolveDomSelectionFromPreviewPoint,
      updateDomEditHoverSelection,
    ],
  );

  const handlePreviewCanvasPointerLeave = useCallback(() => {
    updateDomEditHoverSelection(null);
  }, [updateDomEditHoverSelection]);

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
