import { DotsSixVertical, LinkSimple } from "@phosphor-icons/react";
import { type PointerEvent as ReactPointerEvent } from "react";
import type { TimelineElement, TimelineKind } from "../store/playerStore";
import type { TimelineTheme, TimelineTrackStyle } from "./timelineTheme";
import { getTimelineEditCapabilities } from "./timelineEditing";
import {
  resolveTimelineKind,
  resolveTimelineBindingId,
  resolveTimelineLayerDepth,
  resolveTimelineLayerLabel,
} from "./timelineLayerPresentation";
import timelineChevronDownSrc from "../../icons/timelineChevronDown.svg?url";
import timelineContainerSrc from "../../icons/figmaTimelineContainer.svg?url";
import timelineContainerMutedSrc from "../../icons/figmaTimelineContainerMuted.svg?url";
import timelineImageSrc from "../../icons/figmaTimelineImage.svg?url";
import timelineEffectSrc from "../../icons/figmaTimelineEffect.svg?url";
import timelineTextSrc from "../../icons/figmaTimelineText.svg?url";
import timelineLockSrc from "../../icons/figmaTimelineLock.svg?url";
import timelineLockOpenSrc from "../../icons/figmaTimelineLockOpen.svg?url";
import timelineEyeSrc from "../../icons/figmaTimelineEye.svg?url";
import timelineEyeOffSrc from "../../icons/figmaTimelineEyeOff.svg?url";
import { useStudioI18n } from "../../i18n";

function resolveFigmaKindIcon(kind: TimelineKind, selected: boolean): string {
  if (kind === "text") return timelineTextSrc;
  if (kind === "image" || kind === "video") return timelineImageSrc;
  if (kind === "effect") return timelineEffectSrc;
  return selected ? timelineContainerSrc : timelineContainerMutedSrc;
}

interface TimelineLayerHeaderProps {
  track: number;
  elements: TimelineElement[];
  hidden: boolean;
  locked: boolean;
  selected: boolean;
  expanded: boolean;
  expandable: boolean;
  theme: TimelineTheme;
  visualStyle: TimelineTrackStyle;
  gutterWidth: number;
  onToggleHidden: (hidden: boolean) => void;
  onToggleLocked: (locked: boolean) => void;
  onSelect: (element: TimelineElement | null) => void;
  onToggleExpanded: (element: TimelineElement) => void;
  onReorderPointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    element: TimelineElement,
  ) => void;
}

