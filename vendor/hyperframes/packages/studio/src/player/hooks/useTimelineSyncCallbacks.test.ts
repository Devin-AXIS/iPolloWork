import {
  durationToFrameCount,
  frameAlignedDurationSeconds,
  lastVideoFrameTime,
  runtimeProtocolMetadata,
} from "@hyperframes/core/runtime/protocol";
// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaybackAdapter } from "../lib/playbackTypes";
import { usePlayerStore, liveTime } from "../store/playerStore";
import { resolveForwardPlaybackWindow, useTimelinePlayerLoop } from "./useTimelinePlayerLoop";
import { useTimelinePlayer } from "./useTimelinePlayer";
import { resolveTimelineTotalDuration, useTimelineSyncCallbacks } from "./useTimelineSyncCallbacks";
import { useStudioUrlState } from "../../hooks/useStudioUrlState";
import { parseStudioUrlStateFromHash } from "../../utils/studioUrlState";

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
    expect(
      resolveTimelineTotalDuration({
        manifestDurationSeconds: Math.ceil(96.472 * fps) / fps,
        authoredRootDurationSeconds: 96.472,
        manifestFps: fps,
      }),
    ).toBe(Math.ceil(96.472 * fps) / fps);
  });

  it("retains real longer timelines and the authored duration floor", () => {
    expect(
      resolveTimelineTotalDuration({
        manifestDurationSeconds: 97,
        authoredRootDurationSeconds: 96.472,
        manifestFps: 30,
      }),
    ).toBe(97);
    expect(
      resolveTimelineTotalDuration({
        manifestDurationSeconds: 95,
        authoredRootDurationSeconds: 96.472,
        manifestFps: 30,
      }),
    ).toBe(96.5);
    expect(
      resolveTimelineTotalDuration({
        manifestDurationSeconds: 96.5,
        authoredRootDurationSeconds: 0,
        manifestFps: 30,
      }),
    ).toBe(96.5);
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
  let player: ReturnType<typeof useTimelinePlayer> | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  function Harness() {
    player = useTimelinePlayer();
    saveSeekPosition = player.saveSeekPosition;
    return null;
  }

  flushSync(() => root.render(createElement(Harness)));
  if (!saveSeekPosition || !player) throw new Error("Timeline player callback missing");
  return {
    ...player,
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

describe("authored audio metadata refresh", () => {
  it.each([
    ["fade-in", "fadeIn", "0.45", 0.45],
    ["fade-out", "fadeOut", "0.7", 0.7],
    ["volume", "volume", "0.45", 0.45],
    ["playback-rate", "playbackRate", "1.2", 1.2],
    ["media-start", "playbackStart", "0.4", 0.4],
  ] as const)(
    "refreshes %s without requiring a clip timing change and restores it on undo",
    (attribute, property, value, expected) => {
      const frame = document.createElement("iframe");
      document.body.append(frame);
      const doc = frame.contentDocument!;
      doc.body.innerHTML = `<main data-composition-id="main" data-duration="6"><audio id="music" data-start="0" data-duration="6" data-track-index="1" data-volume="0.6" data-fade-in="0.35" data-fade-out="0.4"></audio></main>`;
      const adapter: PlaybackAdapter = {
        play: vi.fn(),
        pause: vi.fn(),
        seek: vi.fn(),
        getTime: () => 0,
        getDuration: () => 6,
        isPlaying: () => false,
      };
      Object.defineProperty(frame.contentWindow, "__player", { value: adapter });
      const manifest = {
        ...runtimeProtocolMetadata(30),
        clips: [
          {
            id: "music",
            label: "Music",
            start: 0,
            duration: 6,
            track: 1,
            kind: "element",
            tagName: "audio",
            compositionId: null,
            parentCompositionId: null,
            compositionSrc: null,
            assetUrl: null,
          },
        ],
        durationInFrames: 180,
        fps: 30,
      };
      Object.defineProperty(frame.contentWindow, "__clipManifest", { value: manifest });
      usePlayerStore.setState({ elements: [], duration: 6, currentTime: 0, projectId: null });
      const harness = mountTimelinePlayerHarness();
      harness.iframeRef.current = frame;
      try {
        harness.onIframeLoad();
        const music = () => usePlayerStore.getState().elements.find((el) => el.id === "music");
        expect(music()).toBeDefined();
        const original = music()![property];
        const media = doc.getElementById("music")! as HTMLMediaElement;
        const previousAttribute = media.getAttribute(`data-${attribute}`);
        const previousRate = media.defaultPlaybackRate;
        media.setAttribute(`data-${attribute}`, value);
        if (attribute === "playback-rate") media.defaultPlaybackRate = Number(value);
        harness.onIframeLoad();
        expect(music()![property]).toBe(expected);
        expect(music()!.duration).toBe(6);
        if (previousAttribute === null) media.removeAttribute(`data-${attribute}`);
        else media.setAttribute(`data-${attribute}`, previousAttribute);
        media.defaultPlaybackRate = previousRate;
        harness.onIframeLoad();
        expect(music()![property]).toBe(original);
      } finally {
        harness.unmount();
        frame.remove();
      }
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  usePlayerStore.getState().reset();
  usePlayerStore.setState({ liveGenerationActive: false });
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
  it.each([0, 2])("preserves live autoplay during default URL hydration but honours an explicit seek (%ss)", initialTime => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    usePlayerStore.setState({ isPlaying: true, liveGenerationActive: true,
      liveGeneration: { id: "run", status: "generating", readyDuration: 4 } });
    const requestSeek = vi.spyOn(usePlayerStore.getState(), "requestSeek");
    function Harness() {
      useStudioUrlState({ projectId: "live", activeCompPath: null, duration: 4, isPlaying: true, compositionLoading: false,
        refreshKey: 0, previewIframeRef: { current: null }, rightPanelTab: "design", rightCollapsed: true, activeCompPathHydrated: true,
        domEditSelection: null, buildDomSelectionFromTarget: async () => null, applyDomSelection: vi.fn(), setRightCollapsed: vi.fn(),
        setRightPanelTab: vi.fn(), initialState: parseStudioUrlStateFromHash(`#project/live?t=${initialTime}`) });
      return null;
    }
    try {
      flushSync(() => root.render(createElement(Harness)));
      if (initialTime === 0) expect(requestSeek).not.toHaveBeenCalled();
      else expect(requestSeek).toHaveBeenCalledWith(2);
    } finally { flushSync(() => root.unmount()); container.remove(); }
  });
  it("starts a preloaded scene when the host busy message arrives after iframe readiness", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const frame = document.createElement("iframe"); document.body.append(frame);
    frame.contentDocument!.body.innerHTML = '<main data-composition-id="main" data-ipw-live-id="run" data-ipw-live-status="generating" data-duration="4"></main>';
    const play = vi.fn();
    Object.defineProperty(frame.contentWindow, "__player", { value: {
      play, pause: vi.fn(), seek: vi.fn(), getTime: () => 0, getDuration: () => 4, isPlaying: () => false,
    } });
    const harness = mountTimelinePlayerHarness(); harness.iframeRef.current = frame;
    try {
      harness.onIframeLoad();
      expect(play).not.toHaveBeenCalled();
      expect(usePlayerStore.getState().liveGeneration).toBeNull();
      usePlayerStore.setState({ liveGenerationActive: true });
      expect(play).toHaveBeenCalledOnce();
      expect(usePlayerStore.getState().isPlaying).toBe(true);
      usePlayerStore.getState().reset();
      expect(usePlayerStore.getState().liveGenerationActive).toBe(true);
    } finally { harness.unmount(); frame.remove(); }
  });
  it("autoplays the first publication, waits at its boundary without looping and resumes the extended prefix", () => {
    const scheduled: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { scheduled.push(callback); return scheduled.length; });
    const frame = document.createElement("iframe");
    document.body.append(frame);
    frame.contentDocument!.body.innerHTML = '<main data-composition-id="main" data-ipw-live-id="run" data-ipw-live-status="generating" data-duration="4"></main>';
    let time = 0, duration = 4, playing = false;
    const play = vi.fn(() => { playing = true; });
    const adapter: PlaybackAdapter = {
      play, pause: () => { playing = false; }, seek: value => { time = value; playing = false; },
      getTime: () => time, getDuration: () => duration, isPlaying: () => playing,
    };
    Object.defineProperty(frame.contentWindow, "__player", { value: adapter });
    usePlayerStore.setState({ liveGenerationActive: true, loopEnabled: true });
    const harness = mountTimelinePlayerHarness();
    harness.iframeRef.current = frame;
    try {
      harness.onIframeLoad();
      expect(play).toHaveBeenCalledOnce();
      expect(usePlayerStore.getState().isPlaying).toBe(true);
      time = 4;
      scheduled.shift()?.(0);
      expect(time).toBeCloseTo(4 - 1 / 30);
      expect(playing).toBe(false);
      expect(usePlayerStore.getState().currentTime).toBe(4);
      expect(usePlayerStore.getState().isPlaying).toBe(true);
      expect(liveTime.get()).toBe(4);
      duration = 8;
      frame.contentDocument!.querySelector("main")!.setAttribute("data-duration", "8");
      harness.refreshPlayer();
      harness.onIframeLoad();
      expect(time).toBe(4);
      expect(playing).toBe(true);
      expect(play).toHaveBeenCalledTimes(2);
      harness.pause();
      duration = 12;
      frame.contentDocument!.querySelector("main")!.setAttribute("data-duration", "12");
      harness.refreshPlayer();
      harness.onIframeLoad();
      expect(playing).toBe(false);
      expect(play).toHaveBeenCalledTimes(2);
      expect(usePlayerStore.getState().isPlaying).toBe(false);
    } finally { harness.unmount(); frame.remove(); }
  });

  it("keeps live playback running while a replacement loads and finishes buffering when the task stops", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const frame = document.createElement("iframe"); document.body.append(frame);
    frame.contentDocument!.body.innerHTML = '<main data-composition-id="main" data-ipw-live-id="run" data-ipw-live-status="generating" data-duration="4"></main>';
    const pause = vi.fn();
    Object.defineProperty(frame.contentWindow, "__player", { value: {
      play: vi.fn(), pause, seek: vi.fn(), getTime: () => 2, getDuration: () => 4, isPlaying: () => true,
    } });
    usePlayerStore.setState({ liveGenerationActive: true, isPlaying: true, currentTime: 2, duration: 4,
      liveGeneration: { id: "run", status: "generating", readyDuration: 4 } });
    const harness = mountTimelinePlayerHarness(); harness.iframeRef.current = frame;
    try {
      harness.refreshPlayer();
      expect(pause).not.toHaveBeenCalled();
      usePlayerStore.setState({ currentTime: 4, liveGenerationActive: false });
      expect(usePlayerStore.getState().isPlaying).toBe(false);
    } finally { harness.unmount(); frame.remove(); }
  });

  it.each([false, true])("resumes the final publication after idle unless the user seeks while waiting (%s)", userSeek => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const frame = document.createElement("iframe"); document.body.append(frame);
    frame.contentDocument!.body.innerHTML = '<main data-composition-id="main" data-ipw-live-id="run" data-ipw-live-status="complete" data-duration="8"></main>';
    let time = 0;
    const play = vi.fn();
    Object.defineProperty(frame.contentWindow, "__player", { value: {
      play, pause: vi.fn(), seek: (next: number) => { time = next; }, getTime: () => time, getDuration: () => 8, isPlaying: () => false,
    } });
    usePlayerStore.setState({ liveGenerationActive: false, isPlaying: false, currentTime: 4, duration: 4,
      liveGeneration: { id: "run", status: "generating", readyDuration: 4 }, liveGenerationResumePending: true });
    const harness = mountTimelinePlayerHarness(); harness.iframeRef.current = frame;
    try {
      if (userSeek) harness.seek(2);
      harness.onIframeLoad();
      expect(time).toBe(userSeek ? 2 : 4);
      expect(play).toHaveBeenCalledTimes(userSeek ? 0 : 1);
      expect(usePlayerStore.getState().isPlaying).toBe(!userSeek);
      expect(usePlayerStore.getState().liveGenerationResumePending).toBe(false);
    } finally { harness.unmount(); frame.remove(); }
  });
  it("restores a seek made while an edited preview is still loading", () => {
    const visibleFrame = document.createElement("iframe");
    const replacementFrame = document.createElement("iframe");
    document.body.append(visibleFrame, replacementFrame);
    let visibleTime = 17.27;
    const nextSeek = vi.fn();
    const adapter: PlaybackAdapter = {
      play: vi.fn(),
      pause: vi.fn(),
      seek: (time) => {
        visibleTime = time;
      },
      getTime: () => visibleTime,
      getDuration: () => 21.3,
      isPlaying: () => false,
    };
    Object.defineProperty(visibleFrame.contentWindow, "__player", { value: adapter });
    Object.defineProperty(replacementFrame.contentWindow, "__player", {
      value: { ...adapter, seek: nextSeek, getTime: () => 0 },
    });
    usePlayerStore.setState({ currentTime: visibleTime, duration: 21.3 });
    const harness = mountTimelinePlayerHarness();
    harness.iframeRef.current = visibleFrame;
    harness.saveSeekPosition();
    expect(harness.seek(3.219)).toBe(true);
    expect(usePlayerStore.getState().currentTime).toBe(3.219);
    harness.saveSeekPosition();

    harness.iframeRef.current = replacementFrame;
    harness.onIframeLoad();

    expect(nextSeek).toHaveBeenLastCalledWith(3.219, undefined);
    expect(usePlayerStore.getState().currentTime).toBe(3.219);
    harness.unmount();
    visibleFrame.remove();
    replacementFrame.remove();
  });

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

  it("intersects loop points with a scene without changing the global duration", () => {
    expect(
      resolveForwardPlaybackWindow({
        adapterDuration: 24,
        storeDuration: 24,
        inPoint: 0,
        outPoint: 24,
        playbackRange: { start: 8, end: 16 },
      }),
    ).toEqual({ duration: 24, loopStart: 8, loopEnd: 16 });
    expect(
      resolveForwardPlaybackWindow({
        adapterDuration: 24,
        storeDuration: 24,
        inPoint: 10,
        outPoint: 12,
        playbackRange: { start: 8, end: 16 },
      }),
    ).toEqual({ duration: 24, loopStart: 10, loopEnd: 12 });
    expect(
      resolveForwardPlaybackWindow({
        adapterDuration: 24,
        storeDuration: 24,
        inPoint: 1,
        outPoint: 4,
        playbackRange: { start: 8, end: 16 },
      }),
    ).toEqual({ duration: 24, loopStart: 8, loopEnd: 16 });
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
