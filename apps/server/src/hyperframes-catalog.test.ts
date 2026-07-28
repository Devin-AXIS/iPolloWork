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

  test("detects and classifies the complete bundled GSAP runtime catalog", async () => {
    const catalog = await listHyperframesCatalog();
    const gsapItems = catalog.filter((item) => item.engine?.name === "gsap");
    const animations = gsapItems.filter((item) => item.kind === "animation");
    const effects = gsapItems.filter((item) => item.kind === "effect");

    expect(gsapItems).toHaveLength(129);
    expect(animations).toHaveLength(69);
    expect(effects).toHaveLength(60);
    expect(gsapItems.every((item) => item.source?.provider === "hyperframes")).toBe(true);
    expect(gsapItems.find((item) => item.name === "app-showcase")?.engine?.version).toBe("3.14.2");
    expect(gsapItems.find((item) => item.name === "gsap-scrolltrigger-story")?.engine?.plugins).toEqual(["ScrollTrigger"]);
    expect(gsapItems.find((item) => item.name === "gsap-splittext-reveal")?.engine?.plugins).toEqual(["SplitText"]);
    expect(gsapItems.find((item) => item.name === "gsap-morphsvg-shape")?.engine?.plugins).toEqual(["MorphSVGPlugin"]);
  });
});
