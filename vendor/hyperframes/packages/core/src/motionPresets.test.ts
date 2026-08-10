import { describe, expect, it } from "vitest";
import {
  MOTION_PRESETS,
  compileMotionInstance,
  createMotionInstance,
  listMotionPresets,
  readMotionInstanceFromExtras,
  validateMotionParameters,
} from "./motionPresets";

describe("motion presets", () => {
  it("ships stable text and element presets across all three phases", () => {
    expect(MOTION_PRESETS).toHaveLength(29);
    expect(new Set(MOTION_PRESETS.map((preset) => preset.id)).size).toBe(29);
    expect(listMotionPresets({ targetKind: "text", phase: "enter" })).toHaveLength(8);
    expect(listMotionPresets({ targetKind: "text", phase: "emphasis" })).toHaveLength(6);
    expect(listMotionPresets({ targetKind: "text", phase: "exit" })).toHaveLength(6);
    expect(listMotionPresets({ targetKind: "element", phase: "enter" })).toHaveLength(3);
    expect(listMotionPresets({ targetKind: "element", phase: "emphasis" })).toHaveLength(3);
    expect(listMotionPresets({ targetKind: "element", phase: "exit" })).toHaveLength(3);
    expect(
      listMotionPresets({ targetKind: "text", phase: "enter", tone: "modern" }).map(
        (preset) => preset.id,
      ),
    ).toContain("text.enter.rise");
    expect(
      listMotionPresets({ targetKind: "text", phase: "enter", intent: "title reveal" }),
    ).not.toHaveLength(0);
  });

  it("reuses safe keyframes for general elements without text-only parameters", () => {
    const preset = listMotionPresets({ targetKind: "element", phase: "enter" }).find(
      (candidate) => candidate.id === "element.enter.slide",
    );
    expect(preset?.parameterSchema.map((parameter) => parameter.id)).toEqual([
      "ease",
      "intensity",
      "direction",
    ]);

    const compiled = compileMotionInstance(
      createMotionInstance({
        presetId: "element.enter.slide",
        target: { selector: "#card", elementId: "card" },
        targetKind: "element",
        start: 2,
        parameters: { direction: "right", intensity: 1 },
      }),
    );
    expect(compiled.targetSelector).toBe("#card");
    expect(compiled.keyframes[0]?.properties).toMatchObject({ opacity: 0, x: -42, y: 0 });
    expect(compiled.extras).not.toHaveProperty("stagger");
  });

  it("compiles deterministic, finite GSAP keyframes and semantic metadata", () => {
    const instance = createMotionInstance({
      presetId: "text.enter.rise",
      target: { selector: "#headline", elementId: "headline" },
      targetKind: "text",
      start: 1.25,
      duration: 0.7,
      parameters: { direction: "left", intensity: 1.2, unit: "whole" },
    });
    const compiled = compileMotionInstance(instance);

    expect(compiled.targetSelector).toBe("#headline");
    expect(compiled.position).toBe(1.25);
    expect(compiled.duration).toBe(0.7);
    expect(compiled.keyframes[0]?.properties).toMatchObject({ opacity: 0, x: 50.4, y: 0 });
    expect(compiled.keyframes.at(-1)?.properties).toMatchObject({ opacity: 1, x: 0, y: 0 });
    expect(readMotionInstanceFromExtras({ data: compiled.extras.data })).toEqual(instance);
  });

  it("targets deterministic word and grapheme wrappers without changing the engine", () => {
    const character = compileMotionInstance(
      createMotionInstance({
        presetId: "text.enter.typewriter",
        target: { selector: "#mixed" },
        targetKind: "text",
        start: 0,
        parameters: { unit: "character", stagger: 0.06 },
      }),
    );
    const word = compileMotionInstance(
      createMotionInstance({
        presetId: "text.emphasis.pulse",
        target: { selector: "#mixed" },
        targetKind: "text",
        start: 1,
        parameters: { unit: "word" },
      }),
    );

    expect(character.targetSelector).toBe("#mixed [data-ipw-motion-char]");
    expect(character.extras.stagger).toBe(0.06);
    expect(word.targetSelector).toBe("#mixed > [data-ipw-motion-word]");
  });

  it("rejects unknown and unsafe parameters structurally", () => {
    const preset = MOTION_PRESETS.find((item) => item.id === "text.enter.rise")!;
    const report = validateMotionParameters(preset, {
      intensity: Number.POSITIVE_INFINITY,
      unit: "line",
      stagger: 99,
      random: true,
    });

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "unknown_parameter",
        "invalid_number",
        "invalid_option",
        "out_of_range",
      ]),
    );
  });

  it("does not restore malformed or incompatible semantic metadata", () => {
    const malformed = {
      id: "motion:#title:enter",
      presetId: "text.enter.fade",
      target: { selector: "#title" },
      targetKind: "element",
      phase: "enter",
      start: 0,
      duration: 0.7,
      parameters: { intensity: 1, unit: "whole", stagger: 0.04, ease: "power2.out" },
    };
    expect(
      readMotionInstanceFromExtras({
        data: "ipw-motion:v1:" + JSON.stringify(malformed),
      }),
    ).toBeNull();
  });

  it("keeps emphasis animations at the authored state at both boundaries", () => {
    for (const preset of listMotionPresets({ targetKind: "text", phase: "emphasis" })) {
      const compiled = compileMotionInstance(
        createMotionInstance({
          presetId: preset.id,
          target: { selector: "#title" },
          targetKind: "text",
          start: 0,
        }),
      );
      expect(compiled.keyframes[0]?.percentage).toBe(0);
      expect(compiled.keyframes.at(-1)?.percentage).toBe(100);
      expect(compiled.keyframes.at(-1)?.properties.opacity ?? 1).toBe(1);
    }
  });
});
