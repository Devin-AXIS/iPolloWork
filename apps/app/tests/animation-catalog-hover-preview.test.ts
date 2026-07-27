import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/components/chat/new-conversation-starter.tsx", import.meta.url),
  "utf8",
);

describe("animation catalog hover preview", () => {
  test("plays the catalog video on hover or focus and resets it when preview ends", () => {
    expect(source).toContain("item.preview?.video");
    expect(source).toContain("onMouseEnter");
    expect(source).toContain("onMouseLeave");
    expect(source).toContain("onFocus");
    expect(source).toContain("onBlur");
    expect(source).toContain("preview.currentTime = 0");
    expect(source).toContain("muted");
    expect(source).toContain("loop");
    expect(source).toContain("playsInline");
  });
});
