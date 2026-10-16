import { MousePointer2, Image, Scissors, Pencil, TextSelect, ArrowLeftRight, Undo2, Redo2, Diamond, Trash2, ZoomOut, Scan, Camera } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Ellipsis, ZoomIn, type LucideIcon } from "lucide-react";
import { useKeyframeKeyboard } from "../hooks/useKeyframeKeyboard";
import { useFrameCapture } from "../hooks/useFrameCapture";
import {
  getNextTimelineZoomPercent,
  getTimelineZoomPercent,
  timelineZoomPercentToSlider,
  timelineSliderToZoomPercent,
} from "../player/components/timelineZoom";
import { useTimelineZoom } from "../player/components/useTimelineZoom";
import { collectTimelineTreeElements } from "../player/lib/timelineTreeSelection";
import { useExpandedTimelineElements } from "../player/hooks/useExpandedTimelineElements";
import { usePlayerStore, type TimelineElement } from "../player";
import { STUDIO_KEYFRAMES_ENABLED } from "./editor/manualEditingAvailability";
import { Tooltip } from "./ui";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuItem,
} from "@ipollowork/ui/dropdown-menu";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "./editor/domEditingTypes";
import {
  findSelectedTimelineElement,
  rebaseExpandedTimelineEdit,
} from "../utils/timelineToolbarSelection";
import { findMatchingTimelineElementId } from "../utils/studioHelpers";
import { useStudioShellContext } from "../contexts/StudioContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { useStudioI18n } from "../i18n";
import { buildTimelinePropertyRows, resolveTimelinePropertyKeyframeTarget, TIMELINE_EMPTY_PROPERTY_ROWS } from "../hooks/gsapTimelineSegmentCache";
import { useTimelineEditContextOptional } from "../contexts/TimelineEditContext";
import { requestPreviewZoomReset } from "./nle/previewZoom";
import { resolveFloatingPanelPosition } from "./editor/floatingPanel";

export const CANVAS_SNAP_TOOLBAR_SLOT_ID = "hf-canvas-snap-toolbar-slot";
export const CANVAS_GRID_TOOLBAR_SLOT_ID = "hf-canvas-grid-toolbar-slot";
export const SHORTCUTS_TOOLBAR_SLOT_ID = "hf-shortcuts-toolbar-slot";

interface DomEditSessionSlice {
  domEditSelection: DomEditSelection | null;
  selectedGsapAnimations: GsapAnimation[];
}

interface TimelineToolbarProps {
  domEditSession?: DomEditSessionSlice;
  onDeleteElement?: (element: TimelineElement) => Promise<void> | void;
  onDeleteDomElement?: (selection: DomEditSelection) => Promise<void> | void;
}

