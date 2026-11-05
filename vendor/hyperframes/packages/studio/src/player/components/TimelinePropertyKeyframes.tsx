import { useStudioShellContextOptional } from "../../contexts/StudioContext";
import { Tooltip } from "../../components/ui/Tooltip";
import { STUDIO_PREVIEW_FPS } from "../lib/time";
import { useRef, useState } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import { useStudioI18n } from "../../i18n";
import { CommitField } from "../../components/editor/propertyPanelPrimitives";
import {
  buildTimelinePropertyPoints,
  type TimelinePropertyPoint,
  type TimelinePropertyRowDefinition,
} from "../../hooks/gsapTimelineSegmentCache";
import { resolveTweenDuration, resolveTweenStart } from "../../utils/globalTimeCompiler";
import { TRACK_H, TRACKS_LEFT_PAD } from "./timelineLayout";
import { KeyframeDiamondContextMenu } from "./KeyframeDiamondContextMenu";
import type { TimelineEditCallbacks } from "./timelineCallbacks";

interface TimelinePropertyKeyframesProps {
  element: TimelineElement;
  row: TimelinePropertyRowDefinition;
  animations: GsapAnimation[];
  pps: number;
  timeOffset?: number;
  isLastPropertyRow?: boolean;
  gutterWidth: number;
  trackContentWidth: number;
  onSeek?: (time: number) => void;
  onEditPropertyKeyframe?: TimelineEditCallbacks["onEditPropertyKeyframe"];
}

