import { useMemo } from "react";
import { usePlayerStore, type TimelineElement, type DomClipChild } from "../store/playerStore";
import type { ClipManifestClip } from "../lib/playbackTypes";
import { createTimelineElementFromManifestClip } from "../lib/timelineDOM";
import { buildTimelineElementKey } from "../lib/timelineElementHelpers";

function extractDomId(key: string): string {
  const hashIdx = key.lastIndexOf("#");
  return hashIdx >= 0 ? key.slice(hashIdx + 1) : key;
}

function resolveRawId(
  elementId: string | null,
  manifest: ClipManifestClip[],
  parentMap: Map<string, string>,
): string | null {
  if (!elementId) return null;
  const rawId = extractDomId(elementId);
  const knownIds = new Set([...parentMap.keys(), ...parentMap.values()]);
  if (knownIds.has(rawId)) return rawId;
  if (knownIds.has(elementId)) return elementId;
  const clip = manifest.find((c) => c.label === elementId || c.label === rawId);
  if (clip?.id && knownIds.has(clip.id)) return clip.id;
  return null;
}

interface TimelineExpansionRawIdInput {
  selectedElementId: string | null;
  isPlaying: boolean;
  currentTime: number;
  manifest: ClipManifestClip[];
  parentMap: Map<string, string>;
}

function clipContainsTime(clip: ClipManifestClip, time: number): boolean {
  return Number.isFinite(time) && time >= clip.start && time < clip.start + clip.duration;
}

function getActiveParentDepth(id: string, parentMap: Map<string, string>, activeIds: Set<string>) {
  let depth = 0;
  let parent = parentMap.get(id);
  const visited = new Set<string>();
  visited.add(id);
  while (parent) {
    if (visited.has(parent)) return depth;
    visited.add(parent);
    if (activeIds.has(parent)) depth += 1;
    parent = parentMap.get(parent);
  }
  return depth;
}

function findActiveExpandableCompositionId(
  currentTime: number,
  manifest: ClipManifestClip[],
  parentMap: Map<string, string>,
): string | null {
  const parentIds = new Set(parentMap.values());
  const activeIds = new Set<string>();
  for (const clip of manifest) {
    if (!clip.id || !parentIds.has(clip.id) || !clipContainsTime(clip, currentTime)) continue;
    activeIds.add(clip.id);
  }
  let bestId: string | null = null;
  let bestDepth = -1;
  for (const id of activeIds) {
    const depth = getActiveParentDepth(id, parentMap, activeIds);
    if (depth <= bestDepth) continue;
    bestId = id;
    bestDepth = depth;
  }
  return bestId;
}

export function resolveTimelineExpansionRawId({
  selectedElementId,
  isPlaying,
  currentTime,
  manifest,
  parentMap,
}: TimelineExpansionRawIdInput): string | null {
  const selectedRawId = resolveRawId(selectedElementId, manifest, parentMap);
  if (selectedRawId) return selectedRawId;
  if (isPlaying) return null;
  return findActiveExpandableCompositionId(currentTime, manifest, parentMap);
}

function filterToTopLevel(
  elements: TimelineElement[],
  parentMap: Map<string, string>,
): TimelineElement[] {
  if (parentMap.size === 0) return elements;
  return elements.filter((el) => !parentMap.has(el.domId ?? el.id));
}

function clampChildToParent(
  child: ClipManifestClip,
  parentStart: number,
  parentEnd: number,
): { start: number; duration: number } | null {
  const childEnd = child.start + child.duration;
  if (child.start >= parentEnd || childEnd <= parentStart) return null;
  const clampedStart = Math.max(child.start, parentStart);
  const clampedDuration = Math.min(childEnd, parentEnd) - clampedStart;
  return clampedDuration > 0 ? { start: clampedStart, duration: clampedDuration } : null;
}

interface DisplayBounds {
  start: number;
  end: number;
  track: number;
}

