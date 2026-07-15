import type { TemplateCategory, TemplateManifestV1 } from "@ipollowork/types/templates";

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
  { id: "ember", label: "暖橙", canvas: "#fafaf9", text: "#1c1b1a", accent: "#c96442" },
  { id: "ocean", label: "深海蓝", canvas: "#f8fafc", text: "#172554", accent: "#2563eb" },
  { id: "violet", label: "紫罗兰", canvas: "#faf5ff", text: "#2e1065", accent: "#7c3aed" },
  { id: "forest", label: "森林绿", canvas: "#f0fdf4", text: "#064e3b", accent: "#059669" },
];

export const DEFAULT_TEMPLATE_COLOR_PALETTE = TEMPLATE_COLOR_PRESETS[0];

export function paletteColors(palette: TemplateColorPalette): [string, string, string] {
  return [palette.canvas, palette.text, palette.accent];
}

export function customTemplateColorPalette(colors: [string, string, string]): TemplateColorPalette {
  return { id: "custom", label: "自定义", canvas: colors[0], text: colors[1], accent: colors[2] };
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

const BRIEF_CONFIGS = {
  site: {
    label: "网站项目",
    heading: "告诉我这个网站要做什么",
    description: "名称和用途会直接替换模板内容；具体文案与视觉细节会保留模板风格继续完成。",
    submitLabel: "生成网站",
    fields: [
      { key: "title", label: "网站名称", placeholder: "例如：Muse Studio" },
      { key: "audience", label: "网站是做什么的、给谁用", placeholder: "例如：帮助创意团队用 AI 完成内容生产" },
      { key: "details", label: "核心页面或功能", placeholder: "例如：作品展示、案例、预约咨询", optional: true },
    ],
  },
  app: {
    label: "App 原型",
    heading: "定义这个 App 原型",
    description: "先确定产品目标与核心流程，AI 会把它落实为可点击、可继续编辑的界面。",
    submitLabel: "生成 App 原型",
    fields: [
      { key: "title", label: "App 名称", placeholder: "例如：Flowmate" },
      { key: "audience", label: "App 给谁用、解决什么", placeholder: "例如：帮助自由职业者安排客户与项目" },
      { key: "details", label: "核心功能或页面", placeholder: "例如：今日任务、客户列表、项目进度", optional: true },
    ],
  },
  slides: {
    label: "演示文稿",
    heading: "定义这份幻灯片",
    description: "明确标题、受众和要推动的决定，AI 会组织成完整、可编辑的演示叙事。",
    submitLabel: "生成幻灯片",
    fields: [
      { key: "title", label: "演示标题", placeholder: "例如：iPolloWork 融资路演" },
      { key: "audience", label: "面向谁、希望推动什么决定", placeholder: "例如：面向投资人，说明市场机会与融资计划" },
      { key: "details", label: "需要包含的信息或数据", placeholder: "例如：问题、方案、增长数据、商业模式", optional: true },
    ],
  },
  poster: {
    label: "海报",
    heading: "定义这张海报",
    description: "只给出主题与受众，模板的版式、风格和视觉节奏会继续保留。",
    submitLabel: "生成海报",
    fields: [
      { key: "title", label: "海报主题", placeholder: "例如：2026 夏季新品发布" },
      { key: "audience", label: "面向谁", placeholder: "例如：城市里的年轻设计爱好者" },
      { key: "details", label: "活动信息或核心文案", placeholder: "例如：日期、地点、主张、行动按钮", optional: true },
    ],
  },
  cards: {
    label: "海报卡片",
    heading: "定义这组卡片",
    description: "告诉我使用场景和关键信息，AI 会让每张卡片保持一致又各有重点。",
    submitLabel: "生成卡片",
    fields: [
      { key: "title", label: "卡片主题", placeholder: "例如：新品功能速览" },
      { key: "audience", label: "使用场景或受众", placeholder: "例如：用于社媒发布，面向产品设计师" },
      { key: "details", label: "需要呈现的关键信息", placeholder: "例如：三项功能、价格或行动按钮", optional: true },
    ],
  },
  report: {
    label: "数据报告",
    heading: "定义这份报告",
    description: "明确报告对象与要支持的判断，AI 会组织清晰的结论、指标和可视化结构。",
    submitLabel: "生成报告",
    fields: [
      { key: "title", label: "报告名称", placeholder: "例如：Q3 增长复盘" },
      { key: "audience", label: "面向谁、用于什么决策", placeholder: "例如：面向管理层，决定下一季度增长重点" },
      { key: "details", label: "要覆盖的数据或结论", placeholder: "例如：渠道、转化、留存和建议", optional: true },
    ],
  },
  article: {
    label: "杂志文章",
    heading: "定义这篇文章",
    description: "给出主题与读者，AI 会按模板的编辑风格组织标题、正文与视觉层次。",
    submitLabel: "生成文章",
    fields: [
      { key: "title", label: "文章标题或主题", placeholder: "例如：重新理解 AI 时代的创作" },
      { key: "audience", label: "写给谁", placeholder: "例如：关注设计与科技的创意从业者" },
      { key: "details", label: "核心观点或已有素材", placeholder: "例如：三个观点、采访内容或引用", optional: true },
    ],
  },
  video: {
    label: "视频项目",
    heading: "定义这支视频",
    description: "先说明内容目标与受众；旁白、节奏与分镜由 AI 结合模板自行决定。",
    submitLabel: "开始制作视频",
    fields: [
      { key: "title", label: "视频主题", placeholder: "例如：新品发布预告" },
      { key: "audience", label: "面向谁", placeholder: "例如：正在评估创意工具的产品团队" },
      { key: "details", label: "想传达或促成什么", placeholder: "例如：介绍核心卖点，引导预约体验", optional: true },
    ],
  },
  other: {
    label: "创作项目",
    heading: "告诉我你要做什么",
    description: "给出名称与用途，AI 会在选定模板的结构和风格内完成内容。",
    submitLabel: "开始创作",
    fields: [
      { key: "title", label: "作品名称", placeholder: "例如：春季创意提案" },
      { key: "audience", label: "要完成什么、给谁看", placeholder: "例如：向客户说明品牌活动方案" },
      { key: "details", label: "关键信息", placeholder: "例如：需要强调的观点、素材或行动", optional: true },
    ],
  },
} satisfies Record<TemplateCategory, TemplateBriefConfig>;

const RESUME_BRIEF_CONFIG: TemplateBriefConfig = {
  label: "简历",
  heading: "定义这份简历",
  description: "填写求职目标与经历重点，AI 会在当前模板的版式里整理出专业、可继续编辑的内容。",
  submitLabel: "生成简历",
  fields: [
    { key: "title", label: "姓名与目标岗位", placeholder: "例如：陈晓 · 产品设计师" },
    { key: "audience", label: "面向什么职位或公司", placeholder: "例如：消费互联网公司的高级产品设计岗位" },
    { key: "details", label: "经历、技能或成果亮点", placeholder: "例如：5 年 B 端产品经验，主导过 0 到 1 项目", optional: true },
  ],
};

export function isResumeTemplate(template: Pick<TemplateManifestV1, "category"> & Partial<Pick<TemplateManifestV1, "subcategory" | "title">>): boolean {
  const identity = `${template.subcategory ?? ""} ${template.title ?? ""}`.toLowerCase();
  return template.category === "other" && /\b(?:resume|curriculum vitae|cv)\b|简历/i.test(identity);
}

export function templateBriefConfigFor(template: Pick<TemplateManifestV1, "category"> & Partial<Pick<TemplateManifestV1, "subcategory" | "title">>): TemplateBriefConfig {
  if (isResumeTemplate(template)) return RESUME_BRIEF_CONFIG;
  return BRIEF_CONFIGS[template.category];
}

export function templateBriefPrompt(input: {
  template: Pick<TemplateManifestV1, "category" | "title" | "applyChecklist"> & Partial<Pick<TemplateManifestV1, "subcategory">>;
  entryPath: string;
  briefPath: string;
}): string {
  const base = `Read \`${input.briefPath}\` and apply it to the selected \`${input.template.title}\` template at \`${input.entryPath}\`. Keep the template's visual language and update every applicable item in this checklist: ${input.template.applyChecklist.join("; ")}.`;
  const colorInstruction = "Use the brief's colorPalette.canvas, colorPalette.text, and colorPalette.accent colors consistently through the template's existing theme tokens; do not introduce an unrelated palette.";
  switch (input.template.category) {
    case "video":
      return `${base} ${colorInstruction} Build this exact video template, not a blank or unrelated project. Decide whether narration materially helps the stated goal; do not ask a separate narration question. Preserve the editable composition, variables, and scene structure while making the content fit the brief.`;
    case "slides":
      return `${base} ${colorInstruction} Rewrite the complete deck, not one slide. Keep the 16:9 slide system, keyboard navigation, controls, theme tokens, and separate speaker notes. Build a coherent decision-oriented narrative from the brief. Never invent metrics; clearly mark missing evidence for the user to replace. Keep 6 to 10 slides and every slide editable in the Design panel.`;
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
