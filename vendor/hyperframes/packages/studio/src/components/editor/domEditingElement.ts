/**
 * Element visibility, visual scoring, layer patch targets, element finders,
 * and the `findElementForSelection` / `findElementForTimelineElement` lookups.
 */
import type {
  DomEditContextOptions,
  DomEditSelection,
  DomEditViewport,
  TimelineElementDomTarget,
  TimelineElementDomTargetOptions,
} from "./domEditingTypes";
import {
  buildStableSelector,
  escapeCssString,
  getSelectorIndex,
  getSourceFileForElement,
  isHtmlElement,
  isElementVisibleThroughAncestors,
  normalizeTimelineCompositionSource,
  querySelectorAllSafely,
} from "./domEditingDom";

// ─── Visibility ──────────────────────────────────────────────────────────────

export function isElementComputedVisible(el: HTMLElement): boolean {
  return isElementVisibleThroughAncestors(el);
}

const VISUAL_LEAF_TAGS = new Set(["img", "video", "canvas", "svg", "audio"]);

// fallow-ignore-next-line complexity
function hasVisualPresence(el: HTMLElement): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  const cs = win.getComputedStyle(el);
  if (cs.backgroundImage !== "none") return true;
  if (
    cs.backgroundColor &&
    cs.backgroundColor !== "transparent" &&
    cs.backgroundColor !== "rgba(0, 0, 0, 0)"
  )
    return true;
  if (cs.borderWidth && parseFloat(cs.borderWidth) > 0 && cs.borderStyle !== "none") return true;
  if (cs.boxShadow && cs.boxShadow !== "none") return true;
  return false;
}

function isEmptyVisualContainer(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (VISUAL_LEAF_TAGS.has(tag)) return false;
  if (hasVisualPresence(el)) return false;

  const { children } = el;
  if (children.length === 0) {
    return (el.textContent ?? "").trim().length === 0;
  }

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (!isHtmlElement(child)) continue;
    if (VISUAL_LEAF_TAGS.has(child.tagName.toLowerCase())) return false;
    if (isElementComputedVisible(child)) return false;
  }

  return true;
}

function hasRenderedBox(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return false;
  if (!isElementComputedVisible(el)) return false;
  if (isEmptyVisualContainer(el)) return false;
  return true;
}

// ─── Visual scoring ──────────────────────────────────────────────────────────

// ─── Layer patch target ──────────────────────────────────────────────────────

const DOM_LAYER_IGNORED_TAGS = new Set([
  "base",
  "br",
  "canvas",
  "link",
  "meta",
  "script",
  "source",
  "style",
  "template",
  "track",
  "wbr",
]);

function isInspectableLayerElement(el: HTMLElement): boolean {
  const tagName = el.tagName.toLowerCase();
  if (DOM_LAYER_IGNORED_TAGS.has(tagName)) return false;

  const computed = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (computed?.display === "none" || computed?.visibility === "hidden") return false;

  return true;
}

export function getDomLayerPatchTarget(
  el: HTMLElement,
  activeCompositionPath: string | null,
): Pick<DomEditSelection, "id" | "hfId" | "selector" | "selectorIndex" | "sourceFile"> | null {
  if (!isInspectableLayerElement(el)) return null;
  if (el.hasAttribute("data-composition-id")) return null;

  const selector = buildStableSelector(el);
  if (!selector) return null;

  const { sourceFile } = getSourceFileForElement(el, activeCompositionPath);
  return {
    id: el.id || undefined,
    hfId: el.getAttribute("data-hf-id") || undefined,
    selector,
    selectorIndex: getSelectorIndex(
      el.ownerDocument,
      el,
      selector,
      sourceFile,
      activeCompositionPath,
    ),
    sourceFile,
  };
}

// ─── Clip ancestor / selection candidate ─────────────────────────────────────

