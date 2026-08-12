import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { PanelTabButton } from "./PanelTabButton";
import { usePreviewVariablesStore } from "../hooks/previewVariablesStore";
import type { RenderJob } from "./renders/useRenderQueue";
import type { BlockParam } from "@hyperframes/core/registry";
import { readMotionInstanceFromExtras } from "@hyperframes/core/motion-presets";
import { STUDIO_INSPECTOR_PANELS_ENABLED } from "./editor/manualEditingAvailability";
import type { Composition } from "@hyperframes/sdk";
import type { EditHistoryKind } from "../utils/editHistory";
import type { UseSlideshowPersistParams } from "../hooks/useSlideshowPersist";
import type { EffectInsertIntent } from "../utils/blockInstaller";
import type { AnimationTemplateDraft } from "./sidebar/AnimationTemplatesTab";

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
import { postVideoAiSelectionToHost } from "./editor/domEditingAgentPrompt";
import { MIN_RIGHT_PANEL_WIDTH } from "../hooks/usePanelLayout";

const loadPropertyPanel = () =>
  import("./editor/PropertyPanel").then((module) => ({ default: module.PropertyPanel }));
const PropertyPanel = lazy(loadPropertyPanel);

export const preloadStudioPropertyPanel = () => loadPropertyPanel();
const DesignPanelPromoteProvider = lazy(() =>
  import("./DesignPanelPromoteProvider").then((module) => ({
    default: module.DesignPanelPromoteProvider,
  })),
);
const CaptionPropertyPanel = lazy(() =>
  import("../captions/components/CaptionPropertyPanel").then((module) => ({
    default: module.CaptionPropertyPanel,
  })),
);
const BlockParamsPanel = lazy(() =>
  import("./editor/BlockParamsPanel").then((module) => ({ default: module.BlockParamsPanel })),
);
const RenderQueue = lazy(() =>
  import("./renders/RenderQueue").then((module) => ({ default: module.RenderQueue })),
);
const loadBlocksTab = () =>
  import("./sidebar/BlocksTab").then((module) => ({ default: module.BlocksTab }));
const BlocksTab = lazy(loadBlocksTab);
export const preloadStudioEffectsPanel = async (): Promise<void> => {
  await Promise.all([
    loadBlocksTab(),
    import("../hooks/useBlockCatalog").then((module) => module.preloadBlockCatalog()),
  ]);
};
const AnimationTemplatesTab = lazy(() =>
  import("./sidebar/AnimationTemplatesTab").then((module) => ({
    default: module.AnimationTemplatesTab,
  })),
);
const AnimationPropertiesPanel = lazy(() =>
  import("./editor/SemanticMotionPanel").then((module) => ({
    default: module.AnimationPropertiesPanel,
  })),
);
const AssetsTab = lazy(() =>
  import("./sidebar/AssetsTab").then((module) => ({ default: module.AssetsTab })),
);
const IllustrationTab = lazy(() =>
  import("./sidebar/IllustrationTab").then((module) => ({ default: module.IllustrationTab })),
);

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
  onAddBlock?: (blockName: string, intent?: EffectInsertIntent) => Promise<boolean>;
}

