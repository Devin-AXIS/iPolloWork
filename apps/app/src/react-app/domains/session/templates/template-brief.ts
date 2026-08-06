import type { TemplateCategory, TemplateManifestV1 } from "@ipollowork/types/templates";
import { t } from "@/i18n";
import type { ComposerAttachment } from "@/app/types";

export type TemplateBrief = {
  title: string;
  audience: string;
  details: string;
};

export const TEMPLATE_BRIEF_REFERENCE_MAX_BYTES = 25 * 1024 * 1024;

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

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEMPLATE_BRIEF_AUTOFILL_TEXT_LIMIT = 12_000;
const TEMPLATE_BRIEF_AUTOFILL_FIELD_LIMIT = 700;

const TEMPLATE_BRIEF_REFERENCE_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "md",
  "txt",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "csv",
  "json",
]);

const TEMPLATE_BRIEF_REFERENCE_MIMES = new Set([
  "application/pdf",
  DOCX_MIME,
  "text/markdown",
  "text/plain",
  "text/csv",
  "application/csv",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const TEMPLATE_BRIEF_REFERENCE_MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: DOCX_MIME,
  md: "text/markdown",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  csv: "text/csv",
  json: "application/json",
};

function templateBriefReferenceExtension(name: string) {
  return name.split(".").pop()?.trim().toLowerCase() ?? "";
}

function templateBriefReferenceNameStem(name: string) {
  const trimmed = name.trim();
  const withoutPath = trimmed.split(/[/\\]/).pop() ?? trimmed;
  const withoutExtension = withoutPath.replace(/\.[^.]+$/, "");
  return withoutExtension.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function isTemplateBriefReferenceFile(file: Pick<File, "name" | "type">) {
  const extension = templateBriefReferenceExtension(file.name);
  if (TEMPLATE_BRIEF_REFERENCE_EXTENSIONS.has(extension)) return true;
  const mime = file.type.trim().toLowerCase();
  return Boolean(mime && TEMPLATE_BRIEF_REFERENCE_MIMES.has(mime));
}

function templateBriefReferenceMime(file: Pick<File, "name" | "type">) {
  const mime = file.type.trim().toLowerCase();
  if (TEMPLATE_BRIEF_REFERENCE_MIMES.has(mime)) return mime;
  return TEMPLATE_BRIEF_REFERENCE_MIME_BY_EXTENSION[templateBriefReferenceExtension(file.name)] ?? "text/plain";
}

function pdfReferencePlaceholder(file: File) {
  return [
    `Reference document uploaded: ${file.name}`,
    "Format: PDF",
    `Size: ${file.size} bytes`,
    "The PDF bytes are intentionally not embedded in the composer request to keep template generation stable.",
    "Use the filename, any auto-filled brief fields, and the saved reference metadata as context.",
  ].join("\n");
}

function decodeXmlText(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

async function extractDocxText(file: File) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) return "";
  const paragraphs = documentXml
    .split(/<\/w:p>/)
    .map((paragraph) => [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((match) => decodeXmlText(match[1] ?? ""))
      .join(""))
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return paragraphs.join("\n");
}

function isTemplateBriefTextReference(file: Pick<File, "name" | "type">) {
  const extension = templateBriefReferenceExtension(file.name);
  if (extension === "md" || extension === "txt" || extension === "csv" || extension === "json") return true;
  const mime = file.type.trim().toLowerCase();
  return mime.startsWith("text/") || mime === "application/json" || mime === "application/csv";
}

function cleanTemplateBriefLine(value: string) {
  return value
    .replace(/^\s{0,3}#{1,6}\s*/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function cleanTemplateBriefSnippet(value: string, limit = TEMPLATE_BRIEF_AUTOFILL_FIELD_LIMIT) {
  return value
    .split(/\r?\n/)
    .map(cleanTemplateBriefLine)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, limit)
    .trim();
}

function firstMatchingLabelValue(text: string, labels: RegExp[]) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const cleaned = cleanTemplateBriefLine(line);
    for (const label of labels) {
      const match = cleaned.match(label);
      const value = cleanTemplateBriefSnippet(match?.[1] ?? "", 240);
      if (value) return value;
    }
  }
  return "";
}

function markdownSectionText(text: string, keywords: string[]) {
  const lines = text.split(/\r?\n/);
  const sections: { heading: string; body: string[] }[] = [];
  let current: { heading: string; body: string[] } | null = null;

  for (const line of lines) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      current = { heading: cleanTemplateBriefLine(heading[1] ?? ""), body: [] };
      sections.push(current);
      continue;
    }
    current?.body.push(line);
  }

  const match = sections.find((section) => {
    const heading = section.heading.toLowerCase();
    return keywords.some((keyword) => heading.includes(keyword.toLowerCase()));
  });
  return cleanTemplateBriefSnippet(match?.body.join("\n") ?? "");
}

