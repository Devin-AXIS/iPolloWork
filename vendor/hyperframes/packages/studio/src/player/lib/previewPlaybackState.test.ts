import { describe, expect, it, vi } from "vitest";

import { setPreviewPlaybackActive } from "./timelineIframeHelpers";

describe("setPreviewPlaybackActive", () => {
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
