import { describe, expect, it, vi } from "vitest";

import { setPreviewPlaybackActive } from "./timelineIframeHelpers";

describe("setPreviewPlaybackActive", () => {
  it("stops a legacy frame carousel once when Studio takes playback control", () => {
    const click = vi.fn();
    let controlled = false;
    const setAttribute = vi.fn(() => {
      controlled = true;
    });
    const root = { setAttribute, hasAttribute: vi.fn(() => controlled) };
    const iframe = {
      getRootNode: () => ({}),
      contentDocument: {
        getAnimations: () => [],
        querySelectorAll: (selector: string) =>
          selector === ".frame" ? [{}, {}] : selector === "audio, video" ? [] : [],
        querySelector: (selector: string) =>
          selector === "[data-composition-id]" ? root : selector === "#play" ? { click } : null,
      },
      contentWindow: {
        requestAnimationFrame: vi.fn(() => 1),
        cancelAnimationFrame: vi.fn(),
        postMessage: vi.fn(),
      },
    } as unknown as HTMLIFrameElement;

    setPreviewPlaybackActive(iframe, false);
    setPreviewPlaybackActive(iframe, false);

    expect(click).toHaveBeenCalledOnce();
    expect(root.setAttribute).toHaveBeenCalledWith("data-hf-studio-carousel-controlled", "true");
  });

  it("freezes iframe animation frames while preview is inactive and resumes them on play", () => {
    const animationPause = vi.fn();
    const animationPlay = vi.fn();
    const nativeRequestAnimationFrame = vi.fn(() => 41);
    const nativeCancelAnimationFrame = vi.fn();
    const iframeWindow = {
      requestAnimationFrame: nativeRequestAnimationFrame,
      cancelAnimationFrame: nativeCancelAnimationFrame,
      postMessage: vi.fn(),
    };
    const iframe = {
      getRootNode: () => ({}),
      contentDocument: {
        getAnimations: () => [
          { pause: animationPause, play: animationPlay, playState: "running" },
        ],
        querySelectorAll: () => [],
      },
      contentWindow: iframeWindow,
    } as unknown as HTMLIFrameElement;

    setPreviewPlaybackActive(iframe, false);

    const frameCallback = vi.fn();
    const pausedFrameId = iframeWindow.requestAnimationFrame(frameCallback);
    expect(pausedFrameId).toBeGreaterThan(0);
    expect(nativeRequestAnimationFrame).not.toHaveBeenCalled();
    expect(animationPause).toHaveBeenCalledOnce();

    setPreviewPlaybackActive(iframe, true);

    expect(animationPlay).toHaveBeenCalledOnce();
    expect(nativeRequestAnimationFrame).toHaveBeenCalledOnce();
    const resumedFrame = nativeRequestAnimationFrame.mock.calls[0]?.[0];
    expect(resumedFrame).toBeTypeOf("function");
    resumedFrame?.(123);
    expect(frameCallback).toHaveBeenCalledWith(123);
  });

  it("pauses the host and every iframe media element when preview is inactive", () => {
    const hostPause = vi.fn();
    const audioPause = vi.fn();
    const videoPause = vi.fn();
    const iframe = {
      getRootNode: () => ({ host: { pause: hostPause } }),
      contentDocument: {
        querySelectorAll: () => [{ pause: audioPause }, { pause: videoPause }],
      },
      contentWindow: { postMessage: vi.fn() },
    } as unknown as HTMLIFrameElement;

    setPreviewPlaybackActive(iframe, false);

    expect(hostPause).toHaveBeenCalledOnce();
    expect(audioPause).toHaveBeenCalledOnce();
    expect(videoPause).toHaveBeenCalledOnce();
  });

  it("does not start media just because preview becomes active", () => {
    const play = vi.fn();
    const iframe = {
      getRootNode: () => ({ host: { play } }),
      contentDocument: { querySelectorAll: () => [{ play }] },
      contentWindow: { postMessage: vi.fn() },
    } as unknown as HTMLIFrameElement;

    setPreviewPlaybackActive(iframe, true);

    expect(play).not.toHaveBeenCalled();
  });

  it("mutes legacy voiceovers that have no scene synchronization metadata", () => {
    const pause = vi.fn();
    const legacyVoiceover = {
      getAttribute: (name: string) => name === "data-start" || name === "data-duration" ? null : "",
      setAttribute: vi.fn(),
      muted: false,
      pause,
    };
    const iframe = {
      getRootNode: () => ({}),
      contentDocument: { querySelectorAll: () => [legacyVoiceover], getElementById: () => null },
      contentWindow: { postMessage: vi.fn() },
    } as unknown as HTMLIFrameElement;

    setPreviewPlaybackActive(iframe, true);

    expect(legacyVoiceover.muted).toBe(true);
    expect(pause).toHaveBeenCalledOnce();
  });
});
