import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { shouldShowTimelineShortcutHint } from "./timelineLayout";

/**
 * The timeline scroll container's viewport plumbing — extracted verbatim from
 * Timeline.tsx (600-line studio cap): the ResizeObserver-backed viewport width,
 * the rAF-throttled shortcut-hint visibility sync, and the callback ref that
 * wires both to the scroll element. `resyncShortcutHintOn` re-checks the hint
 * whenever any of its values change (timeline readiness / element count /
 * canvas height), matching the original effect.
 */
export function useTimelineScrollViewport(
  scrollRef: RefObject<HTMLDivElement | null>,
  resyncShortcutHintOn: ReadonlyArray<unknown>,
): {
  viewportWidth: number;
  viewportHeight: number;
  scrollLeft: number;
  scrollTop: number;
  showShortcutHint: boolean;
  setScrollRef: (el: HTMLDivElement | null) => void;
  syncScrollViewport: (el: HTMLDivElement) => void;
} {
  const [viewport, setViewport] = useState({
    width: 0,
    height: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
  const [showShortcutHint, setShowShortcutHint] = useState(true);
  const roRef = useRef<ResizeObserver | null>(null);
  const shortcutHintRafRef = useRef(0);
  const viewportRafRef = useRef(0);
  const pendingViewportElementRef = useRef<HTMLDivElement | null>(null);

  const syncShortcutHintVisibility = useCallback(() => {
    const scroll = scrollRef.current;
    setShowShortcutHint(
      scroll ? shouldShowTimelineShortcutHint(scroll.scrollHeight, scroll.clientHeight) : true,
    );
  }, [scrollRef]);

  const scheduleShortcutHintVisibilitySync = useCallback(() => {
    if (shortcutHintRafRef.current) cancelAnimationFrame(shortcutHintRafRef.current);
    shortcutHintRafRef.current = requestAnimationFrame(() => {
      shortcutHintRafRef.current = 0;
      syncShortcutHintVisibility();
    });
  }, [syncShortcutHintVisibility]);

  const flushScrollViewport = useCallback(() => {
    viewportRafRef.current = 0;
    const el = pendingViewportElementRef.current;
    pendingViewportElementRef.current = null;
    if (!el) return;
    const next = {
      width: el.clientWidth,
      height: el.clientHeight,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    setViewport((current) =>
      current.width === next.width &&
      current.height === next.height &&
      current.scrollLeft === next.scrollLeft &&
      current.scrollTop === next.scrollTop
        ? current
        : next,
    );
  }, []);

  const syncScrollViewport = useCallback(
    (el: HTMLDivElement) => {
      pendingViewportElementRef.current = el;
      if (viewportRafRef.current === 0) {
        viewportRafRef.current = requestAnimationFrame(flushScrollViewport);
      }
    },
    [flushScrollViewport],
  );

  const setScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (roRef.current) {
        roRef.current.disconnect();
        roRef.current = null;
      }
      scrollRef.current = el;
      if (!el) return;

      const syncScrollViewportSize = () => {
        syncScrollViewport(el);
        scheduleShortcutHintVisibilitySync();
      };

      syncScrollViewportSize();
      roRef.current = new ResizeObserver(syncScrollViewportSize);
      roRef.current.observe(el);
    },
    [scrollRef, scheduleShortcutHintVisibilitySync, syncScrollViewport],
  );

  useMountEffect(() => () => {
    roRef.current?.disconnect();
    if (shortcutHintRafRef.current) cancelAnimationFrame(shortcutHintRafRef.current);
    if (viewportRafRef.current) cancelAnimationFrame(viewportRafRef.current);
  });

  useEffect(() => {
    syncShortcutHintVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncShortcutHintVisibility, ...resyncShortcutHintOn]);

  return {
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    scrollLeft: viewport.scrollLeft,
    scrollTop: viewport.scrollTop,
    showShortcutHint,
    setScrollRef,
    syncScrollViewport,
  };
}
