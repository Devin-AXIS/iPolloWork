/**
 * Higher-level timeline DOM operations: element factories, DOM-to-element
 * parsing, timeline merging, and standalone composition helpers.
 *
 * Preview iframe utilities (normaliseViewport, autoHeal, audio controls, resolveIframe,
 * buildMissingCompositionElements) live in timelineIframeHelpers.ts.
 *
 * Pure functions (no React, no store reads) — testable in isolation.
 */

import type { DomClipChild, TimelineElement } from "../store/playerStore";
import type { ClipManifestClip } from "./playbackTypes";
import { resolveCssStackingContextId } from "@hyperframes/core/runtime/stacking-context";
import { readClipTiming } from "@hyperframes/core/composition-contract";
import {
  resolveMediaElement,
  applyMediaMetadataFromElement,
  getTimelineElementDisplayLabel,
  getImplicitTimelineLayerLabel,
  isImplicitTimelineLayerCandidate,
  getTimelineElementSelector,
  getTimelineElementSourceFile,
  getTimelineElementSelectorIndex,
  buildTimelineElementKey,
  buildTimelineElementIdentity,
  getTimelineElementIdentity,
  isTimelineIgnoredElement,
  readTimelineClipLabel,
  readTimelineElementZIndex,
} from "./timelineElementHelpers";

// Re-export helpers that were previously public from this module so that
// existing import sites (hook + tests) don't need to change.
// fallow-ignore-next-line unused-exports
export {
  readTimelineDurationFromDocument,
  // fallow-ignore-next-line unused-exports
  resolveMediaElement,
  // fallow-ignore-next-line unused-exports
  applyMediaMetadataFromElement,
  getImplicitTimelineLayerLabel,
  isImplicitTimelineLayerCandidate,
  getTimelineElementSelector,
  // fallow-ignore-next-line unused-exports
  getTimelineElementSourceFile,
  // fallow-ignore-next-line unused-exports
  getTimelineElementSelectorIndex,
  // fallow-ignore-next-line unused-exports
  buildTimelineElementIdentity,
  // fallow-ignore-next-line unused-exports
  getTimelineElementIdentity,
  findTimelineDomNodeForClip,
} from "./timelineElementHelpers";

// Re-export iframe helpers so the hook can keep a single import source.
export {
  normalizePreviewViewport,
  autoHealMissingCompositionIds,
  setPreviewMediaMuted,
  setPreviewPlaybackRate,
  shouldMutePreviewAudio,
  resolveIframe,
  buildMissingCompositionElements,
} from "./timelineIframeHelpers";

// ---------------------------------------------------------------------------
// TimelineElement factories
// ---------------------------------------------------------------------------

function resolveClipTag(clip: ClipManifestClip): string {
  return clip.tagName || clip.kind || "div";
}

const TIMELINE_KINDS = new Set([
  "text",
  "logo",
  "image",
  "video",
  "effect",
  "music",
  "voiceover",
  "audio",
  "composition",
  "element",
]);

function isTimelineKind(
  value: string | null,
): value is NonNullable<TimelineElement["timelineKind"]> {
  return value !== null && TIMELINE_KINDS.has(value);
}

