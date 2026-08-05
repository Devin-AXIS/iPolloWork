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
  elementId: string;
  sourceFile?: string;
  selector?: string;
  selectorIndex?: number;
  elements: readonly TimelineElement[];
  manifest: readonly ClipManifestClip[];
  domClipChildren: readonly DomClipChild[];
}): string {
  const existing = input.elements.find(
    (element) => element.domId === input.elementId || element.id === input.elementId,
  );
  if (existing) return existing.key ?? existing.id;

  const domChild = input.domClipChildren.find((child) => child.id === input.elementId);
  const manifestClip = input.manifest.find((clip) => clip.id === input.elementId);
  return buildTimelineElementKey({
    id: input.elementId,
    fallbackIndex: 0,
    domId: input.elementId,
    selector: domChild?.selector ?? manifestClip?.selector ?? input.selector,
    selectorIndex: domChild?.selectorIndex ?? manifestClip?.selectorIndex ?? input.selectorIndex,
    sourceFile: domChild?.sourceFile ?? manifestClip?.sourceFile ?? input.sourceFile,
  });
}