// `display` bounds come from the top-level scene clip (where the expanded row is
// drawn). `editBasis` comes from the child's immediate sub-comp host: its absolute
// start anchors local-time edits and its compositionSrc is the file edits write to.
// They differ only for sub-comp-inside-sub-comp nesting.
function buildChildElements(
  siblings: ClipManifestClip[],
  display: DisplayBounds,
  editBasis: { start: number; sourceFile: string | undefined },
  domClipChildren: readonly DomClipChild[] = [],
): TimelineElement[] {
  const result: TimelineElement[] = [];
  for (const child of siblings) {
    const clamped = clampChildToParent(child, display.start, display.end);
    if (!clamped) continue;
    const base = createTimelineElementFromManifestClip({
      clip: child,
      fallbackIndex: result.length,
    });
    const domChild = domClipChildren.find((candidate) => candidate.id === child.id);
    const domId = domChild?.domId ?? (domChild ? undefined : child.id ?? undefined);
    const selector = domChild?.selector ?? (domId ? `#${domId}` : child.selector ?? undefined);
    const selectorIndex = child.selectorIndex ?? domChild?.selectorIndex ?? base.selectorIndex;
    // `base.key` was built without a hostEl, so it fell back to the colon form
    // (`index.html:<id>:<idx>`) even though we set domId below. Recompute it from
    // the same inputs the store uses (`<sourceFile>#<domId>`) so an expanded
    // child shares one identity with its flat store element — otherwise selecting
    // it sets `selectedElementId` to the store's hash key while the rendered row
    // is keyed by the colon form, and `isSelected` never matches (no highlight).
    const key = buildTimelineElementKey({
      id: base.id,
      fallbackIndex: result.length,
      domId,
      selector,
      selectorIndex,
      sourceFile: child.sourceFile ?? domChild?.sourceFile ?? editBasis.sourceFile,
      previewHostId: domChild?.hostId,
    });
    result.push({
      ...base,
      key,
      start: clamped.start,
      duration: clamped.duration,
      // `track` becomes a synthetic display row under the expanded host, but the
      // factory-set `authoredTrack` (the child's data-track-index in ITS OWN
      // file's coordinate space) and the runtime-computed `stackingContextId`
      // must survive verbatim — lane persists and z-sync read them, they are
      // never reconstructed from display lanes.
      //
      // COLLISION-FREE synthetic rows: the old `display.track + index` scheme
      // could equal a REAL clip's integer lane (host on track 0 with two
      // children puts child #2 on track 1 — where an unrelated top-level clip
      // may live). Lane grouping merges purely by track number, so that
      // collision fused clips from DIFFERENT source files into one display
      // lane, and lane-scoped actions (gap close) then batch-persisted foreign
      // clips. Fractions strictly between the host's lane and the next integer
      // can never equal a normalized (integer) lane, while still rendering the
      // children as their own ordered rows directly under the host.
      track: display.track + (result.length + 1) / (siblings.length + 2),
      authoredTrack: base.authoredTrack,
      stackingContextId: base.stackingContextId,
      expandedParentStart: editBasis.start,
      domId,
      hfId: domChild?.hfId ?? child.hfId ?? base.hfId,
      selector: child.selector ?? selector,
      selectorIndex,
      sourceFile: child.sourceFile ?? editBasis.sourceFile,
      previewHostId: domChild?.hostId,
      timingSource: "authored",
    });
  }
  return result;
}

// Sub-comp DOM children (groups/pills) aren't manifest clips and have no timing
// of their own — they're "always on" within their sub-comp host, so synthesize
// clips spanning the host's full bounds. The host element supplies start/duration
// and the composition file edits write to.
function domSiblingClips(
  domClipChildren: DomClipChild[],
  siblingParentId: string,
  host: TimelineElement,
): ClipManifestClip[] {
  return domClipChildren
    .filter((c) => c.parentId === siblingParentId)
    .map(
      (c): ClipManifestClip => ({
        id: c.id,
        hfId: c.hfId,
        selector: c.selector,
        selectorIndex: c.selectorIndex,
        sourceFile: c.sourceFile,
        label: c.label,
        start: host.start,
        duration: host.duration,
        track: host.track,
        kind: "element",
        tagName: c.tagName ?? null,
        compositionId: null,
        parentCompositionId: host.id ?? null,
        compositionSrc: host.compositionSrc ?? null,
        assetUrl: null,
        stackingContextId: c.stackingContextId,
      }),
    );
}

