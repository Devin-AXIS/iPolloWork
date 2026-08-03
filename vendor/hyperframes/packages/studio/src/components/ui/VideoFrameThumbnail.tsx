import { useCallback, useEffect, useRef, useState } from "react";

const MAX_CACHED_VIDEO_FRAMES = 100;
const videoFrameCache = new Map<string, string>();

function cacheVideoFrame(src: string, frame: string): void {
  videoFrameCache.delete(src);
  videoFrameCache.set(src, frame);
  if (videoFrameCache.size <= MAX_CACHED_VIDEO_FRAMES) return;
  const oldest = videoFrameCache.keys().next().value;
  if (typeof oldest === "string") videoFrameCache.delete(oldest);
}

/**
 * Extracts one representative frame when the thumbnail approaches the viewport.
 * Frames are cached per URL so switching panels does not seek the same video again.
 */
export function VideoFrameThumbnail({
  src,
  fallbackLabel,
}: {
  src: string;
  fallbackLabel?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [frame, setFrame] = useState<string | null>(() => videoFrameCache.get(src) ?? null);
  const [failed, setFailed] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const setRootRef = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!element) return;
    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisible(true);
        observerRef.current?.disconnect();
      },
      { rootMargin: "200px" },
    );
    observerRef.current.observe(element);
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  useEffect(() => {
    const cached = videoFrameCache.get(src);
    setFrame(cached ?? null);
    setFailed(false);
    if (!visible || cached) return;

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "metadata";
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    let disposed = false;

    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
    };
    const handleMetadata = () => {
      video.currentTime = Math.min(2, video.duration * 0.1 || 2);
    };
    const handleSeeked = () => {
      if (disposed || !context || video.videoWidth <= 0 || video.videoHeight <= 0) return;
      canvas.width = Math.min(video.videoWidth, 640);
      canvas.height = Math.max(1, Math.round(canvas.width * video.videoHeight / video.videoWidth));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const nextFrame = canvas.toDataURL("image/jpeg", 0.65);
      cacheVideoFrame(src, nextFrame);
      setFrame(nextFrame);
      cleanup();
    };
    const handleError = () => {
      if (!disposed) setFailed(true);
      cleanup();
    };
    video.addEventListener("loadedmetadata", handleMetadata);
    video.addEventListener("seeked", handleSeeked);
    video.addEventListener("error", handleError);
    video.src = src;
    video.load();

    return () => {
      disposed = true;
      video.removeEventListener("loadedmetadata", handleMetadata);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
      cleanup();
    };
  }, [src, visible]);

  return (
    <div ref={setRootRef} className="h-full w-full">
      {failed && !frame ? (
        <div className="flex h-full w-full items-center justify-center bg-neutral-800">
          <span className="text-[9px] font-medium text-neutral-600">{fallbackLabel ?? "VIDEO"}</span>
        </div>
      ) : frame ? (
        <img src={frame} alt="" draggable={false} className="h-full w-full object-contain" />
      ) : (
        <div className="h-full w-full animate-pulse bg-neutral-800 motion-reduce:animate-none" />
      )}
    </div>
  );
}
