import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./BlocksTab.tsx", import.meta.url), "utf8");

describe("BlocksTab preview media fallback", () => {
  it("falls back from a broken poster to video without exposing alt text", () => {
    expect(source).toContain("setPosterFailed(true)");
    expect(source).toContain("setVideoFailed(true)");
    expect(source).toContain("hovered || !canShowPoster");
    expect(source).toContain('alt=""');
  });

  it("keeps preview media pinned to the card bounds", () => {
    expect(source).toContain('className="absolute inset-0 size-full object-cover"');
  });
});
