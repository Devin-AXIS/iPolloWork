import type { ClipManifestClip } from "./playbackTypes";
import type { DomClipChild, TimelineElement } from "../store/playerStore";
import { buildTimelineElementKey } from "./timelineElementHelpers";
import type { StoryboardFrame } from "@hyperframes/core/storyboard";
import { isAudioTimelineElement } from "../../utils/timelineInspector";

/** Resolve against the official timeline, never manufacture a clip from a script row. */
export function resolveStoryboardTimelineTarget(
  frame: StoryboardFrame,
  frames: readonly StoryboardFrame[],
  elements: readonly TimelineElement[],
  fps: number,
): TimelineElement | null {
  const normalize = (value: string) => value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  const position = frames.findIndex(item => item.index === frame.index);
  if (position < 0) return null;
  const sceneId = frame.extra.scene_id?.trim().replace(/^#/, "");
  const source = frame.src ? normalize(frame.src) : "";
  const candidates = source
    ? elements.filter(element => element.compositionSrc && normalize(element.compositionSrc) === source)
    : elements;
  if (sceneId) {
    const matches = candidates.filter(element => [element.id, element.domId, element.hfId, element.key].includes(sceneId));
    return matches.length === 1 ? matches[0] : null;
  }
  if (source) {
    const matchingFrames = frames.filter(item => item.src && normalize(item.src) === source);
    // Repeated uses of the same component must map to their own runtime host.
    if (candidates.length !== matchingFrames.length) return null;
    const reserved = new Set<TimelineElement>();
    for (const bound of matchingFrames) {
      const id = bound.extra.scene_id?.trim().replace(/^#/, "");
      if (!id) continue;
      const matches = candidates.filter(element => [element.id, element.domId, element.hfId, element.key].includes(id));
      if (matches.length !== 1 || reserved.has(matches[0])) return null;
      reserved.add(matches[0]);
    }
    const unbound = matchingFrames.filter(item => !item.extra.scene_id?.trim());
    const available = candidates.filter(element => !reserved.has(element));
    if (new Set(available.map(element => element.start)).size !== available.length) return null;
    const occurrence = unbound.findIndex(item => item.index === frame.index);
    return [...available].sort((a, b) => a.start - b.start)[occurrence] ?? null;
  }
  const previous = frames.slice(0, position);
  const duration = frame.durationSeconds;
  if (!duration || duration <= 0 || previous.some(item => !item.durationSeconds || item.durationSeconds <= 0)) return null;
  const start = previous.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0);
  const tolerance = 1 / (Number.isFinite(fps) && fps > 0 ? fps : 30);
  const matches = elements.filter(element =>
    element.timingSource !== "implicit" &&
    !isAudioTimelineElement(element) && element.expandedParentStart === undefined &&
    Math.abs(element.start - start) < tolerance &&
    Math.abs(element.duration - duration) < tolerance,
  );
  // Older scripts lack scene_id. Accept only a unique runtime scene with matching bounds.
  return matches.length === 1 ? matches[0] : null;
}

export function collectTimelineAncestorIds(
  elementId: string,
  parentMap: ReadonlyMap<string, string>,
): string[] {
  const ancestors: string[] = [];
  const visited = new Set([elementId]);
  let current = elementId;
  while (true) {
    const parent = parentMap.get(current);
    if (!parent || visited.has(parent)) break;
    ancestors.unshift(parent);
    visited.add(parent);
    current = parent;
  }
  return ancestors;
}

export function resolveTimelineTreeSelectionKey(input: {
  elementId?: string;
  hfId?: string;
  sourceFile?: string;
  selector?: string;
  selectorIndex?: number;
  elements: readonly TimelineElement[];
  manifest: readonly ClipManifestClip[];
  domClipChildren: readonly DomClipChild[];
}): string {
  const elementId = resolveTimelineTreeSelectionId(input);
  if (!elementId) return "";
  const sourceFile = input.sourceFile ?? "index.html";
  const domChild = input.domClipChildren.find((child) => child.id === elementId);
  const existing = input.elements.find(
    (element) =>
      (element.sourceFile ?? "index.html") === sourceFile &&
      (element.domId === elementId ||
        element.id === elementId ||
        (Boolean(input.hfId) && element.hfId === input.hfId)),
  );
  if (existing) {
    // Runtime media rows can enter the store before the DOM scan enriches
    // them with an authored selector. Expanded timeline children use that
    // enriched identity, so return the same key or the DOM -> timeline sync
    // immediately clears their visible selected state after a click.
    if (!existing.domId && !existing.selector && (domChild?.domId || domChild?.selector)) {
      return buildTimelineElementKey({
        id: existing.id,
        fallbackIndex: 0,
        domId: domChild.domId,
        selector: domChild.selector,
        selectorIndex: domChild.selectorIndex,
        sourceFile: domChild.sourceFile ?? existing.sourceFile ?? input.sourceFile,
        previewHostId: existing.previewHostId ?? domChild.hostId,
      });
    }
    return existing.key ?? existing.id;
  }

  const manifestClip = input.manifest.find((clip) => clip.id === elementId);
  return buildTimelineElementKey({
    id: elementId,
    fallbackIndex: 0,
    domId: domChild?.domId ?? manifestClip?.id ?? input.elementId,
    selector: domChild?.selector ?? manifestClip?.selector ?? input.selector,
    selectorIndex: domChild?.selectorIndex ?? manifestClip?.selectorIndex ?? input.selectorIndex,
    sourceFile: domChild?.sourceFile ?? manifestClip?.sourceFile ?? input.sourceFile,
    previewHostId: domChild?.hostId,
  });
}

export function resolveTimelineTreeSelectionId(input: {
  elementId?: string;
  hfId?: string;
  sourceFile?: string;
  selector?: string;
  selectorIndex?: number;
  elements: readonly TimelineElement[];
  manifest: readonly ClipManifestClip[];
  domClipChildren: readonly DomClipChild[];
}): string | null {
  if (input.elementId) return input.elementId;
  const sourceFile = input.sourceFile ?? "index.html";
  const domChild = input.domClipChildren.find(
    (child) =>
      (input.hfId && child.hfId === input.hfId) ||
      (input.selector &&
        child.selector === input.selector &&
        (child.selectorIndex ?? 0) === (input.selectorIndex ?? 0) &&
        (child.sourceFile ?? "index.html") === sourceFile),
  );
  if (domChild) return domChild.id;
  const element = input.elements.find(
    (candidate) =>
      (input.hfId && (candidate.hfId === input.hfId || candidate.id === input.hfId)) ||
      (input.selector &&
        candidate.selector === input.selector &&
        (candidate.selectorIndex ?? 0) === (input.selectorIndex ?? 0) &&
        (candidate.sourceFile ?? "index.html") === sourceFile),
  );
  return element?.domId ?? element?.id ?? null;
}
