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
import {
  formatVisualComponentDataForAi,
  toJSON,
  componentContentSchema,
  componentContentGuide,
  type BlockParam,
  type RegistryVariable,
  type RegistryVisualComponent,
} from "@hyperframes/core/registry";
import { STUDIO_INSPECTOR_PANELS_ENABLED } from "./editor/manualEditingAvailability";
import type { EditHistoryKind } from "../utils/editHistory";

import { useStudioPlaybackContext, useStudioShellContext } from "../contexts/StudioContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { useFileManagerContext } from "../contexts/FileManagerContext";
import { useDomEditContext } from "../contexts/DomEditContext";
import { usePlayerStore } from "../player";
import { startBackgroundRemoval, waitForMediaJob } from "./studioMediaJobs";
import {
  applyColorGradingScopeUpdate,
  EMPTY_COLOR_GRADING_SCOPE_RESULT,
  type ColorGradingScope,
} from "./studioColorGradingScope";
import type { BackgroundRemovalProgress } from "./editor/propertyPanelTypes";
import { timelineKeysForSelections, type ToggleHiddenHandler } from "../utils/studioHelpers";
import { useStudioI18n } from "../i18n";
import { useDockLayoutStore } from "./dock/dockLayoutStore";
import type { VideoStudioPanelBounds } from "@ipollowork/types/hyperframes";

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
export const preloadStudioComponentsPanel = async (): Promise<void> => {
  await Promise.all([
    loadBlocksTab(),
    import("../hooks/useBlockCatalog").then((module) => module.preloadBlockCatalog()),
  ]);
};
const loadAnimationTemplatesTab = () =>
  import("./sidebar/AnimationTemplatesTab").then((module) => ({
    default: module.AnimationTemplatesTab,
  }));
const AnimationTemplatesTab = lazy(loadAnimationTemplatesTab);
export const preloadStudioAnimationPanel = () => loadAnimationTemplatesTab();
const AssetsTab = lazy(() =>
  import("./sidebar/AssetsTab").then((module) => ({ default: module.AssetsTab })),
);
export interface StudioRightPanelProps {
  onAddAssetToTimeline?: (path: string) => void;
  focusedHostAsset?: string;
  activeBlockParams?: {
    blockTitle: string;
    params: BlockParam[];
    variables: RegistryVariable[];
    variableValues: Record<string, string | number | boolean>;
    visualComponent?: RegistryVisualComponent;
    insertedElementId: string;
    hostCompositionPath: string;
  } | null;
  onBackFromBlockParams?: () => void;
  onBlockVariableChange?: (variableId: string, value: string | number | boolean) => Promise<void>;
  onBlockVariablesChange?: (values: Record<string, string | number | boolean>, expected: Record<string, string | number | boolean>) => Promise<void>;
  recordingState?: "idle" | "recording" | "preview";
  recordingDuration?: number;
  onToggleRecording?: () => void;
  /** Reload the preview SDK after the variable editor writes through its own session. */
  forceReloadSdkSession?: () => void;
  reloadPreview: () => void;
  domEditSaveTimestampRef: MutableRefObject<number>;
  recordEdit: (entry: {
    label: string;
    kind?: EditHistoryKind;
    files: Record<string, { before: string; after: string }>;
  }) => Promise<void>;
  onToggleElementHidden?: ToggleHiddenHandler;
  onAddBlock?: (blockName: string) => Promise<boolean>;
}

