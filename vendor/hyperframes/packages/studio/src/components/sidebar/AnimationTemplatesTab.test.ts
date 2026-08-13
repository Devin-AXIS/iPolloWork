import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANIMATION_TEMPLATES,
  createAnimationTemplateSections,
  isAdvancedTextAnimationTemplate,
  resolveAnimationTemplateParameters,
  resolveAnimationTemplateApplication,
  resolveAnimationTemplatePreset,
  sortTextAnimationTemplates,
} from "./AnimationTemplatesTab";

const MIGRATED_TEMPLATES = [
  ["text-editorial-emphasis", "text.enter.editorial-emphasis"],
  ["text-karaoke-flow", "text.emphasis.karaoke-flow"],
  ["text-camera-track", "text.enter.camera-track"],
  ["text-visual-layers", "text.enter.visual-layers"],
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
    expect(ANIMATION_TEMPLATES).toHaveLength(43);
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

  it("marks the migrated family as advanced while keeping one text section", () => {
    for (const [templateId] of MIGRATED_TEMPLATES) {
      const template = ANIMATION_TEMPLATES.find((candidate) => candidate.id === templateId);
      expect(template && isAdvancedTextAnimationTemplate(template), templateId).toBe(true);
    }
    expect(
      isAdvancedTextAnimationTemplate(
        ANIMATION_TEMPLATES.find((template) => template.id === "text-typewriter")!,
      ),
    ).toBe(false);
  });

  it("keeps advanced caption animations at the end of the text animation list", () => {
    const textTemplateIds = sortTextAnimationTemplates(
      ANIMATION_TEMPLATES.filter((template) => template.category === "text"),
    ).map((template) => template.id);

    expect(textTemplateIds.slice(-MIGRATED_TEMPLATES.length)).toEqual(
      MIGRATED_TEMPLATES.map(([templateId]) => templateId),
    );
  });

  it("keeps general, box, and combined text animations available for text selections", () => {
    const sections = createAnimationTemplateSections(ANIMATION_TEMPLATES, "text");
    const textSection = sections.find((section) => section.key === "text");

    expect(sections.map((section) => section.key)).toEqual(["general", "box-automation", "text"]);
    expect(textSection?.templates.map((template) => template.id)).toEqual(
      sortTextAnimationTemplates(
        ANIMATION_TEMPLATES.filter((template) => template.category === "text"),
      ).map((template) => template.id),
    );
  });

  it("uses character progression for decode and gradient previews", () => {
    for (const id of ["text-matrix-decode", "text-gradient-fill"]) {
      expect(ANIMATION_TEMPLATES.find((template) => template.id === id)?.parameters).toMatchObject({
        unit: "character",
      });
    }
  });

  it("shows universal and box automation animations for non-text selections", () => {
    expect(
      createAnimationTemplateSections(ANIMATION_TEMPLATES, "element").map((section) => section.key),
    ).toEqual(["general", "box-automation"]);
  });

  it("runs every text preview through the real preset only while its card is hovered", () => {
    const source = readFileSync(new URL("./AnimationTemplatesTab.tsx", import.meta.url), "utf8");

    expect(source).toContain("const StructuredMotionThumbnail = lazy(() =>");
    expect(source).toContain("textPreset && textParameters && active");
    expect(source).toContain("data-structured-preview-active={");
    expect(source).toContain("onMouseEnter={() => setPreviewActive(true)}");
    expect(source).toContain("onMouseLeave={() => setPreviewActive(false)}");
    expect(source).toContain('contentVisibility: "auto"');
  });

  it("resolves universal templates per target", () => {
    const fade = ANIMATION_TEMPLATES.find((template) => template.id === "general-fade-in");
    if (!fade) throw new Error("Expected animation template is missing");

    expect(resolveAnimationTemplatePreset(fade, "text")?.id).toBe("text.enter.fade");
    expect(resolveAnimationTemplatePreset(fade, "element")?.id).toBe("element.enter.fade");
  });

  it("applies element-only box templates to a text element as element motion", () => {
    const scale = ANIMATION_TEMPLATES.find((template) => template.id === "box-scale");
    const tilt = ANIMATION_TEMPLATES.find((template) => template.id === "box-focus-tilt");
    if (!scale || !tilt) throw new Error("Expected box templates are missing");

    expect(resolveAnimationTemplatePreset(scale, "text")).toMatchObject({
      id: "element.enter.scale",
      targetKinds: ["element"],
    });
    expect(resolveAnimationTemplateApplication(scale, "text")).toMatchObject({
      targetKind: "element",
      applicationKind: "box",
      preset: { id: "element.enter.scale" },
    });
    expect(resolveAnimationTemplateApplication(tilt, "text")).toMatchObject({
      targetKind: "element",
      applicationKind: "box",
      preset: { id: "motion.emphasis.focus-tilt" },
    });
  });

  it("labels universal and text templates for persisted replacement rules", () => {
    const general = ANIMATION_TEMPLATES.find((template) => template.id === "general-fade-in");
    const text = ANIMATION_TEMPLATES.find((template) => template.id === "text-typewriter");
    if (!general || !text) throw new Error("Expected templates are missing");

    expect(resolveAnimationTemplateApplication(general, "text")?.applicationKind).toBe("general");
    expect(resolveAnimationTemplateApplication(text, "text")?.applicationKind).toBe("text");
  });

  it("locks text-template colors to the palette shown in the preview", () => {
    for (const template of ANIMATION_TEMPLATES.filter((item) => item.category === "text")) {
      const preset = resolveAnimationTemplatePreset(template, "text");
      if (!preset?.parameterSchema.some((parameter) => parameter.id === "colorSource")) continue;
      expect(
        resolveAnimationTemplateParameters(template, preset, false),
        template.id,
      ).toMatchObject({ colorSource: "custom" });
    }
  });

  it("keeps theme-aware box effects bound to the active design theme", () => {
    const themeAwareIds = ["box-spotlight-card", "box-glare-sweep"];

    for (const id of themeAwareIds) {
      expect(ANIMATION_TEMPLATES.find((template) => template.id === id)?.parameters).toMatchObject({
        colorSource: "theme",
      });
    }
  });

  it("keeps the migrated highlight sweep on its original red by default", () => {
    expect(
      ANIMATION_TEMPLATES.find((template) => template.id === "text-highlight-sweep")?.parameters,
    ).toMatchObject({
      colorSource: "custom",
      color: "#FF1745",
    });
  });

  it("keeps the selected word or character unit on variable-bound generated text", () => {
    const fold = ANIMATION_TEMPLATES.find((template) => template.id === "text-fold-reveal");
    if (!fold) throw new Error("Expected Fold Text template is missing");
    const preset = resolveAnimationTemplatePreset(fold, "text");
    if (!preset) throw new Error("Expected Fold Text preset is missing");

    expect(resolveAnimationTemplateParameters(fold, preset, true).unit).toBe("character");
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