// fallow-ignore-next-line complexity
export function createTimelineElementFromManifestClip(params: {
  clip: ClipManifestClip;
  fallbackIndex: number;
  doc?: Document | null;
  hostEl?: Element | null;
}): TimelineElement {
  const { clip, fallbackIndex, doc } = params;
  let hostEl = params.hostEl ?? null;
  const manifestClipLabel = clip.timelineClipLabel?.trim();
  const clipLabel = readTimelineClipLabel(hostEl) ?? (manifestClipLabel || undefined);
  const label = getTimelineElementDisplayLabel({
    id: clip.id,
    label: clip.label,
    tag: resolveClipTag(clip),
  });

  let domId: string | undefined;
  let selector: string | undefined;
  let selectorIndex: number | undefined;
  let sourceFile: string | undefined;

  let hfId: string | undefined;
  if (hostEl) {
    domId = hostEl.id || undefined;
    hfId = hostEl.getAttribute("data-hf-id") || undefined;
    selector = getTimelineElementSelector(hostEl);
    selectorIndex =
      doc && selector ? getTimelineElementSelectorIndex(doc, hostEl, selector) : undefined;
    sourceFile = getTimelineElementSourceFile(hostEl);
  }

  const identity = buildTimelineElementIdentity({
    preferredId: clip.id,
    label,
    fallbackIndex,
    domId,
    selector,
    selectorIndex,
    sourceFile,
  });
  const entry: TimelineElement = {
    id: identity.id,
    label,
    clipLabel,
    key: identity.key,
    tag: resolveClipTag(clip),
    start: clip.start,
    duration: clip.duration,
    track: clip.track,
    // clip.track IS the authored data-track-index verbatim (the runtime honors
    // it; see parseAuthoredTrack in core/runtime/timeline.ts). Record it at this
    // translation boundary so later display-lane remaps (normalizeToZones,
    // expanded-child rows) can persist in AUTHORED space instead of
    // reconstructing it from lane occupants.
    authoredTrack: clip.track,
    // Runtime-computed stacking context — authoritative; helpers read it, never
    // re-derive it.
    stackingContextId: clip.stackingContextId ?? null,
    parentCompositionId: clip.parentCompositionId,
    compositionAncestors: clip.compositionAncestors,
    domId,
    hfId,
    selector,
    selectorIndex,
    sourceFile,
  };

  if (clip.timelineRole) entry.timelineRole = clip.timelineRole;
  const manifestGroupId = clip.timelineGroup?.trim();
  if (manifestGroupId) entry.timelineGroupId = manifestGroupId;

  if (hostEl) {
    applyMediaMetadataFromElement(entry, hostEl);
    if (hostEl.hasAttribute("data-hidden")) entry.hidden = true;
    const timelineRole = hostEl.getAttribute("data-timeline-role");
    if (timelineRole) entry.timelineRole = timelineRole;
    const timelineKind = hostEl.getAttribute("data-timeline-kind");
    if (isTimelineKind(timelineKind)) entry.timelineKind = timelineKind;
    const timelineGroupId = hostEl.getAttribute("data-timeline-group");
    if (timelineGroupId) entry.timelineGroupId = timelineGroupId;
    entry.zIndex = readTimelineElementZIndex(hostEl);
  }
  if (clip.assetUrl) entry.src = clip.assetUrl;
  if (clip.kind === "composition" && clip.compositionId) {
    let resolvedSrc = clip.compositionSrc;
    if (!resolvedSrc) {
      hostEl =
        doc?.querySelector(`[data-composition-id="${CSS.escape(clip.compositionId)}"]`) ?? hostEl;
      resolvedSrc =
        hostEl?.getAttribute("data-composition-src") ??
        hostEl?.getAttribute("data-composition-file") ??
        null;
    }
    if (resolvedSrc) {
      entry.compositionSrc = resolvedSrc;
    } else if (hostEl) {
      const innerVideo = hostEl.querySelector("video[src]");
      if (innerVideo) {
        entry.src = innerVideo.getAttribute("src") || undefined;
        entry.tag = "video";
      }
    }
    if (hostEl) {
      entry.domId = hostEl.id || undefined;
      entry.hfId = hostEl.getAttribute("data-hf-id") || undefined;
      entry.selector = getTimelineElementSelector(hostEl);
      entry.selectorIndex =
        doc && entry.selector
          ? getTimelineElementSelectorIndex(doc, hostEl, entry.selector)
          : undefined;
      entry.sourceFile = getTimelineElementSourceFile(hostEl);
      const nextIdentity = buildTimelineElementIdentity({
        preferredId: clip.id,
        label,
        fallbackIndex,
        domId: entry.domId,
        selector: entry.selector,
        selectorIndex: entry.selectorIndex,
        sourceFile: entry.sourceFile,
      });
      entry.id = nextIdentity.id;
      entry.key = nextIdentity.key;
    }
  }

  return entry;
}

