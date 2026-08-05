import type { TimelineElement } from "../player/store/playerStore";

export function findSelectedTimelineElement(
  elements: readonly TimelineElement[],
  selectedElementId: string | null,
): TimelineElement | null {
  if (!selectedElementId) return null;
  const exact = elements.find(
    (element) => element.key === selectedElementId || element.id === selectedElementId,
  );
  if (exact) return exact;

  // Preview/DOM selection stores the source id (or hf id), while expanded
  // timeline rows use a source-qualified key. Resolve those aliases only after
  // exact keys so a top-level id always wins over a nested duplicate.
  return (
    elements.find(
      (element) => element.domId === selectedElementId || element.hfId === selectedElementId,
    ) ?? null
  );
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
