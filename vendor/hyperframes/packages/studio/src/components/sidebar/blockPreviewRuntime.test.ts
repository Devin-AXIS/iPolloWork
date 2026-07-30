// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { mountBlockPreview } from "./blockPreviewRuntime";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("block preview runtime", () => {
  it("keeps hover previews at normal speed and restarts from the beginning", () => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);

    const container = document.createElement("div");
    const abortController = new AbortController();
    const cleanup = mountBlockPreview({
      container,
      videoUrl: "https://example.com/preview.mp4",
      signal: abortController.signal,
      onReady: vi.fn(),
      onError: vi.fn(),
    });
    const video = container.querySelector("video");
    if (!(video instanceof HTMLVideoElement)) throw new Error("Preview video was not mounted.");

    video.playbackRate = 2;
    video.currentTime = 4;
    video.dispatchEvent(new Event("ratechange"));
    video.dispatchEvent(new Event("loadedmetadata"));

    expect(video.defaultPlaybackRate).toBe(1);
    expect(video.playbackRate).toBe(1);
    expect(video.currentTime).toBe(0);

    cleanup();
    expect(container.querySelector("video")).toBeNull();
  });
});
