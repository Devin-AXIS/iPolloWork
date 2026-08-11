import { describe, expect, it } from "vitest";
import {
  ANIMATION_TEMPLATES,
  resolveAnimationTemplateParameters,
  resolveAnimationTemplatePreset,
} from "./AnimationTemplatesTab";

describe("AnimationTemplatesTab catalog", () => {
  it("shows one universal catalog and appends text animation for text selections", () => {
    expect(ANIMATION_TEMPLATES).toHaveLength(26);
    expect(new Set(ANIMATION_TEMPLATES.map((template) => template.category))).toEqual(
      new Set(["general", "text"]),
    );
    expect(
      ANIMATION_TEMPLATES.filter((template) => template.id.startsWith("box-")).every(
        (template) => template.category === "general",
      ),
    ).toBe(true);
    expect(ANIMATION_TEMPLATES.some((template) => template.id.startsWith("background-"))).toBe(
      false,
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

  it("resolves universal templates per target", () => {
    const fade = ANIMATION_TEMPLATES.find((template) => template.id === "general-fade-in");
    if (!fade) throw new Error("Expected animation template is missing");

    expect(resolveAnimationTemplatePreset(fade, "text")?.id).toBe("text.enter.fade");
    expect(resolveAnimationTemplatePreset(fade, "element")?.id).toBe("element.enter.fade");
  });

  it("defaults every color-driven template to the active design theme", () => {
    const themeAwareIds = [
      "text-prism-glow",
      "text-shiny-sweep",
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
