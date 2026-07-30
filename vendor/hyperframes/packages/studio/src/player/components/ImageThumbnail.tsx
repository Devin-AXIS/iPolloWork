import { memo, useCallback, useEffect, useRef, useState } from "react";
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
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
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

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setStatus("loading");

    const image = new Image();
    image.onload = () => {
      if (!cancelled) setStatus("loaded");
    };
    image.onerror = () => {
      if (cancelled) return;
      setStatus(/\.svg($|\?)/i.test(imageSrc) ? "loaded" : "error");
    };
    image.src = imageSrc;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
      image.src = "";
    };
  }, [visible, imageSrc]);

  return (
    <div ref={setContainerRef} className="hf-timeline-image-thumbnail">
      {visible && status === "loaded" && (
        <img src={imageSrc} alt="" draggable={false} loading="lazy" />
      )}
      {visible && status === "loading" && (
        <span className="hf-timeline-thumbnail-shimmer" aria-hidden="true" />
      )}
    </div>
  );
});
