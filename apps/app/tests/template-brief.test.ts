import { beforeEach, describe, expect, test } from "bun:test";

import { setLocale } from "../src/i18n";

import {
  isVideoStudioReady,
  templateBriefConfigFor,
  templateBriefPrompt,
} from "../src/react-app/domains/session/templates/template-brief";

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
    expect(video).toContain("preserve its current theme as the visual source of truth");
    expect(video).toContain("do not change the managed theme block");
    expect(video).not.toContain("colorPalette");
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

  test("requires slide generation to retain the selected template's distinct composition", () => {
    const prompt = templateBriefPrompt({
      template: {
        category: "slides",
        title: "Xiaohongshu Post Deck",
        applyChecklist: ["Keep the template hierarchy"],
      },
      entryPath: "design/ses_xhs/entry.html",
      briefPath: "design/ses_xhs/brief.json",
    });

    expect(prompt).toContain("existing HTML and CSS are the layout source of truth");
    expect(prompt).toContain("Update existing elements in place");
    expect(prompt).toContain("Do not replace the template with a generic deck");
    expect(prompt).toContain("colored blocks, artwork, decorative elements, and template-specific components");
  });

  test("requires website generation to retain the selected template's distinct composition", () => {
    const prompt = templateBriefPrompt({
      template: {
        category: "site",
        title: "Architecture Index",
        applyChecklist: ["Keep the project index"],
      },
      entryPath: "design/ses_site/entry.html",
      briefPath: "design/ses_site/brief.json",
    });

    expect(prompt).toContain("existing website HTML and CSS are the layout source of truth");
    expect(prompt).toContain("Update existing elements in place");
    expect(prompt).toContain("template-specific class names");
    expect(prompt).toContain("do not rebuild it as a generic split hero");
  });

});
