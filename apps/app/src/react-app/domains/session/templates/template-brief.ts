import {
  isArtifactDeliveryManifest,
  type TemplateCatalogItem,
  type TemplateCategory,
  type TemplateManifestV1,
} from "@ipollowork/types/templates";
import { t } from "@/i18n";

export type TemplateBrief = {
  title: string;
  audience: string;
  details: string;
};

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
const EXISTING_TEMPLATE_EDIT_ACTION = /(?:修改|编辑|调整|优化|更新|完善|修复|改进|改成|改为|换成|换为|替换|重做|重新制作|继续(?:做|改|编辑|调整|优化|完善)|增加|添加|加上|插入|删除|移除|去掉|缩短|延长|放大|缩小|导出|渲染|\b(?:edit|change|update|revise|adjust|optimize|improve|fix|replace|restyle|rewrite|continue|add|insert|remove|delete|shorten|extend|resize|export|render)\b)/i;
const EXISTING_TEMPLATE_EDIT_QUESTION = /^(?:请)?(?:告诉我)?\s*(?:怎么|如何)|^(?:can you explain\s+)?how\s+(?:do|can|should|would|to)\b/i;
const CUSTOM_TEMPLATE_REQUEST = /(?:自定义(?:模板|模版|样式|设计)?|空白(?:模板|模版|骨架)?)(?:.{0,12}(?:ppt|幻灯片|演示文稿|视频|网页|网站|海报|卡片|报告|文章))?|(?:不用|不要|不使用|别用)(?:任何)?(?:系统|市场|现有|预设)?\s*(?:模板|模版)|\b(?:custom|blank|from scratch|without (?:a |the )?template|no template)\b/i;

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

export function shouldUseExistingTemplateContext(prompt: string) {
  const normalized = prompt.trim();
  if (!normalized
    || EXPLANATION_ONLY_REQUEST.test(normalized)
    || EXISTING_TEMPLATE_EDIT_QUESTION.test(normalized)) return false;
  return EXISTING_TEMPLATE_EDIT_ACTION.test(normalized);
}

export function conversationArtifactSessionId(sessionId: string, category: TemplateCategory) {
  const suffix = `-artifact-${category}`;
  return `${sessionId.slice(0, 256 - suffix.length)}${suffix}`;
}

const CONVERSATION_ARTIFACT_SESSION_PATTERN = /^(.*)-artifact-(site|video|app|slides|poster|cards|report|article|other)(?:-(\d+))?$/;

/**
 * Template instances use their own runtime session and artifact directory,
 * while remaining owned by the conversation that created them. Exact matches
 * preserve sessions created before multi-template conversations were added.
 */
export function isConversationTemplateSessionId(conversationId: string, templateSessionId: string) {
  if (templateSessionId === conversationId) return true;
  const match = CONVERSATION_ARTIFACT_SESSION_PATTERN.exec(templateSessionId);
  if (!match) return false;
  const embeddedConversationId = match[1] ?? "";
  return embeddedConversationId === conversationId.slice(0, embeddedConversationId.length);
}

