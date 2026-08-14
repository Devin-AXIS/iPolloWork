/**
 * The forward playback loop for the timeline player.
 *
 * Owns the three requestAnimationFrame lifecycle callbacks that drive (and stop)
 * playback:
 *  - startRAFLoop     — the forward tick: advance liveTime, honour in/out loop
 *                       points + loopEnabled, and pause + sync the store at the end.
 *  - stopRAFLoop      — cancel the forward tick.
 *  - stopReverseLoop  — cancel the reverse-shuttle tick (owned by the parent hook).
 *
 * Called unconditionally at the top level of useTimelinePlayer so its useCallback
 * hooks run in a stable order; every dependency is passed in as an argument.
 */

import { useCallback } from "react";
import { liveTime, usePlayerStore } from "../store/playerStore";
import type { PlaybackAdapter } from "../lib/playbackTypes";

interface UseTimelinePlayerLoopParams {
  rafRef: React.MutableRefObject<number>;
  reverseRafRef: React.MutableRefObject<number>;
  getAdapter: () => PlaybackAdapter | null;
  setCurrentTime: (v: number) => void;
  setIsPlaying: (v: boolean) => void;
}

interface UseTimelinePlayerLoopResult {
  startRAFLoop: () => void;
  stopRAFLoop: () => void;
  stopReverseLoop: () => void;
}

export function resolveForwardPlaybackWindow(input: {
  adapterDuration: number;
  storeDuration: number;
  inPoint: number | null;
  outPoint: number | null;
}): { duration: number; loopStart: number; loopEnd: number } | null {
  const adapterDuration =
    Number.isFinite(input.adapterDuration) && input.adapterDuration > 0
      ? input.adapterDuration
      : 0;
  const storeDuration =
    Number.isFinite(input.storeDuration) && input.storeDuration > 0 ? input.storeDuration : 0;
  // A positive adapter duration is authoritative, including after an edit that
  // shortened the composition. The store is only a readiness fallback while
  // the runtime temporarily reports no duration at all.
  const duration = adapterDuration || storeDuration;
  if (duration <= 0) return null;

  const requestedStart =
    input.inPoint !== null && Number.isFinite(input.inPoint)
      ? Math.max(0, Math.min(input.inPoint, duration))
      : 0;
  const requestedEnd =
    input.outPoint !== null && Number.isFinite(input.outPoint)
      ? Math.max(0, Math.min(input.outPoint, duration))
      : duration;
  if (requestedStart >= requestedEnd) {
    return { duration, loopStart: 0, loopEnd: duration };
  }
  return { duration, loopStart: requestedStart, loopEnd: requestedEnd };
}

export function useTimelinePlayerLoop({
  rafRef,
  reverseRafRef,
  getAdapter,
  setCurrentTime,
  setIsPlaying,
}: UseTimelinePlayerLoopParams): UseTimelinePlayerLoopResult {
  const stopReverseLoop = useCallback(() => {
    cancelAnimationFrame(reverseRafRef.current);
  }, [reverseRafRef]);

  const startRAFLoop = useCallback(() => {
    // fallow-ignore-next-line complexity
    const tick = () => {
      const adapter = getAdapter();
      if (adapter) {
        const rawTime = adapter.getTime();
        const state = usePlayerStore.getState();
        const playbackWindow = resolveForwardPlaybackWindow({
          adapterDuration: adapter.getDuration(),
          storeDuration: state.duration,
          inPoint: state.inPoint,
          outPoint: state.outPoint,
        });
        // Runtime readiness can briefly expose no usable duration. Keep the RAF
        // alive until the authored/store duration or full adapter arrives; zero
        // is not a real end-of-video signal.
        if (!playbackWindow) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        const { duration, loopEnd, loopStart } = playbackWindow;
        const time = Math.min(rawTime, duration);
        liveTime.notify(time); // direct DOM updates, no React re-render
        if (time >= loopEnd) {
          if (state.loopEnabled) {
            // keepPlaying skips the adapter's implicit pause; play() below is then a no-op.
            adapter.seek(loopStart, { keepPlaying: true });
            liveTime.notify(loopStart);
            adapter.play();
            setIsPlaying(true);
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          if (adapter.isPlaying()) adapter.pause();
          setCurrentTime(time); // sync Zustand once at end
          setIsPlaying(false);
          cancelAnimationFrame(rafRef.current);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [rafRef, getAdapter, setCurrentTime, setIsPlaying]);

  const stopRAFLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
  }, [rafRef]);

  return { startRAFLoop, stopRAFLoop, stopReverseLoop };
}
