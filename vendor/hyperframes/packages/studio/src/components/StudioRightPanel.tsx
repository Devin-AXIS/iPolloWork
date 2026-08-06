import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { PropertyPanel } from "./editor/PropertyPanel";
import { CaptionPropertyPanel } from "../captions/components/CaptionPropertyPanel";
import { BlockParamsPanel } from "./editor/BlockParamsPanel";
import { RenderQueue } from "./renders/RenderQueue";
import { PanelTabButton } from "./PanelTabButton";
import { usePreviewVariablesStore } from "../hooks/previewVariablesStore";
import type { RenderJob } from "./renders/useRenderQueue";
import type { BlockParam } from "@hyperframes/core/registry";
import { STUDIO_INSPECTOR_PANELS_ENABLED } from "./editor/manualEditingAvailability";
import type { Composition } from "@hyperframes/sdk";
import type { EditHistoryKind } from "../utils/editHistory";
import type { UseSlideshowPersistParams } from "../hooks/useSlideshowPersist";
import { DesignPanelPromoteProvider } from "./DesignPanelPromoteProvider";

import { useStudioPlaybackContext, useStudioShellContext } from "../contexts/StudioContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { useFileManagerContext } from "../contexts/FileManagerContext";
import { useDomEditContext } from "../contexts/DomEditContext";
import { usePlayerStore } from "../player";
import { waitForMediaJob } from "./studioMediaJobs";
import {
  applyColorGradingScopeUpdate,
  EMPTY_COLOR_GRADING_SCOPE_RESULT,
  type ColorGradingScope,
} from "./studioColorGradingScope";
import type { BackgroundRemovalProgress } from "./editor/propertyPanelTypes";
import { timelineKeysForSelections, type ToggleHiddenHandler } from "../utils/studioHelpers";
import { useStudioI18n } from "../i18n";
import { X } from "../icons/SystemIcons";
import { BlocksTab, type BlockPreviewInfo } from "./sidebar/BlocksTab";
import { AssetsTab } from "./sidebar/AssetsTab";
import { IllustrationTab } from "./sidebar/IllustrationTab";

export interface StudioRightPanelProps {
  designPanelActive: boolean;
  activeBlockParams?: {
    blockName: string;
    blockTitle: string;
    params: BlockParam[];
    compositionPath: string;
  } | null;
  onCloseBlockParams?: () => void;
  recordingState?: "idle" | "recording" | "preview";
  recordingDuration?: number;
  onToggleRecording?: () => void;
  /** Dependencies for the Slideshow persist callback, threaded from App.tsx. */
  sdkSession: Composition | null;
  publishSdkSession: NonNullable<UseSlideshowPersistParams["publishSdkSession"]>;
  /**
   * Forces THIS `sdkSession` to re-open from disk. DesignPanelPromoteProvider
   * opens its own separate SDK session scoped to the selected element's own
   * file (needed so promoting inside a sub-composition binds a variable there,
   * not on the host) — for a top-level selection that's the SAME file this
   * session already has open, so a write through that other session leaves
   * this one holding stale in-memory content. The self-write-echo registry
   * that normally suppresses redundant reloads is keyed by file path only, not
   * by session instance, so it wrongly treats the sibling session's write as
   * "our own echo" and never reloads on its own — this must be called
   * explicitly after such a write.
   */
  forceReloadSdkSession?: () => void;
  reloadPreview: () => void;
  domEditSaveTimestampRef: MutableRefObject<number>;
  recordEdit: (entry: {
    label: string;
    kind: EditHistoryKind;
    files: Record<string, { before: string; after: string }>;
  }) => Promise<void>;
  onToggleElementHidden?: ToggleHiddenHandler;
  onAddBlock?: (blockName: string) => void;
  onPreviewBlock?: (preview: BlockPreviewInfo | null) => void;
}

