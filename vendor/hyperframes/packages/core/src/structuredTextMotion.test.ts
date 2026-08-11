import { describe, expect, it } from "vitest";
import { compileMotionInstance, createMotionInstance, getMotionPreset } from "./motionPresets";
import {
  compileStructuredTextMotion,
  createStructuredTextRng,
  isStructuredTextPreset,
  segmentStructuredText,
  segmentStructuredTextFallback,
  structuredMotionSelector,
  validateStructuredTextRecipe,
  type StructuredTextRecipe,
} from "./structuredTextMotion";

function createTextInstance() {
  return createMotionInstance({
    presetId: "text.emphasis.highlight-sweep",
    target: { selector: "#headline", elementId: "headline" },
    targetKind: "text",
    start: 1.25,
    duration: 0.8,
    parameters: { unit: "word", stagger: 0.05 },
  });
}

function recipe(overrides: Partial<StructuredTextRecipe> = {}): StructuredTextRecipe {
  return {
    version: 1,
    id: "test.recipe",
    presetId: "text.emphasis.highlight-sweep",
    split: "word",
    layers: [
      { role: "unit", perUnit: true, className: "ipw-motion-unit" },
      { role: "background", perUnit: true, className: "ipw-motion-background" },
      { role: "text", perUnit: true, className: "ipw-motion-text" },
    ],
    tracks: [
      {
        role: "background",
        position: 0,
        duration: 0.5,
        stagger: 0.05,
        keyframes: [
          { percentage: 0, properties: { opacity: 0, scaleX: 0, transformOrigin: "0% 50%" } },
          { percentage: 100, properties: { opacity: 1, scaleX: 1 } },
        ],
      },
      {
        role: "text",
        position: 0,
        duration: 0.5,
        stagger: 0.05,
        keyframes: [
          { percentage: 0, properties: { opacity: 0 } },
          { percentage: 100, properties: { opacity: 1 } },
        ],
      },
    ],
    ...overrides,
  };
}

