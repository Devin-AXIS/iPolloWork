import { describe, expect, it, vi } from "vitest";

import {
  shouldUseDirectTimelineAdapter,
  shouldUseStudioClockForLegacyFrames,
  wrapAdapterWithDurationLimit,
} from "./playbackAdapter";

describe("shouldUseDirectTimelineAdapter", () => {
  it("keeps Studio on the runtime player while its duration is still settling", () => {
    expect(shouldUseDirectTimelineAdapter(true, 30.8, 30.8)).toBe(false);
    expect(shouldUseDirectTimelineAdapter(false, 30.8, 30.8)).toBe(true);
  });
});

describe("shouldUseStudioClockForLegacyFrames", () => {
  it("uses the Studio clock for legacy multi-frame templates", () => {
    const doc = {
      querySelectorAll: (selector: string) => (selector === ".frame" ? [{}, {}] : []),
    } as unknown as Document;
    const adapter = {
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn(),
      getTime: () => 0,
      getDuration: () => 0,
      isPlaying: () => false,
    };

    expect(shouldUseStudioClockForLegacyFrames(doc, adapter, 10)).toBe(true);
  });

  it("keeps native playback for ordinary compositions", () => {
    const doc = {
      querySelectorAll: () => [],
    } as unknown as Document;
    const adapter = {
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn(),
      getTime: () => 0,
      getDuration: () => 10,
      isPlaying: () => false,
    };

    expect(shouldUseStudioClockForLegacyFrames(doc, adapter, 10)).toBe(false);
  });
});

describe("wrapAdapterWithDurationLimit", () => {
  it("clamps stale runtime time to a shortened document duration", () => {
    let time = 32;
    let playing = true;
    const source = {
      play: vi.fn(() => {
        playing = true;
      }),
      pause: vi.fn(() => {
        playing = false;
      }),
      seek: vi.fn((next: number) => {
        time = next;
      }),
      getTime: () => time,
      getDuration: () => 32,
      isPlaying: () => playing,
    };

    const adapter = wrapAdapterWithDurationLimit(source, 8);

    expect(adapter.getDuration()).toBe(8);
    expect(adapter.getTime()).toBe(8);
    adapter.pause();
    expect(source.pause).toHaveBeenCalledOnce();
  });

  it("restarts from zero instead of playing beyond the document end", () => {
    let time = 32;
    const source = {
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn((next: number) => {
        time = next;
      }),
      getTime: () => time,
      getDuration: () => 32,
      isPlaying: () => false,
    };

    const adapter = wrapAdapterWithDurationLimit(source, 8);
    adapter.play();

    expect(source.seek).toHaveBeenCalledWith(0);
    expect(source.play).toHaveBeenCalledOnce();
  });

  it("clamps seeks to the document duration", () => {
    let time = 0;
    const source = {
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn((next: number) => {
        time = next;
      }),
      getTime: () => time,
      getDuration: () => 32,
      isPlaying: () => false,
    };

    wrapAdapterWithDurationLimit(source, 8).seek(20);
    expect(source.seek).toHaveBeenCalledWith(8, undefined);
  });
});
