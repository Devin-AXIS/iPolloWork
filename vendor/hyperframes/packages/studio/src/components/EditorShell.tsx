import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PreviewPane } from "./nle/PreviewPane";
import { TimelinePane } from "./nle/TimelinePane";
import { PreviewOverlays, useCommitDomZOrder } from "./nle/PreviewOverlays";
import {
  useTimelineEditCallbacks,
  type TimelineEditCallbackDeps,
} from "./nle/useTimelineEditCallbacks";
import { NLEProvider, useNLEContext } from "./nle/NLEContext";
import { CaptionTimeline } from "../captions/components/CaptionTimeline";
import { StudioFeedbackBar } from "./StudioFeedbackBar";
import { useStudioPlaybackContext, useStudioShellContext } from "../contexts/StudioContext";
import { useDomEditActionsContext } from "../contexts/DomEditContext";
import { TimelineEditProvider } from "../contexts/TimelineEditContext";
import { usePlayerStore, type TimelineElement } from "../player";
import type { GestureRecordingState } from "./editor/GestureRecordControl";
import { useAddAssetAtPlayhead } from "../hooks/useAddAssetAtPlayhead";
import { useStudioI18n } from "../i18n";
import {
  resolveTimelineClipLabel,
  resolveTimelineLayerSourceTarget,
} from "../player/components/timelineLayerPresentation";
import { rebaseExpandedTimelineEdit } from "../utils/timelineToolbarSelection";
import { Dock } from "./dock/Dock";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { findTimelineElementInIframe } from "../hooks/timelineEditingHelpers";
import { CanvasContextMenu } from "./editor/CanvasContextMenu";
import type { DomEditSelection } from "./editor/domEditing";

const WORKBENCH_PANELS = [
  "preview",
  "timeline",
  "design",
] as const;
const REQUIRED_WORKBENCH_PANELS = ["preview", "timeline"] as const;

type RenderClipContent = (
  element: TimelineElement,
  style: { clip: string; label: string },
) => ReactNode;
type TimelineDropPlacement = Pick<TimelineElement, "start" | "track">;

interface TimelineClipContextMenuState {
  x: number;
  y: number;
  element: TimelineElement;
  selection: DomEditSelection | null;
}

// The seven move/resize/split/razor handlers come from TimelineEditCallbackDeps
// (shared with useTimelineEditCallbacks); the rest are drop + wiring props.
export interface EditorShellProps extends TimelineEditCallbackDeps {
  /** Right panel (inspector/design) or null when collapsed, in the top row. */
  right: ReactNode;
  /** Hide the whole shell (e.g. while the storyboard view is active). */
  hidden?: boolean;
  /** Playback-only workspace: preview canvas + transport, without editing chrome. */
  previewOnly?: boolean;
  timelineToolbar: ReactNode;
  renderClipContent: RenderClipContent;
  handleTimelineElementDelete: (element: TimelineElement) => Promise<void> | void;
  handleTimelineAssetDrop: (
    assetPath: string,
    placement: TimelineDropPlacement,
  ) => Promise<void> | void;
  handleTimelineBlockDrop?: (
    blockName: string,
    placement: TimelineDropPlacement,
  ) => Promise<void> | void;
  handlePreviewBlockDrop?: (
    blockName: string,
    position: { left: number; top: number },
  ) => Promise<void> | void;
  handleTimelineFileDrop: (
    files: File[],
    placement?: TimelineDropPlacement,
  ) => Promise<void> | void;
  setCompIdToSrc: (map: Map<string, string>) => void;
  setCompositionLoading: (loading: boolean) => void;
  shouldShowSelectedDomBounds: boolean;
  isGestureRecording?: boolean;
  recordingState?: GestureRecordingState;
  onToggleRecording?: () => void;
  gestureOverlay?: ReactNode;
}

