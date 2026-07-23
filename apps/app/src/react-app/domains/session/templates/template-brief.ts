import type { TemplateCategory, TemplateManifestV1 } from "@ipollowork/types/templates";
import { t } from "@/i18n";

export type TemplateBrief = {
  title: string;
  audience: string;
  details: string;
  colorPalette: TemplateColorPalette;
};

export type TemplateBriefFields = Omit<TemplateBrief, "colorPalette">;

export type TemplateColorPalette = {
  id: string;
  label: string;
  canvas: string;
  text: string;
  accent: string;
};

export const TEMPLATE_COLOR_PRESETS: readonly TemplateColorPalette[] = [
  { id: "ember", label: "Warm Ember", canvas: "#fafaf9", text: "#1c1b1a", accent: "#c96442" },
  { id: "ocean", label: "Deep Ocean", canvas: "#f8fafc", text: "#172554", accent: "#2563eb" },
  { id: "violet", label: "Violet", canvas: "#faf5ff", text: "#2e1065", accent: "#7c3aed" },
  { id: "forest", label: "Forest", canvas: "#f0fdf4", text: "#064e3b", accent: "#059669" },
];

export const DEFAULT_TEMPLATE_COLOR_PALETTE = TEMPLATE_COLOR_PRESETS[0];

export function paletteColors(palette: TemplateColorPalette): [string, string, string] {
  return [palette.canvas, palette.text, palette.accent];
}

export function customTemplateColorPalette(colors: [string, string, string]): TemplateColorPalette {
  return { id: "custom", label: "Custom", canvas: colors[0], text: colors[1], accent: colors[2] };
}

export function templateColorPaletteLabel(id: string): string {
  switch (id) {
    case "ember":
      return t("templates.palette.ember");
    case "ocean":
      return t("templates.palette.ocean");
    case "violet":
      return t("templates.palette.violet");
    case "forest":
      return t("templates.palette.forest");
    case "custom":
      return t("templates.palette.custom");
    default:
      return id;
  }
}

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
    return `${base} This template has locked brand colors and fixed brand images. Ignore the brief's colorPalette completely. Update only the article copy and non-fixed middle article images. Preserve every data-ipw-fixed="true" node exactly, keep fixed-hero.jpg and fixed-footer-cta.jpg unchanged, and only edit the href on a.fixed-footer-cta when a CTA link is provided. Do not write instruction conflicts or process notes into the HTML.`;
  }
  const colorInstruction = "Use the brief's colorPalette.canvas, colorPalette.text, and colorPalette.accent colors consistently through the template's existing theme tokens; do not introduce an unrelated palette.";
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
      return `${base} ${colorInstruction} Update the complete website, not a partial copy edit. Replace inherited names, navigation labels, links, headings, calls to action, cards, metadata, and footer content with information consistent with the brief. Keep it responsive on desktop and mobile, and keep every part editable in the Design panel.`;
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
