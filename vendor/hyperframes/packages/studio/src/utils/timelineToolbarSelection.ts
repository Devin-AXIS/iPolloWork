import type { TimelineElement } from "../player/store/playerStore";

export function findSelectedTimelineElement(
  elements: readonly TimelineElement[],
  selectedElementId: string | null,
  selectedElementIds: ReadonlySet<string> = new Set(),
): TimelineElement | null {
  const selectionIds = selectedElementId
    ? [selectedElementId, ...selectedElementIds].filter(
        (id, index, ids) => ids.indexOf(id) === index,
      )
    : [...selectedElementIds];

  for (const selectionId of selectionIds) {
    const exact = elements.find(
      (element) => element.key === selectionId || element.id === selectionId,
    );
    if (exact) return exact;

    // Preview/DOM selection stores the source id (or hf id), while expanded
    // timeline rows use a source-qualified key. Resolve those aliases only after
    // exact keys so a top-level id always wins over a nested duplicate.
    const alias = elements.find(
      (element) => element.domId === selectionId || element.hfId === selectionId,
    );
    if (alias) return alias;
  }

  return null;
}

export function rebaseExpandedTimelineEdit(
  element: TimelineElement,
  timelineTime: number,
): { element: TimelineElement; time: number } {
  const basis = element.expandedParentStart;
  if (basis === undefined) return { element, time: timelineTime };

  return {
    element: {
      ...element,
      id: element.domId ?? element.id,
      start: element.start - basis,
    },
    time: Math.max(0, timelineTime - basis),
  };
}
