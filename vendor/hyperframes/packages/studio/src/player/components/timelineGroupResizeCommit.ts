import { resolveTimelineStretchedPlaybackRate } from "./timelineEditing";
import type { TimelineElement } from "../store/playerStore";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import type { TimelineGroupResizeSession } from "./timelineGroupEditing";
import {
  beginTimelineOptimisticGesture,
  rollbackLatestTimelineOptimisticGesture,
} from "./timelineOptimisticRevision";

export function commitTimelineGroupResize(
  session: TimelineGroupResizeSession,
  updateElement: (key: string, updates: Partial<TimelineElement>) => void,
  persist: TimelineEditCallbacks["onResizeElements"],
): void {
  if (!session.hasChanged) return;
  const changes = session.changes;
  const revision = beginTimelineOptimisticGesture(
    updateElement,
    changes.map((change) => change.key),
  );
  for (const change of changes) {
    updateElement(change.key, {
      start: change.start,
      duration: change.duration,
      playbackStart: change.playbackStart,
      ...(session.resizeMode === "stretch" &&
      (change.element.compositionSrc ||
        ["video", "audio"].includes(change.element.tag.toLowerCase()))
        ? {
            playbackRate: resolveTimelineStretchedPlaybackRate(
              change.element.playbackRate,
              change.element.duration,
              change.duration,
            ),
          }
        : {}),
    });
  }
  if (!persist) {
    rollbackLatestTimelineOptimisticGesture(
      updateElement,
      revision,
      session.members.map((member) => ({ key: member.key, updates: member })),
    );
    return;
  }
  const coalesceKey = `clip-group-resize:${changes.map((change) => change.key).join(":")}`;
  Promise.resolve(
    persist(
      changes.map((change) => ({
        element: change.element,
        start: change.start,
        duration: change.duration,
        playbackStart: change.playbackStart,
        resizeMode: session.resizeMode,
      })),
      { coalesceKey },
    ),
  ).catch((error) => {
    rollbackLatestTimelineOptimisticGesture(
      updateElement,
      revision,
      session.members.map((member) => ({ key: member.key, updates: member })),
    );
    console.error("[Timeline] Failed to persist group clip resize", error);
  });
}
