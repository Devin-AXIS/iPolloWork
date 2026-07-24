import { describe, expect, it, vi } from "vitest";

import { wrapAdapterWithDurationLimit } from "./playbackAdapter";

describe("wrapAdapterWithDurationLimit", () => {
  it("clamps stale runtime time to a shortened document duration", () => {
    let time = 32;
    let playing = true;
    const source = {
      play: vi.fn(() => { playing = true; }),
      pause: vi.fn(() => { playing = false; }),
      seek: vi.fn((next: number) => { time = next; }),
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
      seek: vi.fn((next: number) => { time = next; }),
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
      seek: vi.fn((next: number) => { time = next; }),
      getTime: () => time,
      getDuration: () => 32,
      isPlaying: () => false,
    };

    wrapAdapterWithDurationLimit(source, 8).seek(20);
    expect(source.seek).toHaveBeenCalledWith(8, undefined);
  });
});