function animationSelectionKey(
  selection: AnimationTemplateDraft["selection"] | null | undefined,
): string | null {
  if (!selection) return null;
  const locator = selection.hfId ?? selection.id ?? selection.selector;
  return locator ? `${selection.compositionPath}:${selection.sourceFile}:${locator}` : null;
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
  const { t, tx } = useStudioI18n();

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
    selectedGsapAnimations,
    gsapMultipleTimelines,
    gsapUnsupportedTimelinePattern,
    handleGsapUpdateProperty,
    handleGsapUpdateMeta,
    handleGsapDeleteAnimation,
    handleGsapAddAnimation,
    handleMotionMutation,
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
  const [pendingMotionDraft, setPendingMotionDraft] = useState<AnimationTemplateDraft | null>(null);
  const [animationPreviewRequest, setAnimationPreviewRequest] = useState(0);

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
  const singleDomEditSelection = domEditGroupSelections.length > 1 ? null : domEditSelection;
  const propertyPanelContent = (
    <PropertyPanel
      projectId={projectId}
      projectDir={projectDir}
      assets={assets}
      element={singleDomEditSelection}
      inspectorMode={rightPanelTab === "animation-properties" ? "animation" : "properties"}
      showInspectorChrome={rightPanelTab !== "animation-properties"}
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
      onAskAgent={
        singleDomEditSelection
          ? () => postVideoAiSelectionToHost(singleDomEditSelection)
          : undefined
      }
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
      onMutateMotion={handleMotionMutation}
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
  );
  const propertyPanel = singleDomEditSelection ? (
    <DesignPanelPromoteProvider
      selection={singleDomEditSelection}
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
      {propertyPanelContent}
    </DesignPanelPromoteProvider>
  ) : (
    propertyPanelContent
  );
  const animationPanelActive =
    rightPanelTab === "animation" || rightPanelTab === "animation-properties";
  const hasSelectedSemanticMotion = selectedGsapAnimations.some(
    (animation) => readMotionInstanceFromExtras(animation.extras) !== null,
  );
  const showAnimationProperties =
    rightPanelTab === "animation-properties" &&
    (pendingMotionDraft !== null || hasSelectedSemanticMotion);
  const selectAnimationTemplate = useCallback(
    (draft: AnimationTemplateDraft) => {
      setPendingMotionDraft(draft);
      setRightPanelTab("animation-properties");
    },
    [setRightPanelTab],
  );
  const currentAnimationSelectionKey = animationSelectionKey(domEditSelection);
  const pendingAnimationSelectionKey = animationSelectionKey(pendingMotionDraft?.selection);
  useEffect(() => {
    if (
      pendingMotionDraft &&
      currentAnimationSelectionKey &&
      currentAnimationSelectionKey !== pendingAnimationSelectionKey
    ) {
      setPendingMotionDraft(null);
    }
  }, [currentAnimationSelectionKey, pendingAnimationSelectionKey, pendingMotionDraft]);

  const animationPanel = (
    <div className="h-full min-h-0 overflow-hidden">
      {showAnimationProperties ? (
        <AnimationPropertiesPanel
          draft={pendingMotionDraft}
          element={singleDomEditSelection}
          animations={selectedGsapAnimations}
          onMutate={handleMotionMutation}
          previewRequest={animationPreviewRequest}
          onApplied={() => {
            setPendingMotionDraft(null);
            setAnimationPreviewRequest((request) => request + 1);
            showToast(tx("Animation applied"), "info");
          }}
        />
      ) : (
        <AnimationTemplatesTab onSelectTemplate={selectAnimationTemplate} />
      )}
    </div>
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

  const postHostPanel = useCallback(
    (panel: "voice" | "style") => {
      if (window.parent !== window) {
        window.parent.postMessage(
          {
            type: "ipollowork:video-studio-panel",
            projectId,
            panel,
            width: rightWidth,
          },
          "*",
        );
      }
    },
    [projectId, rightWidth],
  );

  const openHostPanel = (panel: "voice" | "style") => {
    setRightPanelTab(panel);
  };

  const closeHostPanel = useCallback(() => {
    if (window.parent !== window) {
      window.parent.postMessage(
        {
          type: "ipollowork:video-studio-panel",
          projectId,
          panel: null,
        },
        "*",
      );
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

  const selectStudioPanel = (
    panel:
      | "design"
      | "animation"
      | "animation-properties"
      | "illustration"
      | "assets"
      | "catalog"
      | "effects",
  ) => {
    closeHostPanel();
    setRightPanelTab(panel);
  };

  const exportDrawer = rightPanelTab === "renders";

  return (
    <>
      {/* 0.5px visual separator with an expanded pointer-capture zone. */}
      <div
        role="separator"
        aria-label={t("right.resizeInspector")}
        aria-orientation="vertical"
        tabIndex={0}
        className="group relative w-[0.5px] flex-shrink-0 cursor-ew-resize outline-none focus-visible:bg-studio-accent/20"
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
          setRightWidth(Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(600, rightWidth + delta)));
        }}
      >
        <div className="absolute inset-y-0 left-1/2 w-2 -translate-x-1/2" />
        <div className="absolute inset-y-0 left-0 w-[0.5px] bg-[var(--hf-studio-divider)] group-focus-visible:bg-studio-accent/60" />
      </div>
      <div
        className="flex min-w-0 flex-shrink-0 flex-col overflow-hidden border-[0.5px] border-[var(--hf-studio-divider)] bg-panel-bg"
        style={{ width: rightWidth, minWidth: MIN_RIGHT_PANEL_WIDTH }}
      >
        {captionEditMode ? (
          <Suspense
            fallback={
              <div className="h-full animate-pulse bg-panel-bg motion-reduce:animate-none" />
            }
          >
            <CaptionPropertyPanel iframeRef={previewIframeRef} />
          </Suspense>
        ) : (
          <>
            <div className="relative z-30 flex h-[49px] min-w-0 items-center overflow-hidden border-b-[0.5px] border-[var(--hf-studio-divider)] bg-panel-bg pl-3 pr-11">
              {exportDrawer ? (
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-neutral-200">
                  {t("right.renders")}
                </span>
              ) : (
                <div className="hf-inspector-tabs-scroll flex min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden pb-1">
                  <div className="flex w-max items-center gap-[5px]">
                    {STUDIO_INSPECTOR_PANELS_ENABLED && (
                      <PanelTabButton
                        label={t("right.design")}
                        tooltip={t("right.designTooltip")}
                        active={inspectorTabActive}
                        onClick={() => selectStudioPanel("design")}
                      />
                    )}
                    <PanelTabButton
                      label={t("right.style")}
                      tooltip={t("right.styleTooltip")}
                      active={rightPanelTab === "style"}
                      onClick={() => openHostPanel("style")}
                    />
                    <PanelTabButton
                      label={t("right.animation")}
                      tooltip={t("right.animationTooltip")}
                      active={animationPanelActive}
                      onClick={() => {
                        setPendingMotionDraft(null);
                        selectStudioPanel("animation");
                      }}
                    />
                    <PanelTabButton
                      label={t("right.catalog")}
                      tooltip={t("right.catalogTooltip")}
                      active={rightPanelTab === "catalog" || rightPanelTab === "effects"}
                      onClick={() => selectStudioPanel("catalog")}
                    />
                    <PanelTabButton
                      label={t("right.voice")}
                      tooltip={t("right.voiceTooltip")}
                      active={rightPanelTab === "voice"}
                      onClick={() => openHostPanel("voice")}
                    />
                    <PanelTabButton
                      label={t("right.illustration")}
                      tooltip={t("right.illustrationTooltip")}
                      active={rightPanelTab === "illustration"}
                      onClick={() => selectStudioPanel("illustration")}
                    />
                    <PanelTabButton
                      label={t("right.assets")}
                      tooltip={t("right.assetsTooltip")}
                      active={rightPanelTab === "assets"}
                      onClick={() => selectStudioPanel("assets")}
                    />
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  closeHostPanel();
                  setRightCollapsed(true);
                }}
                className="absolute right-3 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border border-transparent bg-panel-bg text-neutral-500 transition-colors hover:border-neutral-700 hover:bg-panel-input hover:text-neutral-200 active:scale-[0.96]"
                aria-label={tx("Close right panel")}
                title={tx("Close right panel")}
              >
                <X size={14} weight="bold" />
              </button>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden pt-3">
              <Suspense
                fallback={
                  <div className="h-full animate-pulse bg-panel-bg motion-reduce:animate-none" />
                }
              >
                <div key={rightPanelTab} className="h-full min-h-0 min-w-0 overflow-hidden">
                  {rightPanelTab === "block-params" && activeBlockParams ? (
                    <BlockParamsPanel
                      blockName={activeBlockParams.blockName}
                      blockTitle={activeBlockParams.blockTitle}
                      params={activeBlockParams.params}
                      compositionPath={activeBlockParams.compositionPath}
                      onClose={onCloseBlockParams ?? (() => {})}
                    />
                  ) : rightPanelTab === "catalog" || rightPanelTab === "effects" ? (
                    <BlocksTab page="effects" onAddBlock={onAddBlock} />
                  ) : animationPanelActive ? (
                    animationPanel
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
                      {rightPanelTab === "voice"
                        ? t("right.voiceTooltip")
                        : t("right.styleTooltip")}
                    </div>
                  ) : inspectorTabActive ? (
                    propertyPanel
                  ) : (
                    renderQueuePanel
                  )}
                </div>
              </Suspense>
            </div>
          </>
        )}
      </div>
    </>
  );
}