export function createImplicitTimelineLayersFromDOM(
  doc: Document,
  rootDuration: number,
  existingElements: readonly TimelineElement[] = [],
): TimelineElement[] {
  if (!Number.isFinite(rootDuration) || rootDuration <= 0) return [];
  const rootComp = doc.querySelector("[data-composition-id]");
  if (!rootComp) return [];

  const existingKeys = new Set(existingElements.map(getTimelineElementIdentity));
  const maxTrack = existingElements.reduce(
    (max, element) => Math.max(max, Number.isFinite(element.track) ? element.track : 0),
    -1,
  );
  const layers: TimelineElement[] = [];

  for (const child of Array.from(rootComp.children)) {
    if (!isImplicitTimelineLayerCandidate(rootComp, child)) continue;

    const selector = getTimelineElementSelector(child);
    if (!selector) continue;
    const selectorIndex = getTimelineElementSelectorIndex(doc, child, selector);
    const sourceFile = getTimelineElementSourceFile(child);
    const label = getImplicitTimelineLayerLabel(child);
    const identity = buildTimelineElementIdentity({
      preferredId: child.id || null,
      label,
      fallbackIndex: existingElements.length + layers.length,
      domId: child.id || undefined,
      selector,
      selectorIndex,
      sourceFile,
    });
    if (existingKeys.has(identity.key) || existingKeys.has(identity.id)) continue;

    const layer: TimelineElement = {
      domId: child.id || undefined,
      hfId: child.getAttribute("data-hf-id") || undefined,
      zIndex: readTimelineElementZIndex(child),
      duration: rootDuration,
      id: identity.id,
      key: identity.key,
      label,
      clipLabel: readTimelineClipLabel(child),
      selector,
      selectorIndex,
      sourceFile,
      stackingContextId: resolveCssStackingContextId(child),
      start: 0,
      tag: child.tagName.toLowerCase(),
      timingSource: "implicit",
      track: maxTrack + 1 + layers.length,
    };
    const timelineKind = child.getAttribute("data-timeline-kind");
    if (isTimelineKind(timelineKind)) layer.timelineKind = timelineKind;
    const timelineRole = child.getAttribute("data-timeline-role");
    if (timelineRole) layer.timelineRole = timelineRole;
    const timelineGroupId = child.getAttribute("data-timeline-group");
    if (timelineGroupId) layer.timelineGroupId = timelineGroupId;
    layers.push(layer);
  }

  return layers;
}

/** Collect addressable untimed descendants without coupling them to runtime tree parsing. */
export function collectDomClipChildren(
  doc: Document,
  clips: readonly ClipManifestClip[],
  resolvedClipHosts: ReadonlyMap<ClipManifestClip, Element>,
): { children: DomClipChild[]; parentMap: Map<string, string> } {
  const children: DomClipChild[] = [];
  const parentMap = new Map<string, string>();
  const collectedTreeIds = new Set<string>();
  const resolvedHostElements = new Set(resolvedClipHosts.values());

  const collect = (parentEl: Element, parentId: string, hostId: string) => {
    for (const child of Array.from(parentEl.children)) {
      // A resolved timed host owns its own descendant tree. Crossing this
      // boundary would attach those descendants to an earlier outer clip; the
      // global identity de-duplication would then keep the wrong timing forever.
      if (resolvedHostElements.has(child)) continue;
      let childParentId = parentId;
      try {
        const selector = getTimelineElementSelector(child);
        if (selector) {
          const htmlChild = child as HTMLElement;
          const sourceFile = getTimelineElementSourceFile(child);
          const selectorIndex = getTimelineElementSelectorIndex(doc, child, selector);
          const domId = htmlChild.id || undefined;
          const hfId = child.getAttribute("data-hf-id") || undefined;
          const treeId =
            domId ?? hfId ?? `${sourceFile ?? "index.html"}:${selector}:${selectorIndex ?? 0}`;
          childParentId = treeId;
          if (!collectedTreeIds.has(treeId)) {
            collectedTreeIds.add(treeId);
            const isGroup = child.hasAttribute("data-hf-group");
            children.push({
              id: treeId,
              domId,
              hfId,
              selector,
              selectorIndex,
              sourceFile,
              parentId,
              hostId,
              label:
                (isGroup ? child.getAttribute("data-hf-group") : null) ||
                getImplicitTimelineLayerLabel(htmlChild),
              clipLabel: readTimelineClipLabel(child),
              tagName: child.tagName.toLowerCase(),
              stackingContextId: resolveCssStackingContextId(child),
            });
            parentMap.set(treeId, parentId);
          }
        }
      } catch {
        // Keep traversing: one unsupported node must not erase its sibling tree.
      }
      collect(child, childParentId, hostId);
    }
  };

  for (const clip of clips) {
    if (!clip.id) continue;
    const hostEl = resolvedClipHosts.get(clip);
    if (!hostEl) continue;
    const innerRoot =
      clip.kind === "composition" ? (hostEl.querySelector("[data-hf-inner-root]") ?? hostEl) : hostEl;
    collect(innerRoot, clip.id, clip.id);
  }

  const compositionRoot = doc.querySelector("[data-composition-id]");
  if (compositionRoot) {
    for (const child of Array.from(compositionRoot.children)) {
      if (!isImplicitTimelineLayerCandidate(compositionRoot, child)) continue;
      const selector = getTimelineElementSelector(child);
      if (!selector) continue;
      const selectorIndex = getTimelineElementSelectorIndex(doc, child, selector);
      const sourceFile = getTimelineElementSourceFile(child);
      const identity = buildTimelineElementIdentity({
        preferredId: child.id || null,
        label: getImplicitTimelineLayerLabel(child),
        fallbackIndex: 0,
        domId: child.id || undefined,
        selector,
        selectorIndex,
        sourceFile,
      });
      collect(child, identity.id, identity.id);
    }
  }

  return { children, parentMap };
}

