import { useEffect, useMemo } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player/store/playerStore";
import { resolveTimelineTreeSelectionKey } from "../player/lib/timelineTreeSelection";
import type { DomEditSelection } from "../components/editor/domEditing";
import { resolveTimelineIdForSelection } from "../utils/studioHelpers";

interface UseTimelineSelectionPreviewSyncParams {
  selectedElementId: string | null;
  selectedElementIds: Set<string>;
  timelineElements: TimelineElement[];
  domEditSelection: DomEditSelection | null;
  domEditGroupSelections: DomEditSelection[];
  activeCompPath: string | null;
  buildDomSelectionForTimelineElement: (
    element: TimelineElement,
  ) => Promise<DomEditSelection | null>;
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: {
      revealPanel?: boolean;
      additive?: boolean;
      preserveGroup?: boolean;
      preserveTimelineSelection?: boolean;
    },
  ) => void;
  applyMarqueeSelection: (selections: DomEditSelection[], additive: boolean) => void;
}

function orderSelectedIds(ids: Set<string>, anchor: string | null): string[] {
  const ordered = [...ids];
  if (!anchor || !ids.has(anchor)) return ordered;
  return [anchor, ...ordered.filter((id) => id !== anchor)];
}

function selectionIdsMatch(
  currentIds: string[],
  selectedIds: string[],
  currentAnchor: string | null,
  wantedAnchor: string | null,
): boolean {
  // Compare as sets in BOTH directions: length equality misreads duplicates (two DOM
  // children resolving to the same clip id) as a full match and skips mirroring the
  // members that never made it into the preview.
  const current = new Set(currentIds);
  const selected = new Set(selectedIds);
  if (current.size !== selected.size) return false;
  for (const id of selected) {
    if (!current.has(id)) return false;
  }
  // The primary/anchor must also agree, or a change of just the anchor within the
  // same set would never re-sync the preview's primary selection.
  return currentAnchor === wantedAnchor;
}

export function useTimelineSelectionPreviewSync({
  selectedElementId,
  selectedElementIds,
  timelineElements,
  domEditSelection,
  domEditGroupSelections,
  activeCompPath,
  buildDomSelectionForTimelineElement,
  applyDomSelection,
  applyMarqueeSelection,
}: UseTimelineSelectionPreviewSyncParams): void {
  const selectedIds = useMemo(
    () => orderSelectedIds(selectedElementIds, selectedElementId),
    [selectedElementId, selectedElementIds],
  );
  const selectedKey = selectedIds.join("\0");

  useEffect(() => {
    const currentSelections =
      domEditGroupSelections.length > 1
        ? domEditGroupSelections
        : domEditSelection
          ? [domEditSelection]
          : [];
    const tree = usePlayerStore.getState();
    const resolveCurrentId = (selection: DomEditSelection) => {
      const key = resolveTimelineTreeSelectionKey({elementId:selection.id ?? undefined,
        hfId:selection.hfId,sourceFile:selection.sourceFile,selector:selection.selector,
        selectorIndex:selection.selectorIndex,elements:timelineElements,
        manifest:tree.clipManifest ?? [],domClipChildren:tree.domClipChildren});
      return timelineElements.some((element) => (element.key ?? element.id) === key)
        ? key : resolveTimelineIdForSelection(selection,timelineElements,activeCompPath);
    };
    const currentIds = currentSelections
      .map(resolveCurrentId)
      .filter((id): id is string => Boolean(id));
    const currentAnchor = domEditSelection
      ? resolveCurrentId(domEditSelection)
      : null;

    if (selectedIds.length === 0) {
      if (currentSelections.length > 0) applyDomSelection(null, { revealPanel: false });
      return;
    }
    // A canvas-picked child can belong to a collapsed timeline row. Its exact
    // tree key is already selected; absence from the visible rows is not a deselect.
    if (currentSelections.every(selection => selection.element.isConnected) &&
      selectionIdsMatch(currentIds, selectedIds, currentAnchor, selectedElementId)) return;
    let cancelled = false;
    const syncSelection = async () => {
      const resolved: Array<{ id: string; selection: DomEditSelection }> = [];
      for (const id of selectedIds) {
        const element = timelineElements.find((item) => (item.key ?? item.id) === id);
        if (!element) continue;
        const selection = await buildDomSelectionForTimelineElement(element);
        if (selection) resolved.push({ id, selection });
      }
      if (cancelled) return;
      const visibleIds = resolved.map((item) => item.id);
      const visibleAnchor = resolved.some((item) => item.id === selectedElementId)
        ? selectedElementId
        : (visibleIds[0] ?? null);
      if (selectionIdsMatch(currentIds, visibleIds, currentAnchor, visibleAnchor)) return;

      const selections = resolved.map((item) => item.selection);
      if (selections.length === 0) {
        // Keep the lower tree row selected. An inactive row has no valid canvas
        // counterpart at this playhead, so only the upper overlay is cleared.
        applyDomSelection(null, {
          revealPanel: false,
          preserveTimelineSelection: true,
        });
      } else if (selections.length === 1) {
        applyDomSelection(selections[0], { revealPanel: false });
      } else {
        applyMarqueeSelection(selections, false);
      }
    };

    void syncSelection();
    return () => {
      cancelled = true;
    };
  }, [
    activeCompPath,
    applyDomSelection,
    applyMarqueeSelection,
    buildDomSelectionForTimelineElement,
    domEditGroupSelections,
    domEditSelection,
    selectedElementId,
    selectedIds,
    selectedKey,
    timelineElements,
  ]);
}
