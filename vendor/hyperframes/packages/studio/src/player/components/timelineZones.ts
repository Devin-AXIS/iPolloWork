import type { TimelineElement } from "../store/playerStore";
import { isAudioTimelineElement } from "../../utils/timelineInspector";

export type TrackZone = "visual" | "audio";

export function classifyZone(el: TimelineElement): TrackZone {
  return isAudioTimelineElement(el) ? "audio" : "visual";
}

/** Preserve authored lane identities; legacy overlaps get display-only subrows
 * within their own track, so they cannot renumber unrelated authored tracks. */
export function normalizeToZones(elements: TimelineElement[]): TimelineElement[] {
  const groups = new Map<number, TimelineElement[]>();
  for (const element of elements) {
    const track = element.authoredTrack ?? element.track;
    const group = groups.get(track) ?? [];
    group.push(element);
    groups.set(track, group);
  }
  const lanes = new Map<string, number>();
  for (const [track, group] of groups) {
    const rows: TimelineElement[][] = [];
    for (const element of [...group].sort((a, b) => (a.key ?? a.id).localeCompare(b.key ?? b.id))) {
      let row = rows.findIndex((clips) => clips.every((clip) =>
        element.start >= clip.start + clip.duration - 1e-6 ||
        clip.start >= element.start + element.duration - 1e-6));
      if (row < 0) { row = rows.length; rows.push([]); }
      rows[row].push(element);
      lanes.set(element.key ?? element.id, track + row / (group.length + 1));
    }
  }
  return elements.map((element) => {
    const track = lanes.get(element.key ?? element.id);
    return track === undefined || track === element.track ? element : {
      ...element, track, authoredTrack: element.authoredTrack ?? element.track,
    };
  });
}

/** Scene lanes contain only local layers; source track identities stay intact. */
export function toSceneLayerRows(elements: TimelineElement[]): TimelineElement[] {
  const local = elements.filter((element) => !element.sharedLayer);
  const visuals = local.filter((element) => !isAudioTimelineElement(element)).sort((a, b) =>
    Number(b.sceneLayer?.role === "scene") - Number(a.sceneLayer?.role === "scene") ||
    (b.zIndex ?? 0) - (a.zIndex ?? 0) || a.track - b.track ||
    (a.key ?? a.id).localeCompare(b.key ?? b.id));
  const audio = local.filter(isAudioTimelineElement);
  return [...visuals.map((element, track) => ({ ...element, track,
    authoredTrack: element.authoredTrack ?? element.track })),
    ...audio.map((element) => ({ ...element, track: visuals.length,
      authoredTrack: element.authoredTrack ?? element.track }))];
}

export function isSceneTimelineElement(element: TimelineElement): boolean {
  return element.inlineScopeKind === "scene" || Boolean(element.compositionSrc);
}

/** Every overview visual owns a display lane; audio shares one final lane. */
export function toMasterSceneRows(elements: TimelineElement[]): TimelineElement[] {
  const visuals = elements.filter((element) => !isAudioTimelineElement(element));
  const audio = elements.filter(isAudioTimelineElement);
  return [...visuals.map((element, track) => ({ ...element,
    track,
    sharedLayer: element.sharedLayer ?? !isSceneTimelineElement(element),
    authoredTrack: element.authoredTrack ?? element.track })),
    ...audio.map((element) => ({ ...element, track: visuals.length,
      authoredTrack: element.authoredTrack ?? element.track }))];
}