export function nextConversationArtifactSessionId(
  conversationId: string,
  category: TemplateCategory,
  existingSessionIds: readonly string[],
) {
  const occupied = new Set(existingSessionIds);
  const first = conversationArtifactSessionId(conversationId, category);
  if (!occupied.has(first)) return first;

  for (let instance = 2; instance < 10_000; instance += 1) {
    const instanceSuffix = `-artifact-${category}-${instance}`;
    const candidate = `${conversationId.slice(0, 256 - instanceSuffix.length)}${instanceSuffix}`;
    if (!occupied.has(candidate)) return candidate;
  }

  throw new Error("This conversation has too many template instances.");
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

export function requestsCustomTemplate(prompt: string): boolean {
  return CUSTOM_TEMPLATE_REQUEST.test(prompt.trim());
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
  if (requestsCustomTemplate(intent.prompt)) return null;
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

export function templateBriefUserMessage(input: {
  template: Pick<TemplateManifestV1, "category" | "title"> & Partial<Pick<TemplateManifestV1, "subcategory">>;
  brief: TemplateBrief;
}): string {
  const fields = templateBriefConfigFor(input.template).fields
    .map((field) => {
      const value = input.brief[field.key].trim();
      return value ? `${field.label}: ${value}` : null;
    })
    .filter((line): line is string => Boolean(line));
  return [t("templates.applied", { title: input.template.title }), ...fields].join("\n");
}

export function templateBriefPrompt(input: {
  template: Pick<TemplateManifestV1, "category" | "title" | "applyChecklist"> & Partial<Pick<TemplateManifestV1, "id" | "subcategory" | "pptxCompatibility">>;
  entryPath: string;
  briefPath: string;
}): string {
  const checklist = input.template.applyChecklist.join("; ");
  if (input.template.id && isArtifactDeliveryManifest({ id: input.template.id })) {
    const categoryContract = input.template.category === "slides" && input.template.pptxCompatibility === "native-editable"
      ? "Preserve the fixed 16:9 stage and native editable PPTX contract: every visible object must use supported data-pptx-text, data-pptx-shape, or data-pptx-image markers. The Design panel owns slide navigation; do not add scripts, custom keyboard handlers, slide counters, navigation buttons, speaker notes, responsive slide reflow, or breakpoint-specific slide layouts."
      : input.template.category === "video"
        ? "Build a complete deterministic HyperFrames composition with the duration, scenes, motion, and editable variables required by the brief."
        : "Keep the result responsive, semantic, complete, and editable through the existing artifact runtime hooks.";
    return `Read \`${input.briefPath}\` and use the blank scaffold at \`${input.entryPath}\` to create a complete original ${input.template.category} artifact now. Replace all placeholder content and rebuild the HTML, CSS, and managed design tokens with a coherent visual system chosen for the content and audience. Do not ask the user to choose a style, and do not reply only with confirmation, options, an outline, or a description. ${categoryContract} Never invent facts or metrics; mark missing evidence. Satisfy: ${checklist}.`;
  }
  const base = `Read \`${input.briefPath}\` and apply it to \`${input.entryPath}\` using the selected \`${input.template.title}\` template. Apply it now in this turn: edit/save target file(s), then report generated files. Do not reply only with confirmation, options, or next-step questions. Derive structure from the brief, replace sample content, keep the template's visual language, and satisfy: ${checklist}. Checklist items guide quality/export, not sample count, order, subject, copy, or assets.`;
  if (input.template.id === "ipollowork.wechat-article") {
    return `${base} Fixed-brand exception: preserve every data-ipw-fixed="true" node, fixed-hero.jpg, fixed-footer-cta.jpg, locked brand colors, and fixed brand images. Update only article copy, non-fixed middle images, and the CTA href when provided.`;
  }
  const visualSystemInstruction = "Keep design-tokens.css and preserve its current theme as the visual source of truth; do not change the managed theme block, --ipw-* tokens, palette, fonts, radii, shadows, or background treatment. Reuse typography hierarchy, component patterns, artwork language, and motion vocabulary. Preserve editor/export/runtime hooks.";
  switch (input.template.category) {
    case "video":
      return `${base} ${visualSystemInstruction} Use the copied HyperFrames project as an editable seed. Build a content-led storyboard from the brief, then add, remove, reorder, or retime scenes as needed while inheriting composition, motion, typography, and transitions. Preserve the root composition contract, editable variables, editor hooks, and deterministic timeline. Decide whether narration materially helps; do not ask a separate narration question.`;
    case "slides":
      const compositionInstruction = "Use existing HTML/CSS, slide patterns, artwork, and components as a reusable layout system rather than a finished deck. First plan a coherent narrative and page count from the brief, then select, repeat, recombine, adapt, remove, or reorder patterns. Do not inherit the sample slide count, section order, copy, or assets unless they fit. Keep it recognizable through distinctive typography hierarchy, colored blocks, artwork, component geometry, and rhythm; avoid a generic deck.";
      if (input.template.pptxCompatibility === "native-editable") {
        return `${base} ${visualSystemInstruction} ${compositionInstruction} Rewrite the complete deck's content, not one slide. Preserve the fixed 16:9 stage and native editable PPTX contract: every visible object must use supported data-pptx-text, data-pptx-shape, or data-pptx-image markers. The Design panel owns slide navigation: do not add <script> tags, custom keyboard handlers, slide counters, navigation buttons, or speaker notes. Do not add responsive slide reflow or breakpoint-specific slide layouts. Never invent metrics; mark missing evidence.`;
      }
      return `${base} ${visualSystemInstruction} ${compositionInstruction} Rewrite the complete deck's content. Keep 16:9 runtime, keyboard navigation, controls, theme tokens, and speaker notes. Never invent metrics; mark missing evidence and keep slides editable.`;
    case "site":
      return `${base} ${visualSystemInstruction} Plan the information architecture and section order from the brief, then reuse, add, remove, or reorder the template's header, navigation, containers, artwork, and component patterns. Do not retain inherited sections merely because they exist, and do not rebuild the result as a generic split hero, statistics strip, feature-card grid, or unrelated scaffold. Replace inherited labels, links, headings, CTAs, cards, metadata, and footer content. Keep it responsive and editable.`;
    case "app":
      return `${base} ${visualSystemInstruction} Derive screens and flows from the brief, reuse interface patterns to build the complete prototype, keep it realistic/editable, and do not retain irrelevant sample screens or turn it into a marketing website.`;
    case "report":
      return `${base} ${visualSystemInstruction} Build a new report structure from the brief with decision-ready sections and hierarchy. Do not inherit irrelevant sample sections or invent data; mark unknown values.`;
    case "article":
      return `${base} ${visualSystemInstruction} Write the complete article from the brief in the editorial style, with content-led hierarchy and readable body copy; remove sample sections/placeholders.`;
    case "poster":
    case "cards":
      return `${base} ${visualSystemInstruction} Recompose visual primitives around the new message, update visible copy and art direction, and keep text editable.`;
    default:
      if (isResumeTemplate(input.template)) {
        return `${base} ${visualSystemInstruction} Build a complete professional resume from the brief. Structure experience, skills, and outcomes clearly; remove inherited placeholder identity and employment details.`;
      }
      return `${base} ${visualSystemInstruction} Rebuild the complete artifact from the brief and remove sample or placeholder content.`;
  }
}
