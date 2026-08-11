import { lazy, Suspense, useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { LeftSidebarHandle, SidebarTab } from "./components/sidebar/LeftSidebar";
import { useRenderQueue } from "./components/renders/useRenderQueue";
import { usePlayerStore, type TimelineElement } from "./player";
import { StudioOverlays } from "./components/StudioOverlays";
import { SaveQueuePausedBanner } from "./components/SaveQueuePausedBanner";
import { useCaptionStore } from "./captions/store";
import { useCaptionSync } from "./captions/hooks/useCaptionSync";
import { usePersistentEditHistory } from "./hooks/usePersistentEditHistory";
import { usePanelLayout } from "./hooks/usePanelLayout";
import { useFileManager } from "./hooks/useFileManager";
import { usePreviewPersistence } from "./hooks/usePreviewPersistence";
import { usePreviewDocumentVersion } from "./hooks/usePreviewDocumentVersion";
import { useTimelineEditing } from "./hooks/useTimelineEditing";
import {
  persistTimelineMoveEditsAtomically,
  type TimelineMoveOperation,
} from "./hooks/timelineMoveAdapter";
import type { TimelineZIndexReorderCommit } from "./hooks/useTimelineEditingTypes";
import type { TimelineStackingReorderIntent } from "./player/components/timelineStacking";
import { useDomEditSession } from "./hooks/useDomEditSession";
import { useSdkSelectionSync } from "./hooks/useSdkSelectionSync";
import { useStudioSdkSessions } from "./hooks/useStudioSdkSessions";
import { useBlockHandlers } from "./hooks/useBlockHandlers";
import { useAddAssetAtPlayhead } from "./hooks/useAddAssetAtPlayhead";
import { useAppHotkeys } from "./hooks/useAppHotkeys";
import { useIPolloWorkHostHistoryBridge } from "./hooks/useIPolloWorkHostHistoryBridge";
import { useClipboard } from "./hooks/useClipboard";
import { deleteSelectedKeyframes } from "./hooks/timelineEditingHelpers";
import { useCaptionDetection } from "./hooks/useCaptionDetection";
import { useRenderClipContent } from "./hooks/useRenderClipContent";
import { useConsoleErrorCapture } from "./hooks/useConsoleErrorCapture";
import { useLintModal } from "./hooks/useLintModal";
import { useCompositionDimensions } from "./hooks/useCompositionDimensions";
import { useToast } from "./hooks/useToast";
import { useCompositionContentLoader } from "./hooks/useCompositionContentLoader";
import { useStudioUrlState } from "./hooks/useStudioUrlState";
import { buildStudioContextValue, useInspectorState } from "./hooks/useStudioContextValue";
import type { DomEditSelection } from "./components/editor/domEditing";
import { StudioHeader } from "./components/StudioHeader";
import { useGestureCommit } from "./hooks/useGestureCommit";
import { EditorShell } from "./components/EditorShell";
import { TimelineToolbar } from "./components/TimelineToolbar";
import { StudioPlaybackProvider, StudioShellProvider } from "./contexts/StudioContext";
import { PanelLayoutProvider } from "./contexts/PanelLayoutContext";
import { ViewModeProvider, useViewModeState } from "./contexts/ViewModeContext";
import { FileManagerProvider } from "./contexts/FileManagerContext";
import { DomEditProvider } from "./contexts/DomEditContext";
import { StudioSplash } from "./components/StudioSplash";
import { StudioI18nProvider, useStudioI18n } from "./i18n";
import { useServerConnection } from "./hooks/useServerConnection";
import { useExpandedTimelineElements } from "./player/hooks/useExpandedTimelineElements";
import {
  normalizeStudioCompositionPath,
  readStudioUrlStateFromWindow,
  resolveMasterCompositionPath,
} from "./utils/studioUrlState";
import { trackStudioSessionStart } from "./telemetry/events";
import { hasFiredSessionStart, markSessionStartFired } from "./telemetry/config";
const HIDE_LEFT_SIDEBAR = true;
const HIDE_STORYBOARD_VIEW = true;
const StudioLeftSidebar = lazy(() =>
  import("./components/StudioLeftSidebar").then((module) => ({
    default: module.StudioLeftSidebar,
  })),
);
const loadStudioRightPanelModule = () => import("./components/StudioRightPanel");
const loadStudioRightPanel = () =>
  loadStudioRightPanelModule().then((module) => ({ default: module.StudioRightPanel }));
const StudioRightPanel = lazy(loadStudioRightPanel);
const StoryboardView = lazy(() =>
  import("./components/storyboard/StoryboardView").then((module) => ({
    default: module.StoryboardView,
  })),
);

function RightPanelLoadingFallback({ width }: { width: number }) {
  const { t } = useStudioI18n();
  return (
    <div
      className="flex h-full min-w-[280px] flex-shrink-0 items-center border-[0.5px] border-[var(--hf-studio-divider)] bg-panel-bg px-5 text-xs text-neutral-500"
      style={{ width }}
    >
      <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-neutral-700 border-t-neutral-300 motion-reduce:animate-none" />
      <span className="ml-2 truncate">{t("right.openingProperties")}</span>
    </div>
  );
}

// fallow-ignore-next-line complexity
export function StudioApp() {
  const { projectId, resolving, waitingForServer } = useServerConnection();
  const initialUrlStateRef = useRef(readStudioUrlStateFromWindow());
  const viewModeValue = useViewModeState();

  // Warm the inspector shell and the default Properties chunk only while the
  // browser is idle. Optional tabs remain on-demand, while the first Properties
  // open reuses the cached modules instead of fetching and evaluating on click.
  useEffect(() => {
    const idleId = window.requestIdleCallback(() => {
      void loadStudioRightPanelModule()
        .then((module) => module.preloadStudioPropertyPanel())
        .catch(() => undefined);
    });
    return () => window.cancelIdleCallback(idleId);
  }, []);
  const [previewMode, setPreviewMode] = useState(false);
  useEffect(() => {
    if (resolving || waitingForServer) return;
    if (hasFiredSessionStart()) return;
    markSessionStartFired();
    trackStudioSessionStart({ has_project: projectId != null });
  }, [projectId, resolving, waitingForServer]);
  useEffect(() => {
    if (resolving || waitingForServer || !projectId) return;
    void loadStudioRightPanel();
  }, [projectId, resolving, waitingForServer]);
  const [activeCompPath, setActiveCompPath] = useState<string | null>(null);
  const [activeCompPathHydrated, setActiveCompPathHydrated] = useState(
    () => initialUrlStateRef.current.activeCompPath == null,
  );
  const [compIdToSrc, setCompIdToSrc] = useState<Map<string, string>>(new Map());
  const [previewIframe, setPreviewIframe] = useState<HTMLIFrameElement | null>(null);
  const [compositionLoading, setCompositionLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [previewDocumentVersion, refreshPreviewDocumentVersion] = usePreviewDocumentVersion();
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const activeCompPathRef = useRef(activeCompPath);
  activeCompPathRef.current = activeCompPath;
  const leftSidebarRef = useRef<LeftSidebarHandle>(null);
  const renderQueue = useRenderQueue(projectId);
  const captionEditMode = useCaptionStore((s) => s.isEditMode);
  const captionHasSelection = useCaptionStore((s) => s.selectedSegmentIds.size > 0);
  const captionSync = useCaptionSync(projectId);
  const timelineElements = usePlayerStore((s) => s.elements);
  const selectionTimelineElements = useExpandedTimelineElements();
  const setSelectedTimelineElementId = usePlayerStore((s) => s.setSelectedElementId);
  const timelineDuration = usePlayerStore((s) => s.duration);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isMasterView = !activeCompPath || activeCompPath === "index.html";
  const activePreviewUrl = activeCompPath
    ? `/api/projects/${projectId}/preview/comp/${activeCompPath}`
    : null;
  const effectiveTimelineDuration = useMemo(() => {
    const maxEnd =
      timelineElements.length > 0
        ? Math.max(...timelineElements.map((el) => el.start + el.duration))
        : 0;
    return Math.max(timelineDuration, maxEnd);
  }, [timelineDuration, timelineElements]);
  const { toasts, showToast, dismissToast } = useToast();
  const panelLayout = usePanelLayout({
    rightCollapsed: initialUrlStateRef.current.rightCollapsed,
    rightPanelTab: initialUrlStateRef.current.rightPanelTab,
  });
  const editHistory = usePersistentEditHistory({ projectId });
  const domEditSaveTimestampRef = useRef(0);
  const markStudioWrite = useCallback(() => {
    domEditSaveTimestampRef.current = Date.now();
  }, []);
  const handleDomZIndexReorderCommitRef = useRef<TimelineZIndexReorderCommit | null>(null);
  const pendingTimelineEditPathRef = useRef(new Set<string>());
  const isGestureRecordingRef = useRef(false);
  const previewRefreshRafRef = useRef<number | null>(null);
  const reloadPreview = useCallback(() => {
    if (previewRefreshRafRef.current !== null) return;
    previewRefreshRafRef.current = requestAnimationFrame(() => {
      previewRefreshRafRef.current = null;
      setRefreshKey((key) => key + 1);
    });
  }, []);
  useEffect(
    () => () => {
      if (previewRefreshRafRef.current !== null) {
        cancelAnimationFrame(previewRefreshRafRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!projectId || !activeCompPathHydrated) return;
    if (window.parent === window) return;
    window.parent.postMessage({ type: "ipollowork:studio-ready", projectId }, "*");
  }, [activeCompPathHydrated, projectId]);
  useEffect(() => {
    if (!projectId || !activeCompPathHydrated || compositionLoading) return;
    let active = true;
    const preload = () => {
      if (!active) return;
      void loadStudioRightPanelModule()
        .then((module) => module.preloadStudioEffectsPanel())
        .catch(() => {});
    };
    const idleId = window.requestIdleCallback(preload, { timeout: 800 });
    return () => {
      active = false;
      window.cancelIdleCallback(idleId);
    };
  }, [activeCompPathHydrated, compositionLoading, projectId]);
  const fileManager = useFileManager({
    projectId,
    showToast,
    recordEdit: editHistory.recordEdit,
    domEditSaveTimestampRef,
    setRefreshKey,
  });
  const masterCompPath = useMemo(
    () => resolveMasterCompositionPath(fileManager.fileTree),
    [fileManager.fileTree],
  );
  const { sdkHandle, editFlowSdkSession } = useStudioSdkSessions(
    projectId,
    activeCompPath,
    domEditSaveTimestampRef,
    masterCompPath,
  );
  useEffect(() => {
    if (activeCompPathHydrated) return;
    if (!fileManager.fileTreeLoaded) return;
    const nextCompPath = normalizeStudioCompositionPath(
      initialUrlStateRef.current.activeCompPath,
      fileManager.fileTree,
    );
    setActiveCompPath((current) => (current === nextCompPath ? current : nextCompPath));
    setActiveCompPathHydrated(true);
  }, [activeCompPathHydrated, fileManager.fileTree, fileManager.fileTreeLoaded]);
  const previewPersistence = usePreviewPersistence({
    projectId,
    showToast,
    readOptionalProjectFile: fileManager.readOptionalProjectFile,
    writeProjectFile: fileManager.writeProjectFile,
    recordEdit: editHistory.recordEdit,
    previewIframeRef,
    activeCompPathRef,
    domEditSaveTimestampRef,
    reloadPreview,
    pendingTimelineEditPathRef,
  });
  const timelineEditing = useTimelineEditing({
    projectId,
    activeCompPath,
    timelineElements,
    showToast,
    writeProjectFile: fileManager.writeProjectFile,
    observeProjectFileVersion: fileManager.observeProjectFileVersion,
    recordEdit: editHistory.recordEdit,
    domEditSaveTimestampRef,
    reloadPreview,
    previewIframeRef,
    pendingTimelineEditPathRef,
    uploadProjectFiles: fileManager.uploadProjectFiles,
    isRecordingRef: isGestureRecordingRef,
    sdkSession: editFlowSdkSession,
    publishSdkSession: sdkHandle.publish,
    forceReloadSdkSession: sdkHandle.forceReload,
    handleDomZIndexReorderCommitRef,
  });
  const handleTimelineElementsMove = useCallback(
    async (
      edits: Array<{
        element: TimelineElement;
        updates: Pick<TimelineElement, "start" | "track"> & {
          stackingReorder?: TimelineStackingReorderIntent | null;
        };
      }>,
      coalesceKey?: string,
      operation: TimelineMoveOperation = "timing",
      coalesceMs?: number,
    ) => {
      const deps = { handleTimelineGroupMove: timelineEditing.handleTimelineGroupMove };
      await persistTimelineMoveEditsAtomically(edits, coalesceKey, operation, deps, coalesceMs);
    },
    [timelineEditing.handleTimelineGroupMove],
  );
  const handleAddAssetAtPlayhead = useAddAssetAtPlayhead(timelineEditing.handleTimelineAssetDrop);
  const {
    activeBlockParams,
    setActiveBlockParams,
    handleAddBlock,
    handleTimelineBlockDrop,
    handlePreviewBlockDrop,
  } = useBlockHandlers({
    projectId,
    blockCtxDeps: {
      activeCompPath,
      timelineElements,
      readProjectFile: fileManager.readProjectFile,
      writeProjectFile: fileManager.writeProjectFile,
      recordEdit: editHistory.recordEdit,
      markStudioWrite,
      refreshFileTree: fileManager.refreshFileTree,
      reloadPreview,
      showToast,
    },
    previewIframeRef,
    setCompositionLoading,
    setRightCollapsed: panelLayout.setRightCollapsed,
    setRightPanelTab: panelLayout.setRightPanelTab,
  });
  const clearDomSelectionRef = useRef<() => void>(() => {});
  const domEditSelectionBridgeRef = useRef<DomEditSelection | null>(null);
  const handleDomEditElementDeleteRef = useRef<(s: DomEditSelection) => Promise<void>>(
    async () => {},
  );
  const domEditDeleteBridge = (s: DomEditSelection) => handleDomEditElementDeleteRef.current(s);
  const resetKeyframesRef = useRef<() => boolean>(() => false);
  const deleteSelectedKeyframesRef = useRef<() => void>(() => {});
  const invalidateGsapCacheRef = useRef<() => void>(() => {});
  const { handleCopy, handlePaste, handleCut } = useClipboard({
    projectId,
    activeCompPath,
    domEditSelectionRef: domEditSelectionBridgeRef,
    showToast,
    writeProjectFile: fileManager.writeProjectFile,
    recordEdit: editHistory.recordEdit,
    domEditSaveTimestampRef,
    reloadPreview,
    handleTimelineElementDelete: timelineEditing.handleTimelineElementDelete,
    handleDomEditElementDelete: domEditDeleteBridge,
    previewIframeRef,
  });
  const appHotkeys = useAppHotkeys({
    handleTimelineElementDelete: timelineEditing.handleTimelineElementDelete,
    handleTimelineElementSplit: timelineEditing.handleTimelineElementSplit,
    handleDomEditElementDelete: domEditDeleteBridge,
    domEditSelectionRef: domEditSelectionBridgeRef,
    clearDomSelectionRef,
    editHistory,
    readOptionalProjectFile: fileManager.readOptionalProjectFile,
    readProjectFile: fileManager.readProjectFile,
    writeProjectFile: fileManager.writeProjectFile,
    domEditSaveTimestampRef,
    showToast,
    syncHistoryPreviewAfterApply: previewPersistence.syncHistoryPreviewAfterApply,
    waitForPendingDomEditSaves: previewPersistence.waitForPendingDomEditSaves,
    leftSidebarRef,
    handleCopy,
    handlePaste,
    handleCut,
    onResetKeyframes: () => resetKeyframesRef.current(),
    onDeleteSelectedKeyframes: () => deleteSelectedKeyframesRef.current(),
    onAfterUndoRedo: () => invalidateGsapCacheRef.current(),
    onGroupSelection: () => domEditSessionRef.current.handleGroupSelection(),
    onUngroupSelection: () => domEditSessionRef.current.handleUngroupSelection(),
    activeCompPath,
    forceReloadSdkSession: sdkHandle.forceReload,
    // Gesture recording is intentionally hidden until its property-target
    // model is clear enough for end users.
    onToggleRecording: undefined,
  });
  useIPolloWorkHostHistoryBridge({
    projectId,
    loaded: editHistory.loaded,
    recordEdit: editHistory.recordEdit,
    handleUndo: appHotkeys.handleUndo,
    handleRedo: appHotkeys.handleRedo,
    showToast,
  });
  const sidebarTabRef = useRef({
    select: (t: SidebarTab) => leftSidebarRef.current?.selectTab(t),
    get: () => leftSidebarRef.current?.getTab() ?? "compositions",
  });
  const domEditSession = useDomEditSession({
    projectId,
    activeCompPath,
    isMasterView,
    compIdToSrc,
    captionEditMode,
    compositionLoading,
    previewIframeRef,
    timelineElements: selectionTimelineElements,
    setSelectedTimelineElementId,
    setRightCollapsed: panelLayout.setRightCollapsed,
    setRightPanelTab: panelLayout.setRightPanelTab,
    showToast,
    refreshPreviewDocumentVersion,
    queueDomEditSave: previewPersistence.queueDomEditSave,
    readProjectFile: fileManager.readProjectFile,
    writeProjectFile: fileManager.writeProjectFile,
    updateEditingFileContent: fileManager.updateEditingFileContent,
    domEditSaveTimestampRef,
    editHistory: { recordEdit: editHistory.recordEdit },
    fileTree: fileManager.fileTree,
    importedFontAssetsRef: fileManager.importedFontAssetsRef,
    projectDir: fileManager.projectDir,
    projectIdRef: fileManager.projectIdRef,
    previewIframe,
    refreshKey,
    previewDocumentVersion,
    rightPanelTab: panelLayout.rightPanelTab,
    applyStudioManualEditsToPreviewRef: previewPersistence.applyStudioManualEditsToPreviewRef,
    syncPreviewHistoryHotkey: appHotkeys.syncPreviewHistoryHotkey,
    reloadPreview,
    setRefreshKey,
    openSourceForSelection: fileManager.openSourceForSelection,
    selectSidebarTab: sidebarTabRef.current.select,
    getSidebarTab: sidebarTabRef.current.get,
    sdkSession: editFlowSdkSession,
    publishSdkSession: sdkHandle.publish,
    forceReloadSdkSession: sdkHandle.forceReload,
  });
  domEditSelectionBridgeRef.current = domEditSession.domEditSelection;
  handleDomZIndexReorderCommitRef.current = domEditSession.handleDomZIndexReorderCommit;
  clearDomSelectionRef.current = domEditSession.clearDomSelection;
  handleDomEditElementDeleteRef.current = domEditSession.handleDomEditElementDelete;
  const handlePreviewModeChange = useCallback((nextPreviewMode: boolean) => {
    setPreviewMode(nextPreviewMode);
  }, []);
  resetKeyframesRef.current = domEditSession.handleResetSelectedElementKeyframes;
  invalidateGsapCacheRef.current = domEditSession.invalidateGsapCache;
  deleteSelectedKeyframesRef.current = () => deleteSelectedKeyframes(domEditSession);
  useSdkSelectionSync(
    editFlowSdkSession,
    domEditSession.domEditSelection,
    domEditSession.domEditGroupSelections,
  );
  useCaptionDetection({
    projectId,
    activeCompPath,
    compIdToSrc,
    captionEditMode,
    captionHasSelection,
    previewIframeRef,
    captionSync,
    setRightCollapsed: panelLayout.setRightCollapsed,
  });
  const renderClipContent = useRenderClipContent({
    projectIdRef: fileManager.projectIdRef,
    activePreviewUrl,
  });
  const compositionDimensions = useCompositionDimensions();
  const { lintModal, linting, handleLint, closeLintModal, findingsByFile } = useLintModal(
    projectId,
    refreshKey,
  );
  const {
    consoleErrors,
    setConsoleErrors,
    resetErrors: resetConsoleErrors,
  } = useConsoleErrorCapture(previewIframe);
  const preventUnhandledFileDrop = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes("Files") || event.defaultPrevented) return;
    event.preventDefault();
  }, []);
  const domEditSessionRef = useRef(domEditSession);
  domEditSessionRef.current = domEditSession;
  const { gestureState, gestureRecording } = useGestureCommit({
    domEditSessionRef,
    previewIframeRef,
    showToast,
    isGestureRecordingRef,
  });
  const recordingToggle = undefined;
  const handlePreviewIframeRef = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      previewIframeRef.current = iframe;
      setPreviewIframe(iframe);
      appHotkeys.syncPreviewTimelineHotkey(iframe);
      appHotkeys.syncPreviewHistoryHotkey(iframe);
      resetConsoleErrors();
      refreshPreviewDocumentVersion();
    },
    [appHotkeys, resetConsoleErrors, refreshPreviewDocumentVersion],
  );
  const { setEditingFile } = fileManager;
  const handleSelectComposition = useCompositionContentLoader({
    projectId,
    setEditingFile,
    setActiveCompPath,
    showToast,
  });
  const {
    designPanelActive,
    inspectorPanelActive,
    inspectorButtonActive,
    shouldShowSelectedDomBounds,
  } = useInspectorState(
    panelLayout.rightPanelTab,
    panelLayout.rightInspectorPanes,
    panelLayout.rightCollapsed,
    isPlaying,
    gestureState === "recording",
  );
  useStudioUrlState({
    projectId,
    activeCompPath,
    duration: effectiveTimelineDuration,
    isPlaying,
    compositionLoading,
    refreshKey,
    previewIframeRef,
    rightPanelTab: panelLayout.rightPanelTab,
    rightCollapsed: panelLayout.rightCollapsed,
    activeCompPathHydrated,
    domEditSelection: domEditSession.domEditSelection,
    buildDomSelectionFromTarget: domEditSession.buildDomSelectionFromTarget,
    applyDomSelection: domEditSession.applyDomSelection,
    setRightCollapsed: panelLayout.setRightCollapsed,
    setRightPanelTab: panelLayout.setRightPanelTab,
    initialState: initialUrlStateRef.current,
  });
  const studioCtxValue = buildStudioContextValue({
    projectId: projectId!,
    activeCompPath,
    setActiveCompPath,
    showToast,
    previewIframeRef,
    captionEditMode,
    compositionLoading,
    refreshKey,
    setRefreshKey,
    timelineElements,
    isPlaying,
    editHistory,
    handleUndo: appHotkeys.handleUndo,
    handleRedo: appHotkeys.handleRedo,
    renderQueue,
    compositionDimensions,
    waitForPendingDomEditSaves: previewPersistence.waitForPendingDomEditSaves,
    handlePreviewIframeRef,
    refreshPreviewDocumentVersion,
  });
  const timelineToolbar = useMemo(
    () => (
      <TimelineToolbar
        domEditSession={domEditSession}
        onSplitElement={timelineEditing.handleTimelineElementSplit}
        onDeleteElement={timelineEditing.handleTimelineElementDelete}
        onDeleteDomElement={domEditSession.handleDomEditElementDelete}
      />
    ),
    [
      domEditSession,
      timelineEditing.handleTimelineElementDelete,
      timelineEditing.handleTimelineElementSplit,
    ],
  );
  if (resolving || waitingForServer || !projectId)
    return (
      <StudioI18nProvider>
        <StudioSplash waiting={waitingForServer} />
      </StudioI18nProvider>
    );
  const activeViewMode = HIDE_STORYBOARD_VIEW ? "timeline" : viewModeValue.viewMode;
  return (
    <StudioI18nProvider>
      <StudioShellProvider value={studioCtxValue}>
        <StudioPlaybackProvider value={studioCtxValue}>
          <ViewModeProvider value={viewModeValue}>
            <PanelLayoutProvider value={panelLayout}>
              <FileManagerProvider value={fileManager}>
                <DomEditProvider value={domEditSession}>
                  <div
                    className="hf-studio-shell flex flex-col h-full w-full bg-neutral-950 relative"
                    onDragOver={preventUnhandledFileDrop}
                    onDrop={preventUnhandledFileDrop}
                  >
                    <StudioHeader
                      inspectorButtonActive={inspectorButtonActive}
                      inspectorPanelActive={inspectorPanelActive}
                      previewMode={previewMode}
                      onPreviewModeChange={handlePreviewModeChange}
                    />
                    {previewPersistence.domEditSaveQueuePaused && (
                      <SaveQueuePausedBanner
                        message={previewPersistence.domEditSaveQueuePaused}
                        onRetry={previewPersistence.resetDomEditSaveQueueBreaker}
                      />
                    )}
                    {activeViewMode === "storyboard" && (
                      <Suspense fallback={<StudioSplash />}>
                        <StoryboardView
                          projectId={projectId}
                          onSelectComposition={handleSelectComposition}
                        />
                      </Suspense>
                    )}
                    <EditorShell
                      hidden={activeViewMode === "storyboard"}
                      previewOnly={previewMode}
                      left={
                        HIDE_LEFT_SIDEBAR ? null : ( // Temporarily hidden per local customization. Set HIDE_LEFT_SIDEBAR=false to restore.
                          <Suspense fallback={null}>
                            <StudioLeftSidebar
                              leftSidebarRef={leftSidebarRef}
                              onSelectComposition={handleSelectComposition}
                              onAddBlock={handleAddBlock}
                              onLint={handleLint}
                              linting={linting}
                              lintFindingCount={lintModal?.length ?? findingsByFile.size}
                              lintFindingsByFile={findingsByFile}
                              onAddAssetToTimeline={handleAddAssetAtPlayhead}
                            />
                          </Suspense>
                        )
                      }
                      right={
                        panelLayout.rightCollapsed ? null : (
                          <Suspense fallback={<RightPanelLoadingFallback width={panelLayout.rightWidth} />}>
                            <StudioRightPanel
                              designPanelActive={designPanelActive}
                              activeBlockParams={activeBlockParams}
                              onCloseBlockParams={() => {
                                setActiveBlockParams(null);
                                panelLayout.setRightPanelTab("design");
                              }}
                              recordingState={gestureState}
                              recordingDuration={gestureRecording.recordingDuration}
                              onToggleRecording={recordingToggle}
                              sdkSession={sdkHandle.session}
                              publishSdkSession={sdkHandle.publish}
                              forceReloadSdkSession={sdkHandle.forceReload}
                              reloadPreview={reloadPreview}
                              domEditSaveTimestampRef={domEditSaveTimestampRef}
                              recordEdit={editHistory.recordEdit}
                              onToggleElementHidden={timelineEditing.handleToggleElementHidden}
                              onAddBlock={handleAddBlock}
                            />
                          </Suspense>
                        )
                      }
                      timelineToolbar={timelineToolbar}
                      renderClipContent={renderClipContent}
                      handleTimelineElementDelete={timelineEditing.handleTimelineElementDelete}
                      handleTimelineAssetDrop={timelineEditing.handleTimelineAssetDrop}
                      handleTimelineBlockDrop={handleTimelineBlockDrop}
                      handlePreviewBlockDrop={handlePreviewBlockDrop}
                      handleTimelineFileDrop={timelineEditing.handleTimelineFileDrop}
                      handleTimelineElementMove={timelineEditing.handleTimelineElementMove}
                      handleTimelineElementsMove={handleTimelineElementsMove}
                      handleTimelineElementResize={timelineEditing.handleTimelineElementResize}
                      handleTimelineGroupResize={timelineEditing.handleTimelineGroupResize}
                      handleToggleTrackHidden={timelineEditing.handleToggleTrackHidden}
                      handleToggleTrackLocked={timelineEditing.handleToggleTrackLocked}
                      handleBlockedTimelineEdit={timelineEditing.handleBlockedTimelineEdit}
                      handleTimelineElementSplit={timelineEditing.handleTimelineElementSplit}
                      handleRazorSplit={timelineEditing.handleRazorSplit}
                      handleRazorSplitAll={timelineEditing.handleRazorSplitAll}
                      setCompIdToSrc={setCompIdToSrc}
                      setCompositionLoading={setCompositionLoading}
                      shouldShowSelectedDomBounds={shouldShowSelectedDomBounds}
                      isGestureRecording={false}
                      recordingState={gestureState}
                      onToggleRecording={recordingToggle}
                      gestureOverlay={undefined}
                    />
                    <StudioOverlays
                      projectId={projectId}
                      projectDir={fileManager.projectDir}
                      lintModal={lintModal}
                      closeLintModal={closeLintModal}
                      consoleErrors={consoleErrors}
                      clearConsoleErrors={() => setConsoleErrors(null)}
                      domEditSession={domEditSession}
                      activeCompPath={activeCompPath}
                      toasts={toasts}
                      dismissToast={dismissToast}
                    />
                  </div>
                </DomEditProvider>
              </FileManagerProvider>
            </PanelLayoutProvider>
          </ViewModeProvider>
        </StudioPlaybackProvider>
      </StudioShellProvider>
    </StudioI18nProvider>
  );
}
