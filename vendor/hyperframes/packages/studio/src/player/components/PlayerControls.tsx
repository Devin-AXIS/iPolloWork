import { useRef, useCallback, useEffect, memo } from "react";
import { formatFrameTime, formatTime, stepFrameTime } from "../lib/time";
import { shouldMutePreviewAudio } from "../lib/timelineIframeHelpers";
import { usePlayerStore } from "../store/playerStore";
import { trackStudioEvent } from "../../utils/studioTelemetry";
import { Tooltip } from "../../components/ui";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { SpeedMenu } from "./SpeedMenu";
import { useSeekBarDrag, resolveSeekPercent } from "./useSeekBarDrag";
import { useStudioI18n } from "../../i18n";
import playIconSrc from "../../icons/figmaPlayerPlay.svg?url";
import repeatIconSrc from "../../icons/figmaPlayerRepeat.svg?url";
import volumeIconSrc from "../../icons/figmaPlayerVolume.svg?url";

export { resolveSeekPercent };

/* ── Icon sub-components ─────────────────────────────────────────── */


function PlayPauseIcon({ playing }: { playing: boolean }) {
  return (
    <span className="relative inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
      {playing ? (
        <span className="flex h-4 w-4 items-center justify-center gap-[3px]">
          <span className="h-[11px] w-[2px] rounded-[1px] bg-white" />
          <span className="h-[11px] w-[2px] rounded-[1px] bg-white" />
        </span>
      ) : (
        <img className="h-4 w-4" src={playIconSrc} alt="" />
      )}
    </span>
  );
}

/* ── Button sub-components ───────────────────────────────────────── */

const MuteButton = memo(function MuteButton({
  audioMuted,
  effectiveAudioMuted,
  controlsDisabled,
  setAudioMuted,
}: {
  audioMuted: boolean;
  effectiveAudioMuted: boolean;
  controlsDisabled: boolean;
  setAudioMuted: (v: boolean) => void;
}) {
  const { t } = useStudioI18n();
  const label = audioMuted ? t("player.unmuteAudio") : t("player.muteAudio");
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={() => {
          trackStudioEvent("playback", { action: "mute_toggle", muted: !audioMuted });
          setAudioMuted(!audioMuted);
        }}
        disabled={controlsDisabled}
        aria-label={label}
        aria-pressed={effectiveAudioMuted}
        className={`relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-colors disabled:pointer-events-none disabled:opacity-40 ${
          effectiveAudioMuted
            ? "bg-[#e8eaed] opacity-60"
            : "hover:bg-[#e8eaed]"
        }`}
      >
        <img src={volumeIconSrc} width="24" height="24" alt="" aria-hidden="true" />
      </button>
    </Tooltip>
  );
});

const LoopButton = memo(function LoopButton({
  loopEnabled,
  disabled,
  setLoopEnabled,
}: {
  loopEnabled: boolean;
  disabled: boolean;
  setLoopEnabled: (v: boolean) => void;
}) {
  const { t } = useStudioI18n();
  return (
    <Tooltip label={t("player.loop")}>
      <button
        type="button"
        onClick={() => {
          trackStudioEvent("playback", { action: "loop_toggle", enabled: !loopEnabled });
          setLoopEnabled(!loopEnabled);
        }}
        disabled={disabled}
        className={`flex h-6 w-6 items-center justify-center rounded transition-colors disabled:opacity-40 ${
          loopEnabled
            ? "bg-[#dff6f6]"
            : "hover:bg-[#e8eaed]"
        }`}
        aria-label={loopEnabled ? t("player.disableLoop") : t("player.enableLoop")}
        aria-pressed={loopEnabled}
      >
        <img src={repeatIconSrc} width="24" height="24" alt="" aria-hidden="true" />
      </button>
    </Tooltip>
  );
});

/* ── Seek bar sub-component ──────────────────────────────────────── */

