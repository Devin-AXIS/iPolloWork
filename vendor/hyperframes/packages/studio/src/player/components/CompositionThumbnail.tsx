import { memo, useCallback, useEffect, useState, useRef } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { computeThumbnailStrip, scheduleTimelineThumbnailTask } from "./thumbnailUtils";

interface CompositionThumbnailProps {
  previewUrl: string;
  label: string;
  labelColor: string;
  selector?: string;
  selectorIndex?: number;
  seekTime?: number;
  duration?: number;
  width?: number;
  height?: number;
  loading?: "eager" | "lazy";
  minLoadWidth?: number;
}

const CLIP_HEIGHT = 66;
const THUMBNAIL_URL_VERSION = "v3";

export function buildCompositionThumbnailUrl({
  previewUrl,
  seekTime = 2,
  duration = 5,
  selector,
  selectorIndex,
  origin,
}: {
  previewUrl: string;
  seekTime?: number;
  duration?: number;
  selector?: string;
  selectorIndex?: number;
  origin: string;
}): string {
  const thumbnailBase = previewUrl
    .replace("/preview/comp/", "/thumbnail/")
    .replace(/\/preview$/, "/thumbnail/index.html");
  const midTime = seekTime + duration / 2;
  const thumbnailUrl = new URL(thumbnailBase, origin);
  thumbnailUrl.searchParams.set("t", midTime.toFixed(2));
  thumbnailUrl.searchParams.set("v", THUMBNAIL_URL_VERSION);
  if (selector) {
    thumbnailUrl.searchParams.set("selector", selector);
    if (selectorIndex != null && selectorIndex > 0) {
      thumbnailUrl.searchParams.set("selectorIndex", String(selectorIndex));
    }
  }
  return thumbnailUrl.toString();
}

export const CompositionThumbnail = memo(function CompositionThumbnail({
  previewUrl,
  label,
  labelColor,
  selector,
  selectorIndex,
  seekTime = 2,
  duration = 5,
  loading = "eager",
  minLoadWidth = 0,
}: CompositionThumbnailProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [aspect, setAspect] = useState(16 / 9);
  const ioRef = useRef<IntersectionObserver | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const resizeRafRef = useRef(0);
  const pendingWidthRef = useRef(0);
  const idleCallbackRef = useRef<number | null>(null);
  const releaseTaskRef = useRef<(() => void) | null>(null);

  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    ioRef.current?.disconnect();
    roRef.current?.disconnect();
    if (!el) return;

    const scheduleWidth = (width: number) => {
      pendingWidthRef.current = Math.max(0, Math.round(width));
      if (resizeRafRef.current !== 0) return;
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = 0;
        setContainerWidth((current) =>
          current === pendingWidthRef.current ? current : pendingWidthRef.current,
        );
      });
    };

    scheduleWidth(el.parentElement?.clientWidth || el.clientWidth);

    ioRef.current = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        ioRef.current?.disconnect();
      },
      { rootMargin: "80px" },
    );
    ioRef.current.observe(el);

    const target = el.parentElement || el;
    roRef.current = new ResizeObserver(([entry]) => {
      if (entry) scheduleWidth(entry.contentRect.width);
    });
    roRef.current.observe(target);
  }, []);

  useMountEffect(() => () => {
    ioRef.current?.disconnect();
    roRef.current?.disconnect();
    if (resizeRafRef.current !== 0) cancelAnimationFrame(resizeRafRef.current);
    if (idleCallbackRef.current != null) window.cancelIdleCallback(idleCallbackRef.current);
    releaseTaskRef.current?.();
  });

  const url = buildCompositionThumbnailUrl({
    previewUrl,
    seekTime,
    duration,
    selector,
    selectorIndex,
    origin: window.location.origin,
  });
  const eligible = visible && containerWidth >= minLoadWidth;
  const { frameW } = computeThumbnailStrip(containerWidth, aspect, CLIP_HEIGHT);

  useEffect(() => {
    setLoaded(false);
    setReady(false);
    if (!eligible) return;

    let cancelled = false;
    idleCallbackRef.current = window.requestIdleCallback(
      () => {
        idleCallbackRef.current = null;
        if (cancelled) return;
        releaseTaskRef.current = scheduleTimelineThumbnailTask(() => {
          if (!cancelled) setReady(true);
        });
      },
      { timeout: 1200 },
    );

    return () => {
      cancelled = true;
      if (idleCallbackRef.current != null) {
        window.cancelIdleCallback(idleCallbackRef.current);
        idleCallbackRef.current = null;
      }
      releaseTaskRef.current?.();
      releaseTaskRef.current = null;
    };
  }, [eligible, url]);

  const finishTask = () => {
    releaseTaskRef.current?.();
    releaseTaskRef.current = null;
  };

  return (
    <div ref={setContainerRef} className="absolute inset-0 overflow-hidden">
      {ready && (
        <img
          src={url}
          alt=""
          draggable={false}
          loading={loading}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setAspect(img.naturalWidth / img.naturalHeight);
            }
            setLoaded(true);
            finishTask();
          }}
          onError={finishTask}
          className="pointer-events-none absolute h-px w-px opacity-0"
        />
      )}

      {loaded && (
        <div
          className="absolute inset-0"
          style={{
            animation: "hf-thumb-fade 200ms ease-out",
            backgroundImage: `url(${JSON.stringify(url)})`,
            backgroundPosition: "left center",
            backgroundRepeat: "repeat-x",
            backgroundSize: `${frameW}px 100%`,
          }}
        />
      )}

      {label && (
        <div className="absolute left-3 top-0 bottom-0 flex items-center" style={{ zIndex: 10 }}>
          <span
            className="block max-w-full truncate text-[10px] font-semibold leading-none"
            style={{
              color: labelColor,
              textShadow: loaded ? "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)" : "none",
            }}
          >
            {label}
          </span>
        </div>
      )}
    </div>
  );
});
