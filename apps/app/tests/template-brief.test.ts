import { beforeEach, describe, expect, test } from "bun:test";

import { setLocale } from "../src/i18n";
import { customTemplateColorPalette, isVideoStudioReady, paletteColors, TEMPLATE_COLOR_PRESETS, templateBriefConfigFor, templateBriefPrompt } from "../src/react-app/domains/session/templates/template-brief";

describe("template brief", () => {
  beforeEach(() => {
    setLocale("en");
  });

  test("asks website creators for a site-specific brief", () => {
    const config = templateBriefConfigFor({ category: "site" });

    expect(config.fields.map((field) => field.label)).toEqual([
      "Website name",
      "What the website does and who it is for",
      "Core pages or features",
    ]);
    expect(config.submitLabel).toBe("Generate website");
  });

  test("asks video creators for a purpose and audience without a narration question", () => {
    const config = templateBriefConfigFor({ category: "video" });

    expect(config.fields.map((field) => field.label)).toEqual([
      "Video topic",
      "Who it is for",
      "What it should communicate or drive",
    ]);
    expect(config.description).toContain("AI will decide the narration");
    expect(config.fields.some((field) => field.label.includes("narration"))).toBe(false);
  });

  test("uses a resume-specific brief for templates filed under other", () => {
    const config = templateBriefConfigFor({ category: "other", subcategory: "resume", title: "Minimal CV" });

    expect(config.fields.map((field) => field.label)).toEqual([
      "Name and target role",
      "Target role or company",
      "Experience, skills, or outcome highlights",
    ]);
    expect(config.submitLabel).toBe("Generate resume");
    expect(templateBriefPrompt({
      template: { category: "other", subcategory: "resume", title: "Minimal CV", applyChecklist: ["Keep layout"] },
      entryPath: "design/ses_resume/index.html",
      briefPath: "design/ses_resume/brief.json",
    })).toContain("complete professional resume");
  });

  test("keeps Video Studio closed until a selected template has a confirmed brief", () => {
    expect(isVideoStudioReady(false, false)).toBe(false);
    expect(isVideoStudioReady(true, false)).toBe(false);
    expect(isVideoStudioReady(true, true)).toBe(true);
  });

  test("offers complete three-color presets and a fully editable custom palette", () => {
    expect(TEMPLATE_COLOR_PRESETS).toHaveLength(4);
    expect(TEMPLATE_COLOR_PRESETS.every((palette) => paletteColors(palette).every((color) => /^#[0-9a-f]{6}$/i.test(color)))).toBe(true);

    const custom = customTemplateColorPalette(["#fef3c7", "#422006", "#d97706"]);
    expect(custom).toMatchObject({ id: "custom", canvas: "#fef3c7", text: "#422006", accent: "#d97706" });
    expect(paletteColors(custom)).toEqual(["#fef3c7", "#422006", "#d97706"]);
  });

  test("keeps each template category on its own application contract", () => {
    const video = templateBriefPrompt({
      template: { category: "video", title: "Launch Film", applyChecklist: ["Keep composition"] },
      entryPath: "video/ses_a/index.html",
      briefPath: "video/ses_a/brief.json",
    });
    const app = templateBriefPrompt({
      template: { category: "app", title: "Finance App", applyChecklist: ["Keep flows"] },
      entryPath: "design/ses_b/index.html",
      briefPath: "design/ses_b/brief.json",
    });

    expect(video).toContain("Decide whether narration materially helps");
    expect(video).toContain("not a blank or unrelated project");
    expect(video).toContain("colorPalette.canvas");
    expect(app).toContain("complete App prototype");
    expect(app).toContain("do not turn it into a marketing website");
  });

  test("assigns compatible slide navigation and responsive scaling to the Design panel", () => {
    const prompt = templateBriefPrompt({
      template: {
        category: "slides",
        title: "Native Pitch",
        applyChecklist: ["Preserve markers"],
        pptxCompatibility: "native-editable",
      },
      entryPath: "design/ses_native/entry.html",
      briefPath: "design/ses_native/brief.json",
    });

    expect(prompt).toContain("do not add <script> tags");
    expect(prompt).toContain("The Design panel owns slide navigation");
    expect(prompt).toContain("responsive slide reflow");
  });
});