function childClipsForParent(
  manifest: ClipManifestClip[],
  parentMap: Map<string, string>,
  domClipChildren: DomClipChild[],
  parentId: string,
  parentElement: TimelineElement,
  displayDelta: number,
): ClipManifestClip[] {
  const manifestChildren = manifest.filter(
    (clip) => clip.id != null && parentMap.get(clip.id) === parentId,
  );
  const adjustedManifestChildren =
    displayDelta === 0
      ? manifestChildren
      : manifestChildren.map((clip) => ({ ...clip, start: clip.start + displayDelta }));
  const manifestIds = new Set(
    adjustedManifestChildren.flatMap((clip) => (clip.id ? [clip.id] : [])),
  );
  const domChildren = domSiblingClips(domClipChildren, parentId, parentElement).filter(
    (clip) => !clip.id || !manifestIds.has(clip.id),
  );
  return [...adjustedManifestChildren, ...domChildren];
}

// Exported for tests.
export function buildExpandedElements(
  elements: TimelineElement[],
  manifest: ClipManifestClip[],
  parentMap: Map<string, string>,
  topLevelId: string,
  siblingParentId: string,
  domClipChildren: DomClipChild[] = [],
): TimelineElement[] {
  const topLevelElement = elements.find((el) => el.id === topLevelId || el.domId === topLevelId);
  if (!topLevelElement) return filterToTopLevel(elements, parentMap);

  // Merge timed manifest children with untimed DOM-only children. Treating
  // these as fallback sources made DOM siblings disappear whenever a parent
  // happened to contain at least one authored/timed child.
  const manifestTopLevel = manifest.find((clip) => clip.id === topLevelId);
  const displayDelta = manifestTopLevel ? topLevelElement.start - manifestTopLevel.start : 0;
  const siblings = childClipsForParent(
    manifest,
    parentMap,
    domClipChildren,
    siblingParentId,
    topLevelElement,
    displayDelta,
  );
  if (siblings.length === 0) return filterToTopLevel(elements, parentMap);

  // The sub-comp host the children actually live in: top-level host for 1-level
  // nesting, a nested host for deeper nesting. Its start/file anchor edits.
  const parentHost = manifest.find((c) => c.id === siblingParentId);
  const editBasis = {
    start: (parentHost?.start ?? topLevelElement.start) + displayDelta,
    sourceFile: parentHost?.compositionSrc ?? topLevelElement.compositionSrc ?? undefined,
  };

  const parentKey = topLevelElement.key ?? topLevelElement.id;
  const expanded = buildChildElements(
    siblings,
    {
      start: topLevelElement.start,
      end: topLevelElement.start + topLevelElement.duration,
      track: topLevelElement.track,
    },
    editBasis,
    domClipChildren,
  ).map((child) => ({ ...child, expandedDisplayHostKey: parentKey }));
  if (expanded.length === 0) return filterToTopLevel(elements, parentMap);

  return elements
    .filter((el) => (el.key ?? el.id) === parentKey || !parentMap.has(el.domId ?? el.id))
    .flatMap((el) => ((el.key ?? el.id) === parentKey ? [el, ...expanded] : [el]));
}