function SeekBarMarker({ position, duration }: { position: number; duration: number }) {
  if (duration <= 0) return null;
  return (
    <div
      className="absolute z-[3] pointer-events-none"
      style={{
        left: `${Math.min(100, (position / duration) * 100)}%`,
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: "2px",
        height: "10px",
        background: "#1FBAC0",
        borderRadius: "1px",
      }}
    />
  );
}

function WorkAreaOverlay({
  inPoint,
  outPoint,
  duration,
}: {
  inPoint: number | null;
  outPoint: number | null;
  duration: number;
}) {
  if ((inPoint === null && outPoint === null) || duration <= 0) return null;
  return (
    <>
      <div
        className="absolute top-0 bottom-0 pointer-events-none"
        style={{
          left: `${inPoint !== null ? Math.min(100, (inPoint / duration) * 100) : 0}%`,
          right: `${outPoint !== null ? 100 - Math.min(100, (outPoint / duration) * 100) : 0}%`,
          background: "rgba(31,186,192,0.15)",
        }}
      />
      {inPoint !== null && <SeekBarMarker position={inPoint} duration={duration} />}
      {outPoint !== null && <SeekBarMarker position={outPoint} duration={duration} />}
    </>
  );
}

const SeekBar = memo(function SeekBar({
  disabled,
  duration,
  inPoint,
  outPoint,
  progressFillRef,
  progressThumbRef,
  seekBarRef,
  sliderRef,
  onPointerDown,
  onKeyDown,
}: {
  disabled: boolean;
  duration: number;
  inPoint: number | null;
  outPoint: number | null;
  progressFillRef: React.RefObject<HTMLDivElement | null>;
  progressThumbRef: React.RefObject<HTMLDivElement | null>;
  seekBarRef: React.RefObject<HTMLDivElement | null>;
  sliderRef: React.RefObject<HTMLDivElement | null>;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const { t } = useStudioI18n();
  return (
    <div
      ref={(el) => {
        (seekBarRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        (sliderRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={t("player.seek")}
      aria-disabled={disabled || undefined}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={0}
      className={`group flex h-6 min-w-[96px] flex-1 items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-[#1FBAC0]/30 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <div className="relative h-1 w-full rounded-lg bg-[#858a94]">
        <WorkAreaOverlay inPoint={inPoint} outPoint={outPoint} duration={duration} />
        <div
          ref={progressFillRef}
          className="absolute top-0 bottom-0 left-0 z-[1] rounded-full"
          style={{ background: "#1FBAC0" }}
        />
        <div
          ref={progressThumbRef}
          className="absolute top-1/2 z-[4] h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1FBAC0] transition-transform group-hover:scale-110"
          style={{
            boxShadow: "0 0 0 0 rgba(31,186,192,0.14)",
          }}
        />
      </div>
    </div>
  );
});

/* ── Main component ──────────────────────────────────────────────── */

interface PlayerControlsProps {
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  disabled?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const PlayerControls = memo(function PlayerControls({
  onTogglePlay,
  onSeek,
  disabled = false,
}: PlayerControlsProps) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const duration = usePlayerStore((s) => s.duration);
  const timelineReady = usePlayerStore((s) => s.timelineReady);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const audioMuted = usePlayerStore((s) => s.audioMuted);
  const loopEnabled = usePlayerStore((s) => s.loopEnabled);
  const setPlaybackRate = usePlayerStore.getState().setPlaybackRate;
  const setAudioMuted = usePlayerStore.getState().setAudioMuted;
  const setLoopEnabled = usePlayerStore.getState().setLoopEnabled;
  const inPoint = usePlayerStore((s) => s.inPoint);
  const outPoint = usePlayerStore((s) => s.outPoint);
  const setInPoint = usePlayerStore.getState().setInPoint;
  const setOutPoint = usePlayerStore.getState().setOutPoint;
  const timeDisplayMode = usePlayerStore((s) => s.timeDisplayMode);
  const setTimeDisplayMode = usePlayerStore.getState().setTimeDisplayMode;
  const { t } = useStudioI18n();

  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressThumbRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const timeDisplayModeRef = useRef(timeDisplayMode);
  timeDisplayModeRef.current = timeDisplayMode;

  const durationRef = useRef(duration);
  durationRef.current = duration;
  const controlsDisabled = disabled || !timelineReady;
  const effectiveAudioMuted = shouldMutePreviewAudio(audioMuted, playbackRate);

  useEffect(() => {
    if (!timeDisplayRef.current) return;
    const t = currentTimeRef.current;
    timeDisplayRef.current.textContent =
      timeDisplayMode === "frame" ? formatFrameTime(t, duration) : formatTime(t);
  }, [duration, timeDisplayMode]);

  const { handlePointerDown } = useSeekBarDrag(
    {
      seekBarRef,
      progressFillRef,
      progressThumbRef,
      sliderRef,
      timeDisplayRef,
      isDraggingRef,
      durationRef,
      currentTimeRef,
      timeDisplayModeRef,
    },
    onSeek,
    disabled,
    duration,
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled || !timelineReady || duration <= 0) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onSeek(stepFrameTime(currentTimeRef.current, -step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onSeek(Math.min(duration, stepFrameTime(currentTimeRef.current, step)));
      }
    },
    [disabled, timelineReady, duration, onSeek],
  );

  return (
    <div
      // No own background/border: the transport blends into the preview
      // panel's surface — buttons carry their own chrome.
      className="hf-player-controls flex h-[52px] flex-shrink-0 items-center gap-4 bg-[var(--hf-studio-controls-bg)] px-4"
      aria-disabled={disabled || undefined}
      data-testid="figma-player-controls"
    >
      <Tooltip label={isPlaying ? t("player.pause") : t("player.play")}>
        <button
          type="button"
          aria-label={isPlaying ? t("player.pause") : t("player.play")}
          onClick={() => {
            trackStudioEvent("playback", { action: isPlaying ? "pause" : "play" });
            onTogglePlay();
          }}
          disabled={controlsDisabled}
          className="hf-studio-play-control flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#171816] transition-opacity hover:opacity-85 disabled:pointer-events-none disabled:opacity-30"
        >
          <PlayPauseIcon playing={isPlaying} />
        </button>
      </Tooltip>

      <Tooltip
        label={timeDisplayMode === "time" ? t("player.switchToFrames") : t("player.switchToTime")}
      >
        <button
          type="button"
          onClick={() => setTimeDisplayMode(timeDisplayMode === "time" ? "frame" : "time")}
          disabled={disabled}
          className="w-[76px] flex-shrink-0 text-left text-xs tabular-nums text-[var(--hf-panel-text-1)] transition-opacity hover:opacity-75 disabled:pointer-events-none"
        >
          <span ref={timeDisplayRef}>{formatTime(0)}</span>
          {timeDisplayMode === "time" ? (
            <>
              <span className="text-[#999]">{` / ${formatTime(duration)}`}</span>
            </>
          ) : null}
        </button>
      </Tooltip>

      <SeekBar
        disabled={disabled}
        duration={duration}
        inPoint={inPoint}
        outPoint={outPoint}
        progressFillRef={progressFillRef}
        progressThumbRef={progressThumbRef}
        seekBarRef={seekBarRef}
        sliderRef={sliderRef}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      />

      <div className="flex flex-shrink-0 items-center gap-[10px] rounded-lg">
        <SpeedMenu
          playbackRate={playbackRate}
          setPlaybackRate={setPlaybackRate}
          disabled={disabled}
        />

        <LoopButton loopEnabled={loopEnabled} disabled={disabled} setLoopEnabled={setLoopEnabled} />

        <MuteButton
          audioMuted={audioMuted}
          effectiveAudioMuted={effectiveAudioMuted}
          controlsDisabled={controlsDisabled}
          setAudioMuted={setAudioMuted}
        />

        <ShortcutsPanel
          disabled={disabled}
          duration={duration}
          inPoint={inPoint}
          outPoint={outPoint}
          setInPoint={setInPoint}
          setOutPoint={setOutPoint}
          onSeek={onSeek}
        />
      </div>
    </div>
  );
});