// fallow-ignore-next-line complexity
export function StudioRightPanel({
  onAddAssetToTimeline,
  focusedHostAsset,
  activeBlockParams,
  onBackFromBlockParams,
  onBlockVariableChange,
  onBlockVariablesChange,
  recordingState,
  recordingDuration,
  onToggleRecording,
  forceReloadSdkSession,
  reloadPreview,
  domEditSaveTimestampRef,
  recordEdit,
  onToggleElementHidden,
  onAddBlock,
}: StudioRightPanelProps) {
  const {
    rightWidth,
    rightCollapsed,
    setRightWidth,
    setRightCollapsed,
    rightPanelTab,
    setRightPanelTab,
  } = usePanelLayoutContext();

  const {
    previewIframeRef,
    projectId,
    activeCompPath,
    showToast,
    dismissToast,
    compositionDimensions,
    waitForPendingDomEditSaves,
    renderQueue,
  } = useStudioShellContext();
  const { captionEditMode } = useStudioPlaybackContext();
  const { t, tx } = useStudioI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const hostPanelSlotRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panelRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && Math.abs(entry.contentRect.width - rightWidth) > 1)
        setRightWidth(entry.contentRect.width);
    });
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [rightWidth, setRightWidth]);
  const [roleTab, setRoleTab] = useState<"avatar" | "voice">("voice");

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
    setAgentPromptSelectionContext,
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
      const jobId = await startBackgroundRemoval(projectId, inputPath, options);
      const loadingToastId = showToast("Removing background...", "loading");
      backgroundRemovalAbortRef.current?.abort();
      const controller = new AbortController();
      backgroundRemovalAbortRef.current = controller;
      try {
        const result = await waitForMediaJob(jobId, options.onProgress, controller.signal);
        await refreshFileTree();
        dismissToast(loadingToastId);
        showToast(`Created transparent asset: ${result.outputPath.split("/").pop()}`, "success");
        return result;
      } catch (error) {
        dismissToast(loadingToastId);
        throw error;
      } finally {
        if (backgroundRemovalAbortRef.current === controller) {
          backgroundRemovalAbortRef.current = null;
        }
      }
    },
    [dismissToast, projectId, refreshFileTree, showToast],
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
      showInspectorChrome
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
      onAskAgent={singleDomEditSelection ? () => {
        handleAskAgent();
        setAgentPromptSelectionContext(componentSemanticContext(activeBlockParams, singleDomEditSelection.id));
      } : undefined}
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

  const animationPanel = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 gap-1 border-b border-neutral-800 p-2">
        {(["animation", "animation-properties"] as const).map((tab) => (
          <button key={tab} type="button" aria-pressed={rightPanelTab === tab}
            className={`rounded px-3 py-1 text-[11px] ${rightPanelTab === tab ? "bg-neutral-700 text-white" : "text-neutral-400 hover:bg-neutral-800"}`}
            onClick={() => setRightPanelTab(tab)}>
            {tx(tab === "animation" ? "Animation templates" : "Selected animation properties")}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
      {rightPanelTab === "animation-properties" ? propertyPanel : <AnimationTemplatesTab
        onMutate={handleMotionMutation}
        onStatus={(status) =>
          showToast(
            t(
              status === "applied"
                ? "animation.applied"
                : status === "selection-required"
                  ? "animation.selectElement"
                  : status === "updated"
                    ? "animation.updated"
                    : "animation.removed",
            ),
            status === "selection-required" ? "error" : "success",
          )
        }
      />}
      </div>
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
    (panel: "voice" | "style" | "avatar") => {
      if (window.parent !== window) {
        const slot = hostPanelSlotRef.current?.getBoundingClientRect();
        if (!slot || window.innerWidth <= 0 || window.innerHeight <= 0) return;
        const left = Math.max(0, slot.left);
        const top = Math.max(0, slot.top);
        const width = Math.min(window.innerWidth, slot.right) - left;
        const height = Math.min(window.innerHeight, slot.bottom) - top;
        if (width <= 0 || height <= 0) return;
        const bounds: VideoStudioPanelBounds = {
          left: left / window.innerWidth,
          top: top / window.innerHeight,
          width: width / window.innerWidth,
          height: height / window.innerHeight,
        };
        window.parent.postMessage(
          {
            type: "ipollowork:video-studio-panel",
            projectId,
            panel,
            width: rightWidth,
            bounds,
          },
          "*",
        );
      }
    },
    [projectId, rightWidth],
  );

  const openHostPanel = (panel: "voice" | "style") => {
    if (panel === "voice" && rightPanelTab !== "voice") setRoleTab("voice");
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
    if (!rightCollapsed && (rightPanelTab === "voice" || rightPanelTab === "style")) {
      let frame = 0;
      const publish = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => postHostPanel(rightPanelTab === "voice" ? roleTab : "style"));
      };
      const observer = new ResizeObserver(publish);
      if (hostPanelSlotRef.current) observer.observe(hostPanelSlotRef.current);
      const unsubscribe = useDockLayoutStore.subscribe(publish);
      window.addEventListener("resize", publish);
      publish();
      return () => {
        observer.disconnect();
        unsubscribe();
        window.removeEventListener("resize", publish);
        cancelAnimationFrame(frame);
      };
    }
    closeHostPanel();
  }, [closeHostPanel, roleTab, postHostPanel, rightPanelTab, rightCollapsed]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || window.innerWidth > 760 || document.querySelector('[role="listbox"], [role="dialog"]')) return;
      setRightCollapsed(true);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [setRightCollapsed]);

  useEffect(() => {
    const handleHostPanel = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.projectId !== projectId) return;
      if (event.data.type === "ipollowork:video-studio-panel" && event.data.panel === "voice") {
        setRoleTab("voice");
        setRightPanelTab("voice");
      }
    };
    window.addEventListener("message", handleHostPanel);
    return () => window.removeEventListener("message", handleHostPanel);
  }, [projectId, setRightPanelTab]);

  useEffect(() => () => closeHostPanel(), [closeHostPanel]);

  const selectStudioPanel = (
    panel: "design" | "animation" | "animation-properties" | "components" | "assets",
  ) => {
    setRightPanelTab(panel);
  };

  const exportDrawer = rightPanelTab === "renders";
  const componentsPanelActive = rightPanelTab === "components" || (rightPanelTab === "block-params" && !activeBlockParams);

  return (
    <>
      <div
        ref={panelRef}
        className="hf-studio-inspector flex min-w-0 flex-shrink-0 flex-col overflow-hidden border-[0.5px] border-[var(--hf-studio-divider)] bg-panel-bg"
        style={{
          width: "100%",
          minWidth: 0,
        }}
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
            <div className="relative z-30 flex h-[49px] min-w-0 items-center overflow-hidden border-b-[0.5px] border-[var(--hf-studio-divider)] bg-panel-bg px-2">
              {exportDrawer ? (
                <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-panel-text-1">
                  {t("right.renders")}
                </h2>
              ) : (
                <div className="hf-inspector-tabs-scroll flex min-w-0 flex-1 items-center overflow-hidden">
                  <div className="grid w-full min-w-0 grid-flow-col auto-cols-fr items-center gap-1">
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
                      label={t("right.components")}
                      tooltip={t("right.componentsTooltip")}
                      active={componentsPanelActive}
                      onClick={() => selectStudioPanel("components")}
                    />
                    <PanelTabButton
                      label={t("right.animation")}
                      tooltip={t("right.animationTooltip")}
                      active={animationPanelActive}
                      onClick={() => {
                        selectStudioPanel("animation");
                      }}
                    />
                    <PanelTabButton
                      label={t("right.assets")}
                      tooltip={t("right.assetsTooltip")}
                      active={rightPanelTab === "assets"}
                      onClick={() => selectStudioPanel("assets")}
                    />
                    <PanelTabButton
                      label={t("right.role")}
                      tooltip={t("right.voiceTooltip")}
                      active={rightPanelTab === "voice"}
                      onClick={() => openHostPanel("voice")}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden pt-3">
              <Suspense
                fallback={
                  <div className="h-full animate-pulse bg-panel-bg motion-reduce:animate-none" />
                }
              >
                <div key={rightPanelTab} className="h-full min-h-0 min-w-0 overflow-hidden">
                  {rightPanelTab === "block-params" && activeBlockParams ? (
                    <BlockParamsPanel key={activeBlockParams.insertedElementId}
                      blockTitle={activeBlockParams.blockTitle}
                      params={activeBlockParams.params}
                      variables={activeBlockParams.variables}
                      variableValues={activeBlockParams.variableValues}
                      visualComponent={activeBlockParams.visualComponent}
                      onVariableChange={onBlockVariableChange ?? (async () => {})}
                      onVariablesChange={onBlockVariablesChange}
                      onBack={onBackFromBlockParams ?? (() => {})}
                    />
                  ) : componentsPanelActive ? (
                    <BlocksTab onAddBlock={onAddBlock} />
                  ) : animationPanelActive ? (
                    animationPanel
                  ) : rightPanelTab === "assets" ? (
                    <StudioAssetsPanel
                      onAddAssetToTimeline={onAddAssetToTimeline}
                      focusedHostAsset={focusedHostAsset}
                    />
                  ) : rightPanelTab === "voice" ? (
                    <div className="flex h-full min-h-0 flex-col">
                    <div className="shrink-0 px-4 pb-3">
                      <div role="group" aria-label={t("right.role")} data-testid="role-subtabs" className="grid h-[34px] grid-cols-2 gap-1 rounded-lg bg-panel-input p-1">
                        {["voice", "avatar"].map(tab => (
                          <button key={tab} type="button" aria-pressed={roleTab === tab} onClick={() => setRoleTab(tab === "avatar" ? "avatar" : "voice")}
                            className={`rounded-md text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-studio-accent ${roleTab === tab ? "bg-panel-bg text-panel-text-1 shadow-sm" : "text-panel-text-3 hover:text-panel-text-1"}`}>
                            {t(tab === "avatar" ? "right.avatar" : "right.voice")}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div ref={hostPanelSlotRef} data-testid="host-panel-slot" className="min-h-0 flex-1" />
                    </div>
                  ) : rightPanelTab === "style" ? (
                    <div ref={hostPanelSlotRef} data-testid="host-panel-slot" className="grid h-full place-items-center px-6 text-center text-xs text-neutral-500">{t("right.styleTooltip")}</div>
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

function componentSemanticContext(
  activeBlockParams: StudioRightPanelProps["activeBlockParams"],
  selectedElementId: string | null | undefined,
): string | undefined {
  if (!activeBlockParams || activeBlockParams.insertedElementId !== selectedElementId) {
    return undefined;
  }
  const contract = activeBlockParams.visualComponent?.data;
  const model = activeBlockParams.visualComponent?.ai?.model;
  if (model) {
    const values = { ...model.defaults, ...Object.fromEntries(activeBlockParams.variables.map(variable => [variable.id, variable.default])), ...activeBlockParams.variableValues };
    try { return JSON.stringify({ elementId: activeBlockParams.insertedElementId, sourceFile: activeBlockParams.hostCompositionPath,
      data: toJSON(model, values), schema: componentContentSchema(model), guide: componentContentGuide(model),
      editing: "Use media.video_component_read with this sourceFile and elementId, then media.video_component_write with the same target, returned revision and data object." }, null, 2); }
    catch { return undefined; }
  }
  if (!contract) return undefined;
  const variable = activeBlockParams.variables.find(
    (candidate) => candidate.id === contract.binding.variable,
  );
  if (!variable || variable.type !== "string") return undefined;
  const value = activeBlockParams.variableValues[variable.id] ?? variable.default;
  return formatVisualComponentDataForAi(contract, String(value));
}

/** The right sidebar owns the existing asset workflow. */
function StudioAssetsPanel({
  onAddAssetToTimeline,
  focusedHostAsset,
}: {
  onAddAssetToTimeline?: (path: string) => void;
  focusedHostAsset?: string;
}) {
  const { projectId } = useStudioShellContext();
  const {
    assets,
    refreshFileTree,
    handleImportFiles,
    handleDeleteFile,
    handleRenameFile,
  } = useFileManagerContext();
  return (
    <Suspense fallback={<div className="h-full animate-pulse bg-panel-bg" />}>
      <AssetsTab
        projectId={projectId}
        assets={assets}
        onRefresh={refreshFileTree}
        onImport={handleImportFiles}
        onDelete={handleDeleteFile}
        onRename={handleRenameFile}
        onAddAssetToTimeline={onAddAssetToTimeline}
        focusedHostAsset={focusedHostAsset}
      />
    </Suspense>
  );
}
