import { describe, expect, test } from "bun:test";
import { listHyperframesCatalog, normalizeHyperframesCatalogItem } from "./hyperframes-catalog.js";

describe("HyperFrames catalog parameters", () => {
  test("normalizes legacy block params into composition variables", () => {
    const item = normalizeHyperframesCatalogItem({
      name: "legacy-effect",
      title: "Legacy effect",
      description: "Legacy parameter fixture",
      type: "hyperframes:block",
      tags: ["effect"],
      params: [
        {
          key: "--wave-intensity",
          label: "Wave intensity",
          type: "number",
          default: "1",
          min: 0,
          max: 3,
          step: 0.1,
        },
      ],
    });

    expect(item?.variables).toEqual([
      {
        id: "waveIntensity",
        label: "Wave intensity",
        type: "number",
        default: 1,
        min: 0,
        max: 3,
        step: 0.1,
        update: "live",
      },
    ]);
  });

  test("exposes the bundled GSAP effect variable contract", async () => {
    const item = (await listHyperframesCatalog()).find(
      (candidate) => candidate.name === "vfx-liquid-background",
    );

    expect(item?.engine).toEqual({ name: "gsap", version: "3.14.2", seekable: true });
    expect(item?.variables.map((variable) => variable.id)).toEqual([
      "backgroundColor",
      "textColor",
      "waveIntensity",
      "animationSpeed",
      "duration",
      "ease",
    ]);
    expect(item?.variables.find((variable) => variable.id === "duration")?.update).toBe("rebuild");
  });
});