export function TimelineLayerHeader({
  track,
  elements,
  hidden,
  locked,
  selected,
  expanded,
  expandable,
  theme,
  visualStyle,
  gutterWidth,
  onToggleHidden,
  onToggleLocked,
  onSelect,
  onToggleExpanded,
  onReorderPointerDown,
}: TimelineLayerHeaderProps) {
  const { tx } = useStudioI18n();
  const first = elements[0] ?? null;
  const kind = first ? resolveTimelineKind(first) : "element";
  const label = resolveTimelineLayerLabel(elements, track);
  const bindingId = resolveTimelineBindingId(elements);
  const depth = resolveTimelineLayerDepth(elements);
  const capabilities = first ? getTimelineEditCapabilities(first) : null;
  const status = capabilities?.status ?? "missing-target";
  const statusTitle =
    status === "materializes-timing"
      ? "Timing is inferred; the first edit saves explicit timing"
      : status === "locked"
        ? "Locked in the composition source"
        : status === "nested-context"
          ? "Open the parent composition to edit this nested layer"
          : status === "missing-target"
            ? "No stable source target is available"
            : status === "invalid-duration"
              ? "This layer has no valid editable duration"
              : "Editable";
  const editability =
    !first || status === "missing-target"
      ? "unavailable"
      : status === "editable" || status === "materializes-timing"
        ? "editable"
        : "limited";
  const selectionTitle =
    editability === "editable" ? label : `${label} · ${statusTitle}`;
  const canReorder = Boolean(
    first && elements.length === 1 && capabilities?.canMove && onReorderPointerDown,
  );
  const reorderTitle =
    elements.length > 1
      ? "This row contains multiple clips; reorder clips individually"
      : canReorder
        ? "Drag vertically to reorder this layer"
        : statusTitle;
  return (
    <div
      className={`hf-timeline-layer-header sticky left-0 z-[12] flex flex-shrink-0 items-center ${
        selected ? "is-selected" : ""
      } ${editability === "unavailable" ? "is-uneditable" : ""} ${
        editability === "limited" ? "is-limited" : ""
      }`}
      style={{
        width: gutterWidth,
        paddingLeft: 16 + depth * 19,
        color: selected ? theme.textPrimary : theme.textSecondary,
        background: theme.gutterBackground,
        borderRight: `1px solid ${theme.gutterBorder}`,
        borderBottom: `1px solid ${theme.rowBorder}`,
      }}
      data-layer-kind={kind}
      data-layer-depth={depth}
      data-layer-group={bindingId ?? undefined}
      data-layer-editability={editability}
      data-layer-edit-status={status}
      data-layer-element-id={first?.id}
      data-layer-dom-id={first?.domId}
      data-layer-hf-id={first?.hfId}
      data-layer-source-file={first?.sourceFile}
      data-layer-selector={first?.selector}
      onClick={() => onSelect(first)}
    >
      {first && expandable ? (
        <button
          type="button"
          className="hf-timeline-layer-header__caret"
          aria-label={tx(`${expanded ? "Collapse" : "Expand"} ${label}`)}
          aria-expanded={expanded}
          title={tx(`${expanded ? "Collapse" : "Expand"} ${label}`)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpanded(first);
          }}
        >
          <img
            src={timelineChevronDownSrc}
            alt=""
            aria-hidden="true"
            className={`h-[6px] w-[10px] transition-transform ${expanded ? "" : "-rotate-90"}`}
          />
        </button>
      ) : (
        <span className="hf-timeline-layer-header__caret-spacer" aria-hidden="true" />
      )}

      <div
        role="button"
        tabIndex={0}
        className="hf-timeline-layer-header__select"
        title={tx(selectionTitle)}
        aria-label={tx(`Select ${label}`)}
        aria-pressed={selected}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(first);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          onSelect(first);
        }}
      >
        <span className="hf-timeline-layer-header__kind">
          <img src={resolveFigmaKindIcon(kind, selected)} alt="" aria-hidden="true" />
        </span>
        <span className="hf-timeline-layer-header__label">{label}</span>
        {bindingId && (
          <span
            className="hf-timeline-layer-header__binding"
            style={{ color: visualStyle.accent }}
            title={tx(`Bound group: ${bindingId}`)}
            aria-label={tx(`Bound group: ${bindingId}`)}
          >
            <LinkSimple size={11} weight="bold" aria-hidden="true" />
          </span>
        )}
      </div>

      <span className="hf-timeline-layer-header__actions">
        <button
          type="button"
          className={`hf-timeline-layer-header__status ${
            locked ? "is-locked" : "is-editable"
          }`}
          aria-label={tx(locked ? `Unlock ${label}` : `Lock ${label}`)}
          aria-pressed={locked}
          title={tx(locked ? `Unlock ${label}` : `Lock ${label}`)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleLocked(!locked);
          }}
        >
          <img src={locked ? timelineLockSrc : timelineLockOpenSrc} alt="" aria-hidden="true" />
        </button>

        <button
          type="button"
          aria-label={tx(hidden ? `Show ${label}` : `Hide ${label}`)}
          title={tx(hidden ? `Show ${label}` : `Hide ${label}`)}
          className={`hf-timeline-layer-header__visibility ${hidden ? "is-hidden" : ""}`}
          style={{ color: hidden ? visualStyle.accent : "inherit" }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleHidden(!hidden);
          }}
        >
          <img src={hidden ? timelineEyeOffSrc : timelineEyeSrc} alt="" aria-hidden="true" />
        </button>

        {first && (
          <button
            type="button"
            className="hf-timeline-layer-header__reorder"
            aria-label={tx(`Reorder ${label}`)}
            title={tx(reorderTitle)}
            disabled={!canReorder}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (canReorder) onReorderPointerDown?.(event, first);
            }}
          >
            <DotsSixVertical size={14} weight="bold" aria-hidden="true" />
          </button>
        )}
      </span>
    </div>
  );
}
