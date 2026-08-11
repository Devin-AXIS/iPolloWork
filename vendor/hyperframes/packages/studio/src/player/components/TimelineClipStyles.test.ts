import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("TimelineClip styles", () => {
  it("hides custom clip headers inside micro clips", () => {
    const styles = readFileSync(new URL("../../styles/studio.css", import.meta.url), "utf8");

    expect(styles).toContain(".timeline-clip.is-micro .hf-timeline-clip-content__header");
    expect(styles).toContain(".timeline-clip.is-micro .hf-timeline-clip-content__timecode");
  });
});
