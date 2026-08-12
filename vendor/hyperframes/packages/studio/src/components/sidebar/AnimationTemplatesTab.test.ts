import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANIMATION_TEMPLATES,
  createAnimationTemplateSections,
  resolveAnimationTemplateParameters,
  resolveAnimationTemplatePreset,
  sortTextAnimationTemplates,
} from "./AnimationTemplatesTab";

const MIGRATED_TEMPLATES = [
  ["text-highlight-sweep", "text.emphasis.highlight-sweep"],
  ["text-matrix-decode", "text.enter.matrix-decode"],
  ["text-gradient-fill", "text.emphasis.gradient-fill"],
  ["text-neon-glow", "text.emphasis.neon-glow"],
  ["text-neon-accent", "text.emphasis.neon-accent"],
  ["text-rgb-glitch", "text.emphasis.rgb-glitch"],
  ["text-clip-wipe", "text.enter.clip-wipe"],
  ["text-blend-difference", "text.emphasis.blend-difference"],
  ["text-weight-shift", "text.emphasis.weight-shift"],
  ["text-texture-fill", "text.emphasis.texture-fill"],
  ["text-kinetic-slam", "text.emphasis.kinetic-slam"],
  ["text-emoji-pop", "text.emphasis.emoji-pop"],
  ["text-particle-burst", "text.emphasis.particle-burst"],
] as const;

describe("AnimationTemplatesTab catalog", () => {
  it("shows one universal catalog and appends text animation for text selections", () => {
    expect(ANIMATION_TEMPLATES).toHaveLength(39);
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
        "caption-highlight",
        "caption-matrix-decode",
      ]),
    );
  });

  it("exposes migrated caption effects as text animation templates", () => {
    for (const [templateId, presetId] of MIGRATED_TEMPLATES) {
      const template = ANIMATION_TEMPLATES.find((candidate) => candidate.id === templateId);
      expect(template, templateId).toMatchObject({ category: "text", presetId });
      expect(resolveAnimationTemplatePreset(template!, "text")?.id).toBe(presetId);
    }
  });

  it("keeps advanced caption animations at the end of the text animation list", () => {
    const textTemplateIds = sortTextAnimationTemplates(
      ANIMATION_TEMPLATES.filter((template) => template.category === "text"),
    ).map((template) => template.id);

    expect(textTemplateIds.slice(-MIGRATED_TEMPLATES.length)).toEqual(
      MIGRATED_TEMPLATES.map(([templateId]) => templateId),
    );
  });

  it("puts advanced caption animations in the final section", () => {
    const sections = createAnimationTemplateSections(ANIMATION_TEMPLATES, "text");
    const migratedSection = sections.find((section) => section.key === "migrated-text");

    expect(sections.map((section) => section.key).slice(0, 3)).toEqual([
      "general",
      "text",
      "migrated-text",
    ]);
    expect(migratedSection?.title.zh).toBe("\u5b57\u5e55\u9ad8\u7ea7\u52a8\u753b");
    expect(migratedSection?.templates.map((template) => template.id)).toEqual(
      MIGRATED_TEMPLATES.map(([templateId]) => templateId),
    );
  });

  it("shows only universal animations for non-text selections", () => {
    expect(
      createAnimationTemplateSections(ANIMATION_TEMPLATES, "element").map(
        (section) => section.key,
      ),
    ).toEqual(["general"]);
  });

  it("keeps advanced previews idle until their card is hovered", () => {
    const source = readFileSync(new URL("./AnimationTemplatesTab.tsx", import.meta.url), "utf8");

    expect(source).toContain('const StructuredMotionThumbnail = lazy(() =>');
    expect(source).toContain("structuredParameters && active");
    expect(source).toContain('data-structured-preview-active={');
    expect(source).toContain('onMouseEnter={() => setPreviewActive(true)}');
    expect(source).toContain('onMouseLeave={() => setPreviewActive(false)}');
    expect(source).toContain('contentVisibility: "auto"');
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
      "text-matrix-decode",
      "text-gradient-fill",
      "text-neon-glow",
      "text-neon-accent",
      "text-rgb-glitch",
      "text-texture-fill",
      "text-particle-burst",
      "box-spotlight-card",
      "box-glare-sweep",
    ];

    for (const id of themeAwareIds) {
      expect(ANIMATION_TEMPLATES.find((template) => template.id === id)?.parameters).toMatchObject({
        colorSource: "theme",
      });
    }
  });

  it("keeps the migrated highlight sweep on its original red by default", () => {
    expect(ANIMATION_TEMPLATES.find((template) => template.id === "text-highlight-sweep")?.parameters).toMatchObject({
      colorSource: "custom",
      color: "#FF1745",
    });
  });

  it("keeps variable-bound text intact by applying text motion to the whole element", () => {
    const fold = ANIMATION_TEMPLATES.find((template) => template.id === "text-fold-reveal");
    if (!fold) throw new Error("Expected Fold Text template is missing");
    const preset = resolveAnimationTemplatePreset(fold, "text");
    if (!preset) throw new Error("Expected Fold Text preset is missing");

    expect(resolveAnimationTemplateParameters(fold, preset, true).unit).toBe("whole");
    expect(resolveAnimationTemplateParameters(fold, preset, false).unit).toBe("character");

    const highlight = ANIMATION_TEMPLATES.find(
      (template) => template.id === "text-highlight-sweep",
    );
    if (!highlight) throw new Error("Expected Highlight template is missing");
    const highlightPreset = resolveAnimationTemplatePreset(highlight, "text");
    if (!highlightPreset) throw new Error("Expected Highlight preset is missing");
    expect(resolveAnimationTemplateParameters(highlight, highlightPreset, true).unit).toBe("word");
  });
});
