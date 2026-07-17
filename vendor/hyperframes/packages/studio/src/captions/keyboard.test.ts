import { describe, expect, it } from "vitest";
import { shouldHandleCaptionNudgeKey } from "./keyboard";

function mockKeyboardEvent(
  key: string,
  overrides: Partial<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey">> = {},
): Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "key"> {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    key,
    ...overrides,
  };
}

describe("shouldHandleCaptionNudgeKey", () => {
  it("handles plain and Shift-modified arrow keys for caption nudging", () => {
    expect(shouldHandleCaptionNudgeKey(mockKeyboardEvent("ArrowLeft"))).toBe(true);
    expect(shouldHandleCaptionNudgeKey(mockKeyboardEvent("ArrowRight"))).toBe(true);
  });

  it("ignores browser and app shortcut chords", () => {
    expect(shouldHandleCaptionNudgeKey(mockKeyboardEvent("ArrowLeft", { altKey: true }))).toBe(
      false,
    );
    expect(shouldHandleCaptionNudgeKey(mockKeyboardEvent("ArrowRight", { ctrlKey: true }))).toBe(
      false,
    );
    expect(shouldHandleCaptionNudgeKey(mockKeyboardEvent("ArrowRight", { metaKey: true }))).toBe(
      false,
    );
  });

  it("ignores non-arrow keys", () => {
    expect(shouldHandleCaptionNudgeKey(mockKeyboardEvent("KeyL"))).toBe(false);
  });
});
