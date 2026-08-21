import type { TemplateCatalogItem, TemplateCategory, TemplateManifestV1 } from "@ipollowork/types/templates";
import { t } from "@/i18n";

export type TemplateBrief = {
  title: string;
  audience: string;
  details: string;
};

export const TEMPLATE_BRIEF_REFERENCE_ACCEPT = [
  ".pdf",
  ".docx",
  ".md",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".csv",
  ".json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
  "text/csv",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/webp",
].join(",");

export type TemplateBriefFields = TemplateBrief;

type TemplateBriefField = {
  key: keyof TemplateBriefFields;
  label: string;
  placeholder: string;
  optional?: boolean;
};

export type TemplateBriefConfig = {
  label: string;
  heading: string;
  description: string;
  submitLabel: string;
  fields: readonly [TemplateBriefField, TemplateBriefField, TemplateBriefField];
};

export function isVideoStudioReady(hasTemplateSession: boolean, hasBrief: boolean): boolean {
  return hasTemplateSession && hasBrief;
}

export type ConversationTemplateIntent = {
  category: TemplateCategory;
  prompt: string;
};

const CREATIVE_DELIVERABLE_ACTION = /(?:生成|制作|创建|设计|开发|搭建|编写|起草|输出|写(?:一份|一个|一套|一篇)?|做(?:一份|一个|一套|一张|一段|个)?|\b(?:create|build|develop|make|generate|design|produce|draft|write)\b)/i;
const EXPLANATION_ONLY_REQUEST = /(?:怎么|如何)(?:做|制作|创建|设计|生成)|(?:做|制作|创建|设计|生成).{0,12}(?:需要什么|用什么|有哪些|是什么|怎么|如何)|(?:什么|哪些).{0,8}(?:工具|方法|步骤)|(?:解释|介绍|教程|方法|步骤).{0,12}(?:ppt|幻灯片|演示文稿|视频|网页|网站|海报|报告|文章)|\bhow\s+(?:do|can|should|would)\b|\bhow\s+to\b|\bwhat\s+(?:tools?|steps?|methods?|software)\b|\bwhy\b/i;
const PLAN_ONLY_REQUEST = /(?:视频|动画|宣传片|短片)\s*(?:脚本|文案|创意方案)|(?:ppt|幻灯片|演示文稿)\s*(?:大纲|提纲)|(?:网页|网站)\s*(?:需求文档|策划方案)/i;

const CATEGORY_INTENT_PATTERNS: ReadonlyArray<{
  category: TemplateCategory;
  pattern: RegExp;
}> = [
  { category: "slides", pattern: /\bpptx?\b|幻灯片|演示文稿|路演稿|演示稿|\b(?:slide deck|slides|presentation|pitch deck|deck)\b/i },
  { category: "video", pattern: /视频|动画|短片|宣传片|片头|片尾|竖屏短视频|\b(?:video|animation|motion graphics?|reel|promo film)\b/i },
  { category: "cards", pattern: /社交卡片|轮播卡片|小红书卡片|信息卡片|\b(?:social cards?|carousel)\b/i },
  { category: "poster", pattern: /海报|横幅|主视觉|\b(?:poster|banner|key visual)\b/i },
  { category: "app", pattern: /应用原型|产品原型|交互原型|管理后台|控制台|仪表盘|\b(?:app|application|prototype|dashboard|admin console)\b/i },
  { category: "report", pattern: /分析报告|研究报告|数据报告|实验报告|周报|年报|\b(?:report|readout|weekly update)\b/i },
  { category: "article", pattern: /公众号文章|博客文章|长文|推文|文章|\b(?:article|blog post|editorial)\b/i },
  { category: "site", pattern: /落地页|着陆页|官网|网页|网站|页面|\bhtml\b|\b(?:landing page|website|webpage|web page|site)\b/i },
  { category: "other", pattern: /简历|履历|\b(?:resume|curriculum vitae|cv)\b/i },
];