/** Build the visible hierarchy while preserving every expanded ancestor. */
export function buildExpandedElementTree(
  elements: TimelineElement[],
  manifest: ClipManifestClip[],
  parentMap: Map<string, string>,
  expandedRawIds: ReadonlySet<string>,
  domClipChildren: DomClipChild[] = [],
): TimelineElement[] {
  const topLevelElements = filterToTopLevel(elements, parentMap);

  return topLevelElements.flatMap((topLevelElement) => {
    const topLevelId = topLevelElement.domId ?? topLevelElement.id;
    const topLevelKey = topLevelElement.key ?? topLevelElement.id;
    const manifestTopLevel = manifest.find((clip) => clip.id === topLevelId);
    const displayDelta = manifestTopLevel ? topLevelElement.start - manifestTopLevel.start : 0;
    const flattened: Array<{ element: TimelineElement; ancestors: string[] }> = [
      { element: topLevelElement, ancestors: [] },
    ];
    const visited = new Set<string>();

    const appendChildren = (
      parentId: string,
      parentElement: TimelineElement,
      ancestors: string[],
    ) => {
      if (!expandedRawIds.has(parentId) || visited.has(parentId)) return;
      visited.add(parentId);

      const siblings = childClipsForParent(
        manifest,
        parentMap,
        domClipChildren,
        parentId,
        parentElement,
        displayDelta,
      );
      const parentHost = manifest.find((clip) => clip.id === parentId);
      const editBasis = {
        start: (parentHost?.start ?? parentElement.start) + displayDelta,
        sourceFile:
          parentHost?.compositionSrc ?? parentElement.compositionSrc ?? parentElement.sourceFile,
      };
      const nextAncestors = [...ancestors, parentId];
      const children = buildChildElements(
        siblings,
        {
          start: topLevelElement.start,
          end: topLevelElement.start + topLevelElement.duration,
          track: topLevelElement.track,
        },
        editBasis,
        domClipChildren,
      );

      for (const child of children) {
        const childId = child.domId ?? child.id;
        const nestedChild = {
          ...child,
          compositionAncestors: nextAncestors,
          expandedDisplayHostKey: topLevelKey,
        };
        flattened.push({ element: nestedChild, ancestors: nextAncestors });
        appendChildren(childId, nestedChild, nextAncestors);
      }
    };

    appendChildren(topLevelId, topLevelElement, []);
    const descendantCount = flattened.length - 1;
    return flattened.map(({ element }, index) =>
      index === 0
        ? element
        : {
            ...element,
            track: topLevelElement.track + index / (descendantCount + 1),
          },
    );
  });
}

export function applyTimelineLayerStateOverrides(
  elements: TimelineElement[],
  overrides: ReadonlyMap<string, Partial<Pick<TimelineElement, "hidden" | "timelineLocked">>>,
): TimelineElement[] {
  return elements.map((element) => {
    const override = overrides.get(element.key ?? element.id);
    return override ? { ...element, ...override } : element;
  });
}

export function useExpandedTimelineElements(): TimelineElement[] {
  const elements = usePlayerStore((s) => s.elements);
  const layerStateOverrides = usePlayerStore((s) => s.timelineLayerStateOverrides);
  const clipManifest = usePlayerStore((s) => s.clipManifest);
  const clipParentMap = usePlayerStore((s) => s.clipParentMap);
  const domClipChildren = usePlayerStore((s) => s.domClipChildren);
  const expandedTimelineElementIds = usePlayerStore((s) => s.expandedTimelineElementIds);

  // Store explicit expanded ids. Manual caret clicks toggle one id, while a
  // canvas selection may add its ancestor chain so the selected row is visible.
  const expandedRawIds = useMemo(() => {
    const rawIds = new Set<string>();
    if (clipParentMap.size === 0) return rawIds;
    const manifest = clipManifest ?? [];
    for (const elementId of expandedTimelineElementIds) {
      const rawId = resolveRawId(elementId, manifest, clipParentMap);
      if (rawId) rawIds.add(rawId);
    }
    return rawIds;
  }, [clipManifest, clipParentMap, expandedTimelineElementIds]);

  return useMemo(() => {
    const expandedElements =
      clipParentMap.size === 0
        ? elements
        : buildExpandedElementTree(
            elements,
            clipManifest ?? [],
            clipParentMap,
            expandedRawIds,
            domClipChildren,
          );
    return applyTimelineLayerStateOverrides(expandedElements, layerStateOverrides);
  }, [
    elements,
    clipManifest,
    clipParentMap,
    domClipChildren,
    expandedRawIds,
    layerStateOverrides,
  ]);
}
