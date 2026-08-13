// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaybackAdapter } from "../lib/playbackTypes";
import { usePlayerStore } from "../store/playerStore";
import { useTimelineSyncCallbacks } from "./useTimelineSyncCallbacks";

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

afterEach(() => {
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
