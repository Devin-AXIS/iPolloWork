import { useThumbnailLease } from "../../hooks/useThumbnailLease";
import { decodeImageThumbnail } from "../lib/thumbnailImageDecoder";
import { memo, useCallback, useRef, useState, useMemo } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";

interface ImageThumbnailProps {
  imageSrc: string;
}

/**
 * Displays one contained still image. Static assets and logos deliberately do
 * not repeat like video frames; the surrounding clip bar carries their length.
 */
export const ImageThumbnail = memo(function ImageThumbnail({ imageSrc }: ImageThumbnailProps) {
  const [visible, setVisible] = useState(false);

  const observerRef = useRef<IntersectionObserver | null>(null);

  const setContainerRef = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!element) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observerRef.current?.disconnect();
      },
      { rootMargin: "200px" },
    );
    observerRef.current.observe(element);
  }, []);

  useMountEffect(() => () => observerRef.current?.disconnect());

  const request = useMemo(() => visible ? {
    key: imageSrc, projectId: new URL(imageSrc, window.location.href).pathname.split("/")[3] ?? "studio",
    sessionEpoch: 0, kind: "image" as const, priority: "visible" as const,
    load: (signal: AbortSignal) => decodeImageThumbnail(imageSrc, signal),
  } : null, [visible, imageSrc]);
  const snapshot = useThumbnailLease(request);
  const status = snapshot.status === "ready" ? "loaded" : snapshot.status === "error" ? "error" : "loading";
  const source = snapshot.status === "ready" && snapshot.value.kind === "image" ? snapshot.value.url : imageSrc;

  return (
    <div ref={setContainerRef} className="hf-timeline-image-thumbnail">
      {visible && status === "loaded" && (
        <img src={source} alt="" draggable={false} loading="lazy" />
      )}
      {visible && status === "loading" && (
        <span className="hf-timeline-thumbnail-shimmer" aria-hidden="true" />
      )}
    </div>
  );
});