function getPreferredClipAncestor(startEl: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = startEl;
  while (current) {
    if (current.classList.contains("clip")) {
      const isCompositionHost =
        current.hasAttribute("data-composition-src") ||
        current.hasAttribute("data-composition-file");
      if (!isCompositionHost || current === startEl) return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function getSelectionCandidate(
  startEl: HTMLElement,
  options: DomEditContextOptions,
): HTMLElement {
  const structuredTextRoot = startEl.closest<HTMLElement>('[data-ipw-motion-structure="v1"]');
  if (structuredTextRoot) return structuredTextRoot;

  if (options.preferClipAncestor) {
    const clipAncestor = getPreferredClipAncestor(startEl);
    if (clipAncestor) {
      return clipAncestor;
    }
  }

  return startEl;
}

// ─── Visual target resolution ─────────────────────────────────────────────────

export function resolveVisualDomEditSelectionTarget(
  elementsFromPoint: Iterable<Element | null | undefined>,
  options: Pick<DomEditContextOptions, "activeCompositionPath">,
): HTMLElement | null {
  const candidates = resolveAllVisualDomEditTargets(elementsFromPoint, options);
  return candidates[0] ?? null;
}

/**
 * Returns all independently-selectable elements at the given point, in paint
 * order (topmost first). Used for click-cycling through stacked layers.
 *
 * Each entry in the returned array is an independent "layer" — an element
 * that is not an ancestor of an earlier entry. This gives one result per
 * z-stacked element rather than one per DOM node.
 */
export function resolveAllVisualDomEditTargets(
  elementsFromPoint: Iterable<Element | null | undefined>,
  options: Pick<DomEditContextOptions, "activeCompositionPath">,
): HTMLElement[] {
  const raw: HTMLElement[] = [];

  for (const entry of elementsFromPoint) {
    if (!isHtmlElement(entry)) continue;
    if (hasRenderedBox(entry) && getDomLayerPatchTarget(entry, options.activeCompositionPath)) {
      raw.push(entry);
    }
  }

  if (raw.length === 0) return [];

  // Browsers commonly return a child before its ancestors. Remove every
  // candidate that contains another hit, independent of ordering, so the
  // deepest authored child always wins. This list is bounded by DOM depth.
  return raw.filter(
    (candidate) => !raw.some((other) => other !== candidate && candidate.contains(other)),
  );
}

// ─── Raster detection ────────────────────────────────────────────────────────

function hasRasterBackground(selection: Pick<DomEditSelection, "computedStyles">): boolean {
  const backgroundImage = selection.computedStyles["background-image"]?.trim();
  return Boolean(backgroundImage && backgroundImage !== "none");
}

export function isLargeRasterDomEditSelection(
  selection: Pick<DomEditSelection, "boundingBox" | "computedStyles" | "tagName">,
  viewport?: DomEditViewport | null,
): boolean {
  const tagName = selection.tagName.toLowerCase();
  const isRasterLike = tagName === "img" || hasRasterBackground(selection);
  if (!isRasterLike) return false;

  const { width, height } = selection.boundingBox;
  if (width <= 1 || height <= 1) return false;
  if (!viewport || viewport.width <= 1 || viewport.height <= 1) {
    return width >= 960 && height >= 540;
  }

  const areaRatio = (width * height) / (viewport.width * viewport.height);
  const widthRatio = width / viewport.width;
  const heightRatio = height / viewport.height;
  return areaRatio >= 0.4 || (widthRatio >= 0.7 && heightRatio >= 0.5);
}

// ─── Element finders ──────────────────────────────────────────────────────────

type FindElementSelection = Pick<DomEditSelection, "id" | "hfId" | "selector" | "selectorIndex"> & {
  sourceFile?: string;
};

export function findElementForSelection(
  doc: Document,
  selection: FindElementSelection,
  activeCompositionPath: string | null = null,
  queryRoot: ParentNode = doc,
): HTMLElement | null {
  const sourceMatches = (candidate: Element): candidate is HTMLElement =>
    isHtmlElement(candidate) &&
    (!selection.sourceFile ||
      getSourceFileForElement(candidate, activeCompositionPath).sourceFile ===
        selection.sourceFile);
  const findAll = (selector: string): HTMLElement[] =>
    querySelectorAllSafely(queryRoot, selector).filter(sourceMatches);

  if (selection.hfId) {
    const byHfId = findAll(`[data-hf-id="${escapeCssString(selection.hfId)}"]`)[0];
    // A minted hf id is the element identity, not merely one locator option.
    // Falling through after deletion can rebind a stale selection to another
    // same-tag element through its generic selector.
    return byHfId ?? null;
  }

  if (selection.id) {
    // Flattened sub-compositions can repeat authored ids. getElementById returns
    // only the first document match, so filter every id match by source first.
    const byId = findAll(`[id="${escapeCssString(selection.id)}"]`)[0];
    if (byId) return byId;
  }

  if (!selection.selector) return null;
  const selectorMatches = findAll(selection.selector);
  if (selectorMatches.length === 0) return null;
  const selectorIndex = selection.selectorIndex ?? 0;
  if (queryRoot === doc) return selectorMatches[selectorIndex] ?? null;
  // Flattened repeated compositions number selectors globally. A host-scoped
  // lookup folds that index back into the authored selector set for this copy.
  return selectorMatches[selectorIndex % selectorMatches.length] ?? null;
}

function timelineNumberMatches(element: Element, attribute: string, expected: number): boolean {
  const actual = Number.parseFloat(element.getAttribute(attribute) ?? "");
  return Number.isFinite(actual) && Math.abs(actual - expected) < 0.001;
}

function findElementForTimelineTiming(
  root: ParentNode,
  element: TimelineElementDomTarget,
  sourceFile: string,
  activeCompositionPath: string | null,
): HTMLElement | null {
  if (element.start == null || element.duration == null || element.track == null) return null;
  const expectedTag = element.tag?.toLowerCase();
  return (
    querySelectorAllSafely(root, "[data-start]")
      .filter(isHtmlElement)
      .find(
        (candidate) =>
          (!expectedTag || candidate.tagName.toLowerCase() === expectedTag) &&
          timelineNumberMatches(candidate, "data-start", element.start ?? 0) &&
          timelineNumberMatches(candidate, "data-duration", element.duration ?? 0) &&
          timelineNumberMatches(candidate, "data-track-index", element.track ?? 0) &&
          getSourceFileForElement(candidate, activeCompositionPath).sourceFile === sourceFile,
      ) ?? null
  );
}

// fallow-ignore-next-line complexity
export function findElementForTimelineElement(
  doc: Document,
  element: TimelineElementDomTarget,
  options: TimelineElementDomTargetOptions,
): HTMLElement | null {
  const elementId = typeof element.id === "string" ? element.id : "";
  const compositionSource =
    normalizeTimelineCompositionSource(element.compositionSrc) ??
    options.compIdToSrc?.get(elementId);
  const sourceFile =
    compositionSource ??
    normalizeTimelineCompositionSource(element.sourceFile) ??
    options.activeCompositionPath ??
    "index.html";
  const escapedElementId = escapeCssString(elementId);
  const escapedCompositionSource = compositionSource ? escapeCssString(compositionSource) : null;
  // Runtime-generated manifest entries use their data-hf-id value as `id`
  // even when the translated timeline element has no explicit `hfId` field.
  // Treat that id as the stable DOM handle only when no authored DOM target
  // was preserved, so exact image/media rows remain inspectable.
  const runtimeHfId =
    element.hfId ?? (!element.domId && !element.selector ? elementId || undefined : undefined);
  const selector =
    element.selector ??
    (compositionSource
      ? `[data-composition-src="${escapedCompositionSource}"],[data-composition-file="${escapedCompositionSource}"],[data-composition-id="${escapedElementId}"]`
      : escapedElementId
        ? `[data-composition-id="${escapedElementId}"]`
        : undefined);
  const previewHost = element.previewHostId
    ? querySelectorAllSafely(
        doc,
        `[data-composition-id="${escapeCssString(element.previewHostId)}"],[data-hf-id="${escapeCssString(element.previewHostId)}"],[id="${escapeCssString(element.previewHostId)}"]`,
      ).find(isHtmlElement)
    : undefined;
  const queryRoot = previewHost?.querySelector("[data-hf-inner-root]") ?? previewHost ?? doc;

  if (selector || element.domId) {
    const targetElement = findElementForSelection(
      doc,
      {
        id: element.domId ?? undefined,
        hfId: runtimeHfId,
        selector,
        selectorIndex: element.selectorIndex,
        sourceFile,
      },
      options.activeCompositionPath,
      queryRoot,
    );
    if (targetElement) return targetElement;
  }

  const timingElement = findElementForTimelineTiming(
    queryRoot,
    element,
    sourceFile,
    options.activeCompositionPath,
  );
  if (timingElement) return timingElement;

  const hasExplicitDomTarget = Boolean(element.domId || element.selector || compositionSource);
  if (options.isMasterView || hasExplicitDomTarget || !options.activeCompositionPath) {
    return null;
  }

  const root = doc.querySelector("[data-composition-id]");
  if (!isHtmlElement(root)) return null;
  return getSourceFileForElement(root, options.activeCompositionPath).sourceFile === sourceFile
    ? root
    : null;
}

// ─── Layer children ───────────────────────────────────────────────────────────

export function getDirectLayerChildren(
  el: HTMLElement,
  options: DomEditContextOptions,
): HTMLElement[] {
  return Array.from(el.children).filter(
    (child): child is HTMLElement =>
      isHtmlElement(child) && getDomLayerPatchTarget(child, options.activeCompositionPath) !== null,
  );
}