const DEFAULT_TEMPLATE_IDS: Partial<Record<TemplateCategory, readonly string[]>> = {
  site: ["ipollowork.html-anything.prototype-web", "ipollowork.html-anything.web-proto-soft"],
  video: ["ipollowork.html-anything.motion-frames", "ipollowork.hyperframes.release-spotlight"],
  slides: ["ipollowork.pptx-brand-narrative", "ipollowork.html-anything.deck-blueprint"],
  app: ["ipollowork.app-creator-studio"],
  poster: ["ipollowork.html-anything.poster-hero"],
  cards: ["ipollowork.html-anything.social-carousel"],
  report: ["ipollowork.html-anything.data-report"],
  article: ["ipollowork.html-anything.article-magazine"],
};

const TEMPLATE_SEMANTIC_SIGNALS: ReadonlyArray<{
  request: RegExp;
  template: RegExp;
  score: number;
}> = [
  { request: /融资|路演|投资人|\b(?:fundrais|investor|pitch)\w*\b/i, template: /pitch|fundrais|investor/i, score: 36 },
  { request: /品牌|品牌故事|\bbrand\w*\b/i, template: /brand|narrative/i, score: 28 },
  { request: /产品发布|新品|上线|\b(?:product launch|release|launch)\b/i, template: /product|launch|release|spotlight/i, score: 28 },
  { request: /课程|教学|培训|\b(?:course|lesson|training|education)\b/i, template: /course|lesson|training|education/i, score: 28 },
  { request: /代码|编程|技术讲解|\b(?:code|coding|developer|technical)\b/i, template: /code|developer|technical|tech/i, score: 26 },
  { request: /竖屏|短视频|社交媒体|小红书|抖音|\b(?:vertical|social|reel|tiktok)\b/i, template: /vertical|social|reel|xhs/i, score: 32 },
  { request: /财务|金融|股票|投资|\b(?:finance|financial|stock|equity)\b/i, template: /finance|financial|stock|equity/i, score: 28 },
  { request: /数据|图表|分析|仪表盘|\b(?:data|chart|analytics|dashboard)\b/i, template: /data|chart|analytics|dashboard|report/i, score: 22 },
  { request: /建筑|作品集|\b(?:architecture|portfolio|atelier)\b/i, template: /architecture|portfolio|atelier/i, score: 28 },
  { request: /极简|简约|\bminimal\b/i, template: /minimal/i, score: 16 },
  { request: /柔和|圆润|\bsoft\b/i, template: /soft/i, score: 16 },
  { request: /粉彩|小清新|\bpastel\b/i, template: /pastel/i, score: 16 },
  { request: /暗色|深色|黑色|\b(?:dark|obsidian)\b/i, template: /dark|obsidian/i, score: 16 },
  { request: /赛博|科技感|\bcyber\b/i, template: /cyber/i, score: 16 },
  { request: /编辑部|杂志|\b(?:editorial|magazine)\b/i, template: /editorial|magazine/i, score: 16 },
  { request: /手绘|线框|草图|\b(?:sketch|wireframe)\b/i, template: /sketch|wireframe/i, score: 16 },
];

function templateSearchText(item: TemplateCatalogItem): string {
  const { manifest } = item;
  return [
    manifest.id,
    manifest.title,
    manifest.description,
    manifest.subcategory,
    manifest.style,
    ...manifest.tags,
  ].join(" ").toLowerCase();
}

function promptSearchTerms(prompt: string): string[] {
  const latinTerms = prompt.toLowerCase().match(/[a-z][a-z0-9-]{1,}/g) ?? [];
  const cjkTerms = prompt.match(/[\u3400-\u9fff]{2,6}/g) ?? [];
  return [...new Set([...latinTerms, ...cjkTerms])];
}

export function inferConversationTemplateIntent(prompt: string): ConversationTemplateIntent | null {
  return inferConversationTemplateIntents(prompt)[0] ?? null;
}

