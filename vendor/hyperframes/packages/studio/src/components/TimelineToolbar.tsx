import { useRef, useState } from "react";
import {
  useEnableKeyframes,
  isPlayheadWithinTween,
  type EnableKeyframesSession,
} from "../hooks/useEnableKeyframes";
import { computeElementPercentage } from "../hooks/gsapShared";
import { useKeyframeKeyboard } from "../hooks/useKeyframeKeyboard";
import { useFrameCapture } from "../hooks/useFrameCapture";
import {
  getNextTimelineZoomPercent,
  getTimelineZoomPercent,
  timelineZoomPercentToSlider,
  timelineSliderToZoomPercent,
} from "../player/components/timelineZoom";
import { useTimelineZoom } from "../player/components/useTimelineZoom";
import { useExpandedTimelineElements } from "../player/hooks/useExpandedTimelineElements";
import { usePlayerStore, type TimelineElement } from "../player";
import { STUDIO_KEYFRAMES_ENABLED } from "./editor/manualEditingAvailability";
import { Tooltip } from "./ui";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "./editor/domEditingTypes";
import { canSplitElement } from "../utils/timelineElementSplit";
import {
  findSelectedTimelineElement,
  rebaseExpandedTimelineEdit,
} from "../utils/timelineToolbarSelection";
import { useStudioShellContext } from "../contexts/StudioContext";
import { useStudioI18n } from "../i18n";
import { requestPreviewZoomReset } from "./nle/previewZoom";
import undoIconSrc from "../icons/figmaToolbarUndo.svg?url";
import redoIconSrc from "../icons/figmaToolbarRedo.svg?url";
import dividerIconSrc from "../icons/figmaToolbarDivider.svg?url";
import scissorsIconSrc from "../icons/figmaToolbarScissors.svg?url";
import diamondIconSrc from "../icons/figmaToolbarDiamond.svg?url";
import trashIconSrc from "../icons/figmaToolbarTrash.svg?url";
import zoomOutIconSrc from "../icons/figmaToolbarZoomOut.svg?url";
import zoomInIconSrc from "../icons/figmaToolbarZoomIn.svg?url";
import fitIconSrc from "../icons/figmaToolbarFit.svg?url";
import cameraIconSrc from "../icons/figmaToolbarCamera.svg?url";

export const CANVAS_SNAP_TOOLBAR_SLOT_ID = "hf-canvas-snap-toolbar-slot";
export const CANVAS_GRID_TOOLBAR_SLOT_ID = "hf-canvas-grid-toolbar-slot";
export const SHORTCUTS_TOOLBAR_SLOT_ID = "hf-shortcuts-toolbar-slot";

interface DomEditSessionSlice extends EnableKeyframesSession {
  domEditSelection: DomEditSelection | null;
  selectedGsapAnimations: GsapAnimation[];
}

interface TimelineToolbarProps {
  domEditSession?: DomEditSessionSlice;
  onSplitElement?: (element: TimelineElement, splitTime: number) => Promise<void> | void;
  onDeleteElement?: (element: TimelineElement) => Promise<void> | void;
  onDeleteDomElement?: (selection: DomEditSelection) => Promise<void> | void;
}

function useKeyframeToggle(session?: DomEditSessionSlice) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const onToggle = useEnableKeyframes(
    sessionRef as React.RefObject<EnableKeyframesSession | undefined>,
  );

  if (!session) return { state: "none" as const, onToggle: undefined };
  const selection = session.domEditSelection;
  const keyframeAnimation = session.selectedGsapAnimations.find((animation) => animation.keyframes);
  let state: "active" | "inactive" | "none" = "none";

  if (keyframeAnimation?.keyframes && selection) {
    if (!isPlayheadWithinTween(keyframeAnimation, currentTime)) {
      state = "inactive";
    } else {
      const percentage = computeElementPercentage(currentTime, selection, keyframeAnimation);
      state = keyframeAnimation.keyframes.keyframes.some(
        (keyframe) => Math.abs(keyframe.percentage - percentage) <= 1,
      )
        ? "active"
        : "inactive";
    }
  }

  return { state, onToggle: selection ? onToggle : undefined };
}

function ToolbarIcon({ src, size = 16 }: { src: string; size?: number }) {
  return <img className="hf-timeline-toolbar-icon" src={src} width={size} height={size} alt="" aria-hidden="true" />;
}

