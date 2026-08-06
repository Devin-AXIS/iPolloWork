import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { PlayerControls } from "../../player";
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

export interface PreviewPaneProps {
  portrait?: boolean;
  editingEnabled?: boolean;
  /** Slot for overlays rendered on top of the preview (cursors, highlights, etc.) */
  previewOverlay?: ReactNode;
  onPreviewBlockDrop?: (
    blockName: string,
    position: { left: number; top: number },
  ) => Promise<void> | void;
  onPreviewAssetDrop?: (assetPath: string) => Promise<void> | void;
}

// fallow-ignore-next-line complexity
export function PreviewPane({
  portrait,
  editingEnabled = true,
  previewOverlay,
  onPreviewBlockDrop,
  onPreviewAssetDrop,
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
    onAssetDrop: onPreviewAssetDrop,
  });

  // Preview-only fullscreen: fullscreen targets THIS pane's container, so the
  // browser shows only the preview (sidebars + timeline are excluded naturally).
  const containerRef = useRef<HTMLDivElement>(null);
  const [isStudioFullscreen, setIsStudioFullscreen] = useState(false);
  const fullscreenElement = useSyncExternalStore(subscribeFullscreen, getFullscreenElement);
  const isNativeFullscreen =
    fullscreenElement === containerRef.current && fullscreenElement != null;
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
      // Panel chrome is dropped in fullscreen so the preview fills the screen edge-to-edge.
      className={`hf-preview-pane flex-1 min-h-0 flex flex-col overflow-hidden bg-neutral-950 ${
        isFullscreen ? "" : "border-[0.5px] border-[var(--hf-studio-divider)]"
      } ${isStudioFullscreen ? "hf-preview-pane--studio-fullscreen" : ""}`}
      data-studio-fullscreen-target=""
      data-studio-fullscreen-active={isFullscreen ? "" : undefined}
    >
      <div
        className="flex-1 min-h-0 relative overflow-hidden"
        data-preview-pan-surface="true"
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
        {!isFullscreen && editingEnabled && previewOverlay}
        <PreviewTextSelectionToolbar
          iframeRef={iframeRef}
          containerRef={containerRef}
          activeSelection={editingEnabled ? domEditSelection : null}
          hidden={timelineDisabled || !editingEnabled}
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