// Keep the same controls and portal slots mounted when they move into a popover.
function ToolbarGroup({ collapsed, label, icon: Icon, toolbarWidth, children, value }: {
  collapsed: boolean;
  label: string;
  icon: LucideIcon;
  toolbarWidth: number;
  children: ReactNode;
  value?: string;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useEffect(() => setOpen(false), [collapsed]);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !panelRef.current?.matches(":popover-open") ||
        (event.target instanceof Element && event.target.closest('[aria-modal="true"]'))) return;
      event.preventDefault();
      event.stopPropagation();
      panelRef.current.hidePopover();
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", dismiss, true);
    return () => window.removeEventListener("keydown", dismiss, true);
  }, []);
  useLayoutEffect(() => {
    if (!collapsed || !open || !triggerRef.current || !panelRef.current) return;
    const { left, top } = resolveFloatingPanelPosition(
      triggerRef.current.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      panelRef.current.getBoundingClientRect(),
    );
    setPosition({ left, top });
  }, [collapsed, open, toolbarWidth]);

  return (
    <div className="contents">
      {collapsed && (
        <Tooltip label={value ? `${label} · ${value}` : label}>
          <button
            ref={triggerRef}
            type="button"
            popoverTarget={id}
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="hf-timeline-toolbutton"
          >
            <Icon size={16} strokeWidth={1.75} />
          </button>
        </Tooltip>
      )}
      <div
        id={id}
        ref={panelRef}
        popover={collapsed ? "auto" : undefined}
        role={collapsed ? "dialog" : "group"}
        aria-label={label}
        onToggle={(event) => setOpen(event.newState === "open")}
        className="hf-timeline-toolbar-group"
        style={collapsed ? { ...position, visibility: open ? "visible" : "hidden" } : undefined}
      >
        {collapsed && (
          <div className="mb-2 flex items-center justify-between gap-3 text-xs text-panel-text-2">
            <span>{label}</span>
            {value && <span className="tabular-nums">{value}</span>}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    </div>
  );
}

// fallow-ignore-next-line complexity
export function TimelineToolbar({
  domEditSession,
  onDeleteElement,
  onDeleteDomElement,
}: TimelineToolbarProps) {
  const { tx } = useStudioI18n();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const editingModeTriggerRef = useRef<HTMLButtonElement>(null);
  const annotationTriggerRef = useRef<HTMLButtonElement>(null);
  const propertyTriggerRef = useRef<HTMLButtonElement>(null);
  const [toolbarWidth, setToolbarWidth] = useState(0);
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const measure = () => setToolbarWidth(toolbar.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);
  const layout = toolbarWidth >= 760 ? "full" : toolbarWidth >= 560 ? "compact" : "narrow";
  const [pendingAction, setPendingAction] = useState<"delete" | "keyframe" | null>(
    null,
  );
  const activeTool = usePlayerStore((state) => state.activeTool);
  const setActiveTool = usePlayerStore((state) => state.setActiveTool);
  const thumbnailMode = usePlayerStore((state) => state.thumbnailMode);
  const setThumbnailMode = usePlayerStore((state) => state.setThumbnailMode);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const selectedElementIds = usePlayerStore((s) => s.selectedElementIds);
  const expandedElements = useExpandedTimelineElements();
  const rawElements = usePlayerStore((state) => state.elements);
  const clipManifest = usePlayerStore((state) => state.clipManifest);
  const domClipChildren = usePlayerStore((state) => state.domClipChildren);
  // Flat scene rows are not necessarily expanded in the legacy hierarchy.
  // Keep its rebased elements authoritative, then include the remaining DOM rows.
  const elements = useMemo(() => {
    const keys = new Set(expandedElements.map((element) => element.key ?? element.id));
    return [...expandedElements, ...collectTimelineTreeElements(rawElements, clipManifest ?? [], domClipChildren)
      .filter((element) => !keys.has(element.key ?? element.id))];
  }, [expandedElements, rawElements, clipManifest, domClipChildren]);
  const selectedElement = findSelectedTimelineElement(
    elements,
    selectedElementId,
    selectedElementIds,
  );
  const domEditSelection = domEditSession?.domEditSelection ?? null;
  const selectedElementKey = selectedElement ? (selectedElement.key ?? selectedElement.id) : null;
  const domSelectionTimelineId = domEditSelection
    ? findMatchingTimelineElementId(domEditSelection, elements)
    : null;
  const matchingDomSelection =
    domEditSelection && (!selectedElementKey || domSelectionTimelineId === selectedElementKey)
      ? domEditSelection
      : null;
  const { zoomMode, manualZoomPercent, setZoomMode, setManualZoomPercent } = useTimelineZoom();
  const timelineZoomPercent = getTimelineZoomPercent(zoomMode, manualZoomPercent);
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

  const iconButton = "hf-timeline-toolbutton";
  const { onEditPropertyKeyframe } = useTimelineEditContextOptional();
  const [keyframeProperty, setKeyframeProperty] = useState<string | null>(null);
  const keyframePending = useRef(false);
  const selectedPoint = usePlayerStore(state => state.selectedPropertyKeyframe);
  const canChooseProperty = Boolean(
    projectId && matchingDomSelection && selectedElementKey && selectedElement &&
    !selectedElement.timelineLocked && selectedElementIds.size <= 1 && onEditPropertyKeyframe,
  );
  const animations = domEditSession?.selectedGsapAnimations ?? [];
  const authoredProperties = new Set(buildTimelinePropertyRows(animations).map(row => row.key));
  const resolveTarget = (property: string): ReturnType<typeof resolveTimelinePropertyKeyframeTarget> => selectedElement
    ? resolveTimelinePropertyKeyframeTarget(animations, selectedElement, property, currentTime,
        selectedPoint?.ownerKey === selectedElementKey && selectedPoint.property === property ? selectedPoint.animationId : undefined, domEditSession?.domEditSelection?.element.ownerDocument)
    : { kind: "blocked" };
  const propertyChoices = buildTimelinePropertyRows(
    animations, TIMELINE_EMPTY_PROPERTY_ROWS.map(row => row.key),
  ).map(row => ({ ...row, animated: authoredProperties.has(row.key), blocked: resolveTarget(row.key).kind === "blocked" }));
  const activeProperty = propertyChoices.find(row => row.key === keyframeProperty);
  const { setRightPanelTab, setRightCollapsed } = usePanelLayoutContext();
  const addPropertyKeyframe = async (property: string) => {
    if (!canChooseProperty || !selectedElement || !selectedElementKey || !onEditPropertyKeyframe ||
      pendingAction || keyframePending.current) return;
    const target = resolveTarget(property);
    if (target.kind === "blocked") return;
    setKeyframeProperty(property);
    const store = usePlayerStore.getState();
    store.setSelectedTimelineEffect({ ownerKey: selectedElementKey,
      animationId: target.kind === "existing" ? target.point.animation.id : target.animationId, property });
    store.requestClipReveal(selectedElementKey);
    setRightPanelTab("design");
    setRightCollapsed(false);
    if (target.kind === "existing") {
      store.setSelectedPropertyKeyframe({ ownerKey: selectedElementKey, property,
        animationId: target.point.animation.id, time: target.point.time });
      return;
    }
    keyframePending.current = true;
    setPendingAction("keyframe");
    try {
      const changed = await onEditPropertyKeyframe(selectedElement, target.animationId, property, target.percentage, { action: "add" });
      if (changed) store.setSelectedPropertyKeyframe({ ownerKey: selectedElementKey, property,
        animationId: target.animationId, time: currentTime });
    } catch (error) {
      showToast(error instanceof Error ? error.message : tx("Could not add keyframe"), "error");
    } finally {
      keyframePending.current = false;
      setPendingAction(null);
    }
  };
  const canDelete = Boolean(
    (matchingDomSelection && onDeleteDomElement) || (selectedElement && onDeleteElement),
  );
  useKeyframeKeyboard({
    enabled: STUDIO_KEYFRAMES_ENABLED && canChooseProperty,
    onAddKeyframe: () => {
      if (keyframeProperty) void addPropertyKeyframe(keyframeProperty);
      else propertyTriggerRef.current?.click();
    },
  });
  const runSelectionAction = async (
    action: "delete",
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
      ref={toolbarRef}
      className="hf-timeline-toolbar flex h-11 items-center justify-between gap-4 border-y border-[var(--hf-panel-hairline)] bg-[var(--hf-studio-toolbar-bg)] px-4"
      data-testid="figma-timeline-toolbar"
      data-toolbar-layout={layout}
      data-toolbar-wrap={toolbarWidth > 0 && toolbarWidth < 340}
      data-preserve-studio-selection="true"
    >
      <div className="hf-timeline-toolbar-edit flex min-w-0 items-center gap-2">
        <DropdownMenu>
          <Tooltip label={tx("Editing mode")}>
            <DropdownMenuTrigger
              ref={editingModeTriggerRef}
              render={<button type="button" className="hf-timeline-toolbutton hf-timeline-tool-dropdown" />}
              aria-label={tx("Editing mode")}
              aria-pressed={["select", "stretch", "razor"].includes(activeTool)}
            >
              {activeTool === "razor" ? <Scissors size={16} /> : activeTool === "stretch" ? <ArrowLeftRight size={16} /> : <MousePointer2 size={16} />}
              <ChevronDown size={10} aria-hidden="true" />
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent finalFocus={editingModeTriggerRef} aria-label={tx("Editing mode")}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>{tx("Editing mode")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={activeTool}>
                <DropdownMenuRadioItem closeOnClick value="select" aria-label={tx("Selection tool")} onClick={() => setActiveTool("select")}>
                  <MousePointer2 /><span>{tx("Select and trim")}</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem closeOnClick value="stretch" aria-label={tx("Stretch tool")} onClick={() => setActiveTool("stretch")}>
                  <ArrowLeftRight /><span>{tx("Stretch tool")}</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem closeOnClick value="razor" aria-label={tx("Razor tool")} onClick={() => setActiveTool("razor")}>
                  <Scissors /><span>{tx("Razor tool")}</span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <Tooltip label={tx("AI annotations")}>
            <DropdownMenuTrigger
              ref={annotationTriggerRef}
              render={<button type="button" className="hf-timeline-toolbutton hf-timeline-tool-dropdown" />}
              aria-label={tx("AI annotations")}
              aria-pressed={activeTool === "annotate" || activeTool === "annotate-lasso"}
            >
              <Pencil size={16} /><ChevronDown size={10} aria-hidden="true" />
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent finalFocus={annotationTriggerRef} aria-label={tx("AI annotations")} className="w-max max-w-[calc(100vw-16px)]">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{tx("AI annotations")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={activeTool}>
                <DropdownMenuRadioItem closeOnClick value="annotate" aria-label={tx("Annotate time range")}
                  onClick={() => setActiveTool(activeTool === "annotate" ? "select" : "annotate")}>
                  <TextSelect /><span>{tx("Annotate time range")}</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem closeOnClick value="annotate-lasso" aria-label={tx("Lasso clips for AI")}
                  onClick={() => setActiveTool(activeTool === "annotate-lasso" ? "select" : "annotate-lasso")}>
                  <Pencil /><span>{tx("Lasso clips for AI")}</span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <ToolbarGroup collapsed={layout === "narrow"} label={tx("Edit actions")} icon={Ellipsis} toolbarWidth={toolbarWidth}>
        <Tooltip label={tx(editHistory.undoLabel ? `Undo ${editHistory.undoLabel}` : "Undo")}>
          <button
            type="button"
            className={iconButton}
            onClick={() => void handleUndo()}
            disabled={!editHistory.canUndo}
            aria-label={tx("Undo")}
          >
            <Undo2 size={16} aria-hidden="true" />
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
            <Redo2 size={16} aria-hidden="true" />
          </button>
        </Tooltip>
        <span className="h-4 w-px shrink-0 bg-panel-border" aria-hidden="true" />
        <div id={CANVAS_SNAP_TOOLBAR_SLOT_ID} className="flex shrink-0 items-center" />
        {STUDIO_KEYFRAMES_ENABLED && (
          <div role="group" aria-label={tx("Add keyframe")} className="flex shrink-0 items-center">
            <Tooltip label={activeProperty ? `${tx("Add keyframe")} · ${tx(activeProperty.label)}` : tx("Choose an animation property")}>
              <button type="button" className={iconButton} data-testid="add-property-keyframe"
                aria-busy={pendingAction === "keyframe"}
                aria-label={activeProperty ? `${tx("Add keyframe")} · ${tx(activeProperty.label)}` : tx("Add keyframe")}
                disabled={!canChooseProperty || pendingAction !== null || Boolean(activeProperty?.blocked)}
                onClick={() => keyframeProperty ? void addPropertyKeyframe(keyframeProperty) : propertyTriggerRef.current?.click()}>
                <Diamond size={16} aria-hidden="true" />
              </button>
            </Tooltip>
            <DropdownMenu>
              <Tooltip label={tx("Choose an animation property")}>
                <DropdownMenuTrigger ref={propertyTriggerRef}
                  render={<button type="button" className="hf-timeline-toolbutton" style={{width:20,minWidth:20}} />}
                  disabled={!canChooseProperty || pendingAction !== null}
                  aria-label={tx("Choose an animation property")}>
                  <ChevronDown size={12} aria-hidden="true" />
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent finalFocus={(closeType) => {
                if (closeType === "keyboard") requestAnimationFrame(() => {
                  if (document.activeElement === document.body) propertyTriggerRef.current?.focus();
                });
                return propertyTriggerRef.current;
              }}>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{tx("Add keyframe")}</DropdownMenuLabel>
                  {propertyChoices.map(row => (
                    <DropdownMenuItem key={row.key} data-property-choice={row.key} disabled={row.blocked}
                      onClick={() => void addPropertyKeyframe(row.key)}>
                      <span className="flex-1">{tx("Add keyframe")} · {tx(row.label)}</span>
                      <span className="text-ui-caption text-muted-foreground">
                        {tx(row.blocked ? "Unavailable at current time" : row.animated ? "Animated" : "Not animated")}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <Tooltip label={tx("Delete selected element")}>
          <button
            type="button"
            className={iconButton}
            disabled={!canDelete || pendingAction !== null}
            aria-label={tx("Delete selected element")}
            aria-busy={pendingAction === "delete"}
            onClick={() => {
              if (matchingDomSelection && onDeleteDomElement) {
                void runSelectionAction("delete", () => onDeleteDomElement(matchingDomSelection));
                return;
              }
              if (selectedElement && onDeleteElement) {
                void runSelectionAction("delete", () =>
                  onDeleteElement(rebaseExpandedTimelineEdit(selectedElement, currentTime).element),
                );
              }
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </Tooltip>
        </ToolbarGroup>
      </div>

      <div className="hf-timeline-toolbar-view flex shrink-0 items-center gap-2">
        <Tooltip label={tx(thumbnailMode === "hidden" ? "Show thumbnails" : "Hide thumbnails")}>
          <button
            type="button"
            className={iconButton}
            aria-label={tx("Show thumbnails")}
            aria-pressed={thumbnailMode !== "hidden"}
            onClick={() =>
              setThumbnailMode(
                thumbnailMode === "hidden" ? "adaptive" : "hidden",
              )
            }
          >
            <Image size={16} />
          </button>
        </Tooltip>
        <Tooltip label={tx(zoomMode === "fit"
          ? "Timeline is fitted; clip durations are unchanged. Zoom in to inspect details."
          : "Show the entire timeline from 00:00 without changing clip durations")}>
          <button
            type="button"
            className={iconButton}
            aria-label={tx("Fit timeline")}
            aria-pressed={zoomMode === "fit"}
            onClick={() => setZoomMode("fit")}
          >
            <ArrowLeftRight size={16} aria-hidden="true" />
          </button>
        </Tooltip>
        <ToolbarGroup
          collapsed={layout !== "full"}
          label={tx("Timeline zoom")}
          icon={ZoomIn}
          toolbarWidth={toolbarWidth}
          value={`${timelineZoomPercent}%`}
        >
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
              <ZoomOut size={16} aria-hidden="true" />
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
              <ZoomIn size={16} aria-hidden="true" />
            </button>
          </Tooltip>
        </ToolbarGroup>
        <Tooltip label={tx("Reset video to fit")}>
          <button
            type="button"
            className={iconButton}
            aria-label={tx("Reset video to fit")}
            data-testid="preview-fit-reset"
            onClick={requestPreviewZoomReset}
          >
            <Scan size={16} aria-hidden="true" />
          </button>
        </Tooltip>
        <ToolbarGroup
          collapsed={layout === "narrow"}
          label={tx("More tools")}
          icon={Ellipsis}
          toolbarWidth={toolbarWidth}
        >
          <Tooltip label={tx(capturing ? "Capturing current frame" : "Capture current frame")}>
            <a
              href={captureFrameHref}
              download={captureFrameFilename}
              onClick={handleCaptureFrameClick}
              className={`${iconButton} ${capturing ? "pointer-events-none cursor-wait" : ""}`}
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
                <Camera size={16} aria-hidden="true" />
              )}
            </a>
          </Tooltip>
          <div id={CANVAS_GRID_TOOLBAR_SLOT_ID} className="flex items-center" />
          <div id={SHORTCUTS_TOOLBAR_SLOT_ID} className="flex items-center" />
        </ToolbarGroup>
      </div>
    </div>
  );
}
