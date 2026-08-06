import { useState, useRef, useEffect, memo } from "react";
import { trackStudioEvent } from "../../utils/studioTelemetry";
import { Tooltip } from "../../components/ui";
import { useStudioI18n } from "../../i18n";

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2] as const;

interface SpeedMenuProps {
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  disabled: boolean;
}

export const SpeedMenu = memo(function SpeedMenu({
  playbackRate,
  setPlaybackRate,
  disabled,
}: SpeedMenuProps) {
  const { tx } = useStudioI18n();
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const speedMenuContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSpeedMenu) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        speedMenuContainerRef.current &&
        !speedMenuContainerRef.current.contains(e.target as Node)
      ) {
        setShowSpeedMenu(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [showSpeedMenu]);

  return (
    <div ref={speedMenuContainerRef} className="relative flex-shrink-0">
      <Tooltip label={tx("Playback speed")}>
        <button
          type="button"
          onClick={() => setShowSpeedMenu((v) => !v)}
          disabled={disabled}
          className={`flex h-6 min-w-10 items-center justify-center whitespace-nowrap rounded border-[0.5px] border-[#858a94] px-1.5 text-xs font-medium tabular-nums text-[#59616d] transition-colors hover:bg-[#e8eaed] disabled:opacity-40 ${
            showSpeedMenu ? "bg-[#e8eaed]" : "bg-transparent"
          }`}
          aria-label={tx(`Playback speed ${playbackRate}x`)}
          aria-expanded={showSpeedMenu}
        >
          {playbackRate === 1 ? "1x" : `${playbackRate}x`}
        </button>
      </Tooltip>
      {showSpeedMenu && (
        <div
          className="absolute bottom-full right-0 z-50 mb-1.5 min-w-16 overflow-hidden rounded-lg border border-[var(--hf-panel-border-input)] bg-[var(--hf-panel-bg)] p-1 shadow-xl"
        >
          {SPEED_OPTIONS.map((rate) => (
            <button
              key={rate}
              onClick={() => {
                trackStudioEvent("playback", { action: "speed_change", rate });
                setPlaybackRate(rate);
                setShowSpeedMenu(false);
              }}
              className={`block w-full rounded px-3 py-1.5 text-left font-mono text-[11px] tabular-nums transition-colors ${
                rate === playbackRate
                  ? "bg-[var(--hf-panel-hover)] font-semibold text-[var(--hf-panel-text-0)]"
                  : "text-[var(--hf-panel-text-3)] hover:bg-[var(--hf-panel-bg-inset)] hover:text-[var(--hf-panel-text-1)]"
              }`}
              aria-pressed={rate === playbackRate}
            >
              {rate}x
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
