import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ARTIFACT_DELIVERY_ID_PREFIX,
  templateCategorySchema,
  type TemplateCatalogItem,
  type TemplateCategory,
  type TemplateManifestV1,
} from "@ipollowork/types/templates";

import { setLocale } from "../src/i18n";

import {
  conversationArtifactSessionId,
  conversationTemplateBrief,
  conversationVideoTarget,
  inferConversationTemplateIntent,
  inferConversationTemplateIntents,
  isConversationTemplateSessionId,
  isVideoStudioReady,
  nextConversationArtifactSessionId,
  requestsCustomTemplate,
  selectConversationTemplate,
  shouldUseExistingTemplateContext,
  templateBriefConfigFor,
  templateBriefPrompt,
  templateBriefUserMessage,
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
  test.each(templateCategorySchema.options)("routes both template and custom %s generation to type rules", (category) => {
    for (const id of ["test.template", ARTIFACT_DELIVERY_ID_PREFIX + category]) {
      const prompt = templateBriefPrompt({
        template: catalogItem({ id, category, title: "Example" }).manifest,
        entryPath: "design/test/entry.html",
        briefPath: "design/test/brief.json",
      });
      if (category === "slides") {
        expect(prompt).toContain("iPolloWork Presentations workflow");
        expect(prompt).not.toContain("design-slides.md");
      } else if (category === "video") {
        expect(prompt).toContain("ipollowork-video-studio");
        expect(prompt).toContain("references/shared-guidelines.md and references/video.md");
        expect(prompt).toContain("core-v1-video/catalog.md");
        expect(prompt).not.toContain("design-video.md");
      } else {
        expect(prompt).toContain(`references/design-${category}.md`);
        expect(prompt).toContain("references/shared-guidelines.md");
        expect(prompt).toContain("media/artifact_media_review phase=plan");
        expect(prompt).not.toContain("slides-ppt.md");
      }
    }
  });

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

  test("keeps the submitted template brief visible as the user message", () => {
    expect(templateBriefUserMessage({
      template: { category: "video", title: "Agent Command Center" },
      brief: { title: "123", audience: "Operations teams", details: "Explain steps 1-2-3" },
    })).toBe([
      "Template applied: Agent Command Center",
      "Video topic: 123",
      "Who it is for: Operations teams",
      "What it should communicate or drive: Explain steps 1-2-3",
    ].join("\n"));
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

    expect(video).toContain("Follow the Video voiceover contract and saved voiceover.json settings");
    expect(video).not.toContain("Decide whether narration materially helps");
    expect(video).toContain("content-led storyboard");
    expect(video).toContain("add, remove, reorder, or retime scenes");
    expect(video).toContain("If brief.style is empty, preserve the template theme");
    expect(video).toContain("/* ipw-theme:start */");
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

    // Includes bounded layer selection and rendering rules; layout sources stay on disk.
    // The slide media gate includes the explicit multi-model question protocol.
    expect(prompt.length).toBeLessThan(5_000);
    expect(prompt).toContain("Read `design/ses_morrow/brief.json`");
    expect(prompt).toContain("Edit/save target files now");
    expect(prompt).toContain("Deliver files, not just a plan or confirmation");
    expect(prompt).toContain("native editable PPTX contract");
    expect(prompt).toContain("Before layout, call media/artifact_media_review phase=plan");
    expect(prompt).toContain("Before final call phase=check");
    expect(prompt).toContain("original generationPath");
    expect(prompt).toContain("multiple suitable models without preference/policy require one question");
    expect(prompt).toContain("never silent defaultModel or geometry downgrade");
    expect(prompt).toContain("Resolve pending/missing assets");
    expect(prompt).toContain("continue the file without opening settings");
  });

  test("recognizes explicit creative deliverables but leaves explanatory questions as normal chat", () => {
    expect(inferConversationTemplateIntent("帮我生成一份融资路演PPT")?.category).toBe("slides");
    expect(inferConversationTemplateIntent("制作一个竖屏产品发布视频")?.category).toBe("video");
    expect(inferConversationTemplateIntent("创建一个 AI 产品落地页")?.category).toBe("site");
    expect(inferConversationTemplateIntent("再做个网页")?.category).toBe("site");
    expect(inferConversationTemplateIntent("测试首条消息")).toBeNull();
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

  test.each([
    "生成视频",
    "帮我做一个 30 秒竖屏产品宣传片，最后导出 MP4",
    "根据这张图片制作写实视频",
    "生成 HTML 视频",
    "生成 Video Studio 支持的视频",
    "生成 Video Stuido 支持的视频",
    "生成介绍 Sora 的视频",
    "不用插件，生成视频",
    "不要视频素材，生成视频",
    "Make a video without a plugin",
    "用可灵生成视频素材，再合成完整视频",
    "用这些视频素材制作宣传片",
    "先生成视频素材，然后剪辑成宣传片",
    "Generate footage and assemble the clips into a complete video",
    "给现有视频添加新生成的视频素材",
    "生成一段视频素材加到当前视频里",
    "用视频素材在 Video Studio 生成视频",
  ])("routes a composition request to exactly one video artifact: %s", (prompt) => {
    expect(conversationVideoTarget(prompt)).toBe("studio");
    expect(inferConversationTemplateIntents(prompt).map((intent) => intent.category)).toEqual(["video"]);
  });

  test.each([
    "用插件生成视频",
    "用可灵插件生成视频",
    "用可灵生成视频",
    "用 Seedance 生成视频",
    "通过视频模型生成视频",
    "只生成视频素材",
    "生成一段原始视频",
    "生成镜头素材视频",
    "生成图生视频",
    "生成视频素材，不要 HTML 视频",
    "不要用 Video Studio，用插件生成视频",
    "不是 HTML 视频，生成纯视频素材",
    "在 Video Studio 里用插件生成视频素材",
    "Generate a video using Runway",
    "Generate B-roll footage",
    "Make a raw video clip",
  ])("leaves explicit footage requests to media tools: %s", (prompt) => {
    expect(conversationVideoTarget(prompt)).toBe("media");
    expect(inferConversationTemplateIntents(prompt)).toEqual([]);
  });

  test("keeps unrelated deliverables when a video is explicitly plugin-generated", () => {
    expect(inferConversationTemplateIntents("制作产品 PPT，并用插件生成视频").map((intent) => intent.category)).toEqual(["slides"]);
    expect(inferConversationTemplateIntents("生成 HTML 视频和一个官网").map((intent) => intent.category)).toEqual(["video", "site"]);
    expect(inferConversationTemplateIntent("写一个图生视频脚本")).toBeNull();
    expect(inferConversationTemplateIntent("如何用插件生成视频")).toBeNull();
    expect(conversationVideoTarget("生成一个官网")).toBeNull();
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

  test("keeps ordinary questions out of an existing template edit context", () => {
    expect(shouldUseExistingTemplateContext("你是谁")).toBe(false);
    expect(shouldUseExistingTemplateContext("为什么这个视频会卡")).toBe(false);
    expect(shouldUseExistingTemplateContext("如何修改这个视频")).toBe(false);
    expect(shouldUseExistingTemplateContext("把标题改成红色")).toBe(true);
    expect(shouldUseExistingTemplateContext("继续优化视频节奏")).toBe(true);
    expect(shouldUseExistingTemplateContext("Remove the second scene")).toBe(true);
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
    expect(routeSource).toContain("shouldUseExistingTemplateContext(text)");
    expect(routeSource).not.toContain("conversationTemplates.slice(0, 1)");
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
    expect(pageSource).toContain("pendingProgrammaticDraft={pendingTemplateDispatch");
    expect(pageSource).toContain("artifactCompletionRequirement={pendingVideoArtifactCompletion");
    expect(surfaceSource).toContain("sendDraft(pending.draft, pending.draft.attachments)");
    expect(surfaceSource).toContain("beginOptimisticSessionPrompt(");
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

    expect(prompt).toContain("reorder template layouts");
    expect(prompt).toContain("Plan the narrative from the brief");
    expect(prompt).toContain("reuse, repeat, adapt, remove, or reorder");
    expect(prompt).toContain("template/checklist quantities are examples");
    expect(prompt).toContain("distinctive typography, colored blocks, artwork");
  expect(prompt).not.toContain("Do not add or remove slides");
});

test("routes every slide template through presentation rules and the default layout library", () => {
  const prompt = templateBriefPrompt({
    template: {
      category: "slides",
      title: "Legacy HTML Deck",
      applyChecklist: ["Keep the visual language"],
    },
    entryPath: "design/ses_legacy/entry.html",
    briefPath: "design/ses_legacy/brief.json",
  });

  expect(prompt).toContain("iPolloWork Presentations workflow");
  expect(prompt).toContain("shared-guidelines.md, slides-ppt.md and layout.md");
  expect(prompt).toContain("core-v1-slides/catalog.md");
  expect(prompt).toContain("write a new layout");
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


test.each(["site", "app", "slides", "poster", "cards", "report", "article", "video", "other", "resume"] as const)("%s template honors editable brief style", (category) => {
  const prompt = templateBriefPrompt({ template: { category, title: "Reference style", applyChecklist: [] }, entryPath: "index.html", briefPath: "brief.json" });
  expect(prompt).toContain("Reference/brief.style sets INITIAL defaults only");
  expect(prompt).toContain("later user theme/token edits win");
  expect(prompt).toContain("Preserve fixed-brand assets");
});


test.each(["ipollowork.wechat-article", `${ARTIFACT_DELIVERY_ID_PREFIX}slides`])("%s also treats reference colors as replaceable defaults", (id) => {
  const prompt = templateBriefPrompt({ template: { id, category: "slides", title: "Example", applyChecklist: [] }, entryPath: "index.html", briefPath: "brief.json" });
  expect(prompt).toContain("Reference/brief.style sets INITIAL defaults only");
  expect(prompt).toContain("No hardcoded theme colors");
});

test("template quantities remain examples for design and video, including blank scaffolds", () => {
  for (const category of ["slides", "video", "site"] satisfies TemplateCategory[]) {
    for (const id of ["example-template", `${ARTIFACT_DELIVERY_ID_PREFIX}${category}`]) {
      const prompt = templateBriefPrompt({
        template: { id, category, title: "Example", applyChecklist: ["Keep 10 pages and a fixed 60 seconds."] },
        entryPath: "index.html", briefPath: "brief.json",
      });
      expect(prompt).toContain("template/checklist quantities are examples");
      expect(prompt).toContain("only when explicitly requested by the user");
      expect(prompt).toContain("Never omit important content or add filler");
    }
  }
});


test("template adaptation covers content roles and preserves explicit layout constraints", () => {
  for (const category of ["slides", "site", "video", "article"] satisfies TemplateCategory[]) {
    const prompt = templateBriefPrompt({
      template: { category, title: "Three-card sample", applyChecklist: ["Keep the three-card layout."] },
      entryPath: "index.html", briefPath: "brief.json",
    });
    expect(prompt).toContain("Template/checklist layout examples are not mandatory structures");
    expect(prompt).toContain("create a new composition from the same visual primitives");
    expect(prompt).toContain("If the user explicitly requests exact template layout, honor it");
    expect(prompt).toContain("For targeted follow-up edits, apply adaptation only within the requested scope");
    expect(prompt).toContain("Keep explicit fixed-brand regions");
    expect(prompt).toContain("inspect rendered pages/scenes");
    expect(prompt).not.toContain("Preserve fixed-brand assets, layout and timing.");
  }
});


test("template application points to its packaged layout guide without inventing one for legacy templates", () => {
  const template = { category: "site", title: "Guided", applyChecklist: ["Replace sample content"] } satisfies Pick<TemplateManifestV1, "category" | "title" | "applyChecklist">;
  const paths = { entryPath: "design/example/pages/index.html", briefPath: "design/example/brief.json" };
  const legacy = templateBriefPrompt({ template, ...paths });
  const guided = templateBriefPrompt({ template: { ...template, authoringGuide: "references/layouts.md" }, ...paths });
  expect(legacy).not.toContain("Read guide");
  expect(guided).toContain('"references/layouts.md" relative to brief.json');
  expect(guided).toContain("inspect its source layouts");
});

test("shared layouts provide structure while the selected template owns visual rules", () => {
  const prompt = templateBriefPrompt({ template: { category: "site", title: "Example", applyChecklist: ["Replace sample copy"], layoutLibrary: "core-v1" }, entryPath: "design/example/entry.html", briefPath: "design/example/brief.json" });
  expect(prompt).toContain("core-v1-site/catalog.md");
  expect(prompt).toContain("core-v1-site/shared-contract.md");
  expect(prompt).toContain("Retain active tokens");
  expect(prompt).toContain("content topic is not permission to change theme");
  expect(prompt).toContain("isolated final characters");
});

test("artifact delivery reads the shared slide layout library", () => {
  const prompt = templateBriefPrompt({
    template: {
      id: "ipollowork.delivery.pptx",
      category: "slides",
      title: "Native editable PPT deliverable",
      applyChecklist: ["Keep the 16:9 stage"],
      pptxCompatibility: "native-editable",
      layoutLibrary: "core-v1",
    },
    entryPath: "design/example/entry.html",
    briefPath: "design/example/brief.json",
  });
  expect(prompt).toContain("core-v1-slides/catalog.md");
  expect(prompt).toContain("Select by type then content relationship");
  expect(prompt).toContain("reuse fitting global/local structures");
});

test("unified layout index routes template and custom tasks to only their active type", () => {
  for (const category of ["slides", "site", "video"] satisfies TemplateCategory[]) {
    for (const id of ["legacy-template", `${ARTIFACT_DELIVERY_ID_PREFIX}${category}`]) {
      const prompt = templateBriefPrompt({
        template: { id, category, title: "Example", applyChecklist: [] },
        entryPath: "design/test/entry.html", briefPath: "design/test/brief.json",
      });
      expect(prompt).toContain("core-v1-index.md");
      expect(prompt.indexOf("core-v1-index.md")).toBeLessThan(prompt.indexOf(`core-v1-${category}/catalog.md`));
      expect(prompt).toContain(`core-v1-${category}/shared-contract.md`);
      for (const other of ["slides", "site", "video"].filter((type) => type !== category)) {
        expect(prompt).not.toContain(`core-v1-${other}/catalog.md`);
      }
    }
  }
  for (const category of ["app", "poster", "cards", "report", "article", "other"] satisfies TemplateCategory[]) {
    expect(templateBriefPrompt({
      template: { category, title: "Example", applyChecklist: [] },
      entryPath: "entry.html", briefPath: "brief.json",
    })).not.toContain("core-v1-index.md");
  }
});
