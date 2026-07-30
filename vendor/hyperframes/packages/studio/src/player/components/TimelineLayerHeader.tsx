import {
  CaretDown,
  CaretRight,
  Clock,
  DotsSixVertical,
  Eye,
  EyeSlash,
  LinkSimple,
  LockSimple,
  LockSimpleOpen,
} from "@phosphor-icons/react";
import { type PointerEvent as ReactPointerEvent } from "react";
import type { TimelineElement } from "../store/playerStore";
import type { TimelineTheme, TimelineTrackStyle } from "./timelineTheme";
import { GUTTER } from "./timelineLayout";
import { TimelineKindIcon } from "./TimelineClipContent";
import { getTimelineEditCapabilities } from "./timelineEditing";
import {
  resolveTimelineKind,
  resolveTimelineBindingId,
  resolveTimelineLayerDepth,
  resolveTimelineLayerLabel,
} from "./timelineLayerPresentation";

interface TimelineLayerHeaderProps {
  track: number;
  elements: TimelineElement[];
  hidden: boolean;
  selected: boolean;
  expanded: boolean;
  theme: TimelineTheme;
  visualStyle: TimelineTrackStyle;
  onToggleHidden: (hidden: boolean) => void;
  onSelect: (element: TimelineElement | null) => void;
  onReorderPointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    element: TimelineElement,
  ) => void;
}

export function TimelineLayerHeader({
  track,
  elements,
  hidden,
  selected,
  expanded,
  theme,
  visualStyle,
  onToggleHidden,
  onSelect,
  onReorderPointerDown,
}: TimelineLayerHeaderProps) {
  const first = elements[0] ?? null;
  const kind = first ? resolveTimelineKind(first) : "element";
  const label = resolveTimelineLayerLabel(elements, track);
  const bindingId = resolveTimelineBindingId(elements);
  const depth = resolveTimelineLayerDepth(elements);
  const capabilities = first ? getTimelineEditCapabilities(first) : null;
  const status = capabilities?.status ?? "missing-target";
  const editable = Boolean(
    capabilities?.canMove || capabilities?.canTrimStart || capabilities?.canTrimEnd,
  );
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
  const canReorder = Boolean(
    first && elements.length === 1 && capabilities?.canMove && onReorderPointerDown,
  );
  const reorderTitle =
    elements.length > 1
      ? "This row contains multiple clips; reorder clips individually"
      : canReorder
        ? "Drag vertically to reorder this layer"
        : statusTitle;
  const isComposition = elements.some((element) => Boolean(element.compositionSrc));

  return (
    <div
      className={`hf-timeline-layer-header sticky left-0 z-[12] flex flex-shrink-0 items-center ${
        selected ? "is-selected" : ""
      }`}
      style={{
        width: GUTTER,
        paddingLeft: 6 + depth * 14,
        color: selected ? theme.textPrimary : theme.textSecondary,
        background: selected
          ? (visualStyle.clipActive ?? visualStyle.clip)
          : theme.gutterBackground,
        borderRight: `1px solid ${theme.gutterBorder}`,
        borderBottom: `1px solid ${theme.rowBorder}`,
      }}
      data-layer-kind={kind}
      data-layer-depth={depth}
      data-layer-group={bindingId ?? undefined}
    >
      <button
        type="button"
        aria-label={hidden ? `Show ${label}` : `Hide ${label}`}
        title={hidden ? `Show ${label}` : `Hide ${label}`}
        className={`hf-timeline-layer-header__visibility ${hidden ? "is-hidden" : ""}`}
        style={{ color: hidden ? visualStyle.accent : "inherit" }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggleHidden(!hidden);
        }}
      >
        {hidden ? (
          <EyeSlash size={14} weight="bold" aria-hidden="true" />
        ) : (
          <Eye size={14} weight="bold" aria-hidden="true" />
        )}
      </button>

      <span
        className={`hf-timeline-layer-header__status ${
          editable ? "is-editable" : "is-locked"
        } ${status === "materializes-timing" ? "is-materializing" : ""}`}
        aria-label={`${label}: ${statusTitle}`}
        title={statusTitle}
      >
        {status === "materializes-timing" ? (
          <Clock size={12} weight="bold" aria-hidden="true" />
        ) : editable ? (
          <LockSimpleOpen size={12} aria-hidden="true" />
        ) : (
          <LockSimple size={12} weight="fill" aria-hidden="true" />
        )}
      </span>

      <button
        type="button"
        className="hf-timeline-layer-header__select"
        title={label}
        aria-label={`Select ${label}`}
        aria-pressed={selected}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(selected ? null : first);
        }}
      >
        <span
          className="hf-timeline-layer-header__kind"
          style={{ color: visualStyle.accent }}
        >
          <TimelineKindIcon kind={kind} size={15} />
        </span>
        <span className="hf-timeline-layer-header__label">{label}</span>
        {bindingId && (
          <span
            className="hf-timeline-layer-header__binding"
            style={{ color: visualStyle.accent }}
            title={`Bound group: ${bindingId}`}
            aria-label={`Bound group: ${bindingId}`}
          >
            <LinkSimple size={11} weight="bold" aria-hidden="true" />
          </span>
        )}
        {isComposition && (
          <span className="hf-timeline-layer-header__caret">
            {expanded ? (
              <CaretDown size={11} weight="bold" aria-hidden="true" />
            ) : (
              <CaretRight size={11} weight="bold" aria-hidden="true" />
            )}
          </span>
        )}
      </button>

      {first && (
        <button
          type="button"
          className="hf-timeline-layer-header__reorder"
          aria-label={`Reorder ${label}`}
          title={reorderTitle}
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
    </div>
  );
}
