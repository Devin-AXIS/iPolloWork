/**
 * RAF-driven hook that tracks overlay, hover, and group rects from the iframe DOM.
 * Runs a requestAnimationFrame loop and writes React state only when rects change.
 */
import { useRef, useState, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { usePlayerStore } from "../../player";
import { hugRectForElement } from "./domEditOverlayCrop";
import { type DomEditSelection, findElementForSelection } from "./domEditing";
import {
  type GroupOverlayItem,
  type OverlayRect,
  type ResolvedElementRef,
  groupOverlayItemsEqual,
  isElementLaidOutForSelectionOverlay,
  isElementVisibleForOverlay,
  groupAwareOverlayRect,
  orientedGroupAwareOverlayRect,
  rectsEqual,
  resolveElementForOverlay,
  selectionCacheKey,
  toVisibleOverlayRect,
} from "./domEditOverlayGeometry";

const PAUSED_OVERLAY_FALLBACK_MS = 250;
const CHILD_RECT_INTERVAL_MS = 180;

function childRectsEqual(a: OverlayRect[], b: OverlayRect[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!rectsEqual(a[i]!, b[i]!)) return false;
  }
  return true;
}

export function shouldMeasureDomEditChildRect(root: HTMLElement, child: HTMLElement): boolean {
  const generatedMotionText =
    root.getAttribute("data-ipw-motion-structure") === "v1" ||
    root.getAttribute("data-ipw-motion-split") === "v1";
  if (!generatedMotionText) return true;
  return !child.closest("[data-ipw-motion-role], [data-ipw-motion-word], [data-ipw-motion-char]");
}

interface UseDomEditOverlayRectsOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  selectionRef: RefObject<DomEditSelection | null>;
  activeCompositionPathRef: RefObject<string | null>;
  groupSelectionsRef: RefObject<DomEditSelection[]>;
  hoverSelectionRef: RefObject<DomEditSelection | null>;
  rafPausedRef: RefObject<boolean>;
}

interface UseDomEditOverlayRectsResult {
  overlayRect: OverlayRect | null;
  overlayRectRef: RefObject<OverlayRect | null>;
  setOverlayRect: (next: OverlayRect | null) => void;
  hoverRect: OverlayRect | null;
  hoverRectRef: RefObject<OverlayRect | null>;
  setHoverRect: (next: OverlayRect | null) => void;
  groupOverlayItems: GroupOverlayItem[];
  groupOverlayItemsRef: RefObject<GroupOverlayItem[]>;
  setGroupOverlayItems: (next: GroupOverlayItem[]) => void;
  childRects: OverlayRect[];
}

