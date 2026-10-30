import { useMemo, useRef } from "react";
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
export function useTimelineTrackDerivations(
  expandedElements: TimelineElement[],
  editingMode: "master" | "scene" = "scene",
): {
  tracks: [number, TimelineElement[]][];
  trackStyles: Map<number, TrackVisualStyle>;
  elementStyles: Map<string, TrackVisualStyle>;
  trackOrder: number[];
} {
  const retainedTracks = useRef(new Set<number>());
  const tracks = useMemo(() => {
    const map = new Map<number, TimelineElement[]>();
    for (const el of expandedElements) {
      const list = map.get(el.track) ?? [];
      list.push(el);
      map.set(el.track, list);
    }
    if (editingMode === "master") {
      for (const track of map.keys()) retainedTracks.current.add(track);
      for (const track of retainedTracks.current) if (!map.has(track)) map.set(track, []);
      // Preserve empty interior authored lanes without changing any clip's track.
      const max = Math.max(0, ...map.keys());
      for (let track = 0; track <= max; track++) if (!map.has(track)) map.set(track, []);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [expandedElements, editingMode]);

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