export function inferConversationTemplateIntents(prompt: string): ConversationTemplateIntent[] {
  const normalized = prompt.trim();
  if (!normalized || !CREATIVE_DELIVERABLE_ACTION.test(normalized)) return [];
  if (EXPLANATION_ONLY_REQUEST.test(normalized) || PLAN_ONLY_REQUEST.test(normalized)) return [];
  return CATEGORY_INTENT_PATTERNS
    .filter(({ pattern }) => pattern.test(normalized))
    .map(({ category }) => ({ category, prompt: normalized }));
}

export function conversationArtifactSessionId(sessionId: string, category: TemplateCategory) {
  const suffix = `-artifact-${category}`;
  return `${sessionId.slice(0, 256 - suffix.length)}${suffix}`;
}

export function conversationTemplateBrief(prompt: string): TemplateBrief {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  const title = normalized
    .replace(/^(?:请|麻烦)?\s*(?:帮我|给我|我要|我需要|我想要)?\s*/i, "")
    .replace(/^(?:生成|制作|创建|设计|开发|搭建|编写|起草|输出|写|做)\s*/i, "")
    .slice(0, 96)
    .trim() || "对话生成内容";
  return {
    title,
    audience: "根据当前对话推断目标受众；如需求中已明确受众，以明确内容为准。",
    details: prompt.trim(),
  };
}

export function selectConversationTemplate(
  prompt: string,
  catalog: readonly TemplateCatalogItem[],
  requestedCategory?: TemplateCategory,
): TemplateCatalogItem | null {
  const intent = requestedCategory
    ? { category: requestedCategory, prompt: prompt.trim() }
    : inferConversationTemplateIntent(prompt);
  if (!intent) return null;
  const candidates = catalog.filter((item) => item.installed && item.manifest.category === intent.category);
  if (candidates.length === 0) return null;
  const terms = promptSearchTerms(intent.prompt);
  const defaults = DEFAULT_TEMPLATE_IDS[intent.category] ?? [];
  const requestsNativeSlides = intent.category === "slides" && /\bpptx?\b|可编辑|导出.{0,5}ppt/i.test(intent.prompt);
  const requestsHtmlSlides = intent.category === "slides" && /\bhtml\b|网页演示/i.test(intent.prompt);

  return [...candidates].sort((left, right) => {
    const score = (item: TemplateCatalogItem) => {
      const searchText = templateSearchText(item);
      let value = item.sourceType === "local" || item.sourceType === "market" ? 2 : 0;
      for (const term of terms) {
        if (searchText.includes(term.toLowerCase())) value += term.length > 4 ? 4 : 2;
      }
      for (const signal of TEMPLATE_SEMANTIC_SIGNALS) {
        if (signal.request.test(intent.prompt) && signal.template.test(searchText)) value += signal.score;
      }
      if (requestsNativeSlides && item.manifest.pptxCompatibility === "native-editable") value += 24;
      if (requestsHtmlSlides && item.manifest.pptxCompatibility !== "native-editable") value += 18;
      const defaultIndex = defaults.indexOf(item.manifest.id);
      if (defaultIndex >= 0) value += Math.max(1, 8 - defaultIndex);
      return value;
    };
    return score(right) - score(left)
      || left.manifest.title.localeCompare(right.manifest.title)
      || left.manifest.id.localeCompare(right.manifest.id);
  })[0] ?? null;
}

function briefField(key: keyof TemplateBriefFields, label: string, placeholder: string, optional = false): TemplateBriefField {
  return { key, label, placeholder, optional };
}

type TemplateBriefConfigKeys = {
  label: string;
  heading: string;
  description: string;
  submit: string;
  titleLabel: string;
  titlePlaceholder: string;
  audienceLabel: string;
  audiencePlaceholder: string;
  detailsLabel: string;
  detailsPlaceholder: string;
};

