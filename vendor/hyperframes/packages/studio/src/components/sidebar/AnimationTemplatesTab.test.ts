import { describe, expect, it } from "vitest";
import {
  ANIMATION_TEMPLATES,
  resolveAnimationTemplateParameters,
  resolveAnimationTemplatePreset,
} from "./AnimationTemplatesTab";

describe("AnimationTemplatesTab catalog", () => {
  it("owns four editable animation categories without scene effects", () => {
    expect(ANIMATION_TEMPLATES).toHaveLength(32);
    expect(new Set(ANIMATION_TEMPLATES.map((template) => template.category))).toEqual(
      new Set(["general", "text", "background", "box"]),
    );
    expect(ANIMATION_TEMPLATES.map((template) => template.id)).not.toEqual(
      expect.arrayContaining([
        "opening-editorial-rise",
        "ending-brand-lockup",
        "transition-split-wipe",
        "caption-mask-reveal",
      ]),
    );
  });

  it("resolves universal templates per target and keeps backgrounds element-only", () => {
    const fade = ANIMATION_TEMPLATES.find((template) => template.id === "general-fade-in");
    const molten = ANIMATION_TEMPLATES.find((template) => template.id === "background-molten-flow");
    if (!fade || !molten) throw new Error("Expected animation templates are missing");

    expect(resolveAnimationTemplatePreset(fade, "text")?.id).toBe("text.enter.fade");
    expect(resolveAnimationTemplatePreset(fade, "element")?.id).toBe("element.enter.fade");
    expect(resolveAnimationTemplatePreset(molten, "text")?.targetKinds).not.toContain("text");
    expect(resolveAnimationTemplatePreset(molten, "element")?.id).toBe(
      "background.emphasis.molten-flow",
    );
  });

  it("defaults every color-driven template to the active design theme", () => {
    const themeAwareIds = [
      "text-prism-glow",
      "text-shiny-sweep",
      "background-molten-flow",
      "background-aurora",
      "background-prism",
      "background-light-rays",
      "background-grid-scan",
      "background-iridescent",
      "box-spotlight-card",
      "box-glare-sweep",
    ];

    for (const id of themeAwareIds) {
      expect(ANIMATION_TEMPLATES.find((template) => template.id === id)?.parameters).toMatchObject({
        colorSource: "theme",
      });
    }
  });

  it("keeps variable-bound text intact by applying text motion to the whole element", () => {
    const fold = ANIMATION_TEMPLATES.find((template) => template.id === "text-fold-reveal");
    if (!fold) throw new Error("Expected Fold Text template is missing");
    const preset = resolveAnimationTemplatePreset(fold, "text");
    if (!preset) throw new Error("Expected Fold Text preset is missing");

    expect(resolveAnimationTemplateParameters(fold, preset, true).unit).toBe("whole");
    expect(resolveAnimationTemplateParameters(fold, preset, false).unit).toBe("character");
  });
});
