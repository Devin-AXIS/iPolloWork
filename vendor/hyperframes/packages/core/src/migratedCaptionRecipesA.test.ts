import { describe, expect, it } from "vitest";
import { validateStructuredTextRecipe } from "./structuredTextMotion";
import {
  resolveClipWipeStructuredRecipe,
  resolveEditorialEmphasisStructuredRecipe,
  resolveGradientFillStructuredRecipe,
  resolveKaraokeFlowStructuredRecipe,
  resolveMatrixDecodeStructuredRecipe,
  resolveWeightShiftStructuredRecipe,
} from "./migratedCaptionRecipesA";

describe("migrated caption recipes A", () => {
  it("produces valid structured recipes for all migrated effects", () => {
    const recipes = [
      resolveMatrixDecodeStructuredRecipe(),
      resolveGradientFillStructuredRecipe(),
      resolveClipWipeStructuredRecipe(),
      resolveWeightShiftStructuredRecipe(),
      resolveEditorialEmphasisStructuredRecipe(),
      resolveKaraokeFlowStructuredRecipe(),
    ];

    for (const recipe of recipes) expect(() => validateStructuredTextRecipe(recipe)).not.toThrow();
  });

  it("settles Editorial Emphasis back into the authored text style", () => {
    const recipe = resolveEditorialEmphasisStructuredRecipe({
      direction: "left",
      distance: 40,
      blur: 8,
      emphasisWeight: 850,
      stagger: 0.08,
      colorSource: "theme",
    });

    expect(recipe).toMatchObject({
      id: "caption-editorial-emphasis.word-focus",
      presetId: "text.enter.editorial-emphasis",
      split: "word",
    });
    expect(recipe.tracks[0]?.keyframes[0]?.properties).toMatchObject({
      opacity: 0,
      x: -40,
      y: 0,
      filter: "blur(8px)",
    });
    expect(recipe.tracks[0]?.keyframes.at(-1)?.properties).toMatchObject({
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      filter: "blur(0px)",
    });
    expect(recipe.tracks[1]?.keyframes[1]?.properties).toMatchObject({
      color: "var(--ipw-color-accent, #20BBC0)",
      fontWeight: 850,
    });
    expect(recipe.tracks[1]?.keyframes.at(-1)?.properties).toMatchObject({
      color: "inherit",
      fontWeight: "inherit",
    });
  });

  it("hands Karaoke Flow across words and restores readable text", () => {
    const recipe = resolveKaraokeFlowStructuredRecipe({
      colorSource: "theme",
      stagger: 0.14,
      roundness: 14,
      lift: 9,
    });

    expect(recipe.layers.map(({ role }) => role)).toEqual(["unit", "background", "text"]);
    expect(recipe.tracks.every((track) => track.stagger === 0.14)).toBe(true);
    expect(recipe.tracks[0]?.keyframes[1]?.properties).toMatchObject({
      opacity: 1,
      backgroundColor: "var(--ipw-color-accent, #20BBC0)",
      borderRadius: "14px",
    });
    expect(recipe.tracks[1]?.keyframes[1]?.properties.y).toBe(-9);
    expect(recipe.tracks[2]?.keyframes.at(-1)?.properties).toMatchObject({
      color: "inherit",
      textShadow: "none",
    });
  });

  it("preserves Matrix Decode's two scramble states and 100ms ticks", () => {
    const recipe = resolveMatrixDecodeStructuredRecipe({
      color: "#00aa44",
      stagger: 0.07,
      speed: 2,
      density: 1.5,
      blur: 3,
      seed: 42,
    });

    expect(recipe).toMatchObject({
      id: "caption-matrix-decode.word-decode",
      presetId: "text.enter.matrix-decode",
      split: "word",
      seed: 42,
    });
    expect(recipe.layers.map(({ role }) => role)).toEqual([
      "unit",
      "clone-primary",
      "clone-accent",
      "text",
    ]);
    expect(recipe.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "clone-primary", position: 0, duration: 0, stagger: 0.07 }),
        expect.objectContaining({
          role: "clone-accent",
          position: 0.05,
          duration: 0,
          stagger: 0.07,
        }),
        expect.objectContaining({ role: "text", position: 0.1, duration: 0, stagger: 0.07 }),
      ]),
    );
    expect(recipe.tracks[0]?.keyframes[0]?.properties).toMatchObject({
      color: "#00aa44",
      filter: "blur(3px) contrast(1.75)",
      letterSpacing: "0.06em",
    });
  });

  it("sweeps Gradient Fill progressively and settles without a reset flash", () => {
    const recipe = resolveGradientFillStructuredRecipe({
      color: "#ff8800",
      accentColor: "#cc44ff",
      direction: "left",
      stagger: 0.08,
      speed: 2,
      intensity: 1.5,
      wordDuration: 0.4,
    });
    const sweep = recipe.tracks[0]!;

    expect(recipe.split).toBe("word");
    expect(sweep).toMatchObject({ role: "text", position: 0, duration: 0.275, stagger: 0.08 });
    expect(sweep.keyframes[0]).toMatchObject({
      percentage: 0,
      ease: "none",
      properties: {
        backgroundPosition: "55% 0",
        backgroundSize: "350% 100%",
        scale: 1,
      },
    });
    expect(String(sweep.keyframes[0]?.properties.backgroundImage)).toContain("#ff8800 0%");
    expect(String(sweep.keyframes[0]?.properties.backgroundImage)).toContain("#cc44ff 30%");
    expect(String(sweep.keyframes[0]?.properties.backgroundImage)).toContain("white 50.5%");
    expect(sweep.keyframes[1]).toMatchObject({
      percentage: expect.closeTo(72.727, 3),
      properties: { backgroundPosition: "100% 0", scale: 1.06 },
    });
    expect(sweep.keyframes.at(-1)).toMatchObject({
      percentage: 100,
      ease: "power2.out",
      properties: { backgroundPosition: "100% 0", scale: 1 },
    });
    expect(recipe.tracks).toHaveLength(1);
  });

  it("preserves Clip Wipe's reveal and gold accent while restoring readable text", () => {
    const recipe = resolveClipWipeStructuredRecipe({
      direction: "up",
      color: "#ffaa00",
      inactiveOpacity: 0.55,
      stagger: 0.06,
      speed: 2,
      holdDuration: 0.4,
    });

    expect(recipe.layers.map(({ role }) => role)).toEqual(["unit", "text"]);
    expect(recipe.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "text", position: 0, duration: 0.15, stagger: 0.06 }),
        expect.objectContaining({ role: "text", position: 0.05, duration: 0.025, stagger: 0.06 }),
        expect.objectContaining({ role: "text", position: 0.4, duration: 0.1, stagger: 0.06 }),
      ]),
    );
    expect(recipe.tracks[0]?.keyframes).toEqual([
      { percentage: 0, properties: { clipPath: "inset(100% 0% 0% 0%)", opacity: 1 } },
      {
        percentage: 100,
        ease: "power2.out",
        properties: { clipPath: "inset(0% 0% 0% 0%)", opacity: 1 },
      },
    ]);
    expect(recipe.tracks[1]?.keyframes.at(-1)?.properties.color).toBe("#ffaa00");
    expect(recipe.tracks[2]?.keyframes.at(-1)?.properties).toMatchObject({
      color: "inherit",
      opacity: 1,
    });
    expect(recipe.tracks.some((track) => track.role === "unit")).toBe(false);
  });

  it("preserves Weight Shift's entry and 100ms light-to-bold handoff", () => {
    const recipe = resolveWeightShiftStructuredRecipe({
      minWeight: 250,
      maxWeight: 750,
      stagger: 0.09,
      speed: 2,
      intensity: 1.4,
      switchPoint: 0.35,
    });

    expect(recipe).toMatchObject({
      id: "caption-weight-shift.word-handoff",
      presetId: "text.emphasis.weight-shift",
      split: "word",
    });
    expect(recipe.tracks[0]).toMatchObject({
      role: "unit",
      position: 0,
      duration: 0.05,
      stagger: 0.045,
    });
    expect(recipe.tracks[0]?.keyframes).toEqual([
      { percentage: 0, properties: { opacity: 1, scale: 0.79 } },
      { percentage: 100, ease: "power3.out", properties: { opacity: 1, scale: 1 } },
    ]);
    expect(recipe.tracks[1]).toMatchObject({
      role: "text",
      position: 0.35,
      duration: 0.05,
      stagger: 0.09,
    });
    expect(recipe.tracks[1]?.keyframes).toEqual([
      { percentage: 0, properties: { fontWeight: 250 } },
      { percentage: 100, ease: "power2.out", properties: { fontWeight: 750 } },
    ]);
  });
});
