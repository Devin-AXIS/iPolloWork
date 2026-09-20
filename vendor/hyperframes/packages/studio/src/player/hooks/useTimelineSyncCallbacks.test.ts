import { durationToFrameCount, frameAlignedDurationSeconds, lastVideoFrameTime } from "@hyperframes/core/runtime/protocol";
// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaybackAdapter } from "../lib/playbackTypes";
import { usePlayerStore } from "../store/playerStore";
import { resolveForwardPlaybackWindow, useTimelinePlayerLoop } from "./useTimelinePlayerLoop";
import { useTimelinePlayer } from "./useTimelinePlayer";
import { resolveTimelineTotalDuration, useTimelineSyncCallbacks } from "./useTimelineSyncCallbacks";

describe("shared video frame boundaries", () => {
  it("preserves audio seconds while padding video to 2895 frames", () => {
    expect(durationToFrameCount(96.472, 30)).toBe(2895);
    expect(frameAlignedDurationSeconds(96.472, 30)).toBe(96.5);
    expect(lastVideoFrameTime(96.5, 96.5, 30)).toBe(2894 / 30);
  });
  it("does not add a frame for floating point noise at exact boundaries", () => {
    expect(durationToFrameCount(0.1 + 0.2, 30)).toBe(9);
    expect(durationToFrameCount(0.30001, 30)).toBe(10);
  });
  it("uses the exact rational rate for NTSC", () => {
    const fps = { num: 30000, den: 1001 };
    expect(durationToFrameCount(1001 / 30, fps)).toBe(1000);
    expect(frameAlignedDurationSeconds(1001 / 30, fps)).toBe(1001 / 30);
  });
});

describe("manifest duration precision", () => {
  it.each([24, 30, 60])("aligns authored seconds to a complete frame at %i fps", (fps) => {
    expect(resolveTimelineTotalDuration({
      manifestDurationSeconds: Math.ceil(96.472 * fps) / fps,
      authoredRootDurationSeconds: 96.472,
      manifestFps: fps,
    })).toBe(Math.ceil(96.472 * fps) / fps);
  });

  it("retains real longer timelines and the authored duration floor", () => {
    expect(resolveTimelineTotalDuration({ manifestDurationSeconds: 97, authoredRootDurationSeconds: 96.472, manifestFps: 30 })).toBe(97);
    expect(resolveTimelineTotalDuration({ manifestDurationSeconds: 95, authoredRootDurationSeconds: 96.472, manifestFps: 30 })).toBe(96.5);
    expect(resolveTimelineTotalDuration({ manifestDurationSeconds: 96.5, authoredRootDurationSeconds: 0, manifestFps: 30 })).toBe(96.5);
  });
});