describe("structured text motion", () => {
  it("compiles an allow-listed per-word recipe", () => {
    const compiled = compileStructuredTextMotion(
      createTextInstance(),
      "Make motion clear",
      recipe(),
    );

    expect(compiled).toMatchObject({
      version: 1,
      recipeId: "test.recipe",
      split: "word",
      units: [{ sourceText: "Make" }, { sourceText: "motion" }, { sourceText: "clear" }],
      layers: expect.arrayContaining([
        expect.objectContaining({ role: "unit", perUnit: true }),
        expect.objectContaining({ role: "background", perUnit: true }),
        expect.objectContaining({ role: "text", perUnit: true }),
      ]),
      tracks: expect.arrayContaining([
        expect.objectContaining({ role: "background", stagger: 0.05 }),
        expect.objectContaining({ role: "text", stagger: 0.05 }),
      ]),
    });
  });

  it("rejects unknown roles, properties, and unsafe particle counts", () => {
    expect(() =>
      validateStructuredTextRecipe(
        recipe({ layers: [{ role: "script" as never, perUnit: true, className: "bad-layer" }] }),
      ),
    ).toThrow(/role/i);

    expect(() =>
      validateStructuredTextRecipe(
        recipe({
          tracks: [
            {
              role: "unit",
              position: 0,
              duration: 0.5,
              stagger: 0,
              keyframes: [
                { percentage: 0, properties: { dangerouslySetInnerHTML: "no" } },
                { percentage: 100, properties: { opacity: 1 } },
              ],
            },
          ],
        }),
      ),
    ).toThrow(/property/i);

    expect(() =>
      validateStructuredTextRecipe(
        recipe({
          particles: { count: 97, x: [-30, 30], y: [-30, 30], size: [2, 6], delay: [0, 0.2] },
        }),
      ),
    ).toThrow(/96/);
  });

  it("rejects non-primitive keyframe values and unsafe ease strings", () => {
    const invalidValues: unknown[] = [true, {}, [], () => undefined, Symbol("value"), 1n, null, undefined];
    for (const value of invalidValues) {
      expect(() =>
        validateStructuredTextRecipe(
          recipe({
            tracks: [
              {
                role: "unit",
                position: 0,
                duration: 0.5,
                stagger: 0,
                keyframes: [
                  { percentage: 0, properties: { opacity: value } as never },
                  { percentage: 100, properties: { opacity: 1 } },
                ],
              },
            ],
          }),
        ),
      ).toThrow(/value/i);
    }

    expect(() =>
      validateStructuredTextRecipe(
        recipe({
          tracks: [
            {
              role: "unit",
              position: 0,
              duration: 0.5,
              stagger: 0,
              keyframes: [
                { percentage: 0, ease: (() => undefined) as never, properties: { opacity: 0 } },
                { percentage: 100, properties: { opacity: 1 } },
              ],
            },
          ],
        }),
      ),
    ).toThrow(/ease/i);

    expect(() =>
      validateStructuredTextRecipe(
        recipe({
          tracks: [
            {
              role: "unit",
              position: 0,
              duration: 0.5,
              stagger: 0,
              keyframes: [
                { percentage: 0, ease: "power2.out; alert(1)", properties: { opacity: 0 } },
                { percentage: 100, properties: { opacity: 1 } },
              ],
            },
          ],
        }),
      ),
    ).toThrow(/ease/i);
  });

  it("accepts only bounded registry-relative assets", () => {
    expect(() => validateStructuredTextRecipe(recipe({ assets: ["textures/noise.png"] }))).toThrow(/asset/i);
    expect(() => validateStructuredTextRecipe(recipe({ assets: [""] }))).toThrow(/asset/i);
    expect(() => validateStructuredTextRecipe(recipe({ assets: ["/registry/noise.png"] }))).toThrow(/asset/i);
    expect(() => validateStructuredTextRecipe(recipe({ assets: ["\\registry\\noise.png"] }))).toThrow(/asset/i);
    expect(() => validateStructuredTextRecipe(recipe({ assets: ["//registry/noise.png"] }))).toThrow(/asset/i);
    expect(() => validateStructuredTextRecipe(recipe({ assets: ["registry/../noise.png"] }))).toThrow(/asset/i);
    expect(() => validateStructuredTextRecipe(recipe({ assets: ["registry/./noise.png"] }))).toThrow(/asset/i);
    expect(() => validateStructuredTextRecipe(recipe({ assets: ["https://example.test/noise.png"] }))).toThrow(/asset/i);
    expect(() => validateStructuredTextRecipe(recipe({ assets: Array.from({ length: 9 }, () => "registry/noise.png") }))).toThrow(/asset/i);
    expect(() => validateStructuredTextRecipe(recipe({ assets: ["registry/" + "a".repeat(257)] }))).toThrow(/asset/i);
    expect(() => validateStructuredTextRecipe(recipe({ assets: ["registry/textures/noise.png"] }))).not.toThrow();
  });

  it("segments text and random values deterministically", () => {
    expect(segmentStructuredText("Motion stays clear", "word")).toEqual([
      "Motion",
      "stays",
      "clear",
    ]);
    expect(segmentStructuredText("A B", "character")).toEqual(["A", " ", "B"]);
    expect(segmentStructuredText("A \u{1F44F}\u{1F3FD}", "character")).toEqual([
      "A",
      " ",
      "\u{1F44F}\u{1F3FD}",
    ]);
    expect(segmentStructuredTextFallback("A \u{1F44F}\u{1F3FD}", "character")).toEqual([
      "A",
      " ",
      "\u{1F44F}\u{1F3FD}",
    ]);
    expect(segmentStructuredTextFallback("e\u{301}", "character")).toEqual(["e\u{301}"]);
    expect(segmentStructuredText("Don't stop", "word")).toEqual(
      segmentStructuredTextFallback("Don't stop", "word"),
    );
    expect(segmentStructuredText("\u{1F1E8}\u{1F1F3}\u{1F1FA}\u{1F1F8}", "character")).toEqual([
      "\u{1F1E8}\u{1F1F3}",
      "\u{1F1FA}\u{1F1F8}",
    ]);
    expect(segmentStructuredText("\u{1100}\u{1161}\u{11A8}", "character")).toEqual([
      "\u{1100}\u{1161}\u{11A8}",
    ]);
    expect(
      segmentStructuredTextFallback(
        "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}",
        "character",
      ),
    ).toEqual(["\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}"]);
    expect(createStructuredTextRng("stable-seed")()).toBe(createStructuredTextRng("stable-seed")());
    const particleRecipe = recipe({
      seed: "stable-particles",
      particles: { count: 2, x: [-10, 10], y: [-10, 10], size: [2, 6], delay: [0, 0.2] },
    });
    expect(compileStructuredTextMotion(createTextInstance(), "Motion stays clear", particleRecipe)).toEqual(
      compileStructuredTextMotion(createTextInstance(), "Motion stays clear", particleRecipe),
    );
    expect(compileStructuredTextMotion(createTextInstance(), "", particleRecipe)?.particles).toBeUndefined();
  });

  it("keeps ordinary presets on the existing unstructured path", () => {
    const preset = getMotionPreset("element.enter.fade")!;
    const instance = createMotionInstance({
      presetId: preset.id,
      target: { selector: "#card" },
      targetKind: "element",
      start: 0,
    });
    const compiled = compileMotionInstance(instance, "Unchanged");

    expect(isStructuredTextPreset(preset)).toBe(false);
    expect(compileStructuredTextMotion(instance, "Unchanged")).toBeUndefined();
    expect(compiled.structured).toBeUndefined();
    expect(compiled.keyframes.length).toBeGreaterThan(0);
  });

  it("builds stable selectors for generated roles", () => {
    expect(structuredMotionSelector("#headline", "background")).toBe(
      '#headline [data-ipw-motion-role="background"]',
    );
  });
});
