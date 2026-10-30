import { describe, expect, it } from "vitest";
import { shouldIgnorePlaybackShortcutTarget } from "./playbackShortcuts";

describe("playback shortcut ownership", () => {
  it.each([
    "[data-playback-shortcuts='off']",
    "[role='separator']",
    "input",
    "button",
  ])("leaves keyboard input with %s", (selector) => {
    const target = Object.assign(new EventTarget(), {
      closest: (selectors: string) =>
        selectors.split(",").includes(selector) ? {} : null,
    });
    expect(shouldIgnorePlaybackShortcutTarget(target)).toBe(true);
  });

  it("continues to accept shortcuts outside interactive controls", () => {
    const target = Object.assign(new EventTarget(), { closest: () => null });
    expect(shouldIgnorePlaybackShortcutTarget(target)).toBe(false);
    expect(shouldIgnorePlaybackShortcutTarget(null)).toBe(false);
  });
});
