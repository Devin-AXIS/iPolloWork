import { describe, expect, it } from "vitest";
import { validateStructuredTextRecipe, type StructuredTextRecipe } from "./structuredTextMotion";
import {
  resolveBlendDifferenceStructuredRecipe,
  resolveGlitchRgbStructuredRecipe,
  resolveNeonAccentStructuredRecipe,
  resolveNeonGlowStructuredRecipe,
} from "./migratedCaptionRecipesB";

function tracksFor(recipe: StructuredTextRecipe, role: string) {
  return recipe.tracks.filter((track) => track.role === role);
}

function serializedProperties(recipe: StructuredTextRecipe): string {
  return JSON.stringify(recipe.tracks.flatMap((track) => track.keyframes.map((frame) => frame.properties)));
}

describe("migrated caption recipes B", () => {
  it("restores Neon Glow group entry and per-word cyan/magenta glow timing", () => {
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
      expect.objectContaining({ position: 0.95, duration: 0.1, stagger: 0 }),
    ]);
    expect(tracksFor(recipe, "unit")[0]?.keyframes[1]?.ease).toBe("steps(1)");
    expect(tracksFor(recipe, "unit")[1]?.keyframes[1]?.ease).toBe("power3.out");
    expect(tracksFor(recipe, "unit")[2]?.keyframes[1]?.ease).toBe("steps(1)");

    const textTracks = tracksFor(recipe, "text");
    expect(textTracks).toHaveLength(2);
    expect(textTracks[0]).toMatchObject({ position: 0, duration: 0.06, stagger: 0.3 });
    expect(textTracks[0]?.keyframes[0]?.properties.color).toBe("rgba(0,255,240,0.14)");
    expect(textTracks[0]?.keyframes[1]?.properties).toMatchObject({
      color: "#00FFF0",
      textShadow: "0 0 10px #00FFF0, 0 0 35px #00FFF0, 0 0 90px #00FFF0",
    });
    expect(textTracks[1]).toMatchObject({ position: 0.24, duration: 0.06, stagger: 0.3 });
    expect(serializedProperties(recipe)).toContain("#FF0099");
  });

  it("maps Neon Glow speed, colors, glow, and group duration without changing oracle ratios", () => {
    const recipe = resolveNeonGlowStructuredRecipe({
      speed: 2,
      colorSource: "custom",
      color: "#12ABCD",
      accentColor: "#EF0099",
      glow: 2,
      groupDuration: 2,
    });

    expect(tracksFor(recipe, "unit").map((track) => track.duration)).toEqual([0.025, 0.07, 0.05]);
    expect(tracksFor(recipe, "unit")[2]?.position).toBe(0.95);
    expect(serializedProperties(recipe)).toContain("0 0 20px #12ABCD, 0 0 70px #12ABCD, 0 0 180px #12ABCD");
    expect(serializedProperties(recipe)).toContain("#EF0099");
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
    expect(unitTracks[0]).toMatchObject({ position: 0, duration: 7 / 30, stagger: 0 });
    expect(unitTracks[0]?.keyframes).toEqual([
      expect.objectContaining({ properties: expect.objectContaining({ opacity: 0, scale: 0.65 }) }),
      expect.objectContaining({ ease: "power3.out", properties: expect.objectContaining({ opacity: 1, scale: 1 }) }),
    ]);
    expect(unitTracks[1]).toMatchObject({ position: 0, duration: (2 / 1.3) / 2, stagger: 0 });
    expect(unitTracks[1]?.keyframes[1]).toMatchObject({ ease: "sine.inOut", properties: { x: -14, y: -14 } });
    expect(unitTracks[2]).toMatchObject({ position: (2 / 1.3) / 2, duration: (2 / 1.3) / 2, stagger: 0 });
    expect(unitTracks[2]?.keyframes[1]).toMatchObject({ ease: "sine.inOut", properties: { x: 0, y: 0 } });

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
    expect(unitTracks.at(-1)).toMatchObject({ position: 0.9, duration: 0.1, stagger: 0 });
    expect(unitTracks.at(-1)?.keyframes[1]?.ease).toBe("power2.in");
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
    expect(unitTracks.slice(0, 5).map((track) => track.duration)).toEqual([0.06, 0.042, 0.078, 0.0225, 0.0375]);
    expect(unitTracks[1]?.keyframes[1]?.properties.x).toBe(-36);
    expect(serializedProperties(recipe)).toContain("#AA0033");
    expect(serializedProperties(recipe)).toContain("#00BBEE");
    expect(tracksFor(recipe, "texture")[0]?.keyframes[0]?.properties.opacity).toBe(0.8);
  });

  it("keeps Blend Difference as persistent whole-text styling without a flash timeline", () => {
    const recipe = resolveBlendDifferenceStructuredRecipe();

    expect(() => validateStructuredTextRecipe(recipe)).not.toThrow();
    expect(recipe).toMatchObject({
      id: "caption-blend-difference.persistent",
      presetId: "text.emphasis.blend-difference",
      split: "whole",
      layers: [
        { role: "unit", perUnit: true, className: "ipw-blend-difference-scope" },
        { role: "text", perUnit: true, className: "ipw-blend-difference-text" },
      ],
      tracks: [
        {
          role: "unit",
          position: 0,
          duration: 0,
          stagger: 0,
          keyframes: [{ percentage: 0, properties: { opacity: 1, mixBlendMode: "difference" } }],
        },
        {
          role: "text",
          position: 0,
          duration: 0,
          stagger: 0,
          keyframes: [{ percentage: 0, properties: { color: "#FFFFFF" } }],
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
      expect(tracksFor(recipe, "text")[0]?.keyframes[0]?.properties.color).toBe("#F4F4F4");
    }
  });
});
