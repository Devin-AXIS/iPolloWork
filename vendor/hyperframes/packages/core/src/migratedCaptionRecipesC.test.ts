import { describe, expect, it } from "vitest";
import { validateStructuredTextRecipe } from "./structuredTextMotion.js";
import {
  resolveEmojiPopStructuredRecipe,
  resolveKineticSlamStructuredRecipe,
  resolveParticleBurstStructuredRecipe,
  resolveTextureFillStructuredRecipe,
} from "./migratedCaptionRecipesC.js";

describe("migrated caption recipes C", () => {
  it("preserves the texture mask asset and oracle entrance, sweep, and exit timing", () => {
    const recipe = resolveTextureFillStructuredRecipe({
      unit: "word",
      stagger: 0.07,
      speed: 2,
      texture: "lava",
    });

    expect(() => validateStructuredTextRecipe(recipe)).not.toThrow();
    expect(recipe).toMatchObject({
      id: "caption-texture.word-mask-sweep",
      presetId: "text.emphasis.texture-fill",
      split: "word",
      assets: ["registry/components/caption-texture/lava.png"],
    });
    expect(recipe.layers.map((layer) => layer.role)).toEqual(["unit", "text"]);
    expect(recipe.tracks).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "unit", position: 0, duration: 0.09, stagger: 0.07 }),
      expect.objectContaining({ role: "text", position: 0, duration: 0.2, stagger: 0.07 }),
      expect.objectContaining({ role: "unit", position: 0.15, duration: 0.05, stagger: 0.07 }),
      expect.objectContaining({ role: "unit", position: 0.2, duration: 0, stagger: 0.07 }),
    ]));
    expect(recipe.tracks[0]?.keyframes[1]?.ease).toBe("power3.out");
    expect(recipe.tracks[1]?.keyframes[1]).toMatchObject({
      ease: "sine.inOut",
      properties: { backgroundPosition: "100% 50%" },
    });
    expect(recipe.tracks[2]?.keyframes[1]?.ease).toBe("power2.in");
  });

  it.each([
    ["up", { x: 0, y: -120, scale: 1 }, 0.22, "back.out(1.7)"],
    ["left", { x: -300, y: 0, scale: 1 }, 0.2, "expo.out"],
    ["right", { x: 300, y: 0, scale: 1 }, 0.2, "expo.out"],
    ["down", { x: 0, y: 0, scale: 0.4 }, 0.24, "back.out(2.2)"],
  ])("maps kinetic direction %s to an original entrance mode", (direction, from, duration, ease) => {
    const recipe = resolveKineticSlamStructuredRecipe({ direction, stagger: 0.05 });

    expect(() => validateStructuredTextRecipe(recipe)).not.toThrow();
    expect(recipe.split).toBe("word");
    expect(recipe.tracks[0]).toMatchObject({ role: "unit", duration, stagger: 0.05 });
    expect(recipe.tracks[0]?.keyframes[0]?.properties).toMatchObject(from);
    expect(recipe.tracks[0]?.keyframes[1]?.ease).toBe(ease);
    expect(recipe.tracks[1]).toMatchObject({ role: "unit", position: duration, duration: 0.1 });
    expect(recipe.tracks[1]?.keyframes[1]?.ease).toBe("power2.in");
  });

  it("preserves Emoji Pop squash timings and the original accent palette", () => {
    const recipe = resolveEmojiPopStructuredRecipe({ stagger: 0.1, speed: 2 });

    expect(() => validateStructuredTextRecipe(recipe)).not.toThrow();
    expect(recipe).toMatchObject({
      id: "caption-emoji-pop.group-squash",
      presetId: "text.emphasis.emoji-pop",
      split: "word",
    });
    expect(recipe.layers.map((layer) => layer.role)).toEqual(["unit", "text", "clone-accent"]);
    expect(recipe.tracks[0]).toMatchObject({ duration: 2 / 30, stagger: 0.1 });
    expect(recipe.tracks[0]?.keyframes).toEqual([
      expect.objectContaining({ properties: expect.objectContaining({ opacity: 0, scaleX: 0.8 }) }),
      expect.objectContaining({ ease: "power3.out", properties: expect.objectContaining({ opacity: 1, scaleX: 1 }) }),
    ]);
    expect(recipe.tracks[1]).toMatchObject({ position: 2 / 30, duration: 1.5 / 30 });
    expect(recipe.tracks[1]?.keyframes[1]?.ease).toBe("power2.in");
    expect(recipe.tracks.find((track) => track.role === "clone-accent")?.keyframes[0]?.properties)
      .toMatchObject({ color: "#FF76FF" });
  });

  it("creates deterministic real particles with oracle burst and fade timing", () => {
    const recipe = resolveParticleBurstStructuredRecipe({ density: 1.5, stagger: 0.09, speed: 2 });

    expect(() => validateStructuredTextRecipe(recipe)).not.toThrow();
    expect(recipe).toMatchObject({
      id: "caption-particle-burst.radial-word-burst",
      presetId: "text.emphasis.particle-burst",
      split: "word",
      seed: "caption-particle-burst",
      particles: {
        count: 15,
        x: [-320, 320],
        y: [-320, 320],
        size: [4, 12],
        delay: [0, 0],
      },
    });
    expect(recipe.layers.map((layer) => layer.role)).toEqual([
      "unit", "text", "particle-container", "particle",
    ]);
    const particleTrack = recipe.tracks.find((track) => track.role === "particle" && track.duration > 0);
    expect(particleTrack).toMatchObject({ position: 0, duration: 0.285, stagger: 0.009 });
    expect(particleTrack?.keyframes[1]).toMatchObject({
      percentage: expect.closeTo(21.0526, 3),
      ease: "power3.out",
      properties: { opacity: 1 },
    });
    expect(particleTrack?.keyframes[2]?.ease).toBe("power1.in");
    expect(recipe.tracks).toContainEqual(expect.objectContaining({
      role: "particle", position: 0.35, duration: 0,
    }));
  });
});