const BRIEF_CONFIG_KEYS: Record<TemplateCategory | "resume", TemplateBriefConfigKeys> = {
  site: {
    label: "templates.brief.site.label",
    heading: "templates.brief.site.heading",
    description: "templates.brief.site.description",
    submit: "templates.brief.site.submit",
    titleLabel: "templates.brief.site.title_label",
    titlePlaceholder: "templates.brief.site.title_placeholder",
    audienceLabel: "templates.brief.site.audience_label",
    audiencePlaceholder: "templates.brief.site.audience_placeholder",
    detailsLabel: "templates.brief.site.details_label",
    detailsPlaceholder: "templates.brief.site.details_placeholder",
  },
  app: {
    label: "templates.brief.app.label",
    heading: "templates.brief.app.heading",
    description: "templates.brief.app.description",
    submit: "templates.brief.app.submit",
    titleLabel: "templates.brief.app.title_label",
    titlePlaceholder: "templates.brief.app.title_placeholder",
    audienceLabel: "templates.brief.app.audience_label",
    audiencePlaceholder: "templates.brief.app.audience_placeholder",
    detailsLabel: "templates.brief.app.details_label",
    detailsPlaceholder: "templates.brief.app.details_placeholder",
  },
  slides: {
    label: "templates.brief.slides.label",
    heading: "templates.brief.slides.heading",
    description: "templates.brief.slides.description",
    submit: "templates.brief.slides.submit",
    titleLabel: "templates.brief.slides.title_label",
    titlePlaceholder: "templates.brief.slides.title_placeholder",
    audienceLabel: "templates.brief.slides.audience_label",
    audiencePlaceholder: "templates.brief.slides.audience_placeholder",
    detailsLabel: "templates.brief.slides.details_label",
    detailsPlaceholder: "templates.brief.slides.details_placeholder",
  },
  poster: {
    label: "templates.brief.poster.label",
    heading: "templates.brief.poster.heading",
    description: "templates.brief.poster.description",
    submit: "templates.brief.poster.submit",
    titleLabel: "templates.brief.poster.title_label",
    titlePlaceholder: "templates.brief.poster.title_placeholder",
    audienceLabel: "templates.brief.poster.audience_label",
    audiencePlaceholder: "templates.brief.poster.audience_placeholder",
    detailsLabel: "templates.brief.poster.details_label",
    detailsPlaceholder: "templates.brief.poster.details_placeholder",
  },
  cards: {
    label: "templates.brief.cards.label",
    heading: "templates.brief.cards.heading",
    description: "templates.brief.cards.description",
    submit: "templates.brief.cards.submit",
    titleLabel: "templates.brief.cards.title_label",
    titlePlaceholder: "templates.brief.cards.title_placeholder",
    audienceLabel: "templates.brief.cards.audience_label",
    audiencePlaceholder: "templates.brief.cards.audience_placeholder",
    detailsLabel: "templates.brief.cards.details_label",
    detailsPlaceholder: "templates.brief.cards.details_placeholder",
  },
  report: {
    label: "templates.brief.report.label",
    heading: "templates.brief.report.heading",
    description: "templates.brief.report.description",
    submit: "templates.brief.report.submit",
    titleLabel: "templates.brief.report.title_label",
    titlePlaceholder: "templates.brief.report.title_placeholder",
    audienceLabel: "templates.brief.report.audience_label",
    audiencePlaceholder: "templates.brief.report.audience_placeholder",
    detailsLabel: "templates.brief.report.details_label",
    detailsPlaceholder: "templates.brief.report.details_placeholder",
  },
  article: {
    label: "templates.brief.article.label",
    heading: "templates.brief.article.heading",
    description: "templates.brief.article.description",
    submit: "templates.brief.article.submit",
    titleLabel: "templates.brief.article.title_label",
    titlePlaceholder: "templates.brief.article.title_placeholder",
    audienceLabel: "templates.brief.article.audience_label",
    audiencePlaceholder: "templates.brief.article.audience_placeholder",
    detailsLabel: "templates.brief.article.details_label",
    detailsPlaceholder: "templates.brief.article.details_placeholder",
  },
  video: {
    label: "templates.brief.video.label",
    heading: "templates.brief.video.heading",
    description: "templates.brief.video.description",
    submit: "templates.brief.video.submit",
    titleLabel: "templates.brief.video.title_label",
    titlePlaceholder: "templates.brief.video.title_placeholder",
    audienceLabel: "templates.brief.video.audience_label",
    audiencePlaceholder: "templates.brief.video.audience_placeholder",
    detailsLabel: "templates.brief.video.details_label",
    detailsPlaceholder: "templates.brief.video.details_placeholder",
  },
  other: {
    label: "templates.brief.other.label",
    heading: "templates.brief.other.heading",
    description: "templates.brief.other.description",
    submit: "templates.brief.other.submit",
    titleLabel: "templates.brief.other.title_label",
    titlePlaceholder: "templates.brief.other.title_placeholder",
    audienceLabel: "templates.brief.other.audience_label",
    audiencePlaceholder: "templates.brief.other.audience_placeholder",
    detailsLabel: "templates.brief.other.details_label",
    detailsPlaceholder: "templates.brief.other.details_placeholder",
  },
  resume: {
    label: "templates.brief.resume.label",
    heading: "templates.brief.resume.heading",
    description: "templates.brief.resume.description",
    submit: "templates.brief.resume.submit",
    titleLabel: "templates.brief.resume.title_label",
    titlePlaceholder: "templates.brief.resume.title_placeholder",
    audienceLabel: "templates.brief.resume.audience_label",
    audiencePlaceholder: "templates.brief.resume.audience_placeholder",
    detailsLabel: "templates.brief.resume.details_label",
    detailsPlaceholder: "templates.brief.resume.details_placeholder",
  },
};

