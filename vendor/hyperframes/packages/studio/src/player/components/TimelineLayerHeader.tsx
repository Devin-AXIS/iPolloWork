import { GripVertical, Link2, Lock, LockOpen, Eye, EyeOff, Image, Film, Type, Shapes, Layers, AudioLines, Sparkles, type LucideIcon } from "lucide-react";
import { Tooltip } from "../../components/ui/Tooltip";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { TimelineElement, TimelineKind } from "../store/playerStore";
import type { TimelineTheme, TimelineTrackStyle } from "./timelineTheme";
import { getTimelineEditCapabilities } from "./timelineEditing";
import {
  resolveTimelineKind,
  resolveTimelineBindingId,
  resolveTimelineLayerDepth,
  resolveTimelineLayerLabel,
  resolveTimelineClipLabel,
} from "./timelineLayerPresentation";
import { isAudioTimelineElement } from "../../utils/timelineInspector";
import { useStudioI18n } from "../../i18n";

function resolveLayerIcon(element: TimelineElement | null): LucideIcon {
  if (!element) return Shapes;
  const kind = resolveTimelineKind(element);
  if (kind === "text") return Type;
  if (kind === "image" || kind === "logo") return Image;
  if (kind === "video") return Film;
  if (kind === "audio" || kind === "music" || kind === "voiceover") return AudioLines;
  if (kind === "effect") return Sparkles;
  if (kind === "composition" || element.inlineScopeKind ||
      element.sceneLayer?.role === "group" || element.sceneLayer?.role === "scene") return Layers;
  return Shapes;
}

interface TimelineLayerHeaderProps {
  editingMode?: "master" | "scene";
  track: number;
  elements: TimelineElement[];
  primaryElement?: TimelineElement | null;
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
  onDrillDown?: (element: TimelineElement) => void;
  onScheduleExpanded?: (element: TimelineElement) => void;
  onCancelScheduledExpansion?: () => void;
  onReorderPointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    element: TimelineElement,
  ) => void;
}