// Official dock workspace with a full-width timeline. Owns the shared player +
// composition-stack state via NLEProvider so both rows share one player.
export function EditorShell({
  right,
  hidden,
  previewOnly = false,
  timelineToolbar,
  renderClipContent,
  handleTimelineElementDelete,
  handleTimelineAssetDrop,
  handleTimelineBlockDrop,
  handlePreviewBlockDrop,
  handleTimelineFileDrop,
  handleTimelineElementMove,
  handleTimelineElementsMove,
  handleTimelineElementResize,
  handleTimelineGroupResize,
  handleToggleTrackHidden,
  handleToggleTrackLocked,
  handleBlockedTimelineEdit,
  handleTimelineElementSplit,
  handleRazorSplit,
  handleRazorSplitAll,
  setCompIdToSrc,
  setCompositionLoading,
  shouldShowSelectedDomBounds,
  isGestureRecording,
  recordingState,
  onToggleRecording,
  gestureOverlay,
}: EditorShellProps) {
  const {
    projectId,
    activeCompPath,
    setActiveCompPath,
    handlePreviewIframeRef,
    previewIframeRef,
  } = useStudioShellContext();
  const { refreshKey, captionEditMode, refreshPreviewDocumentVersion } =
    useStudioPlaybackContext();
  const { handleTimelineElementSelect } = useDomEditActionsContext();

  const { buildDomSelectionForTimelineElement, handleDomAttributesCommit } =
    useDomEditActionsContext();
  const liveAudioOriginals = useRef(new Map<string, string | null>());
  useEffect(() => {
    liveAudioOriginals.current.clear();
  }, [projectId, activeCompPath]);
  const liveAudioAttribute = useCallback(
    (element: TimelineElement, attr: string, value: string | null) => {
      const target = findTimelineElementInIframe(
        previewIframeRef.current,
        element,
        activeCompPath,
      );
      if (!target) return;
      const key = `${element.key ?? element.id}:${attr}`;
      if (!liveAudioOriginals.current.has(key))
        liveAudioOriginals.current.set(key, target.getAttribute(attr));
      if (value === null) target.removeAttribute(attr);
      else target.setAttribute(attr, value);
    },
    [previewIframeRef, activeCompPath],
  );
  const saveAudioAttribute = useCallback(
    async (
      element: TimelineElement,
      attr: string,
      value: string | null,
      label: string,
    ) => {
      let saved = false;
      try {
        const selection = await buildDomSelectionForTimelineElement(element);
        if (!selection) throw new Error("Audio clip source was not found");
        await handleDomAttributesCommit(
          selection,
          { [attr.replace(/^data-/, "")]: value ?? "" },
          label,
          {
            onSettled: (ok) => {
              saved = ok;
            },
          },
        );
        if (!saved) throw new Error("Couldn't save audio edit");
      } catch (error) {
        liveAudioAttribute(
          element,
          attr,
          liveAudioOriginals.current.get(
            `${element.key ?? element.id}:${attr}`,
          ) ?? null,
        );
        throw error;
      } finally {
        liveAudioOriginals.current.delete(
          `${element.key ?? element.id}:${attr}`,
        );
      }
    },
    [
      buildDomSelectionForTimelineElement,
      handleDomAttributesCommit,
      liveAudioAttribute,
    ],
  );
  const timelineEditCallbacks = useTimelineEditCallbacks({
    handleTimelineElementMove,
    handleTimelineElementsMove,
    handleTimelineElementResize,
    handleTimelineGroupResize,
    handleToggleTrackHidden,
    handleToggleTrackLocked,
    handleBlockedTimelineEdit,
    handleTimelineElementSplit,
    handleRazorSplit,
    handleRazorSplitAll,
  });

  const { setRightPanelTab, setRightCollapsed } = usePanelLayoutContext();
  const inspectAnimation = useCallback((element: TimelineElement) => {
    const key = element.key ?? element.id;
    usePlayerStore.getState().setSelection([key], key);
    handleTimelineElementSelect(element);
    setRightPanelTab("animation-properties");
    setRightCollapsed(false);
  }, [handleTimelineElementSelect, setRightPanelTab, setRightCollapsed]);
  const audioEditCallbacks = useMemo(
    () => ({
      ...timelineEditCallbacks,
      onInspectAnimation: inspectAnimation,
      onSetElementAttributeLive: liveAudioAttribute,
      onSetElementAttributeQuiet: saveAudioAttribute,
      onRevertElementAttributeLive: (
        element: TimelineElement,
        attr: string,
      ) => {
        const key = `${element.key ?? element.id}:${attr}`;
        if (liveAudioOriginals.current.has(key))
          liveAudioAttribute(
            element,
            attr,
            liveAudioOriginals.current.get(key) ?? null,
          );
        liveAudioOriginals.current.delete(key);
      },
    }),
    [timelineEditCallbacks, inspectAnimation, liveAudioAttribute, saveAudioAttribute],
  );
  return (
    <div className={`flex flex-col flex-1 min-h-0${hidden ? " hidden" : ""}`}>
      <TimelineEditProvider value={audioEditCallbacks}>
        <NLEProvider
          projectId={projectId}
          refreshKey={refreshKey}
          activeCompositionPath={activeCompPath}
          onIframeRef={handlePreviewIframeRef}
          onCompIdToSrcChange={setCompIdToSrc}
          onCompositionLoadingChange={setCompositionLoading}
          onCompositionChange={(compPath) => {
            // Sync activeCompPath when the user drills down via the timeline or
            // navigates back — keeps sidebar + thumbnails in sync. Guard no-ops to
            // avoid circular refresh cascades (activeCompPath → stack → onChange).
            if (compPath !== activeCompPath) {
              setActiveCompPath(compPath);
              refreshPreviewDocumentVersion();
            }
          }}
        >
          <EditorShellBody
            right={right}
            previewOnly={previewOnly}
            captionEditMode={captionEditMode}
            onSelectTimelineElement={handleTimelineElementSelect}
            onPreviewBlockDrop={previewOnly ? undefined : handlePreviewBlockDrop}
            timelineToolbar={timelineToolbar}
            renderClipContent={renderClipContent}
            onFileDrop={handleTimelineFileDrop}
            onAssetDrop={handleTimelineAssetDrop}
            onBlockDrop={handleTimelineBlockDrop}
            onDeleteElement={handleTimelineElementDelete}
            previewOverlay={
              previewOnly ? null : (
                <PreviewOverlays
                  shouldShowSelectedDomBounds={shouldShowSelectedDomBounds}
                  isGestureRecording={isGestureRecording}
                  recordingState={recordingState}
                  onToggleRecording={onToggleRecording}
                  gestureOverlay={gestureOverlay}
                />
              )
            }
          />
        </NLEProvider>
      </TimelineEditProvider>
      {!previewOnly && <StudioFeedbackBar />}
    </div>
  );
}