function briefConfig(keys: TemplateBriefConfigKeys): TemplateBriefConfig {
  return {
    label: t(keys.label),
    heading: t(keys.heading),
    description: t(keys.description),
    submitLabel: t(keys.submit),
    fields: [
      briefField("title", t(keys.titleLabel), t(keys.titlePlaceholder)),
      briefField("audience", t(keys.audienceLabel), t(keys.audiencePlaceholder)),
      briefField("details", t(keys.detailsLabel), t(keys.detailsPlaceholder), true),
    ],
  };
}

export function isResumeTemplate(template: Pick<TemplateManifestV1, "category"> & Partial<Pick<TemplateManifestV1, "subcategory" | "title">>): boolean {
  const identity = `${template.subcategory ?? ""} ${template.title ?? ""}`.toLowerCase();
  return template.category === "other" && /\b(?:resume|curriculum vitae|cv)\b|简历/i.test(identity);
}

export function templateBriefConfigFor(template: Pick<TemplateManifestV1, "category"> & Partial<Pick<TemplateManifestV1, "subcategory" | "title">>): TemplateBriefConfig {
  if (isResumeTemplate(template)) return briefConfig(BRIEF_CONFIG_KEYS.resume);
  return briefConfig(BRIEF_CONFIG_KEYS[template.category]);
}

