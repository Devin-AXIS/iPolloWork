import { useMemo } from "react";
import type { TimelineElement } from "../store/playerStore";
import { getTrackStyle, type TrackVisualStyle } from "./timelineIcons";
import { getTimelinePaletteStyle } from "./timelineTheme";
import {
  buildTimelineColorIndexes,
  resolveTimelineColorGroupKey,
  resolveTimelineKind,
} from "./timelineLayerPresentation";

/**
 * Per-render track derivations Timeline.tsx feeds the canvas/lanes: the lane →
 * clip grouping (`tracks`, ascending), per-lane visual styles, the ascending
 * `trackOrder`, and the z-override badge set. Extracted from Timeline.tsx as a
 * cohesive unit (600-line studio cap); each memo keys on the expanded display
 * element set exactly as before.
 */
export function useTimelineTrackDerivations(expandedElements: TimelineElement[]): {
  tracks: [number, TimelineElement[]][];
  trackStyles: Map<number, TrackVisualStyle>;
  elementStyles: Map<string, TrackVisualStyle>;
  trackOrder: number[];
} {
  const tracks = useMemo(() => {
    const map = new Map<number, TimelineElement[]>();
    for (const el of expandedElements) {
      const list = map.get(el.track) ?? [];
      list.push(el);
      map.set(el.track, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [expandedElements]);

  const { trackStyles, elementStyles } = useMemo(() => {
    const colorIndexes = buildTimelineColorIndexes(expandedElements);
    const byElement = new Map<string, TrackVisualStyle>();
    for (const element of expandedElements) {
      const colorIndex = colorIndexes.get(resolveTimelineColorGroupKey(element)) ?? 0;
      byElement.set(element.key ?? element.id, getTimelinePaletteStyle(colorIndex));
    }

    const byTrack = new Map<number, TrackVisualStyle>();
    for (const [trackNum, els] of tracks) {
      const first = els[0];
      byTrack.set(
        trackNum,
        first
          ? (byElement.get(first.key ?? first.id) ?? getTrackStyle(resolveTimelineKind(first)))
          : getTrackStyle("element"),
      );
    }
    return { trackStyles: byTrack, elementStyles: byElement };
  }, [expandedElements, tracks]);

  const trackOrder = useMemo(() => tracks.map(([trackNum]) => trackNum), [tracks]);

  return { tracks, trackStyles, elementStyles, trackOrder };
}