/**
 * Parse [data-start] elements from a Document into TimelineElement[].
 * Shared helper — used by onIframeLoad fallback, handleMessage, and enrichMissingCompositions.
 */
export function parseTimelineFromDOM(doc: Document, rootDuration: number): TimelineElement[] {
  const rootComp = doc.querySelector("[data-composition-id]");
  const nodes = doc.querySelectorAll("[data-start]");
  const els: TimelineElement[] = [];
  let trackCounter = 0;

  // fallow-ignore-next-line complexity
  nodes.forEach((node) => {
    if (node === rootComp) return;
    if (isTimelineIgnoredElement(node)) return;
    const el = node as HTMLElement;
    const timing = readClipTiming(el);
    const start = timing.start;
    if (start == null) return;
    if (Number.isFinite(rootDuration) && rootDuration > 0 && start >= rootDuration) return;

    const tagLower = el.tagName.toLowerCase();
    let dur = timing.duration ?? 0;
    if (dur <= 0) dur = Math.max(0, rootDuration - start);
    if (Number.isFinite(rootDuration) && rootDuration > 0) {
      dur = Math.min(dur, Math.max(0, rootDuration - start));
    }
    if (!Number.isFinite(dur) || dur <= 0) return;

    const track = timing.trackSource === "default" ? trackCounter++ : timing.trackIndex;
    // fallow-ignore-next-line code-duplication
    const compId = el.getAttribute("data-composition-id");
    const selector = getTimelineElementSelector(el);
    const sourceFile = getTimelineElementSourceFile(el);
    const selectorIndex = getTimelineElementSelectorIndex(doc, el, selector);
    const label = getTimelineElementDisplayLabel({
      id: el.id || compId || null,
      label: el.getAttribute("data-timeline-label") ?? el.getAttribute("data-label"),
      tag: tagLower,
    });
    const identity = buildTimelineElementIdentity({
      preferredId: el.id || compId || null,
      label,
      fallbackIndex: els.length,
      domId: el.id || undefined,
      selector,
      selectorIndex,
      sourceFile,
    });
    const entry: TimelineElement = {
      id: identity.id,
      label,
      clipLabel: readTimelineClipLabel(el),
      key: identity.key,
      tag: tagLower,
      start,
      duration: dur,
      track,
      domId: el.id || undefined,
      hfId: el.getAttribute("data-hf-id") || undefined,
      selector,
      selectorIndex,
      sourceFile,
      stackingContextId: resolveCssStackingContextId(el),
      timingSource: el.hasAttribute("data-hf-autostamped") ? "implicit" : "authored",
      zIndex: readTimelineElementZIndex(el),
    };

    const mediaEl = resolveMediaElement(el);
    if (mediaEl) {
      if (mediaEl.tagName === "IMG") {
        entry.tag = "img";
      }
      const vol = el.getAttribute("data-volume") ?? mediaEl.getAttribute("data-volume");
      if (vol) entry.volume = parseFloat(vol);
      applyMediaMetadataFromElement(entry, el);
      // Override AFTER the helper (which sets the raw relative attribute) so the
      // resolved absolute URL wins — the Studio can then fetch the asset
      // regardless of whether the attribute value was relative or absolute.
      const resolvedSrc = (mediaEl as HTMLMediaElement | HTMLImageElement).src || undefined;
      if (resolvedSrc) entry.src = resolvedSrc;
    }

    if (el.hasAttribute("data-timeline-locked")) {
      entry.timelineLocked = true;
    }
    if (el.hasAttribute("data-hidden")) {
      entry.hidden = true;
    }

    const timelineRole = el.getAttribute("data-timeline-role");
    if (timelineRole) entry.timelineRole = timelineRole;
    const timelineKind = el.getAttribute("data-timeline-kind");
    if (isTimelineKind(timelineKind)) entry.timelineKind = timelineKind;
    const timelineGroupId = el.getAttribute("data-timeline-group");
    if (timelineGroupId) entry.timelineGroupId = timelineGroupId;

    // Sub-compositions
    const compSrc =
      el.getAttribute("data-composition-src") || el.getAttribute("data-composition-file");
    if (compSrc) {
      entry.compositionSrc = compSrc;
    } else if (compId && compId !== rootComp?.getAttribute("data-composition-id")) {
      // Inline composition — expose inner video for thumbnails
      const innerVideo = el.querySelector("video[src]");
      if (innerVideo) {
        entry.src = innerVideo.getAttribute("src") || undefined;
        entry.tag = "video";
      }
    }

    els.push(entry);
  });

  return [...els, ...createImplicitTimelineLayersFromDOM(doc, rootDuration, els)];
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

export function mergeTimelineElementsPreservingDowngrades(
  currentElements: TimelineElement[],
  nextElements: TimelineElement[],
  currentDuration: number,
  nextDuration: number,
): TimelineElement[] {
  const safeCurrentDuration = Number.isFinite(currentDuration) ? currentDuration : 0;
  const safeNextDuration = Number.isFinite(nextDuration) ? nextDuration : 0;

  if (
    currentElements.length === 0 ||
    nextElements.length >= currentElements.length ||
    safeNextDuration > safeCurrentDuration
  ) {
    return nextElements;
  }

  const nextIdentities = new Set(nextElements.map(getTimelineElementIdentity));
  const preserved = currentElements.filter(
    (element) =>
      !nextIdentities.has(getTimelineElementIdentity(element)) &&
      // Only preserve enriched sub-composition children (compositionSrc set),
      // which a bare DOM re-scan legitimately drops and enrichMissingCompositions
      // re-adds. A TOP-LEVEL element missing from the fresh scan was genuinely
      // removed (undo of a split, a delete), so let it go — otherwise undoing a
      // split leaves a ghost clip in the timeline even though the file is reverted.
      element.compositionSrc != null,
  );
  if (preserved.length === 0) return nextElements;
  return [...nextElements, ...preserved];
}

// ---------------------------------------------------------------------------
// Standalone composition helpers
// ---------------------------------------------------------------------------

export function resolveStandaloneRootCompositionSrc(iframeSrc: string): string | undefined {
  const compPathMatch = iframeSrc.match(/\/preview\/comp\/(.+?)(?:\?|$)/);
  return compPathMatch ? decodeURIComponent(compPathMatch[1]) : undefined;
}

export function buildStandaloneRootTimelineElement(params: {
  compositionId: string;
  tagName: string;
  rootDuration: number;
  iframeSrc: string;
  selector?: string;
  selectorIndex?: number;
}): TimelineElement | null {
  if (!Number.isFinite(params.rootDuration) || params.rootDuration <= 0) return null;

  const compositionSrc = resolveStandaloneRootCompositionSrc(params.iframeSrc);

  return {
    id: params.compositionId,
    label: getTimelineElementDisplayLabel({
      id: params.compositionId,
      tag: params.tagName,
    }),
    key: buildTimelineElementKey({
      id: params.compositionId,
      fallbackIndex: 0,
      selector: params.selector,
      selectorIndex: params.selectorIndex,
      sourceFile: compositionSrc,
    }),
    tag: params.tagName.toLowerCase() || "div",
    start: 0,
    duration: params.rootDuration,
    track: 0,
    compositionSrc,
    selector: params.selector,
    selectorIndex: params.selectorIndex,
    sourceFile: compositionSrc,
  };
}
