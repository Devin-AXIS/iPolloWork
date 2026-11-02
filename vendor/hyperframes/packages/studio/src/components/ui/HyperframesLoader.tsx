export interface HyperframesLoaderProps {
  /** Status text shown below the loading indicator. */
  title: string;
  /** Optional secondary detail line. */
  detail?: string;
  /** Optional monospace third line for IDs, counts, or percentages. */
  mono?: string;
  /** Pixel size of the indicator area; status text scales independently. */
  size?: number;
  /** Optional normalized progress value from 0 to 1. */
  progress?: number;
}

export function HyperframesLoader({
  title,
  detail,
  mono,
  size = 64,
  progress,
}: HyperframesLoaderProps) {
  const boundedProgress =
    typeof progress === "number" && Number.isFinite(progress)
      ? Math.min(1, Math.max(0, progress))
      : undefined;
  const indicatorFrameSize = Math.round(size * 1.16);

  return (
    <div className="hf-loader" role="status" draggable={false}>
      <div
        className="hf-loader-indicator-frame"
        style={{ width: indicatorFrameSize, height: indicatorFrameSize }}
        draggable={false}
      >
        <div
          className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-700 border-t-studio-accent motion-reduce:animate-none"
          aria-hidden="true"
        />
      </div>
      <div className="hf-loader-title">{title}</div>
      {detail && <div className="hf-loader-detail">{detail}</div>}
      {boundedProgress !== undefined && (
        <div
          className="hf-loader-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(boundedProgress * 100)}
        >
          <div
            className="hf-loader-progress__fill"
            style={{ transform: `scaleX(${boundedProgress})` }}
          />
        </div>
      )}
      {mono && <div className="hf-loader-mono">{mono}</div>}
    </div>
  );
}

// fallow-ignore-next-line unused-export
export function StatusFrame(props: HyperframesLoaderProps) {
  return (
    <div className="hf-frame">
      <HyperframesLoader {...props} />
    </div>
  );
}
