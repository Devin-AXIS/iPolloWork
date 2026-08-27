import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ARTIFACT_DELIVERY_ID_PREFIX,
  type TemplateCatalogItem,
  type TemplateCategory,
  type TemplateManifestV1,
} from "@ipollowork/types/templates";

import { setLocale } from "../src/i18n";

import {
  conversationArtifactSessionId,
  conversationTemplateBrief,
  inferConversationTemplateIntent,
  inferConversationTemplateIntents,
  isConversationTemplateSessionId,
  isVideoStudioReady,
  nextConversationArtifactSessionId,
  requestsCustomTemplate,
  selectConversationTemplate,
  templateBriefConfigFor,
  templateBriefPrompt,
} from "../src/react-app/domains/session/templates/template-brief";

function catalogItem(input: {
  id: string;
  category: TemplateCategory;
  title: string;
  tags?: string[];
  installed?: boolean;
  pptxCompatibility?: TemplateManifestV1["pptxCompatibility"];
}): TemplateCatalogItem {
  return {
    manifest: {
      schemaVersion: 1,
      id: input.id,
      version: "1.0.0",
      kind: "design",
      category: input.category,
      subcategory: input.category,
      style: "minimal",
      tags: input.tags ?? [],
      ...(input.pptxCompatibility ? { pptxCompatibility: input.pptxCompatibility } : {}),
      surface: input.category === "video" ? "video" : "design",
      title: input.title,
      description: `${input.title} template`,
      cover: "cover.svg",
      entry: input.category === "video" ? "index.html" : "entry.html",
      source: { name: "Test", license: "MIT" },
      designSystem: {
        tokenVersion: 1,
        editableGroups: ["theme", "background", "typography", "components"],
        tokens: "design-tokens.css",
        variables: [],
      },
      applyChecklist: ["Keep the template structure"],
      minimumAppVersion: "0.1.0",
    },
    sourceType: "bundled",
    installed: input.installed ?? true,
    installedVersion: input.installed === false ? null : "1.0.0",
    updateAvailable: false,
    verified: true,
  };
}

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
    expect(video).toContain("content-led storyboard");
    expect(video).toContain("add, remove, reorder, or retime scenes");
    expect(video).toContain("preserve its current theme as the visual source of truth");
    expect(video).toContain("do not change the managed theme block");
    expect(video).not.toContain("colorPalette");
    expect(app).toContain("build the complete prototype");
    expect(app).toContain("or turn it into a marketing website");
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

  test("lets every custom artifact delivery derive its own visual system", () => {
    const prompt = templateBriefPrompt({
      template: {
        id: `${ARTIFACT_DELIVERY_ID_PREFIX}pptx`,
        category: "slides",
        title: "Custom",
        applyChecklist: ["Keep editable markers"],
        pptxCompatibility: "native-editable",
      },
      entryPath: "design/ses_custom/entry.html",
      briefPath: "design/ses_custom/brief.json",
    });

    expect(prompt).toContain("complete original slides artifact");
    expect(prompt).toContain("chosen for the content and audience");
    expect(prompt).toContain("rebuild the HTML, CSS, and managed design tokens");
    expect(prompt).toContain("native editable PPTX contract");
    expect(prompt).not.toContain("preserve its current theme");
  });

  test("keeps real template application prompts compact for small provider contexts", () => {
    const manifest = JSON.parse(readFileSync(
      new URL("../../server/bundled-templates/ipollowork.pptx-brand-narrative/manifest.json", import.meta.url),
      "utf8",
    )) as TemplateManifestV1;
    const prompt = templateBriefPrompt({
      template: manifest,
      entryPath: "design/ses_morrow/entry.html",
      briefPath: "design/ses_morrow/brief.json",
    });

    expect(prompt.length).toBeLessThan(2_200);
    expect(prompt).toContain("Read `design/ses_morrow/brief.json`");
    expect(prompt).toContain("Apply it now in this turn");
    expect(prompt).toContain("Do not reply only with confirmation");
    expect(prompt).toContain("native editable PPTX contract");
  });

  test("recognizes explicit creative deliverables but leaves explanatory questions as normal chat", () => {
    expect(inferConversationTemplateIntent("帮我生成一份融资路演PPT")?.category).toBe("slides");
    expect(inferConversationTemplateIntent("制作一个竖屏产品发布视频")?.category).toBe("video");
    expect(inferConversationTemplateIntent("创建一个 AI 产品落地页")?.category).toBe("site");
    expect(inferConversationTemplateIntent("再做个网页")?.category).toBe("site");
    expect(inferConversationTemplateIntent("请解释 PPT 是什么")).toBeNull();
    expect(inferConversationTemplateIntent("告诉我怎么制作一个网页")).toBeNull();
    expect(inferConversationTemplateIntent("做视频需要什么工具？")).toBeNull();
    expect(inferConversationTemplateIntent("How do I create a website?")).toBeNull();
    expect(inferConversationTemplateIntent("What tools should I use to make a video?")).toBeNull();
    expect(inferConversationTemplateIntent("Please create a website for my company")?.category).toBe("site");
    expect(inferConversationTemplateIntent("帮我写一个产品宣传视频脚本")).toBeNull();
    expect(inferConversationTemplateIntent("生成一份路演 PPT 大纲")).toBeNull();
  });

  test("keeps every explicitly requested creative deliverable in one conversation plan", () => {
    expect(inferConversationTemplateIntents("给我做一个恒生银行的 PPT 和视频").map((intent) => intent.category)).toEqual([
      "slides",
      "video",
    ]);
    expect(conversationArtifactSessionId("ses_bank", "slides")).toBe("ses_bank-artifact-slides");
    expect(conversationArtifactSessionId("x".repeat(256), "video")).toHaveLength(256);
  });

  test("allocates isolated repeated template instances under one conversation", () => {
    const first = nextConversationArtifactSessionId("ses_bank", "slides", []);
    const second = nextConversationArtifactSessionId("ses_bank", "slides", [first]);
    const video = nextConversationArtifactSessionId("ses_bank", "video", [first, second]);

    expect(first).toBe("ses_bank-artifact-slides");
    expect(second).toBe("ses_bank-artifact-slides-2");
    expect(video).toBe("ses_bank-artifact-video");
    expect(isConversationTemplateSessionId("ses_bank", "ses_bank")).toBe(true);
    expect(isConversationTemplateSessionId("ses_bank", second)).toBe(true);
    expect(isConversationTemplateSessionId("ses_other", second)).toBe(false);
    const longConversationId = "x".repeat(256);
    const longFirst = conversationArtifactSessionId(longConversationId, "slides");
    const longSecond = nextConversationArtifactSessionId(longConversationId, "slides", [longFirst]);
    expect(longSecond).toHaveLength(256);
    expect(longSecond).toEndWith("-artifact-slides-2");
    expect(isConversationTemplateSessionId(longConversationId, longSecond)).toBe(true);
  });

  test("selects an installed semantic match and prefers native-editable templates for PPT", () => {
    const catalog = [
      catalogItem({ id: "test.deck-html", category: "slides", title: "HTML Deck", tags: ["deck"] }),
      catalogItem({ id: "test.deck-pitch", category: "slides", title: "Investor Pitch", tags: ["pitch"], pptxCompatibility: "native-editable" }),
      catalogItem({ id: "test.deck-perfect-uninstalled", category: "slides", title: "融资路演", tags: ["融资", "pitch"], installed: false }),
    ];

    expect(selectConversationTemplate("生成一份可编辑的融资路演 PPT", catalog)?.manifest.id).toBe("test.deck-pitch");
  });

  test("uses market templates by default and only skips them for explicit custom requests", () => {
    const catalog = [catalogItem({ id: "test.deck-market", category: "slides", title: "Investor Pitch", tags: ["pitch"] })];

    expect(requestsCustomTemplate("生成一份融资路演 PPT")).toBe(false);
    expect(selectConversationTemplate("生成一份融资路演 PPT", catalog)?.manifest.id).toBe("test.deck-market");
    expect(requestsCustomTemplate("不用系统模板，帮我自定义一份融资路演 PPT")).toBe(true);
    expect(selectConversationTemplate("不用系统模板，帮我自定义一份融资路演 PPT", catalog)).toBeNull();
  });

  test("routes vertical social video requests to the matching video template", () => {
    const catalog = [
      catalogItem({ id: "test.video-default", category: "video", title: "Product Film" }),
      catalogItem({ id: "test.video-vertical", category: "video", title: "Vertical Social Story", tags: ["vertical", "social"] }),
    ];

    expect(selectConversationTemplate("制作一个适合抖音的竖屏短视频", catalog)?.manifest.id).toBe("test.video-vertical");
  });

  test("turns the original conversation into the persisted template brief", () => {
    const brief = conversationTemplateBrief("请帮我生成一个面向企业客户的 AI 产品官网");

    expect(brief.title).toBe("一个面向企业客户的 AI 产品官网");
    expect(brief.audience).toContain("当前对话");
    expect(brief.details).toContain("面向企业客户");
  });

  test("materializes matched templates before ordinary chat generation and refreshes Studio", () => {
    const routeSource = readFileSync(
      new URL("../src/react-app/shell/session-route.tsx", import.meta.url),
      "utf8",
    );
    const pageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(routeSource).toContain("inferConversationTemplateIntents(text)");
    expect(routeSource).toContain("selectConversationTemplate(text, catalog.items, intent.category)");
    expect(routeSource).toContain("nextConversationArtifactSessionId(");
    expect(routeSource).toContain('setSessionType(targetSessionId, "work")');
    expect(routeSource).toContain("explicitlyTargetedTemplateSessionIds.size === 0");
    expect(routeSource).not.toContain('sessionTypeBeforeRouting === "work"');
    expect(routeSource).toContain("Multi-artifact delivery contract");
    expect(routeSource).toContain("conversationTemplateBrief(text)");
    expect(routeSource).toContain('purpose: "artifact-delivery"');
    expect(routeSource).not.toContain("No installed ${automaticTemplateIntent.category} template");
    expect(routeSource).toContain("templateInstructions.push(templateBriefPrompt");
    expect(pageSource).toContain("subscribeToSessionType((sessionId)");
    expect(pageSource).toContain("currentTemplateSessionData?.hasBrief === true");
  });

  test("arms the shared artifact completion gate before starting a video template task", () => {
    const pageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );
    const surfaceSource = readFileSync(
      new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url),
      "utf8",
    );

    expect(pageSource).toContain("createVideoArtifactCompletionRequirement(");
    expect(pageSource).toContain("const dispatched = await props.surface?.onSendDraft(");
    expect(pageSource).toContain("artifactCompletionRequirement={pendingVideoArtifactCompletion");
    expect(surfaceSource).toContain("unchangedVideoArtifactIssue(");
    expect(surfaceSource).toContain("Continue the unfinished video delivery.");
  });

  test("adapts slide structure to the brief while retaining the template's visual system", () => {
    const prompt = templateBriefPrompt({
      template: {
        category: "slides",
        title: "Xiaohongshu Post Deck",
        applyChecklist: ["Keep the template hierarchy"],
      },
      entryPath: "design/ses_xhs/entry.html",
      briefPath: "design/ses_xhs/brief.json",
    });

    expect(prompt).toContain("reusable layout system rather than a finished deck");
    expect(prompt).toContain("plan a coherent narrative and page count from the brief");
    expect(prompt).toContain("select, repeat, recombine, adapt, remove, or reorder");
    expect(prompt).toContain("Do not inherit the sample slide count");
    expect(prompt).toContain("distinctive typography hierarchy, colored blocks, artwork");
    expect(prompt).not.toContain("Do not add or remove slides");
  });

  test("adapts website structure to the brief while retaining the template's visual system", () => {
    const prompt = templateBriefPrompt({
      template: {
        category: "site",
        title: "Architecture Index",
        applyChecklist: ["Keep the project index"],
      },
      entryPath: "design/ses_site/entry.html",
      briefPath: "design/ses_site/brief.json",
    });

    expect(prompt).toContain("Plan the information architecture and section order from the brief");
    expect(prompt).toContain("reuse, add, remove, or reorder the template's header");
    expect(prompt).toContain("Do not retain inherited sections merely because they exist");
    expect(prompt).toContain("do not rebuild the result as a generic split hero");
  });

});