function mountInitializationHarness(input: {
  adapter: PlaybackAdapter;
  resumePlayback: () => void;
  setIsPlaying: (playing: boolean) => void;
  pendingSeek?: number | null;
}) {
  let initializeAdapter: (() => boolean) | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  function Harness() {
    initializeAdapter = useTimelineSyncCallbacks({
      iframeRef: { current: null },
      probeIntervalRef: { current: undefined },
      pendingSeekRef: { current: input.pendingSeek ?? null },
      isRefreshingRef: { current: false },
      getAdapter: () => input.adapter,
      syncTimelineElements: vi.fn(),
      setDuration: vi.fn(),
      setCurrentTime: vi.fn(),
      setTimelineReady: vi.fn(),
      setIsPlaying: input.setIsPlaying,
      attachIframeShortcutListeners: vi.fn(),
      applyPreviewAudioState: vi.fn(),
      stopPreviewMedia: vi.fn(),
      resumePlayback: input.resumePlayback,
    }).initializeAdapter;
    return null;
  }

  flushSync(() => root.render(createElement(Harness)));
  if (!initializeAdapter) throw new Error("Initialization callback missing");
  return {
    initializeAdapter,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

function mountTimelinePlayerHarness() {
  let saveSeekPosition: (() => void) | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  function Harness() {
    saveSeekPosition = useTimelinePlayer().saveSeekPosition;
    return null;
  }

  flushSync(() => root.render(createElement(Harness)));
  if (!saveSeekPosition) throw new Error("Timeline player callback missing");
  return {
    saveSeekPosition,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

function mountForwardPlaybackLoopHarness(getAdapter: () => PlaybackAdapter | null) {
  let startRAFLoop: (() => void) | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  function Harness() {
    startRAFLoop = useTimelinePlayerLoop({
      rafRef: { current: 0 },
      reverseRafRef: { current: 0 },
      getAdapter,
      setCurrentTime: vi.fn(),
      setIsPlaying: usePlayerStore.getState().setIsPlaying,
    }).startRAFLoop;
    return null;
  }

  flushSync(() => root.render(createElement(Harness)));
  if (!startRAFLoop) throw new Error("Forward playback callback missing");
  return {
    startRAFLoop,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  usePlayerStore.getState().reset();
});

describe("timeline adapter initialization", () => {
  it("keeps the first user-initiated playback running when runtime readiness arrives late", () => {
    const pause = vi.fn();
    const seek = vi.fn();
    const resumePlayback = vi.fn();
    const setIsPlaying = vi.fn();
    const adapter: PlaybackAdapter = {
      play: vi.fn(),
      pause,
      seek,
      getTime: () => 1.2,
      getDuration: () => 30,
      isPlaying: () => true,
    };
    usePlayerStore.setState({ isPlaying: true, currentTime: 0 });
    const harness = mountInitializationHarness({ adapter, resumePlayback, setIsPlaying });

    expect(harness.initializeAdapter()).toBe(true);
    expect(pause).toHaveBeenCalledOnce();
    expect(seek).toHaveBeenLastCalledWith(1.2);
    expect(setIsPlaying).not.toHaveBeenCalledWith(false);
    expect(resumePlayback).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("keeps an initialized preview paused when the user has not started playback", () => {
    const resumePlayback = vi.fn();
    const setIsPlaying = vi.fn();
    const adapter: PlaybackAdapter = {
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn(),
      getTime: () => 0,
      getDuration: () => 30,
      isPlaying: () => false,
    };
    usePlayerStore.setState({ isPlaying: false, currentTime: 4 });
    const harness = mountInitializationHarness({ adapter, resumePlayback, setIsPlaying });

    expect(harness.initializeAdapter()).toBe(true);
    expect(setIsPlaying).toHaveBeenCalledWith(false);
    expect(resumePlayback).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("continues a post-edit staged refresh from its saved playhead", () => {
    const seek = vi.fn();
    const resumePlayback = vi.fn();
    const adapter: PlaybackAdapter = {
      play: vi.fn(),
      pause: vi.fn(),
      seek,
      getTime: () => 0,
      getDuration: () => 30,
      isPlaying: () => false,
    };
    usePlayerStore.setState({ isPlaying: true, currentTime: 0 });
    const harness = mountInitializationHarness({
      adapter,
      resumePlayback,
      setIsPlaying: vi.fn(),
      pendingSeek: 12.5,
    });

    expect(harness.initializeAdapter()).toBe(true);
    expect(seek).toHaveBeenLastCalledWith(12.5);
    expect(resumePlayback).toHaveBeenCalledOnce();
    harness.unmount();
  });
});

describe("playback refresh races", () => {
  it("preserves user playback intent while a staged refresh is loading", () => {
    usePlayerStore.setState({ isPlaying: true, currentTime: 1.25, duration: 12 });
    const harness = mountTimelinePlayerHarness();

    harness.saveSeekPosition();

    expect(usePlayerStore.getState().isPlaying).toBe(true);
    harness.unmount();
  });

  it("continues playing when bootstrap playback is promoted to the runtime adapter", () => {
    const scheduledFrames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    });
    const bootstrapAdapter: PlaybackAdapter = {
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn(),
      getTime: () => 6.9,
      getDuration: () => 30,
      isPlaying: () => true,
    };
    let runtimePlaying = false;
    const runtimePlay = vi.fn(() => {
      runtimePlaying = true;
    });
    const runtimeAdapter: PlaybackAdapter = {
      play: runtimePlay,
      pause: vi.fn(),
      seek: vi.fn(),
      getTime: () => 7,
      getDuration: () => 30,
      isPlaying: () => runtimePlaying,
    };
    const adapters = [bootstrapAdapter, runtimeAdapter];
    const harness = mountForwardPlaybackLoopHarness(() => adapters.shift() ?? runtimeAdapter);
    usePlayerStore.setState({ isPlaying: true, duration: 30 });

    harness.startRAFLoop();
    scheduledFrames.shift()?.(0);
    expect(runtimePlay).not.toHaveBeenCalled();
    scheduledFrames.shift()?.(16);

    expect(runtimePlay).toHaveBeenCalledOnce();
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    harness.unmount();
  });

  it("does not treat a temporarily missing adapter duration as the project end", () => {
    expect(
      resolveForwardPlaybackWindow({
        adapterDuration: 0,
        storeDuration: 0,
        inPoint: null,
        outPoint: null,
      }),
    ).toBeNull();
    expect(
      resolveForwardPlaybackWindow({
        adapterDuration: 0,
        storeDuration: 12,
        inPoint: null,
        outPoint: null,
      }),
    ).toEqual({ duration: 12, loopStart: 0, loopEnd: 12 });
  });

  it("uses a positive adapter duration after a composition is shortened", () => {
    expect(
      resolveForwardPlaybackWindow({
        adapterDuration: 6,
        storeDuration: 12,
        inPoint: null,
        outPoint: null,
      }),
    ).toEqual({ duration: 6, loopStart: 0, loopEnd: 6 });
  });

  it("still honours a deliberate out point", () => {
    expect(
      resolveForwardPlaybackWindow({
        adapterDuration: 12,
        storeDuration: 12,
        inPoint: 1,
        outPoint: 4,
      }),
    ).toEqual({ duration: 12, loopStart: 1, loopEnd: 4 });
  });
});