export function templateBriefPrompt(input: {
  template: Pick<TemplateManifestV1, "category" | "title" | "applyChecklist"> & Partial<Pick<TemplateManifestV1, "id" | "subcategory" | "pptxCompatibility">>;
  entryPath: string;
  briefPath: string;
}): string {
  const base = `Read \`${input.briefPath}\` and apply it to the selected \`${input.template.title}\` template at \`${input.entryPath}\`. Keep the template's visual language and update every applicable item in this checklist: ${input.template.applyChecklist.join("; ")}.`;
  if (input.template.id === "ipollowork.wechat-article") {
    return `${base} This template has locked brand colors and fixed brand images. Update only the article copy and non-fixed middle article images. Preserve every data-ipw-fixed="true" node exactly, keep fixed-hero.jpg and fixed-footer-cta.jpg unchanged, and only edit the href on a.fixed-footer-cta when a CTA link is provided. Do not write instruction conflicts or process notes into the HTML.`;
  }
  const colorInstruction = "Keep the template's final design-tokens.css link and preserve its current theme as the visual source of truth. During this initial brief application, do not change the managed theme block, existing --ipw-* token values, palette, fonts, radii, shadows, or background treatment. Do not introduce higher-priority inline styles or hardcoded colors that override the template theme. Theme changes belong to the Design System panel after initialization. Preserve the DOM skeleton, dimensions, layout, animation, and timing.";
  switch (input.template.category) {
    case "video":
      return `${base} ${colorInstruction} Build this exact video template, not a blank or unrelated project. Decide whether narration materially helps the stated goal; do not ask a separate narration question. Preserve the editable composition, variables, and scene structure while making the content fit the brief.`;
    case "slides":
      const compositionInstruction = "The existing HTML and CSS are the layout source of truth. Update existing elements in place: retain the selected template's slide count, section order, containers, class names, positioning, typography hierarchy, and visual rhythm. Do not replace the template with a generic deck, generic white background, generic cards, or a newly invented slide skeleton. Keep the template's colored blocks, artwork, decorative elements, and template-specific components; adapt their copy and declared theme tokens only when needed for the brief.";
      if (input.template.pptxCompatibility === "native-editable") {
        return `${base} ${colorInstruction} ${compositionInstruction} Rewrite the complete deck's content, not one slide. Preserve the existing fixed 16:9 stage and every data-pptx-text, data-pptx-shape, and data-pptx-image marker. The Design panel owns slide navigation: do not add <script> tags, custom keyboard handlers, slide counters, navigation buttons, or speaker notes. Do not add responsive slide reflow or breakpoint-specific slide layouts; narrow previews scale the same 16:9 stage. Build a coherent decision-oriented narrative from the brief. Never invent metrics; clearly mark missing evidence for the user to replace. Do not add or remove slides unless the existing template already has that exact structure, and keep every visible slide element within the native PPTX marker contract.`;
      }
      return `${base} ${colorInstruction} ${compositionInstruction} Rewrite the complete deck's content, not one slide. Keep the existing 16:9 slide system, keyboard navigation, controls, theme tokens, and separate speaker notes. Build a coherent decision-oriented narrative from the brief. Never invent metrics; clearly mark missing evidence for the user to replace. Do not add or remove slides unless the existing template already has that exact structure, and keep every slide editable in the Design panel.`;
    case "site":
      return `${base} ${colorInstruction} The existing website HTML and CSS are the layout source of truth. Update existing elements in place and retain the current header and navigation composition, section hierarchy and order, containers, template-specific class names, artwork, component geometry, visual rhythm, and responsive behavior. Replace content inside that structure; do not rebuild it as a generic split hero, statistics strip, feature-card grid, project grid, or standard landing-page scaffold. Update the complete website, not a partial copy edit. Replace inherited names, navigation labels, links, headings, calls to action, cards, metadata, and footer content with information consistent with the brief. Keep it responsive on desktop and mobile, and keep every part editable in the Design panel.`;
    case "app":
      return `${base} ${colorInstruction} Update the complete App prototype, including the key screens and flows implied by the brief. Keep the interface coherent, realistic, and editable in the Design panel; do not turn it into a marketing website.`;
    case "report":
      return `${base} ${colorInstruction} Build a clear report narrative with decision-ready sections and visual hierarchy. Do not invent data; mark unknown values for the user to replace.`;
    case "article":
      return `${base} ${colorInstruction} Write the complete article in the template's editorial style, with a coherent hierarchy and readable body copy; do not leave inherited placeholder content.`;
    case "poster":
    case "cards":
      return `${base} ${colorInstruction} Update all visible copy and art direction so the visual message is immediately clear. Preserve the template's composition and make every text element editable.`;
    default:
      if (isResumeTemplate(input.template)) {
        return `${base} ${colorInstruction} Build a complete professional resume from the brief. Structure experience, skills, and outcomes clearly, and remove inherited placeholder identity and employment details.`;
      }
      return `${base} ${colorInstruction} Update the complete artifact rather than only one section, and do not leave inherited placeholder content.`;
  }
}