// fallow-ignore-next-line complexity
export function TimelineToolbar({
  domEditSession,
  onSplitElement,
  onDeleteElement,
  onDeleteDomElement,
}: TimelineToolbarProps) {
  const { tx } = useStudioI18n();
  const [pendingAction, setPendingAction] = useState<"split" | "keyframe" | "delete" | null>(
    null,
  );
  const currentTime = usePlayerStore((s) => s.currentTime);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const elements = useExpandedTimelineElements();
  const selectedElement = findSelectedTimelineElement(elements, selectedElementId);
  const { zoomMode, manualZoomPercent, setZoomMode, setManualZoomPercent } = useTimelineZoom();
  const timelineZoomPercent = getTimelineZoomPercent(zoomMode, manualZoomPercent);
  const { state: keyframeState, onToggle: onToggleKeyframe } = useKeyframeToggle(domEditSession);
  const {
    projectId,
    activeCompPath,
    showToast,
    waitForPendingDomEditSaves,
    editHistory,
    handleUndo,
    handleRedo,
  } = useStudioShellContext();
  const {
    captureFrameHref,
    captureFrameFilename,
    handleCaptureFrameClick,
    capturing,
  } = useFrameCapture({
    projectId,
    activeCompPath,
    showToast,
    waitForPendingDomEditSaves,
  });

  useKeyframeKeyboard({
    enabled: STUDIO_KEYFRAMES_ENABLED && Boolean(onToggleKeyframe),
    onAddKeyframe: onToggleKeyframe,
  });

  const iconButton =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors outline-none hover:bg-[#f2f2f0] focus-visible:ring-2 focus-visible:ring-[#858a94]/35 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/10";
  const canSplit =
    Boolean(onSplitElement && selectedElement && canSplitElement(selectedElement)) &&
    currentTime > (selectedElement?.start ?? 0) &&
    currentTime < (selectedElement?.start ?? 0) + (selectedElement?.duration ?? 0);
  const canDelete = Boolean(
    (selectedElement && onDeleteElement) || (domEditSession?.domEditSelection && onDeleteDomElement),
  );
  const runSelectionAction = async (
    action: "split" | "keyframe" | "delete",
    execute: () => Promise<void> | void,
  ) => {
    if (pendingAction) return;
    setPendingAction(action);
    try {
      await execute();
    } catch (error) {
      showToast(error instanceof Error ? error.message : `Failed to ${action} selection`, "error");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div
      className="hf-timeline-toolbar flex h-11 items-center justify-between border-y border-[var(--hf-panel-hairline)] bg-[var(--hf-studio-toolbar-bg)] px-4"
      data-testid="figma-timeline-toolbar"
      data-preserve-studio-selection="true"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Tooltip label={tx(editHistory.undoLabel ? `Undo ${editHistory.undoLabel}` : "Undo")}>
          <button
            type="button"
            className={iconButton}
            onClick={() => void handleUndo()}
            disabled={!editHistory.canUndo}
            aria-label={tx("Undo")}
          >
            <ToolbarIcon src={undoIconSrc} />
          </button>
        </Tooltip>
        <Tooltip label={tx(editHistory.redoLabel ? `Redo ${editHistory.redoLabel}` : "Redo")}>
          <button
            type="button"
            className={iconButton}
            onClick={() => void handleRedo()}
            disabled={!editHistory.canRedo}
            aria-label={tx("Redo")}
          >
            <ToolbarIcon src={redoIconSrc} />
          </button>
        </Tooltip>
        <ToolbarIcon src={dividerIconSrc} size={17} />
        <Tooltip label={tx(canSplit ? "Split at playhead (S)" : "Select a clip and place the playhead inside it")}>
          <button
            type="button"
            className={iconButton}
            disabled={!canSplit || pendingAction !== null}
            aria-label={tx("Split at playhead")}
            aria-busy={pendingAction === "split"}
            onClick={() => {
              if (canSplit && selectedElement && onSplitElement) {
                const edit = rebaseExpandedTimelineEdit(selectedElement, currentTime);
                void runSelectionAction("split", () => onSplitElement(edit.element, edit.time));
              }
            }}
          >
            <ToolbarIcon src={scissorsIconSrc} />
          </button>
        </Tooltip>
        <div id={CANVAS_SNAP_TOOLBAR_SLOT_ID} className="flex items-center" />
        {STUDIO_KEYFRAMES_ENABLED && (
          <Tooltip
            label={tx(
              !onToggleKeyframe
                ? "Select an animated element to add a keyframe"
                : keyframeState === "active"
                  ? "Remove keyframe at playhead (K)"
                  : "Add keyframe at playhead (K)"
            )}
          >
            <button
              type="button"
              className={`${iconButton} ${keyframeState === "active" ? "bg-[#f2f2f0]" : ""}`}
              disabled={!onToggleKeyframe || pendingAction !== null}
              onClick={() => {
                if (onToggleKeyframe) {
                  void runSelectionAction("keyframe", onToggleKeyframe);
                }
              }}
              aria-label={tx(keyframeState === "active" ? "Remove keyframe at playhead" : "Add keyframe at playhead")}
              aria-pressed={keyframeState === "active"}
              aria-busy={pendingAction === "keyframe"}
            >
              <ToolbarIcon src={diamondIconSrc} size={24} />
            </button>
          </Tooltip>
        )}
        <Tooltip label={tx("Delete selected element")}>
          <button
            type="button"
            className={iconButton}
            disabled={!canDelete || pendingAction !== null}
            aria-label={tx("Delete selected element")}
            aria-busy={pendingAction === "delete"}
            onClick={() => {
              if (selectedElement && onDeleteElement) {
                void runSelectionAction("delete", () =>
                  onDeleteElement(rebaseExpandedTimelineEdit(selectedElement, currentTime).element),
                );
                return;
              }
              if (domEditSession?.domEditSelection && onDeleteDomElement) {
                const selection = domEditSession.domEditSelection;
                void runSelectionAction("delete", () =>
                  onDeleteDomElement(selection),
                );
              }
            }}
          >
            <ToolbarIcon src={trashIconSrc} size={24} />
          </button>
        </Tooltip>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Tooltip label={tx("Zoom timeline out")}>
          <button
            type="button"
            className={iconButton}
            aria-label={tx("Zoom timeline out")}
            onClick={() => {
              setZoomMode("manual");
              setManualZoomPercent(getNextTimelineZoomPercent("out", zoomMode, manualZoomPercent));
            }}
          >
            <ToolbarIcon src={zoomOutIconSrc} />
          </button>
        </Tooltip>
        <input
          type="range"
          min="0"
          max="100"
          value={timelineZoomPercentToSlider(timelineZoomPercent)}
          title={`${timelineZoomPercent}%`}
          aria-label={tx("Timeline zoom")}
          onChange={(event) => {
            setZoomMode("manual");
            setManualZoomPercent(timelineSliderToZoomPercent(Number(event.target.value)));
          }}
          className="w-[90px] cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-px [&::-webkit-slider-runnable-track]:bg-[#b8bab7] [&::-webkit-slider-thumb]:-mt-[3.5px] [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#858a94]"
        />
        <Tooltip label={tx("Zoom timeline in")}>
          <button
            type="button"
            className={iconButton}
            aria-label={tx("Zoom timeline in")}
            onClick={() => {
              setZoomMode("manual");
              setManualZoomPercent(getNextTimelineZoomPercent("in", zoomMode, manualZoomPercent));
            }}
          >
            <ToolbarIcon src={zoomInIconSrc} />
          </button>
        </Tooltip>
        <Tooltip label={tx("Reset video to fit")}>
          <button
            type="button"
            className={iconButton}
            aria-label={tx("Reset video to fit")}
            data-testid="preview-fit-reset"
            onClick={requestPreviewZoomReset}
          >
            <ToolbarIcon src={fitIconSrc} />
          </button>
        </Tooltip>
        <Tooltip label={tx(capturing ? "Capturing current frame" : "Capture current frame")}>
          <a
            href={captureFrameHref}
            download={captureFrameFilename}
            onClick={handleCaptureFrameClick}
            className={`${iconButton} ${capturing ? "pointer-events-none cursor-wait bg-[#f2f2f0]" : ""}`}
            aria-label={tx(capturing ? "Capturing current frame" : "Capture current frame")}
            aria-disabled={capturing}
            aria-busy={capturing}
          >
            {capturing ? (
              <span
                className="size-4 animate-spin rounded-full border-[1.5px] border-[#858a94]/30 border-t-[#858a94] motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <ToolbarIcon src={cameraIconSrc} />
            )}
          </a>
        </Tooltip>
        <div id={CANVAS_GRID_TOOLBAR_SLOT_ID} className="flex items-center" />
        <div id={SHORTCUTS_TOOLBAR_SLOT_ID} className="flex items-center" />
      </div>
    </div>
  );
}