export function useDomEditOverlayRects({
  iframeRef,
  overlayRef,
  selectionRef,
  activeCompositionPathRef,
  groupSelectionsRef,
  hoverSelectionRef,
  rafPausedRef,
}: UseDomEditOverlayRectsOptions): UseDomEditOverlayRectsResult {
  const [overlayRect, setOverlayRectState] = useState<OverlayRect | null>(null);
  const [hoverRect, setHoverRectState] = useState<OverlayRect | null>(null);
  const [groupOverlayItems, setGroupOverlayItemsState] = useState<GroupOverlayItem[]>([]);
  const [childRects, setChildRectsState] = useState<OverlayRect[]>([]);

  const overlayRectRef = useRef<OverlayRect | null>(null);
  const hoverRectRef = useRef<OverlayRect | null>(null);
  const groupOverlayItemsRef = useRef<GroupOverlayItem[]>([]);
  const resolvedElementRef = useRef<{ key: string; element: HTMLElement } | null>(null);
  const resolvedHoverElementRef = useRef<{ key: string; element: HTMLElement } | null>(null);
  const resolvedGroupElementRef = useRef<Map<string, HTMLElement>>(new Map());
  const childRectsRef = useRef<OverlayRect[]>([]);

  const setOverlayRect = (next: OverlayRect | null) => {
    if (rectsEqual(overlayRectRef.current, next)) return;
    overlayRectRef.current = next;
    setOverlayRectState(next);
  };

  const setHoverRect = (next: OverlayRect | null) => {
    if (rectsEqual(hoverRectRef.current, next)) return;
    hoverRectRef.current = next;
    setHoverRectState(next);
  };

  const setGroupOverlayItems = (next: GroupOverlayItem[]) => {
    if (groupOverlayItemsEqual(groupOverlayItemsRef.current, next)) return;
    groupOverlayItemsRef.current = next;
    setGroupOverlayItemsState(next);
  };

  const resolveGroupElement = (doc: Document, sel: DomEditSelection) => {
    const key = selectionCacheKey(sel);
    const cached = resolvedGroupElementRef.current.get(key);
    if (cached?.isConnected && cached.ownerDocument === doc) return cached;

    const next = findElementForSelection(doc, sel, activeCompositionPathRef.current);
    if (next) {
      resolvedGroupElementRef.current.set(key, next);
    } else {
      resolvedGroupElementRef.current.delete(key);
    }
    return next;
  };

  useMountEffect(() => {
    let frame = 0;
    let geometryDirty = true;
    let lastMeasureAt = 0;
    let lastChildMeasureAt = 0;
    let lastSelectionSignature = "";
    let observedDocument: Document | null = null;
    const mutationObserver = new MutationObserver(() => {
      geometryDirty = true;
    });
    const resizeObserver = new ResizeObserver(() => {
      geometryDirty = true;
    });

    const observeGeometry = (
      doc: Document,
      iframe: HTMLIFrameElement,
      overlay: HTMLDivElement,
    ) => {
      if (observedDocument === doc) return;
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      observedDocument = doc;
      mutationObserver.observe(doc.documentElement, {
        attributes: true,
        attributeFilter: ["class", "hidden", "style"],
        characterData: true,
        childList: true,
        subtree: true,
      });
      resizeObserver.observe(iframe);
      resizeObserver.observe(overlay);
      geometryDirty = true;
    };

    const clearAll = () => {
      setOverlayRect(null);
      setHoverRect(null);
      setGroupOverlayItems([]);
      if (childRectsRef.current.length > 0) {
        childRectsRef.current = [];
        setChildRectsState([]);
      }
    };

    const update = () => {
      frame = requestAnimationFrame(update);
      if (rafPausedRef.current) {
        if (childRectsRef.current.length > 0) {
          childRectsRef.current = [];
          setChildRectsState([]);
        }
        return;
      }

      const sel = selectionRef.current;
      const iframe = iframeRef.current;
      const overlayEl = overlayRef.current;
      if (!iframe || !overlayEl) {
        resolvedElementRef.current = null;
        resolvedHoverElementRef.current = null;
        resolvedGroupElementRef.current.clear();
        clearAll();
        return;
      }

      const doc = iframe.contentDocument;
      if (!doc) {
        resolvedElementRef.current = null;
        resolvedHoverElementRef.current = null;
        resolvedGroupElementRef.current.clear();
        clearAll();
        return;
      }

      observeGeometry(doc, iframe, overlayEl);
      const group = groupSelectionsRef.current;
      const hoverSel = hoverSelectionRef.current;
      const selectionSignature = [
        sel ? selectionCacheKey(sel) : "none",
        group.map(selectionCacheKey).join("|"),
        hoverSel ? selectionCacheKey(hoverSel) : "none",
      ].join("::");
      const selectionChanged = selectionSignature !== lastSelectionSignature;
      if (selectionChanged) {
        lastSelectionSignature = selectionSignature;
        geometryDirty = true;
      }

      const now = performance.now();
      const isPlaying = usePlayerStore.getState().isPlaying;
      if (
        !isPlaying &&
        !geometryDirty &&
        !selectionChanged &&
        now - lastMeasureAt < PAUSED_OVERLAY_FALLBACK_MS
      ) {
        return;
      }
      lastMeasureAt = now;
      geometryDirty = false;
      const shouldMeasureChildren =
        selectionChanged || now - lastChildMeasureAt >= CHILD_RECT_INTERVAL_MS;

      if (sel) {
        const el = resolveElementForOverlay(
          doc,
          sel,
          activeCompositionPathRef.current,
          resolvedElementRef as ResolvedElementRef,
        );
        // An explicitly-selected element's overlay must track it whenever it's laid
        // out and not display:none/visibility:hidden. Opacity may be zero on the
        // boundary frame of an entrance/exit animation, but the selected authored
        // node still needs visible canvas chrome so timeline selection stays synced.
        // Use basic selection visibility,
        // NOT the occlusion heuristic. Occlusion (isElementVisibleInPreview) treats any
        // opacity:1 ancestor as an opaque cover even when it paints nothing (e.g. a
        // backgroundless full-bleed scene above a subcomposition), which would wrongly
        // hide the selection box. Occlusion stays for hover, where a false hide is cheap.
        if (el && isElementLaidOutForSelectionOverlay(el)) {
          // Groups render as an AABB union of their members (a group OBB is out of
          // scope); a single element renders as an oriented box that co-rotates
          // with its transform. orientedOverlayRect gates on rotation internally
          // (a cheap per-call check) and only pays for the full corner-transform
          // measurement when the element is actually rotated — this RAF loop runs
          // every frame for any single selection, so that gate matters here most.
          const nextRect = orientedGroupAwareOverlayRect(overlayEl, iframe, el);
          setOverlayRect(nextRect);
          const descendants = shouldMeasureChildren ? el.querySelectorAll("*") : null;
          if (descendants && descendants.length > 0 && descendants.length <= 60) {
            lastChildMeasureAt = now;
            const nextChildRects: OverlayRect[] = [];
            for (let i = 0; i < descendants.length; i++) {
              const child = descendants[i] as HTMLElement;
              if (!shouldMeasureDomEditChildRect(el, child)) continue;
              if (!child.getBoundingClientRect) continue;
              const r = toVisibleOverlayRect(overlayEl, iframe, child);
              if (r && r.width > 2 && r.height > 2) nextChildRects.push(r);
            }
            if (!childRectsEqual(childRectsRef.current, nextChildRects)) {
              childRectsRef.current = nextChildRects;
              setChildRectsState(nextChildRects);
            }
          } else if (descendants && childRectsRef.current.length > 0) {
            lastChildMeasureAt = now;
            childRectsRef.current = [];
            setChildRectsState([]);
          }
        } else {
          setOverlayRect(null);
          if (childRectsRef.current.length > 0) {
            childRectsRef.current = [];
            setChildRectsState([]);
          }
        }
      } else {
        resolvedElementRef.current = null;
        setOverlayRect(null);
        if (childRectsRef.current.length > 0) {
          childRectsRef.current = [];
          setChildRectsState([]);
        }
      }

      if (group.length > 0) {
        const nextGroupItems: GroupOverlayItem[] = [];
        const liveGroupKeys = new Set<string>();
        for (const groupSelection of group) {
          const key = selectionCacheKey(groupSelection);
          // Members of the same group collapse to one selection under select-as-unit,
          // so a multi-select can hold the same group twice — dedupe by key to avoid
          // duplicate React keys (and a doubled overlay box).
          if (liveGroupKeys.has(key)) continue;
          liveGroupKeys.add(key);
          const el = resolveGroupElement(doc, groupSelection);
          const base = el ? groupAwareOverlayRect(overlayEl, iframe, el) : null;
          const rect = base && el ? { ...base, ...hugRectForElement(base, el) } : base;
          if (el && isElementVisibleForOverlay(el) && rect)
            nextGroupItems.push({ key, selection: groupSelection, element: el, rect });
        }
        for (const key of resolvedGroupElementRef.current.keys()) {
          if (!liveGroupKeys.has(key)) resolvedGroupElementRef.current.delete(key);
        }
        setGroupOverlayItems(nextGroupItems);
      } else {
        resolvedGroupElementRef.current.clear();
        setGroupOverlayItems([]);
      }

      const hoverMatchesSelection = Boolean(
        sel && hoverSel && selectionCacheKey(sel) === selectionCacheKey(hoverSel),
      );
      const hoverMatchesGroup = Boolean(
        hoverSel && group.some((entry) => selectionCacheKey(entry) === selectionCacheKey(hoverSel)),
      );
      if (!hoverSel || hoverMatchesSelection || hoverMatchesGroup) {
        resolvedHoverElementRef.current = null;
        setHoverRect(null);
        return;
      }

      const hoverEl = resolveElementForOverlay(
        doc,
        hoverSel,
        activeCompositionPathRef.current,
        resolvedHoverElementRef as ResolvedElementRef,
      );
      if (!hoverEl) {
        setHoverRect(null);
        return;
      }

      setHoverRect(orientedGroupAwareOverlayRect(overlayEl, iframe, hoverEl));
    };

    frame = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  });

  return {
    overlayRect,
    overlayRectRef,
    setOverlayRect,
    hoverRect,
    hoverRectRef,
    setHoverRect,
    groupOverlayItems,
    groupOverlayItemsRef,
    setGroupOverlayItems,
    childRects,
  };
}
