import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { PlayerControls } from "../../player";
import type { TimelineElement } from "../../player";
import { NLEPreview } from "./NLEPreview";
import { CompositionBreadcrumb } from "./CompositionBreadcrumb";
import { usePreviewBlockDrop } from "./usePreviewBlockDrop";
import { useNLEContext } from "./NLEContext";
import { AssetPreviewOverlay } from "./AssetPreviewOverlay";
import { useDomEditSelectionContext } from "../../contexts/DomEditContext";
import { PreviewTextSelectionToolbar } from "./PreviewTextSelectionToolbar";

function subscribeFullscreen(cb: () => void) {
  document.addEventListener("fullscreenchange", cb);
  return () => document.removeEventListener("fullscreenchange", cb);
}

function getFullscreenElement() {
  return document.fullscreenElement;
}

// Clear the timeline selection when a pointer lands outside the composition
// frame (clicks *inside* the frame are handled by the DOM-edit overlay).
// fallow-ignore-next-line complexity
function deselectIfPointerOutsideFrame(
  e: React.PointerEvent,
  iframe: HTMLIFrameElement | null,
  onDeselect?: (element: null) => void,
): void {
  const el = iframe?.parentElement ?? iframe;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const outside =
    e.clientX < rect.left ||
    e.clientX > rect.right ||
    e.clientY < rect.top ||
    e.clientY > rect.bottom;
  if (outside) onDeselect?.(null);
}

export interface PreviewPaneProps {
  portrait?: boolean;
  /** Slot for overlays rendered on top of the preview (cursors, highlights, etc.) */
  previewOverlay?: ReactNode;
  onSelectTimelineElement?: (element: TimelineElement | null) => void;
  onPreviewBlockDrop?: (
    blockName: string,
    position: { left: number; top: number },
  ) => Promise<void> | void;
}

