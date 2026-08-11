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
    expect(MOTION_PRESETS).toHaveLength(63);
    expect(new Set(MOTION_PRESETS.map((preset) => preset.id)).size).toBe(63);
    expect(listMotionPresets({ targetKind: "text", phase: "enter" })).toHaveLength(16);
    expect(listMotionPresets({ targetKind: "text", phase: "emphasis" })).toHaveLength(23);
    expect(listMotionPresets({ targetKind: "text", phase: "exit" })).toHaveLength(6);
    expect(listMotionPresets({ targetKind: "element", phase: "enter" })).toHaveLength(7);
    expect(listMotionPresets({ targetKind: "element", phase: "emphasis" })).toHaveLength(14);
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

  it("ships migrated caption effects as editable text presets", () => {
    const migratedIds = [
      "text.emphasis.highlight-sweep",
      "text.enter.matrix-decode",
      "text.emphasis.gradient-fill",
      "text.emphasis.neon-glow",
      "text.emphasis.neon-accent",
      "text.emphasis.rgb-glitch",
      "text.enter.clip-wipe",
      "text.emphasis.blend-difference",
      "text.emphasis.weight-shift",
      "text.emphasis.texture-fill",
      "text.emphasis.kinetic-slam",
      "text.emphasis.emoji-pop",
      "text.emphasis.particle-burst",
    ];

    expect(MOTION_PRESETS).toHaveLength(63);
    expect(new Set(MOTION_PRESETS.map((preset) => preset.id)).size).toBe(63);

    for (const id of migratedIds) {
      const preset = MOTION_PRESETS.find((candidate) => candidate.id === id);
      expect(preset, id).toBeDefined();
      expect(preset?.targetKinds, id).toEqual(["text"]);
      expect(preset?.parameterSchema.map((parameter) => parameter.id), id).toContain("intensity");
      expect(preset?.parameterSchema.map((parameter) => parameter.id), id).toContain("ease");
    }

    expect(listMotionPresets({ targetKind: "text", phase: "enter" }).map((preset) => preset.id))
      .toEqual(expect.arrayContaining(["text.enter.matrix-decode", "text.enter.clip-wipe"]));
    expect(listMotionPresets({ targetKind: "text", phase: "emphasis" }).map((preset) => preset.id))
      .toEqual(expect.arrayContaining(migratedIds.filter((id) => id.includes(".emphasis."))));
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

  it("defaults every motion preset to one non-looping play", () => {
    for (const preset of MOTION_PRESETS) {
      const targetKind = preset.targetKinds[0];
      if (!targetKind) {
        throw new Error(`Motion preset ${preset.id} has no target kind`);
      }

      const instance = createMotionInstance({
        presetId: preset.id,
        target: { selector: `#target-${preset.id.replaceAll(".", "-")}` },
        targetKind,
        start: 0,
      });
      const compiled = compileMotionInstance(instance);

      expect(instance).toMatchObject({ loop: false, repeat: 0 });
      expect(compiled.extras).not.toHaveProperty("repeat");
    }
  });

  it("persists loop intent as a finite GSAP repeat count", () => {
    const instance = createMotionInstance({
      presetId: "element.emphasis.pulse",
      target: { selector: "#card", elementId: "card" },
      targetKind: "element",
      start: 0,
      duration: 0.8,
      loop: true,
      repeat: 4,
    });
    const compiled = compileMotionInstance(instance);

    expect(compiled.extras.repeat).toBe(4);
    expect(readMotionInstanceFromExtras({ data: compiled.extras.data })).toMatchObject({
      loop: true,
      repeat: 4,
    });
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

  it("compiles editable React Bits-inspired text, general, and background templates", () => {
    const text = compileMotionInstance(
      createMotionInstance({
        presetId: "text.enter.blur-reveal",
        target: { selector: "#headline" },
        targetKind: "text",
        start: 0,
        parameters: { unit: "word", stagger: 0.08, blur: 18, direction: "up" },
      }),
    );
    const general = compileMotionInstance(
      createMotionInstance({
        presetId: "motion.enter.content-reveal",
        target: { selector: "#card" },
        targetKind: "element",
        start: 0,
        parameters: { direction: "left", distance: 80, initialOpacity: 0.2, initialScale: 0.9 },
      }),
    );
    const background = compileMotionInstance(
      createMotionInstance({
        presetId: "background.emphasis.molten-flow",
        target: { selector: "#background" },
        targetKind: "element",
        start: 0,
        parameters: { color1: "#111111", color2: "#222222", color3: "#FFFFFF", glow: 1.4 },
      }),
    );

    expect(text.targetSelector).toBe("#headline > [data-ipw-motion-word]");
    expect(text.keyframes[0]?.properties.filter).toContain("blur(18px)");
    expect(general.keyframes[0]?.properties).toMatchObject({ x: 80, y: 0, opacity: 0.2 });
    expect(background.duration).toBe(3.2);
    expect(background.keyframes.map((keyframe) => keyframe.properties.backgroundColor)).toEqual([
      "#111111",
      "#222222",
      "#FFFFFF",
      "#111111",
    ]);
  });

  it("keeps color animations theme-aware until the user chooses custom colors", () => {
    const text = compileMotionInstance(
      createMotionInstance({
        presetId: "text.emphasis.shiny-sweep",
        target: { selector: "#headline" },
        targetKind: "text",
        start: 0,
        parameters: { colorSource: "theme" },
      }),
    );
    const background = compileMotionInstance(
      createMotionInstance({
        presetId: "background.emphasis.light-rays",
        target: { selector: "#background" },
        targetKind: "element",
        start: 0,
        parameters: { colorSource: "theme" },
      }),
    );
    const custom = compileMotionInstance(
      createMotionInstance({
        presetId: "element.emphasis.spotlight-card",
        target: { selector: "#card" },
        targetKind: "element",
        start: 0,
        parameters: { colorSource: "custom", color: "#FF5500" },
      }),
    );

    expect(text.keyframes[1]?.properties.color).toBe("var(--ipw-color-accent, #7c3aed)");
    expect(background.keyframes.map((keyframe) => keyframe.properties.backgroundColor)).toEqual([
      "var(--ipw-color-bg, #0B1020)",
      "var(--ipw-color-primary, #2563EB)",
      "var(--ipw-color-accent, #FFFFFF)",
      "var(--ipw-color-bg, #0B1020)",
    ]);
    expect(custom.keyframes[1]?.properties.filter).toContain("#FF5500");
  });

  it("compiles every catalog preset to bounded editable keyframes", () => {
    for (const preset of MOTION_PRESETS) {
      const targetKind = preset.targetKinds[0];
      const compiled = compileMotionInstance(
        createMotionInstance({
          presetId: preset.id,
          target: { selector: "#subject" },
          targetKind,
          start: 0,
        }),
      );
      expect(compiled.keyframes.length, preset.id).toBeGreaterThanOrEqual(2);
      expect(compiled.keyframes[0]?.percentage, preset.id).toBe(0);
      expect(compiled.keyframes.at(-1)?.percentage, preset.id).toBe(100);
      expect(compiled.keyframes.every((keyframe) => Number.isFinite(keyframe.percentage))).toBe(
        true,
      );
    }
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