export function TimelineLayerHeader({
  editingMode = "scene",
  track,
  elements,
  primaryElement,
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
  onDrillDown,
  onScheduleExpanded,
  onCancelScheduledExpansion,
  onReorderPointerDown,
}: TimelineLayerHeaderProps) {
  const { tx } = useStudioI18n();
  const first = primaryElement ?? elements[0] ?? null;
  const primaryElements = first ? [first] : elements;
  const kind = first ? resolveTimelineKind(first) : "element";
  const KindIcon = resolveLayerIcon(first);
  const LockIcon = locked ? Lock : LockOpen;
  const EyeIcon = hidden ? EyeOff : Eye;
  const isAudioLane = elements.length > 0 && elements.every(isAudioTimelineElement);
  const baseLabel = isAudioLane ? tx("Audio") : editingMode === "master" && elements.length > 1 ? tx("Scenes") : editingMode === "master"
    ? resolveTimelineLayerLabel(primaryElements, track)
    : resolveTimelineLayerLabel(primaryElements, track);
  const label = first?.sceneLayer?.role === "scene" ? tx("Scene overall") : baseLabel;
  const groupHint = first?.sceneLayer?.parentLabel
    ? `${tx("Belongs to")}: ${first.sceneLayer.parentLabel}` : null;
  const bindingId = resolveTimelineBindingId(primaryElements);
  const depth = resolveTimelineLayerDepth(primaryElements);
  const capabilities = first ? getTimelineEditCapabilities(first) : null;
  const status = capabilities?.status ?? "missing-target";
  const statusTitle =
    status === "materializes-timing"
      ? "Timing is inferred; the first edit saves explicit timing"
      : status === "locked"
        ? "Locked in the composition source"
        : status === "nested-context"
          ? first?.inlineScopeKind && !first.compositionSrc
            ? capabilities?.canMove
              ? "Move this scene as a whole; scene trimming is not supported yet"
              : "Edit group timing through its authored properties"
            : "Open the parent composition to edit this nested layer"
          : status === "missing-target"
            ? "No stable source target is available"
            : status === "invalid-duration"
              ? "This layer has no valid editable duration"
              : "Editable";
  const editability =
    !first || status === "missing-target"
      ? "unavailable"
      : status === "editable" || status === "materializes-timing" || (status === "nested-context" && first?.inlineScopeKind)
        ? "editable"
        : "limited";
  const canDrillDown = Boolean(first && (first.compositionSrc || (!first.sceneLayer && first.inlineScopeKind)) && onDrillDown);
  const showGroupHint = editingMode === "master" && canDrillDown && !first?.sharedLayer && !isAudioLane;
  const selectionTitle =
    editability === "editable" ? label : `${label} · ${statusTitle}`;
  const interactionHint = canDrillDown
    ? tx("Click to expand properties; double-click to enter (Ctrl/⌘+Enter)")
    : expandable ? tx("Click to expand properties") : null;
  const canReorder = Boolean(
    first && elements.length === 1 && capabilities?.canMove && onReorderPointerDown,
  );
  const reorderTitle =
    elements.length > 1
      ? "This row contains multiple clips; reorder clips individually"
      : canReorder
        ? "Drag vertically to reorder this layer"
        : statusTitle;
  const pendingToggle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pendingToggle.current) clearTimeout(pendingToggle.current); }, []);
  const cancelToggle = () => {
    if (pendingToggle.current) clearTimeout(pendingToggle.current);
    pendingToggle.current = null;
    onCancelScheduledExpansion?.();
  };
  const selectName = (doubleClick: boolean) => {
    cancelToggle();
    if (!first) { onSelect(null); return; }
    if (doubleClick) {
      onSelect(first);
      if (canDrillDown) onDrillDown?.(first);
      else if (expandable) onToggleExpanded(first);
    } else if (expandable || onScheduleExpanded) {
      // Source discovery can complete after first selection. Record the intent
      // now; the owner only renders confirmed authored property channels.
      if (onScheduleExpanded) onScheduleExpanded(first);
      else pendingToggle.current = setTimeout(() => { onToggleExpanded(first); pendingToggle.current = null; }, 250);
    }
    if (!doubleClick) onSelect(first);
  };
  const nameControl = (
      <div
        role="button"
        tabIndex={0}
        className="hf-timeline-layer-header__select"
        aria-label={tx(`Select ${label}`)}
        aria-pressed={selected}
        aria-keyshortcuts={canDrillDown ? "Enter Space Control+Enter Meta+Enter" : "Enter Space"}
        aria-expanded={expandable ? expanded : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (event.detail < 2) selectName(false);
        }}
        onDoubleClick={(event) => { event.stopPropagation(); selectName(true); }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          cancelToggle();
          onSelect(first);
          if (first && event.key === "Enter" && (event.ctrlKey || event.metaKey) && canDrillDown) {
            onDrillDown?.(first);
          } else if (first && expandable) onToggleExpanded(first);
        }}
      >
        <span className="hf-timeline-layer-header__kind">
          <KindIcon size={14} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <span className="hf-timeline-layer-header__label">
          <span className="hf-timeline-layer-header__name block truncate">{label}</span>
          {groupHint && <span className="block truncate text-ui-caption text-muted-foreground">{groupHint}</span>}
        </span>
        {first?.sceneLayer?.role === "group" && <span className="shrink-0 text-ui-caption text-muted-foreground">{tx("Overall")}</span>}
        {first?.sharedLayer && !isAudioLane && <span className="text-ui-caption font-normal text-muted-foreground">{tx("Shared")}</span>}
        {elements.length > 1 && (
          <span className="shrink-0 text-ui-caption font-normal text-muted-foreground" title={elements.map(resolveTimelineClipLabel).join("\n")}>
            {elements.length} {tx("clips")}
          </span>
        )}
        {bindingId && (
          <span
            className="hf-timeline-layer-header__binding"
            style={{ color: visualStyle.accent }}
            title={tx(`Bound group: ${bindingId}`)}
            aria-label={tx(`Bound group: ${bindingId}`)}
          >
            <Link2 size={14} strokeWidth={1.75} aria-hidden="true" />
          </span>
        )}
      </div>
  );
  return (
    <div
      className={`hf-timeline-layer-header sticky left-0 z-[12] flex flex-shrink-0 items-center ${
        selected ? "is-selected" : ""
      } ${editability === "unavailable" ? "is-uneditable" : ""} ${
        editability === "limited" ? "is-limited" : ""
      }`}
      style={{
        width: gutterWidth,
        paddingLeft: 10 + depth * 16,
        color: selected ? theme.textPrimary : theme.textSecondary,
        background: theme.gutterBackground,
        borderRight: `1px solid ${theme.gutterBorder}`,
        borderBottom: `1px solid ${theme.rowBorder}`,
      }}
      data-layer-kind={kind}
      data-layer-scene-role={first?.sceneLayer?.role}
      data-layer-parent-label={first?.sceneLayer?.parentLabel}
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
      <Tooltip
        label={showGroupHint ? tx("Double-click to enter group editing") :
          [tx(selectionTitle), groupHint, interactionHint].filter(Boolean).join(" · ")}
        render={nameControl}
      />

      <span className="hf-timeline-layer-header__actions">
        <Tooltip label={tx(locked ? `Unlock ${label}` : `Lock ${label}`)} render={
<button
          type="button"
          className={`hf-timeline-layer-header__status ${
            locked ? "is-locked" : "is-editable"
          }`}
          aria-label={tx(locked ? `Unlock ${label}` : `Lock ${label}`)}
          aria-pressed={locked}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleLocked(!locked);
          }}
        >
          <LockIcon size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
          } />

        <Tooltip label={tx(hidden ? `Show ${label}` : `Hide ${label}`)} render={
<button
          type="button"
          aria-label={tx(hidden ? `Show ${label}` : `Hide ${label}`)}
          className={`hf-timeline-layer-header__visibility ${hidden ? "is-hidden" : ""}`}
          style={{ color: hidden ? "var(--primary-text)" : "var(--muted-foreground)" }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleHidden(!hidden);
          }}
        >
          <EyeIcon size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
          } />

        {first && (
          <Tooltip label={tx(reorderTitle)} render={
<span className="inline-flex" tabIndex={canReorder ? -1 : 0}>
<button
            type="button"
            className="hf-timeline-layer-header__reorder"
            aria-label={tx(`Reorder ${label}`)}
              disabled={!canReorder}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (canReorder) onReorderPointerDown?.(event, first);
            }}
          >
            <GripVertical size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>

</span>
          } />
        )}
      </span>
    </div>
  );
}
