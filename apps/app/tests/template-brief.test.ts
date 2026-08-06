import { beforeEach, describe, expect, test } from "bun:test";

import { setLocale } from "../src/i18n";
import JSZip from "jszip";

import {
  isTemplateBriefReferenceFile,
  isVideoStudioReady,
  inferTemplateBriefFromReferenceFile,
  prepareTemplateBriefReferenceAttachment,
  templateBriefFromReferenceText,
  templateBriefConfigFor,
  templateBriefPrompt,
} from "../src/react-app/domains/session/templates/template-brief";

const sessionPageUrl = new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url);

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

  test("accepts supported optional reference document formats", () => {
    const files = [
      new File(["%PDF"], "brief.pdf", { type: "application/pdf" }),
      new File(["copy"], "notes.md", { type: "text/markdown" }),
      new File(["copy"], "notes.txt", { type: "text/plain" }),
      new File(["image"], "visual.PNG", { type: "image/png" }),
      new File(["image"], "photo.jpg", { type: "image/jpeg" }),
      new File(["image"], "photo.jpeg", { type: "image/jpeg" }),
      new File(["image"], "mock.webp", { type: "image/webp" }),
      new File(["a,b"], "metrics.csv", { type: "text/csv" }),
      new File(['{"a":1}'], "data.json", { type: "application/json" }),
      new File([""], "word.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    ];

    expect(files.map(isTemplateBriefReferenceFile)).toEqual(files.map(() => true));
  });

  test("rejects unsupported optional reference document formats", () => {
    expect(isTemplateBriefReferenceFile(new File(["deck"], "old-deck.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }))).toBe(false);
    expect(isTemplateBriefReferenceFile(new File(["sheet"], "budget.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))).toBe(false);
    expect(isTemplateBriefReferenceFile(new File(["svg"], "logo.svg", { type: "image/svg+xml" }))).toBe(false);
  });

  test("converts docx reference files to text attachments before sending", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Brand voice</w:t></w:r></w:p>
          <w:p><w:r><w:t>Use concise clinical language.</w:t></w:r></w:p>
        </w:body>
      </w:document>`);
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const attachment = await prepareTemplateBriefReferenceAttachment(
      new File([buffer], "reference.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    );

    expect(attachment.name).toBe("reference.docx");
    expect(attachment.mimeType).toBe("text/plain");
    expect(attachment.kind).toBe("file");
    expect(await attachment.file.text()).toContain("Use concise clinical language.");
  });

  test("does not send raw pdf bytes through the composer attachment channel", async () => {
    const attachment = await prepareTemplateBriefReferenceAttachment(
      new File(["%PDF-1.7\nlarge binary body"], "annual-review.pdf", { type: "application/pdf" }),
    );

    expect(attachment.name).toBe("annual-review.pdf");
    expect(attachment.mimeType).toBe("text/plain");
    expect(attachment.kind).toBe("file");
    expect(await attachment.file.text()).toContain("annual-review.pdf");
    expect(await attachment.file.text()).not.toContain("%PDF-1.7");
  });

  test("tracks template reference preview urls independently of React state", async () => {
    const source = await Bun.file(sessionPageUrl).text();
    const registry = source.indexOf("referencePreviewUrlsRef");
    const addPreview = source.indexOf("referencePreviewUrlsRef.current.add");
    const deletePreview = source.indexOf("referencePreviewUrlsRef.current.delete");
    const cleanup = source.indexOf("referencePreviewUrlsRef.current.clear");

    expect(registry).toBeGreaterThan(-1);
    expect(addPreview).toBeGreaterThan(registry);
    expect(deletePreview).toBeGreaterThan(registry);
    expect(cleanup).toBeGreaterThan(registry);
    expect(source).toContain("URL.revokeObjectURL(previewUrl)");
    expect(source).toContain("URL.revokeObjectURL(target.previewUrl)");
  });

  test("infers brief fields from markdown reference text", () => {
    const brief = templateBriefFromReferenceText({
      filename: "ignored.md",
      text: `# Clinical Handoff

## Audience
Ward 7 nurses deciding handoff priorities.

## Key information
Escalation path, risk flags, checklist, and shift-owner notes.`,
    });

    expect(brief.title).toBe("Clinical Handoff");
    expect(brief.audience).toContain("Ward 7 nurses");
    expect(brief.details).toContain("Escalation path");
  });

  test("infers brief fields from docx reference files", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Clinical Handoff</w:t></w:r></w:p>
          <w:p><w:r><w:t>Audience: Ward 7 nurses deciding handoff priorities.</w:t></w:r></w:p>
          <w:p><w:r><w:t>Include escalation path, risk flags, checklist, and shift-owner notes.</w:t></w:r></w:p>
        </w:body>
      </w:document>`);
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const brief = await inferTemplateBriefFromReferenceFile(
      new File([buffer], "clinical-handoff.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    );

    expect(brief.title).toBe("Clinical Handoff");
    expect(brief.audience).toContain("Ward 7 nurses");
    expect(brief.details).toContain("escalation path");
  });

  test("uses a readable filename fallback when reference text cannot be extracted", () => {
    const brief = templateBriefFromReferenceText({ filename: "clinical-handoff.pdf", text: "" });

    expect(brief.title).toBe("clinical handoff");
    expect(brief.audience).toBe("");
    expect(brief.details).toBe("");
  });
});
