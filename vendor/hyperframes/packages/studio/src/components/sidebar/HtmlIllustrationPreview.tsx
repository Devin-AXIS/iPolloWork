import { useEffect, useRef, useState } from "react";

const ILLUSTRATION_WIDTH = 1600;
const ILLUSTRATION_HEIGHT = 900;

export function HtmlIllustrationPreview({
  src,
  srcDoc,
  title,
  className = "",
}: {
  src?: string;
  srcDoc?: string;
  title: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateScale = () => setScale(Math.max(0.001, container.clientWidth / ILLUSTRATION_WIDTH));
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative aspect-video overflow-hidden bg-white ${className}`}
    >
      <iframe
        src={src}
        srcDoc={srcDoc}
        title={title}
        loading="lazy"
        sandbox=""
        width={ILLUSTRATION_WIDTH}
        height={ILLUSTRATION_HEIGHT}
        className="pointer-events-none absolute left-0 top-0 max-w-none border-0 bg-white"
        style={{
          width: ILLUSTRATION_WIDTH,
          height: ILLUSTRATION_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
        }}
      />
    </div>
  );
}
