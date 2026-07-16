import { describe, expect, test } from "bun:test";

import { customTemplateColorPalette, isVideoStudioReady, paletteColors, TEMPLATE_COLOR_PRESETS, templateBriefConfigFor, templateBriefPrompt } from "../src/react-app/domains/session/templates/template-brief";

describe("template brief", () => {
  test("asks website creators for a site-specific brief", () => {
    const config = templateBriefConfigFor({ category: "site" });

    expect(config.fields.map((field) => field.label)).toEqual([
      "网站名称",
      "网站是做什么的、给谁用",
      "核心页面或功能",
    ]);
    expect(config.submitLabel).toBe("生成网站");
  });

  test("asks video creators for a purpose and audience without a narration question", () => {
    const config = templateBriefConfigFor({ category: "video" });

    expect(config.fields.map((field) => field.label)).toEqual([
      "视频主题",
      "面向谁",
      "想传达或促成什么",
    ]);
    expect(config.description).toContain("旁白、节奏与分镜由 AI");
    expect(config.fields.some((field) => field.label.includes("旁白"))).toBe(false);
  });

  test("uses a resume-specific brief for templates filed under other", () => {
    const config = templateBriefConfigFor({ category: "other", subcategory: "resume", title: "Minimal CV" });

    expect(config.fields.map((field) => field.label)).toEqual([
      "姓名与目标岗位",
      "面向什么职位或公司",
      "经历、技能或成果亮点",
    ]);
    expect(config.submitLabel).toBe("生成简历");
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
});