/** Property rows are presentation children; they never become timeline tracks. */
export function TimelinePropertyKeyframes({
  element,
  row,
  animations,
  pps,
  timeOffset = 0,
  isLastPropertyRow = false,
  gutterWidth,
  trackContentWidth,
  onSeek,
  onEditPropertyKeyframe,
}: TimelinePropertyKeyframesProps) {
  const { tx } = useStudioI18n();
  const context = useTimelineEditContextOptional();
  const shell = useStudioShellContextOptional();
  const [timeInputRevision, setTimeInputRevision] = useState(0);
  const edit = onEditPropertyKeyframe ?? context.onEditPropertyKeyframe;
  const selected = usePlayerStore((state) => state.selectedPropertyKeyframe);
  const property = row.property;
  const ownerKey = element.key ?? element.id;
  const points = property ? buildTimelinePropertyPoints(animations, element, property, shell?.previewIframeRef.current?.contentDocument ?? undefined) : [];
  const selectionMatches = selected?.ownerKey === ownerKey && selected.property === property;
  const sameTime = selectionMatches
    ? points.filter((point) => Math.abs(point.time - selected.time) < 0.001)
    : [];
  // A first property edit may split the source tween. Rebind to its new ID by
  // owner, channel and absolute time, but never guess between overlapping keys.
  const selectedPoint =
    sameTime.find((point) => point.animation.id === selected?.animationId) ??
    (sameTime.length === 1 ? sameTime[0] : undefined);
  const [menu, setMenu] = useState<{ x: number; y: number; point: TimelinePropertyPoint } | null>(
    null,
  );
  const [dragTime, setDragTime] = useState<number | null>(null);
  const suppressClick = useRef(false);
  const drag = useRef<{
    point: TimelinePropertyPoint;
    clientX: number;
    time: number;
    started: boolean;
  } | null>(null);
  const offset = element.expandedParentStart ?? 0;
  const selectPoint = (point: TimelinePropertyPoint) => {
    const store = usePlayerStore.getState();
    store.setSelectedElementId(ownerKey);
    store.setSelectedPropertyKeyframe({
      ownerKey,
      property: property ?? "",
      animationId: point.animation.id,
      time: point.time,
    });
    onSeek?.(point.time);
  };
  const commit = async (
    point: TimelinePropertyPoint,
    operation: Parameters<NonNullable<TimelineEditCallbacks["onEditPropertyKeyframe"]>>[4],
  ) => {
    if (!property || point.readOnly || !edit) return;
    const changed = await edit(element, point.animation.id, property, point.percentage, operation);
    if (!changed) return;
    const store = usePlayerStore.getState();
    if (operation.action === "remove") store.setSelectedPropertyKeyframe(null);
    else if (operation.action === "move" && operation.toPercentage !== undefined) {
      const start = resolveTweenStart(point.animation);
      if (start !== null)
        store.setSelectedPropertyKeyframe({
          ownerKey,
          property,
          animationId: point.animation.id,
          time:
            start + (resolveTweenDuration(point.animation) * operation.toPercentage) / 100 + offset,
        });
    }
  };
  const group = row.kind === "group";
  const percentageValue = property === "opacity" || property?.startsWith("scale");
  const unit = percentageValue ? "%" : property?.startsWith("rotation") ? "°" : "px";
  const indentation = 44;
  return (
    <div
      className="hf-timeline-property-row relative flex border-b border-panel-hairline text-muted-foreground"
      data-timeline-property={property}
      data-timeline-property-row={property ?? row.label.toLowerCase()}
      data-owner-id={element.domId ?? element.id}
      data-owner-key={ownerKey}
      style={{ height: TRACK_H }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="sticky left-0 z-20 flex shrink-0 items-center gap-1 bg-panel-bg pr-2 text-ui-meta"
        style={{ width: gutterWidth, paddingLeft: indentation }}
      >
        <svg
          aria-hidden="true"
          data-timeline-property-connector="true"
          className="pointer-events-none absolute left-0 top-0"
          width={indentation}
          height={TRACK_H}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={1}
          opacity={0.45}
        >
          <path d={`M ${indentation - 8} 0 V ${TRACK_H / 2} H ${indentation - 3}`} />
          {!isLastPropertyRow && (
            <path d={`M ${indentation - 8} ${TRACK_H / 2} V ${TRACK_H}`} />
          )}
        </svg>
        <Tooltip label={property === "x" || property === "y" ? `${tx(row.label)} · ${tx("Position offsets are relative to the layer layout")}` : tx(row.label)} render={
          <span className={`hf-timeline-property-label ${group ? "font-medium" : "shrink-0 font-normal"} ${selectedPoint ? "is-selected" : ""}`}>{tx(row.label)}</span>
        } />
        {!group && (
          <>
            {selectedPoint && (
              <>
                <div className="ml-auto flex w-14 items-center gap-0.5" title={typeof selectedPoint.value === "string" ? selectedPoint.value : tx("Keyframe value")}>
                  <CommitField
                    className="text-ui-meta font-medium text-foreground tabular-nums"
                    value={
                      selectedPoint.value === undefined
                        ? ""
                        : String(
                            typeof selectedPoint.value === "number" && percentageValue
                              ? Number((selectedPoint.value * 100).toFixed(3))
                              : selectedPoint.value,
                          )
                    }
                    ariaLabel={`${property} keyframe value at ${selectedPoint.percentage}%`}
                    disabled={selectedPoint.readOnly || !edit || typeof selectedPoint.value !== "number"}
                    onCommit={(raw) => {
                      const value = Number(raw);
                      if (raw.trim() && Number.isFinite(value))
                        void commit(selectedPoint, {
                          action: "update",
                          value: percentageValue ? value / 100 : value,
                        });
                    }}
                  />
                  <span className="text-ui-caption text-muted-foreground">{unit}</span>
                </div>
                <div className="flex w-14 items-center gap-0.5" title={tx("Keyframe time")}>
                  <CommitField
                    className="text-ui-meta font-medium text-foreground tabular-nums"
                    key={timeInputRevision}
                    value={String(Number((selectedPoint.time - timeOffset).toFixed(3)))}
                    ariaLabel={`${property} keyframe time at ${selectedPoint.percentage}%`}
                    disabled={selectedPoint.readOnly || !edit}
                    onCommit={(raw) => {
                      const start = resolveTweenStart(selectedPoint.animation);
                      const time =
                        Math.round(Number(raw) * STUDIO_PREVIEW_FPS) / STUDIO_PREVIEW_FPS + timeOffset;
                      const end = start === null ? null : start + resolveTweenDuration(selectedPoint.animation);
                      if (raw.trim() && start !== null && end !== null && Number.isFinite(time) &&
                        time - offset >= start && time - offset <= end) {
                        void commit(selectedPoint, {
                          action: "move",
                          toPercentage: ((time - offset - start) / resolveTweenDuration(selectedPoint.animation)) * 100,
                        });
                      } else {
                        setTimeInputRevision((revision) => revision + 1);
                        shell?.showToast(`${tx("Keyframe time must be inside this animation")} (${Number(((start ?? 0) + offset - timeOffset).toFixed(3))}–${Number(((end ?? 0) + offset - timeOffset).toFixed(3))}s)`, "info");
                      }
                    }}
                  />
                  <span className="text-ui-caption text-muted-foreground">s</span>
                </div>
                <Tooltip label={tx("Delete selected keyframe")} render={
<button
                  type="button"
                  aria-label={`${property} delete selected keyframe`}
                  disabled={selectedPoint.readOnly || !edit}
                  className="px-1 text-muted-foreground hover:text-destructive disabled:opacity-40"
                  onClick={() => void commit(selectedPoint, { action: "remove" })}
                >
                  ×
                </button>
            } />
              </>
            )}
            {!selectedPoint && points.length > 0 && points.every((point) => point.readOnly) && (
              <span className="ml-1 text-ui-caption text-muted-foreground">{tx("Read-only")}</span>
            )}
            {points.length === 0 && <span className="text-panel-text-3">—</span>}
          </>
        )}
      </div>
      <div className="shrink-0" style={{ width: TRACKS_LEFT_PAD }} />
      <div className="relative shrink-0" style={{ width: trackContentWidth, height: TRACK_H }}>
        {!group &&
          animations.map((animation) => {
            const channelPoints = points.filter((point) => point.animation.id === animation.id);
            if (channelPoints.length < 2) return null;
            const first = channelPoints[0];
            const last = channelPoints[channelPoints.length - 1];
            return (
              <div
                key={animation.id}
                aria-hidden="true"
                data-property-animation-line={animation.id}
                className="pointer-events-none absolute top-1/2 h-px opacity-40"
                style={{
                  backgroundColor: "var(--hf-panel-text-3)",
                  left: (first.time - timeOffset) * pps,
                  width: Math.max(0, (last.time - first.time) * pps),
                }}
              />
            );
          })}
        {!group &&
          points.map((point) => {
            const isSelected = point === selectedPoint;
            const displayTime = isSelected && dragTime !== null ? dragTime : point.time;
            const outside =
              point.time < element.start || point.time > element.start + element.duration;
            return (
              <Tooltip key={`${point.animation.id}:${point.percentage}:${property}`} label={point.readOnly ? tx("This animation is read-only here. Its existing motion was preserved.") : `${tx(row.label)} · ${Number((point.time - timeOffset).toFixed(3))}s · ${tx("Click to edit keyframe; drag to change time")}`} render={
              <button
                type="button"
                className={`absolute top-1/2 p-1 text-[13px] ${isSelected ? "text-panel-accent" : "text-panel-text-2"} ${outside || point.readOnly ? "opacity-40" : ""}`}
                style={{ left: (displayTime - timeOffset) * pps, transform: "translate(-50%, -50%)" }}
                aria-label={`${property} keyframe at ${Number((point.time - timeOffset).toFixed(3))} seconds`}
                aria-pressed={isSelected}
                data-animation-id={point.animation.id}
                data-property={property}
                data-keyframe-percentage={point.percentage}
                data-keyframe-time={point.time}

                onClick={(event) => {
                  event.stopPropagation();
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  selectPoint(point);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Delete" || event.key === "Backspace") {
                    event.preventDefault();
                    event.stopPropagation();
                    void commit(point, { action: "remove" });
                  }
                  if (event.key.toLowerCase() === "k") {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  selectPoint(point);
                  if (!point.readOnly) setMenu({ x: event.clientX, y: event.clientY, point });
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  suppressClick.current = false;
                  selectPoint(point);
                  if (event.button !== 0 || point.readOnly || !edit) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = {
                    point,
                    clientX: event.clientX,
                    time: point.time,
                    started: false,
                  };
                }}
                onPointerMove={(event) => {
                  const gesture = drag.current;
                  if (!gesture) return;
                  const delta = event.clientX - gesture.clientX;
                  if (Math.abs(delta) > 2) gesture.started = true;
                  if (!gesture.started) return;
                  const start = resolveTweenStart(gesture.point.animation);
                  if (start === null) return;
                  const time = Math.min(
                    start + offset + resolveTweenDuration(gesture.point.animation),
                    Math.max(
                      start + offset,
                      Math.round((gesture.point.time + delta / pps) * STUDIO_PREVIEW_FPS) /
                        STUDIO_PREVIEW_FPS,
                    ),
                  );
                  gesture.time = time;
                  setDragTime(time);
                }}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  const gesture = drag.current;
                  drag.current = null;
                  suppressClick.current = gesture?.started ?? false;
                  setDragTime(null);
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  const start = gesture ? resolveTweenStart(gesture.point.animation) : null;
                  if (gesture?.started && start !== null)
                    void commit(gesture.point, {
                      action: "move",
                      toPercentage:
                        ((gesture.time - offset - start) /
                          resolveTweenDuration(gesture.point.animation)) *
                        100,
                    });
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  setDragTime(null);
                }}
              >
                ◆
              </button>
              } />
            );
          })}
      </div>
      {menu && property && (
        <KeyframeDiamondContextMenu
          state={{
            x: menu.x,
            y: menu.y,
            elementId: menu.point.animation.id,
            percentage: menu.point.percentage,
            property,
            currentEase:
              menu.point.ease ??
              menu.point.animation.keyframes?.easeEach ??
              menu.point.animation.ease,
          }}
          onClose={() => setMenu(null)}
          onDelete={() => void commit(menu.point, { action: "remove" })}
          onChangeEase={(_id, _pct, ease) => void commit(menu.point, { action: "ease", ease })}
        />
      )}
    </div>
  );
}