// fallow-ignore-next-line complexity
export function StudioRightPanel({
  designPanelActive,
  activeBlockParams,
  onCloseBlockParams,
  recordingState,
  recordingDuration,
  onToggleRecording,
  sdkSession,
  publishSdkSession,
  forceReloadSdkSession,
  reloadPreview,
  domEditSaveTimestampRef,
  recordEdit,
  onToggleElementHidden,
  onAddBlock,
  onPreviewBlock,
}: StudioRightPanelProps) {
  const {
    rightWidth,
    setRightWidth,
    setRightCollapsed,
    rightPanelTab,
    setRightPanelTab,
    handlePanelResizeStart,
    handlePanelResizeMove,
    handlePanelResizeEnd,
  } = usePanelLayoutContext();

  const {
    previewIframeRef,
    projectId,
    activeCompPath,
    showToast,
    compositionDimensions,
    waitForPendingDomEditSaves,
    renderQueue,
  } = useStudioShellContext();
  const { captionEditMode } = useStudioPlaybackContext();
  const { t } = useStudioI18n();

  const {
    domEditSelection,
    domEditGroupSelections,
    copiedAgentPrompt,
    clearDomSelection,
    handleUngroupSelection,
    handleGroupSelection,
    handleDomStyleCommit,
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomHtmlAttributeCommit,
    handleDomAttributesCommit,
    handleDomPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomTextCommit,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
    handleAskAgent,
    selectedGsapAnimations,
    gsapMultipleTimelines,
    gsapUnsupportedTimelinePattern,
    handleGsapUpdateProperty,
    handleGsapUpdateMeta,
    handleGsapDeleteAnimation,
    handleGsapAddAnimation,
    handleGsapAddProperty,
    handleGsapRemoveProperty,
    handleGsapUpdateFromProperty,
    handleGsapAddFromProperty,
    handleGsapRemoveFromProperty,
    commitAnimatedProperty,
    commitAnimatedProperties,
    handleSetArcPath,
    handleUpdateArcSegment,
    handleUnroll,
    handleUpdateKeyframeEase,
    handleSetAllKeyframeEases,
    handleGsapAddKeyframe,
    handleGsapRemoveKeyframe,
    handleGsapConvertToKeyframes,
  } = useDomEditContext();

  const {
    assets,
    fontAssets,
    projectDir,
    handleImportFiles,
    handleImportFonts,
    handleDeleteFile,
    handleRenameFile,
    refreshFileTree,
    readProjectFile,
    writeProjectFile,
    fileTree,
  } = useFileManagerContext();

  const backgroundRemovalAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      backgroundRemovalAbortRef.current?.abort();
    },
    [],
  );

  const renderJobs = renderQueue.jobs as RenderJob[];
  const inspectorTabActive =
    rightPanelTab === "design" ||
    rightPanelTab === "layers" ||
    rightPanelTab === "slideshow" ||
    rightPanelTab === "variables";

  const handleApplyColorGradingScope = useCallback(
    async (scope: ColorGradingScope, value: string | null) =>
      applyColorGradingScopeUpdate({
        scope,
        value,
        selectedSourceFile: domEditSelection?.sourceFile || activeCompPath || "index.html",
        fileTree,
        projectId,
        domEditSaveTimestampRef,
        waitForPendingDomEditSaves,
        readProjectFile,
        writeProjectFile,
        recordEdit,
        reloadPreview,
        showToast,
      }).catch((error) => {
        showToast(
          `Couldn't apply color grading: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return EMPTY_COLOR_GRADING_SCOPE_RESULT;
      }),
    [
      activeCompPath,
      domEditSaveTimestampRef,
      domEditSelection?.sourceFile,
      fileTree,
      projectId,
      readProjectFile,
      recordEdit,
      reloadPreview,
      showToast,
      waitForPendingDomEditSaves,
      writeProjectFile,
    ],
  );

  const handleRemoveBackground = useCallback(
    // fallow-ignore-next-line complexity
    async (
      inputPath: string,
      options: {
        createBackgroundPlate?: boolean;
        quality?: "fast" | "balanced" | "best";
        onProgress?: (progress: BackgroundRemovalProgress) => void;
      },
    ) => {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/media/remove-background`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inputPath,
            createBackgroundPlate: options.createBackgroundPlate === true,
            quality: options.quality ?? "balanced",
          }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
      };
      if (!response.ok || !data.jobId) {
        throw new Error(data.error || `Background removal failed (${response.status})`);
      }
      showToast("Removing background...", "info");
      backgroundRemovalAbortRef.current?.abort();
      const controller = new AbortController();
      backgroundRemovalAbortRef.current = controller;
      try {
        const result = await waitForMediaJob(data.jobId, options.onProgress, controller.signal);
        await refreshFileTree();
        showToast(`Created transparent asset: ${result.outputPath.split("/").pop()}`, "info");
        return result;
      } finally {
        if (backgroundRemovalAbortRef.current === controller) {
          backgroundRemovalAbortRef.current = null;
        }
      }
    },
    [projectId, refreshFileTree, showToast],
  );
  const handleHideAllSelected = () => {
    const { elements } = usePlayerStore.getState();
    const keys = timelineKeysForSelections(domEditGroupSelections, elements, activeCompPath);
    if (keys.length > 0) void onToggleElementHidden?.(keys, true);
  };
  const propertyPanel = (
    <DesignPanelPromoteProvider
      selection={domEditGroupSelections.length > 1 ? null : domEditSelection}
      projectId={projectId}
      activeCompPath={activeCompPath}
      showToast={showToast}
      readProjectFile={readProjectFile}
      writeProjectFile={writeProjectFile}
      recordEdit={recordEdit}
      reloadPreview={reloadPreview}
      domEditSaveTimestampRef={domEditSaveTimestampRef}
      forceReloadSharedSdkSession={forceReloadSdkSession}
    >
      <PropertyPanel
        projectId={projectId}
        projectDir={projectDir}
        assets={assets}
        element={domEditGroupSelections.length > 1 ? null : domEditSelection}
        multiSelectCount={domEditGroupSelections.length}
        multiSelectedElements={domEditGroupSelections}
        onGroupSelection={handleGroupSelection}
        onHideAllSelected={handleHideAllSelected}
        copiedAgentPrompt={copiedAgentPrompt}
        onClearSelection={clearDomSelection}
        onToggleElementHidden={onToggleElementHidden}
        onUngroup={handleUngroupSelection}
        onSetStyle={handleDomStyleCommit}
        onSetAttribute={handleDomAttributeCommit}
        onSetAttributes={handleDomAttributesCommit}
        onSetAttributeLive={handleDomAttributeLiveCommit}
        onApplyColorGradingScope={handleApplyColorGradingScope}
        onSetHtmlAttribute={handleDomHtmlAttributeCommit}
        onRemoveBackground={handleRemoveBackground}
        onSetManualOffset={handleDomPathOffsetCommit}
        onSetManualSize={handleDomBoxSizeCommit}
        onSetManualRotation={handleDomRotationCommit}
        onSetText={handleDomTextCommit}
        onSetTextFieldStyle={handleDomTextFieldStyleCommit}
        onAddTextField={handleDomAddTextField}
        onRemoveTextField={handleDomRemoveTextField}
        onAskAgent={handleAskAgent}
        onImportAssets={handleImportFiles}
        fontAssets={fontAssets}
        onImportFonts={handleImportFonts}
        previewIframeRef={previewIframeRef}
        gsapAnimations={selectedGsapAnimations}
        gsapMultipleTimelines={gsapMultipleTimelines}
        gsapUnsupportedTimelinePattern={gsapUnsupportedTimelinePattern}
        onUpdateGsapProperty={handleGsapUpdateProperty}
        onUpdateGsapMeta={handleGsapUpdateMeta}
        onDeleteGsapAnimation={handleGsapDeleteAnimation}
        onAddGsapProperty={handleGsapAddProperty}
        onRemoveGsapProperty={handleGsapRemoveProperty}
        onUpdateGsapFromProperty={handleGsapUpdateFromProperty}
        onAddGsapFromProperty={handleGsapAddFromProperty}
        onRemoveGsapFromProperty={handleGsapRemoveFromProperty}
        onAddGsapAnimation={handleGsapAddAnimation}
        onCommitAnimatedProperty={commitAnimatedProperty}
        onCommitAnimatedProperties={commitAnimatedProperties}
        onAddKeyframe={handleGsapAddKeyframe}
        onRemoveKeyframe={handleGsapRemoveKeyframe}
        onConvertToKeyframes={(animId, duration) =>
          handleGsapConvertToKeyframes(animId, undefined, duration)
        }
        onSeekToTime={(t) => usePlayerStore.getState().requestSeek(t)}
        onSetArcPath={handleSetArcPath}
        onUpdateArcSegment={handleUpdateArcSegment}
        onUnroll={handleUnroll}
        onUpdateKeyframeEase={handleUpdateKeyframeEase}
        onSetAllKeyframeEases={handleSetAllKeyframeEases}
        recordingState={recordingState}
        recordingDuration={recordingDuration}
        onToggleRecording={onToggleRecording}
      />
    </DesignPanelPromoteProvider>
  );

  const renderQueuePanel = (
    <RenderQueue
      jobs={renderJobs}
      projectId={projectId}
      onDelete={renderQueue.deleteRender}
      onCancel={renderQueue.cancelRender}
      loadError={renderQueue.loadError}
      onRetryLoad={renderQueue.reloadRenders}
      actionError={renderQueue.actionError}
      onDismissActionError={renderQueue.dismissActionError}
      onClearCompleted={renderQueue.clearCompleted}
      onStartRender={async (format, quality, resolution, fps, outputSize, captureSize) => {
        try {
          await waitForPendingDomEditSaves();
          const composition =
            activeCompPath && activeCompPath !== "index.html" ? activeCompPath : undefined;
          await renderQueue.startRender({
            fps,
            quality,
            format,
            resolution,
            outputSize,
            captureSize,
            composition,
            // Render what the user is previewing: active variable overrides
            // from the Variables panel ride along (undefined = defaults).
            variables: usePreviewVariablesStore.getState().values ?? undefined,
          });
        } catch (error) {
          showToast(
            `Couldn't start export: ${error instanceof Error ? error.message : "Unknown error"}`,
            "error",
          );
        }
      }}
      compositionDimensions={compositionDimensions}
      isRendering={renderQueue.isRendering}
    />
  );

  const postHostPanel = useCallback((panel: "voice" | "style") => {
    if (window.parent !== window) {
      window.parent.postMessage({
        type: "ipollowork:video-studio-panel",
        projectId,
        panel,
        width: rightWidth,
      }, "*");
    }
  }, [projectId, rightWidth]);

  const openHostPanel = (panel: "voice" | "style") => {
    setRightPanelTab(panel);
  };

  const closeHostPanel = useCallback(() => {
    if (window.parent !== window) {
      window.parent.postMessage({
        type: "ipollowork:video-studio-panel",
        projectId,
        panel: null,
      }, "*");
    }
  }, [projectId]);

  useEffect(() => {
    if (rightPanelTab === "voice" || rightPanelTab === "style") {
      postHostPanel(rightPanelTab);
      return;
    }
    closeHostPanel();
  }, [closeHostPanel, postHostPanel, rightPanelTab]);

  useEffect(() => () => closeHostPanel(), [closeHostPanel]);

  const selectStudioPanel = (panel: "design" | "illustration" | "assets" | "catalog" | "effects") => {
    closeHostPanel();
    setRightPanelTab(panel);
  };

  const exportDrawer = rightPanelTab === "renders";

  return (
    <>
      {/* Vertical resize divider: 3px visible seam, 8px pointer-capture zone via
          the absolutely-positioned inner hit area. */}
      <div
        role="separator"
        aria-label={t("right.resizeInspector")}
        aria-orientation="vertical"
        tabIndex={0}
        className="group relative w-[3px] flex-shrink-0 cursor-col-resize outline-none focus-visible:bg-studio-accent/20"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => handlePanelResizeStart("right", e)}
        onPointerMove={handlePanelResizeMove}
        onPointerUp={handlePanelResizeEnd}
        onPointerCancel={handlePanelResizeEnd}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          // Panel is right-anchored: ArrowLeft grows it, ArrowRight shrinks it.
          const delta = e.key === "ArrowLeft" ? 16 : -16;
          setRightWidth(Math.max(160, Math.min(600, rightWidth + delta)));
        }}
      >
        {/* Expanded hit zone: 8px wide, centered on the 3px seam */}
        <div className="absolute inset-y-0 -left-[2.5px] w-2" />
        {/* Visible hairline */}
        <div className="absolute top-1/2 left-0 h-[52px] w-[3px] -translate-y-1/2 bg-white/12 transition-colors group-hover:bg-white/18 group-active:bg-white/24" />
      </div>
      <div
        className="flex min-w-0 flex-shrink-0 flex-col overflow-hidden rounded-lg border border-panel-hairline bg-panel-bg"
        style={{ width: rightWidth }}
      >
        {captionEditMode ? (
          <CaptionPropertyPanel iframeRef={previewIframeRef} />
        ) : (
          <>
            <div className="relative z-30 flex h-[49px] min-w-0 items-center gap-[5px] overflow-visible border-b border-panel-hairline bg-panel-bg px-3">
              {exportDrawer ? (
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-neutral-200">
                  {t("right.renders")}
                </span>
              ) : (<>
              {STUDIO_INSPECTOR_PANELS_ENABLED && (
                <>
                  <PanelTabButton
                    label={t("right.design")}
                    tooltip={t("right.designTooltip")}
                    active={inspectorTabActive}
                    onClick={() => selectStudioPanel("design")}
                  />
                </>
              )}
              <PanelTabButton
                label={t("right.voice")}
                tooltip={t("right.voiceTooltip")}
                active={rightPanelTab === "voice"}
                onClick={() => openHostPanel("voice")}
              />
              <PanelTabButton
                label={t("right.style")}
                tooltip={t("right.styleTooltip")}
                active={rightPanelTab === "style"}
                onClick={() => openHostPanel("style")}
              />
              <PanelTabButton
                label="插画"
                tooltip="使用 Ian 小黑插画能力生成视频素材"
                active={rightPanelTab === "illustration"}
                onClick={() => selectStudioPanel("illustration")}
              />
              <PanelTabButton
                label={t("right.assets")}
                tooltip={t("right.assetsTooltip")}
                active={rightPanelTab === "assets"}
                onClick={() => selectStudioPanel("assets")}
              />
              <PanelTabButton
                label={t("right.catalog")}
                tooltip={t("right.catalogTooltip")}
                active={rightPanelTab === "catalog" || rightPanelTab === "effects"}
                onClick={() => selectStudioPanel("catalog")}
              />
              </>)}
              <button
                type="button"
                onClick={() => { closeHostPanel(); setRightCollapsed(true); }}
                className="ml-auto flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-transparent text-neutral-500 transition-colors hover:border-neutral-700 hover:bg-neutral-800 hover:text-neutral-200 active:scale-[0.96]"
                aria-label="Close right panel"
                title="Close right panel"
              >
                <X size={14} weight="bold" />
              </button>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden pt-3">
              {rightPanelTab === "block-params" && activeBlockParams ? (
                <BlockParamsPanel
                  blockName={activeBlockParams.blockName}
                  blockTitle={activeBlockParams.blockTitle}
                  params={activeBlockParams.params}
                  compositionPath={activeBlockParams.compositionPath}
                  onClose={onCloseBlockParams ?? (() => {})}
                />
              ) : rightPanelTab === "catalog" || rightPanelTab === "effects" ? (
                <BlocksTab
                  key="animation"
                  page="animation"
                  onAddBlock={onAddBlock}
                  onPreviewBlock={onPreviewBlock}
                />
              ) : rightPanelTab === "illustration" ? (
                <IllustrationTab />
              ) : rightPanelTab === "assets" ? (
                <AssetsTab
                  projectId={projectId}
                  assets={assets}
                  onRefresh={refreshFileTree}
                  onImport={handleImportFiles}
                  onDelete={handleDeleteFile}
                  onRename={handleRenameFile}
                />
              ) : rightPanelTab === "voice" || rightPanelTab === "style" ? (
                <div className="grid h-full place-items-center px-6 text-center text-xs text-neutral-500">
                  {rightPanelTab === "voice" ? t("right.voiceTooltip") : t("right.styleTooltip")}
                </div>
              ) : inspectorTabActive ? (
                <div className="h-full min-h-0 min-w-0 overflow-hidden">{propertyPanel}</div>
              ) : (
                renderQueuePanel
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