interface EditorShellBodyProps {
  right: ReactNode;
  previewOnly: boolean;
  captionEditMode: boolean;
  previewOverlay: ReactNode;
  onSelectTimelineElement: (element: TimelineElement | null) => void;
  onPreviewBlockDrop?: (
    blockName: string,
    position: { left: number; top: number },
  ) => Promise<void> | void;
  timelineToolbar: ReactNode;
  renderClipContent: RenderClipContent;
  onFileDrop: (files: File[], placement?: TimelineDropPlacement) => Promise<void> | void;
  onAssetDrop: (assetPath: string, placement: TimelineDropPlacement) => Promise<void> | void;
  onBlockDrop?: (blockName: string, placement: TimelineDropPlacement) => Promise<void> | void;
  onDeleteElement: (element: TimelineElement) => Promise<void> | void;
}

function EditorShellBody({
  right,
  previewOnly,
  captionEditMode,
  previewOverlay,
  onSelectTimelineElement,
  onPreviewBlockDrop,
  timelineToolbar,
  renderClipContent,
  onFileDrop,
  onAssetDrop,
  onBlockDrop,
  onDeleteElement,
}: EditorShellBodyProps) {
  const { tx, t } = useStudioI18n();
  const { projectId, activeCompPath, showToast } = useStudioShellContext();
  const { refreshPreviewDocumentVersion } = useStudioPlaybackContext();
  const {
    applyDomSelection,
    buildDomSelectionForTimelineElement,
    handleDomAttributesCommit,
    handleDomZIndexReorderCommit,
  } = useDomEditActionsContext();
  const { compositionStack, updateCompositionStack, containerRef } = useNLEContext();
  const handlePreviewAssetDrop = useAddAssetAtPlayhead(onAssetDrop);
  const commitDomZOrder = useCommitDomZOrder(handleDomZIndexReorderCommit);
  const [timelineClipContextMenu, setTimelineClipContextMenu] =
    useState<TimelineClipContextMenuState | null>(null);
  const contextMenuRequestRef = useRef(0);
  const clipRenameVersionRef = useRef(new Map<string, number>());

  const closeTimelineClipContextMenu = useCallback(() => {
    contextMenuRequestRef.current += 1;
    setTimelineClipContextMenu(null);
  }, []);

  const openTimelineClipContextMenu = useCallback(
    (element: TimelineElement, anchor: { x: number; y: number }) => {
      const request = ++contextMenuRequestRef.current;
      setTimelineClipContextMenu({ ...anchor, element, selection: null });

      void buildDomSelectionForTimelineElement(element)
        .then((selection) => {
          if (request !== contextMenuRequestRef.current) return;
          if (selection) applyDomSelection(selection, { revealPanel: false });
          setTimelineClipContextMenu((current) =>
            current && (current.element.key ?? current.element.id) === (element.key ?? element.id)
              ? { ...current, selection }
              : current,
          );
        })
        .catch(() => undefined);
    },
    [applyDomSelection, buildDomSelectionForTimelineElement],
  );

  const renameTimelineClip = useCallback(
    async (label: string) => {
      const current = timelineClipContextMenu;
      if (!current) return;
      const selection =
        current.selection ?? (await buildDomSelectionForTimelineElement(current.element));
      if (!selection) throw new Error("Timeline clip source element was not found");

      const renameSelection = current.element.compositionSrc
        ? (() => {
            const target = resolveTimelineLayerSourceTarget(current.element, activeCompPath);
            return { ...selection, ...target, compositionPath: target.sourceFile };
          })()
        : selection;
      const elementKey = current.element.key ?? current.element.id;
      const previousClipLabel = current.element.clipLabel;
      const commitVersion = (clipRenameVersionRef.current.get(elementKey) ?? 0) + 1;
      clipRenameVersionRef.current.set(elementKey, commitVersion);
      let saved = false;
      usePlayerStore.getState().updateElement(elementKey, { clipLabel: label });
      // The durable file mutation/history write can take a few seconds. Keep
      // it in the existing serialized save queue, but don't hold the context
      // menu open while it finishes: the optimistic label is already visible.
      void handleDomAttributesCommit(
        renameSelection,
        { "timeline-clip-label": label },
        "Rename timeline clip",
        {
          // Perform one deliberate preview refresh after a successful commit;
          // the generic refresh + selection resync used to reload twice.
          skipRefresh: true,
          refreshAfter: false,
          onSettled: (ok) => {
            saved = ok;
          },
        },
      )
        .then(() => {
          if (clipRenameVersionRef.current.get(elementKey) !== commitVersion) return;
          if (!saved) {
            usePlayerStore.getState().updateElement(elementKey, { clipLabel: previousClipLabel });
            return;
          }
          refreshPreviewDocumentVersion();
        })
        .catch(() => {
          if (clipRenameVersionRef.current.get(elementKey) !== commitVersion) return;
          usePlayerStore.getState().updateElement(elementKey, { clipLabel: previousClipLabel });
          showToast(tx("Couldn't rename clip. Try again."), "error");
        });
    },
    [
      activeCompPath,
      buildDomSelectionForTimelineElement,
      handleDomAttributesCommit,
      refreshPreviewDocumentVersion,
      showToast,
      timelineClipContextMenu,
      tx,
    ],
  );

  // Keyboard: Escape to pop composition level
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && compositionStack.length > 1) {
        updateCompositionStack((prev) => prev.slice(0, -1));
      }
    },
    [compositionStack.length, updateCompositionStack],
  );

  return (
    <div
      ref={containerRef}
      // Shell canvas is a step LIGHTER than the near-black panel cards so the
      // gaps between panels read as visible seams (CapCut-style).
      className="flex flex-col flex-1 min-h-0 bg-[#18181B]"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Native dock owns placement, resizing, panel visibility and persistence. */}
      {previewOnly ? (
        <div className="flex min-h-0 flex-1 p-px">
          <PreviewPane editingEnabled={false} />
        </div>
      ) : (
        <Dock.Root projectId={projectId} panels={WORKBENCH_PANELS} requiredPanels={REQUIRED_WORKBENCH_PANELS} fullHeightRight hideHeaders>
          <Dock.Panel id="preview" title={tx("Preview")}>
            <div className="flex h-full min-h-0 flex-col">
              <PreviewPane
                previewOverlay={previewOverlay}
                onPreviewBlockDrop={onPreviewBlockDrop}
                onPreviewAssetDrop={handlePreviewAssetDrop}
              />
            </div>
          </Dock.Panel>
          <Dock.Panel id="timeline" title={tx("Timeline")}>
            <TimelinePane
              docked
              timelineToolbar={timelineToolbar}
              renderClipContent={renderClipContent}
              onFileDrop={onFileDrop}
              onAssetDrop={onAssetDrop}
              onBlockDrop={onBlockDrop}
              onDeleteElement={onDeleteElement}
              onSelectTimelineElement={onSelectTimelineElement}
              onContextMenuTimelineElement={openTimelineClipContextMenu}
              timelineFooter={
                captionEditMode ? (
                  <div
                    className="border-t border-neutral-800/30 flex-shrink-0"
                    style={{ height: 60 }}
                  >
                    <div className="flex items-center gap-1.5 px-2 py-0.5">
                      <span className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider">
                        {tx("Captions")}
                      </span>
                    </div>
                    <CaptionTimeline pixelsPerSecond={100} />
                  </div>
                ) : undefined
              }
            />
          </Dock.Panel>
          <Dock.Panel id="design" title={tx("Properties")}>
            <div className="hf-docked-inspector flex h-full min-h-0">
              {right}
            </div>
          </Dock.Panel>
          {timelineClipContextMenu && (
            <CanvasContextMenu
              x={timelineClipContextMenu.x}
              y={timelineClipContextMenu.y}
              selection={timelineClipContextMenu.selection}
              renameValue={resolveTimelineClipLabel(timelineClipContextMenu.element)}
              onRename={renameTimelineClip}
              onDelete={() => {
                const element = rebaseExpandedTimelineEdit(
                  timelineClipContextMenu.element,
                  timelineClipContextMenu.element.start,
                ).element;
                void onDeleteElement(element);
              }}
              onApplyZIndex={
                timelineClipContextMenu.selection
                  ? (patches, action, crossed) =>
                      commitDomZOrder(
                        timelineClipContextMenu.selection as DomEditSelection,
                        patches,
                        action,
                        crossed,
                      )
                  : undefined
              }
              onClose={closeTimelineClipContextMenu}
            />
          )}
        </Dock.Root>
      )}
    </div>
  );
}