// fallow-ignore-next-line complexity
export function PreviewPane({
  portrait,
  previewOverlay,
  onSelectTimelineElement,
  onPreviewBlockDrop,
}: PreviewPaneProps) {
  const {
    projectId,
    iframeRef,
    togglePlay,
    seek,
    onIframeLoad,
    compositionStack,
    handleNavigateComposition,
    setCompositionLoading,
    timelineDisabled,
    hasLoadedOnceRef,
    previewCompositionSize,
    setPreviewCompositionSize,
  } = useNLEContext();
  const { domEditSelection } = useDomEditSelectionContext();

  const stageRefForDrop = useRef<HTMLDivElement | null>(null);
  const handleStageRef = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    stageRefForDrop.current = ref.current;
  }, []);

  const {
    isDragOver: previewDragOver,
    handleDragEnter: handlePreviewDragEnter,
    handleDragOver: handlePreviewDragOver,
    handleDragLeave: handlePreviewDragLeave,
    handleDrop: handlePreviewDrop,
  } = usePreviewBlockDrop({
    portrait,
    compositionSize: previewCompositionSize,
    stageRef: stageRefForDrop as React.RefObject<HTMLDivElement | null>,
    onBlockDrop: onPreviewBlockDrop,
  });

  // Preview-only fullscreen: fullscreen targets THIS pane's container, so the
  // browser shows only the preview (sidebars + timeline are excluded naturally).
  const containerRef = useRef<HTMLDivElement>(null);
  const [isStudioFullscreen, setIsStudioFullscreen] = useState(false);
  const fullscreenElement = useSyncExternalStore(subscribeFullscreen, getFullscreenElement);
  const isNativeFullscreen = fullscreenElement === containerRef.current && fullscreenElement != null;
  const isFullscreen = isNativeFullscreen || isStudioFullscreen;

  useEffect(() => {
    if (!isNativeFullscreen && fullscreenElement) setIsStudioFullscreen(false);
  }, [fullscreenElement, isNativeFullscreen]);

  useEffect(() => {
    document.body.toggleAttribute("data-studio-preview-fullscreen", isFullscreen);
    return () => document.body.removeAttribute("data-studio-preview-fullscreen");
  }, [isFullscreen]);

  useEffect(() => {
    if (!isStudioFullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsStudioFullscreen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isStudioFullscreen]);

  const toggleFullscreen = useCallback(() => {
    const target = containerRef.current;
    if (!target) return;
    if (isStudioFullscreen) {
      setIsStudioFullscreen(false);
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      setIsStudioFullscreen(false);
    } else {
      const fallbackTimer = window.setTimeout(() => {
        if (document.fullscreenElement !== target) setIsStudioFullscreen(true);
      }, 350);
      target.requestFullscreen().then(
        () => {
          window.clearTimeout(fallbackTimer);
          if (document.fullscreenElement !== target) setIsStudioFullscreen(true);
        },
        (err) => {
          window.clearTimeout(fallbackTimer);
          console.warn(
            "[Studio] Native fullscreen unavailable; using in-app fullscreen:",
            err instanceof Error ? err.message : err,
          );
          setIsStudioFullscreen(true);
        },
      );
    }
  }, [isStudioFullscreen]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    node.addEventListener("studio-toggle-fullscreen", toggleFullscreen);
    return () => node.removeEventListener("studio-toggle-fullscreen", toggleFullscreen);
  }, [toggleFullscreen]);

  const currentLevel = compositionStack[compositionStack.length - 1];
  const directUrl = compositionStack.length > 1 ? currentLevel.previewUrl : undefined;

  return (
    <div
      ref={containerRef}
      // Panel chrome (rounded border) is dropped in fullscreen so the preview
      // fills the screen edge-to-edge.
      className={`hf-preview-pane flex-1 min-h-0 flex flex-col overflow-hidden bg-neutral-950 ${
        isFullscreen ? "" : "rounded-lg border border-neutral-800/50"
      } ${isStudioFullscreen ? "hf-preview-pane--studio-fullscreen" : ""}`}
      data-studio-fullscreen-target=""
      data-studio-fullscreen-active={isFullscreen ? "" : undefined}
    >
      <div
        className="flex-1 min-h-0 relative overflow-hidden"
        data-preview-pan-surface="true"
        onPointerDown={(e) =>
          deselectIfPointerOutsideFrame(e, iframeRef.current, onSelectTimelineElement)
        }
        onDragEnter={handlePreviewDragEnter}
        onDragOver={handlePreviewDragOver}
        onDragLeave={handlePreviewDragLeave}
        onDrop={handlePreviewDrop}
      >
        <div className="absolute inset-0 overflow-hidden">
          <NLEPreview
            projectId={projectId}
            iframeRef={iframeRef}
            onIframeLoad={onIframeLoad}
            onCompositionLoadingChange={setCompositionLoading}
            portrait={portrait}
            directUrl={directUrl}
            suppressLoadingOverlay={hasLoadedOnceRef.current}
            onStageRef={handleStageRef}
            onCompositionSizeChange={setPreviewCompositionSize}
          />
          {previewDragOver && (
            <div className="absolute inset-2 z-40 rounded-lg border-2 border-dashed border-studio-accent/50 bg-studio-accent/[0.04] pointer-events-none" />
          )}
          <AssetPreviewOverlay />
        </div>
        {!isFullscreen && previewOverlay}
        <PreviewTextSelectionToolbar
          iframeRef={iframeRef}
          containerRef={containerRef}
          activeSelection={domEditSelection}
          hidden={isFullscreen || timelineDisabled}
        />
      </div>
      {/* Transport row: no own background or border — the controls sit flat on
          the preview panel's surface (CapCut-style). */}
      <div className="flex-shrink-0">
        {!isFullscreen && compositionStack.length > 1 && (
          <CompositionBreadcrumb stack={compositionStack} onNavigate={handleNavigateComposition} />
        )}
        <PlayerControls
          onTogglePlay={togglePlay}
          onSeek={seek}
          disabled={timelineDisabled}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        />
      </div>
    </div>
  );
}
