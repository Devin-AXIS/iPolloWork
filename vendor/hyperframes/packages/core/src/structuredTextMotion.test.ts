import { describe, expect, it } from "vitest";
import { compileMotionInstance, createMotionInstance, getMotionPreset } from "./motionPresets";
import {
  compileStructuredTextMotion,
  createStructuredTextRng,
  isStructuredTextPreset,
  segmentStructuredText,
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
    expect(createStructuredTextRng("stable-seed")()).toBe(createStructuredTextRng("stable-seed")());
    expect(compileStructuredTextMotion(createTextInstance(), "Motion stays clear", recipe())).toEqual(
      compileStructuredTextMotion(createTextInstance(), "Motion stays clear", recipe()),
    );
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
