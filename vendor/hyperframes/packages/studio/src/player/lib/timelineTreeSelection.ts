import type { ClipManifestClip } from "./playbackTypes";
import type { DomClipChild, TimelineElement } from "../store/playerStore";
import { buildTimelineElementKey } from "./timelineElementHelpers";

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
