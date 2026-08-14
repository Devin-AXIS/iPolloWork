import { describe, expect, it } from "vitest";
import { validateStructuredTextRecipe, type StructuredTextRecipe } from "./structuredTextMotion";
import {
  resolveBlendDifferenceStructuredRecipe,
  resolveCameraTrackStructuredRecipe,
  resolveGlitchRgbStructuredRecipe,
  resolveNeonAccentStructuredRecipe,
  resolveNeonGlowStructuredRecipe,
  resolveVisualLayersStructuredRecipe,
} from "./migratedCaptionRecipesB";

function tracksFor(recipe: StructuredTextRecipe, role: string) {
  return recipe.tracks.filter((track) => track.role === role);
}

function serializedProperties(recipe: StructuredTextRecipe): string {
  return JSON.stringify(
    recipe.tracks.flatMap((track) => track.keyframes.map((frame) => frame.properties)),
  );
}

describe("migrated caption recipes B", () => {
  it("resolves Camera Track from depth into the authored position", () => {
    const recipe = resolveCameraTrackStructuredRecipe({
      direction: "right",
      distance: 60,
      blur: 10,
      stagger: 0.07,
    });

    expect(() => validateStructuredTextRecipe(recipe)).not.toThrow();
    expect(recipe).toMatchObject({
      id: "caption-camera-track.depth-resolve",
      presetId: "text.enter.camera-track",
      split: "word",
    });
    expect(recipe.tracks[0]?.keyframes[0]?.properties).toMatchObject({
      opacity: 0.12,
      x: 60,
      y: 0,
      filter: "blur(10px)",
    });
    expect(recipe.tracks[0]?.keyframes.at(-1)?.properties).toMatchObject({
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      filter: "blur(0px)",
    });
  });

  it("converges Visual Layers without leaving duplicate text visible", () => {
    const recipe = resolveVisualLayersStructuredRecipe({
      colorSource: "theme",
      distance: 20,
      blur: 5,
      stagger: 0.06,
    });

    expect(() => validateStructuredTextRecipe(recipe)).not.toThrow();
    expect(recipe.layers.map(({ role }) => role)).toEqual([
      "unit",
      "clone-primary",
      "clone-accent",
      "text",
    ]);
    expect(tracksFor(recipe, "clone-primary")[0]?.keyframes[0]?.properties).toMatchObject({
      color: "var(--ipw-color-primary, #5B6CFF)",
      opacity: 0.68,
      x: -20,
    });
    expect(tracksFor(recipe, "clone-accent")[0]?.keyframes[0]?.properties).toMatchObject({
      color: "var(--ipw-color-accent, #20BBC0)",
      opacity: 0.68,
      x: 20,
    });
    expect(tracksFor(recipe, "clone-primary")[0]?.keyframes.at(-1)?.properties.opacity).toBe(0);
    expect(tracksFor(recipe, "clone-accent")[0]?.keyframes.at(-1)?.properties.opacity).toBe(0);
    expect(tracksFor(recipe, "text")[0]?.keyframes.at(-1)?.properties.opacity).toBe(1);
  });

  it("runs Neon Glow as one smooth per-word color progression", () => {
    const recipe = resolveNeonGlowStructuredRecipe({ stagger: 0.3 });

    expect(() => validateStructuredTextRecipe(recipe)).not.toThrow();
    expect(recipe).toMatchObject({
      version: 1,
      id: "caption-neon-glow.word-timing",
      presetId: "text.emphasis.neon-glow",
      split: "word",
      layers: [
        { role: "unit", perUnit: true, className: "ipw-neon-glow-word" },
        { role: "text", perUnit: true, className: "ipw-neon-glow-text" },
      ],
    });

    expect(tracksFor(recipe, "unit")).toEqual([
      expect.objectContaining({ position: 0, duration: 0.05, stagger: 0 }),
      expect.objectContaining({ position: 0.05, duration: 0.14, stagger: 0 }),
    ]);
    expect(tracksFor(recipe, "unit")[0]?.keyframes[1]?.ease).toBe("steps(1)");
    expect(tracksFor(recipe, "unit")[1]?.keyframes[1]?.ease).toBe("power3.out");
    expect(tracksFor(recipe, "unit")[0]?.keyframes[0]?.properties.opacity).toBe(1);

    const textTracks = tracksFor(recipe, "text");
    expect(textTracks).toHaveLength(1);
    expect(textTracks[0]).toMatchObject({ position: 0, duration: 0.34, stagger: 0.3 });
    expect(textTracks[0]?.keyframes[0]?.properties.color).toBe("rgba(0,255,240,0.14)");
    expect(textTracks[0]?.keyframes[1]?.properties).toMatchObject({
      color: "#FF0099",
      textShadow: "0 0 8px #FF0099, 0 0 28px #FF0099, 0 0 72px #FF0099",
    });
    expect(textTracks[0]?.keyframes[2]?.properties).toMatchObject({
      color: "#00FFF0",
      textShadow: "0 0 4.5px #00FFF0, 0 0 15.75px #00FFF0, 0 0 40.5px #00FFF0",
    });
  });

  it("maps Neon Glow speed, colors, and glow without adding a hidden exit", () => {
    const recipe = resolveNeonGlowStructuredRecipe({
      speed: 2,
      colorSource: "custom",
      color: "#12ABCD",
      accentColor: "#EF0099",
      glow: 2,
      groupDuration: 2,
    });

    expect(tracksFor(recipe, "unit").map((track) => track.duration)).toEqual([0.025, 0.07]);
    expect(serializedProperties(recipe)).toContain(
      "0 0 16px #EF0099, 0 0 56px #EF0099, 0 0 144px #EF0099",
    );
    expect(serializedProperties(recipe)).toContain(
      "0 0 9px #12ABCD, 0 0 31.5px #12ABCD, 0 0 81px #12ABCD",
    );
  });

  it("restores Neon Accent pop, static color channels, and diagonal wiggle cycle", () => {
    const recipe = resolveNeonAccentStructuredRecipe();

    expect(() => validateStructuredTextRecipe(recipe)).not.toThrow();
    expect(recipe).toMatchObject({
      id: "caption-neon-accent.group-wiggle",
      presetId: "text.emphasis.neon-accent",
      split: "word",
      layers: [
        { role: "unit", perUnit: true },
        { role: "text", perUnit: true },
        { role: "clone-primary", perUnit: true },
        { role: "clone-accent", perUnit: true },
      ],
    });

    const unitTracks = tracksFor(recipe, "unit");
    expect(unitTracks[0]).toMatchObject({ position: 0, duration: 7 / 30, stagger: 0.08 });
    expect(unitTracks[0]?.keyframes).toEqual([
      expect.objectContaining({ properties: expect.objectContaining({ opacity: 1, scale: 0.65 }) }),
      expect.objectContaining({
        ease: "power3.out",
        properties: expect.objectContaining({ opacity: 1, scale: 1 }),
      }),
    ]);
    expect(unitTracks[1]).toMatchObject({ position: 0, duration: 2 / 1.3 / 2, stagger: 0.08 });
    expect(unitTracks[1]?.keyframes[1]).toMatchObject({
      ease: "sine.inOut",
      properties: { x: -14, y: -14 },
    });
    expect(unitTracks[2]).toMatchObject({
      position: 2 / 1.3 / 2,
      duration: 2 / 1.3 / 2,
      stagger: 0.08,
    });
    expect(unitTracks[2]?.keyframes[1]).toMatchObject({
      ease: "sine.inOut",
      properties: { x: 0, y: 0 },
    });

    const properties = serializedProperties(recipe);
    for (const color of ["#FFFFFF", "#53FF01", "#FF0002", "#FCFF00"]) {
      expect(properties).toContain(color);
    }
    expect(properties).toContain("0 0 4px");
    expect(properties).toContain("0 0 40px");
  });

  it("restores Glitch RGB overlay, scanlines, channel layers, snap, and aftershock cadence", () => {
    const recipe = resolveGlitchRgbStructuredRecipe();

    expect(() => validateStructuredTextRecipe(recipe)).not.toThrow();
    expect(recipe).toMatchObject({
      id: "caption-glitch-rgb.word-snap",
      presetId: "text.emphasis.rgb-glitch",
      split: "word",
      layers: expect.arrayContaining([
        { role: "background", perUnit: false, className: "ipw-glitch-overlay" },
        { role: "texture", perUnit: false, className: "ipw-glitch-scanlines" },
        { role: "text", perUnit: true, className: "ipw-glitch-text" },
        { role: "clone-primary", perUnit: true, className: "ipw-glitch-red-channel" },
        { role: "clone-accent", perUnit: true, className: "ipw-glitch-cyan-channel" },
      ]),
    });

    const globalProperties = serializedProperties(recipe);
    expect(globalProperties).toContain("rgba(0, 0, 0, 0.08)");
    expect(globalProperties).toContain("rgba(0, 0, 0, 0.5)");
    expect(globalProperties).toContain("transparent 3px");
    expect(globalProperties).toContain("rgba(0, 0, 0, 0.16) 4px");
    expect(globalProperties).toContain("#ff003c");
    expect(globalProperties).toContain("#00e5ff");

    const unitTracks = tracksFor(recipe, "unit");
    expect(unitTracks[0]).toMatchObject({ position: 0, duration: 0.12, stagger: 0 });
    expect(unitTracks[0]?.keyframes[1]?.ease).toBe("power2.out");
    expect(unitTracks[1]).toMatchObject({ position: 0, duration: 0.084, stagger: 0.04 });
    expect(unitTracks[1]?.keyframes[1]?.ease).toBe("none");
    expect(unitTracks[2]).toMatchObject({ position: 0.084, duration: 0.156, stagger: 0.04 });
    expect(unitTracks[2]?.keyframes[1]?.ease).toBe("power3.out");
    expect(unitTracks[3]).toMatchObject({ position: 0.32, duration: 0.045, stagger: 0.04 });
    expect(unitTracks[4]).toMatchObject({ position: 0.365, duration: 0.075, stagger: 0.04 });
    expect(unitTracks).toHaveLength(5);
    expect(serializedProperties(recipe)).not.toContain('"visibility":"hidden"');
  });

  it("maps Glitch RGB speed, amplitude, density, channel colors, and scanline opacity", () => {
    const recipe = resolveGlitchRgbStructuredRecipe({
      speed: 2,
      intensity: 2,
      density: 1.5,
      colorSource: "custom",
      color: "#AA0033",
      accentColor: "#00BBEE",
      scanlineOpacity: 0.8,
    });

    const unitTracks = tracksFor(recipe, "unit");
    expect(unitTracks.slice(0, 5).map((track) => track.duration)).toEqual([
      0.06, 0.042, 0.078, 0.0225, 0.0375,
    ]);
    expect(unitTracks[1]?.keyframes[1]?.properties.x).toBe(-36);
    expect(serializedProperties(recipe)).toContain("#AA0033");
    expect(serializedProperties(recipe)).toContain("#00BBEE");
    expect(tracksFor(recipe, "texture")[0]?.keyframes[0]?.properties.opacity).toBe(0.8);
  });

  it("sweeps Blend Difference forward across a phrase word by word", () => {
    const recipe = resolveBlendDifferenceStructuredRecipe();

    expect(() => validateStructuredTextRecipe(recipe)).not.toThrow();
    expect(recipe).toMatchObject({
      id: "caption-blend-difference.persistent",
      presetId: "text.emphasis.blend-difference",
      split: "word",
      layers: [
        { role: "unit", perUnit: true, className: "ipw-blend-difference-scope" },
        { role: "text", perUnit: true, className: "ipw-blend-difference-text" },
      ],
      tracks: [
        {
          role: "unit",
          position: 0,
          duration: 0.18,
          stagger: 0.08,
          keyframes: [
            { percentage: 0, properties: { opacity: 0.45, mixBlendMode: "difference" } },
            expect.objectContaining({
              percentage: 100,
              properties: { opacity: 1, mixBlendMode: "difference" },
            }),
          ],
        },
        {
          role: "text",
          position: 0,
          duration: 0.18,
          stagger: 0.08,
          keyframes: [
            { percentage: 0, properties: { color: "rgba(255,255,255,0.35)" } },
            expect.objectContaining({ percentage: 100, properties: { color: "#FFFFFF" } }),
          ],
        },
      ],
    });
    expect(serializedProperties(recipe)).not.toContain("invert(");
    expect(serializedProperties(recipe)).not.toContain("blur(");
  });

  it("maps Blend Difference variants and custom caption color", () => {
    for (const blendMode of ["difference", "exclusion", "screen"] as const) {
      const recipe = resolveBlendDifferenceStructuredRecipe({
        blendMode,
        colorSource: "custom",
        color: "#F4F4F4",
      });
      expect(tracksFor(recipe, "unit")[0]?.keyframes[0]?.properties.mixBlendMode).toBe(blendMode);
      expect(tracksFor(recipe, "text")[0]?.keyframes.at(-1)?.properties.color).toBe("#F4F4F4");
    }
  });
});