function firstBodyExcerpt(text: string, title: string) {
  const lines = text
    .split(/\r?\n/)
    .map(cleanTemplateBriefLine)
    .filter((line) => line && line !== title)
    .filter((line) => !/^#{1,6}\s/.test(line));
  return cleanTemplateBriefSnippet(lines.join("\n"));
}

function inferredTitleFromText(text: string, filename: string) {
  const markdownTitle = text.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m);
  const cleanedMarkdownTitle = cleanTemplateBriefSnippet(markdownTitle?.[1] ?? "", 120);
  if (cleanedMarkdownTitle) return cleanedMarkdownTitle;

  const labelTitle = firstMatchingLabelValue(text, [
    /^(?:title|presentation title|project name|name|标题|演示标题|作品标题|项目名称|名称)\s*[:：]\s*(.+)$/i,
  ]);
  if (labelTitle) return labelTitle;

  const firstLine = text
    .split(/\r?\n/)
    .map(cleanTemplateBriefLine)
    .find((line) => line.length > 1 && line.length <= 80 && !/[:：]\s*$/.test(line));
  return firstLine ?? templateBriefReferenceNameStem(filename);
}

export function templateBriefFromReferenceText({ filename, text }: { filename: string; text: string }): TemplateBrief {
  const source = text.replace(/^\uFEFF/, "").slice(0, TEMPLATE_BRIEF_AUTOFILL_TEXT_LIMIT);
  const title = inferredTitleFromText(source, filename);
  const audience = firstMatchingLabelValue(source, [
    /^(?:audience|target audience|who it is for|users?|customers?|decision maker|受众|目标受众|面向谁|面向|目标用户|汇报对象|决策者|对象)\s*[:：]\s*(.+)$/i,
    /^(?:purpose|goal|objective|decision|目标|目的|希望推动|希望推动什么决策|决策)\s*[:：]\s*(.+)$/i,
  ]) || markdownSectionText(source, [
    "audience",
    "target audience",
    "who it is for",
    "decision",
    "purpose",
    "goal",
    "objective",
    "受众",
    "目标受众",
    "面向",
    "目标用户",
    "汇报对象",
    "决策",
    "目的",
    "目标",
    "希望推动",
  ]);
  const details = firstMatchingLabelValue(source, [
    /^(?:details?|key information|requirements?|include|content|data|scope|信息|数据|内容|要求|包含|需要包含|核心内容|关键内容)\s*[:：]\s*(.+)$/i,
  ]) || markdownSectionText(source, [
    "key information",
    "requirements",
    "include",
    "content",
    "data",
    "scope",
    "background",
    "overview",
    "信息",
    "数据",
    "内容",
    "要求",
    "包含",
    "核心内容",
    "关键内容",
    "背景",
    "概述",
    "方案",
    "问题",
  ]) || firstBodyExcerpt(source, title);

  return {
    title: title.trim(),
    audience: cleanTemplateBriefSnippet(audience, 360),
    details: cleanTemplateBriefSnippet(details),
  };
}

export async function extractTemplateBriefReferenceText(file: File) {
  const extension = templateBriefReferenceExtension(file.name);
  const text = extension === "docx" || file.type.trim().toLowerCase() === DOCX_MIME
    ? await extractDocxText(file)
    : isTemplateBriefTextReference(file)
      ? await file.text()
      : "";
  return text.slice(0, TEMPLATE_BRIEF_AUTOFILL_TEXT_LIMIT);
}

export async function inferTemplateBriefFromReferenceFile(file: File): Promise<TemplateBrief> {
  return templateBriefFromReferenceText({
    filename: file.name,
    text: await extractTemplateBriefReferenceText(file),
  });
}

export async function prepareTemplateBriefReferenceAttachment(file: File): Promise<ComposerAttachment> {
  if (file.size > TEMPLATE_BRIEF_REFERENCE_MAX_BYTES) {
    throw new Error(`${file.name} is larger than 25 MB.`);
  }
  if (!isTemplateBriefReferenceFile(file)) {
    throw new Error(`${file.name} is not a supported reference document.`);
  }

  const originalMime = templateBriefReferenceMime(file);
  const isDocx = templateBriefReferenceExtension(file.name) === "docx" || originalMime === DOCX_MIME;
  const isPdf = templateBriefReferenceExtension(file.name) === "pdf" || originalMime === "application/pdf";
  const attachmentFile = isDocx
    ? new File([await extractDocxText(file)], `${file.name}.txt`, { type: "text/plain" })
    : isPdf
      ? new File([pdfReferencePlaceholder(file)], `${file.name}.txt`, { type: "text/plain" })
    : file;
  const mimeType = isDocx || isPdf ? "text/plain" : originalMime;
  const kind = mimeType.startsWith("image/") ? "image" as const : "file" as const;
  const previewUrl = kind === "image" && typeof URL !== "undefined" && "createObjectURL" in URL
    ? URL.createObjectURL(file)
    : undefined;

  return {
    id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    mimeType,
    size: file.size,
    kind,
    file: attachmentFile,
    previewUrl,
  };
}

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
