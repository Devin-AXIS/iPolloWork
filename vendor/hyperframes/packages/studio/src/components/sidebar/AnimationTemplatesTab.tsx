import { memo, useCallback, useMemo, useState } from "react";
import {
  getMotionPreset,
  type MotionParameters,
  type MotionPreset,
  type MotionTargetKind,
} from "@hyperframes/core/motion-presets";
import { useDomEditSelectionContext } from "../../contexts/DomEditContext";
import { useStudioI18n } from "../../i18n";
import {
  resolveMotionInstances,
  resolveMotionTargetKind,
} from "../editor/SemanticMotionPanel";
import type { DomEditSelection } from "../editor/domEditing";
import searchIconSrc from "../../icons/figmaAssetsSearch.svg?url";

export type AnimationTemplateCategory = "general" | "text";

export interface AnimationTemplateDefinition {
  id: string;
  category: AnimationTemplateCategory;
  title: { en: string; zh: string };
  description: { en: string; zh: string };
  preview: string;
  presetId?: string;
  textPresetId?: string;
  elementPresetId?: string;
  parameters?: MotionParameters;
}

export interface AnimationTemplateDraft {
  templateId: string;
  presetId: string;
  targetKind: MotionTargetKind;
  selection: DomEditSelection;
  parameters: MotionParameters;
}

const CATEGORY_LABELS: Record<
  AnimationTemplateCategory,
  { en: string; zh: string; hint: { en: string; zh: string } }
> = {
  general: {
    en: "General",
    zh: "通用动画",
    hint: { en: "Works with text, images, shapes, and groups", zh: "适用于文字、图片、图形和组合" },
  },
  text: {
    en: "Text",
    zh: "文字动画",
    hint: { en: "Word, character, mask, and glow motion", zh: "支持按词、按字、遮罩与流光" },
  },
};

export const ANIMATION_TEMPLATES: readonly AnimationTemplateDefinition[] = [
  {
    id: "general-fade-in",
    category: "general",
    title: { en: "Fade In", zh: "淡入" },
    description: { en: "A restrained universal entrance", zh: "克制、通用的出现动画" },
    preview: "fade-in",
    textPresetId: "text.enter.fade",
    elementPresetId: "element.enter.fade",
  },
  {
    id: "general-slide-in",
    category: "general",
    title: { en: "Slide In", zh: "滑入" },
    description: { en: "Editable direction and intensity", zh: "可调整方向与运动强度" },
    preview: "slide-in",
    textPresetId: "text.enter.rise",
    elementPresetId: "element.enter.slide",
  },
  {
    id: "general-scale-in",
    category: "general",
    title: { en: "Scale In", zh: "缩放进入" },
    description: { en: "Focus attention with a clean scale", zh: "用简洁缩放聚焦内容" },
    preview: "scale-in",
    textPresetId: "text.enter.zoom",
    elementPresetId: "element.enter.scale",
  },
  {
    id: "general-fade-out",
    category: "general",
    title: { en: "Fade Out", zh: "淡出" },
    description: { en: "A universal, quiet exit", zh: "通用、安静的消失动画" },
    preview: "fade-out",
    textPresetId: "text.exit.fade",
    elementPresetId: "element.exit.fade",
  },
  {
    id: "general-slide-out",
    category: "general",
    title: { en: "Slide Out", zh: "滑出" },
    description: { en: "Leave in the selected direction", zh: "沿指定方向离开画面" },
    preview: "slide-out",
    textPresetId: "text.exit.drift",
    elementPresetId: "element.exit.slide",
  },
  {
    id: "general-scale-out",
    category: "general",
    title: { en: "Scale Out", zh: "缩小退出" },
    description: { en: "A compact closing movement", zh: "紧凑的缩小收尾动画" },
    preview: "scale-out",
    textPresetId: "text.exit.shrink",
    elementPresetId: "element.exit.scale",
  },
  {
    id: "general-content-reveal",
    category: "general",
    title: { en: "Content Reveal", zh: "内容显现" },
    description: {
      en: "Distance, opacity, scale, and direction",
      zh: "可调距离、透明度、缩放和方向",
    },
    preview: "content-reveal",
    presetId: "motion.enter.content-reveal",
  },
  {
    id: "general-soft-float",
    category: "general",
    title: { en: "Soft Float", zh: "柔和漂浮" },
    description: { en: "Subtle continuous emphasis", zh: "轻柔的漂浮强调动效" },
    preview: "soft-float",
    presetId: "motion.emphasis.soft-float",
  },
  {
    id: "general-gradual-focus",
    category: "general",
    title: { en: "Gradual Focus", zh: "渐进聚焦" },
    description: { en: "Editable blur, distance, and direction", zh: "可调整模糊、距离与进入方向" },
    preview: "gradual-focus",
    presetId: "motion.enter.gradual-focus",
  },
  {
    id: "general-scan-reveal",
    category: "general",
    title: { en: "Scan Reveal", zh: "扫描揭幕" },
    description: { en: "Directional scan with contrast control", zh: "方向扫描与对比度可调" },
    preview: "scan-reveal",
    presetId: "motion.enter.scan-reveal",
  },
  {
    id: "general-magnetic-snap",
    category: "general",
    title: { en: "Magnetic Snap", zh: "磁吸回弹" },
    description: { en: "Pull distance and overshoot controls", zh: "可调整吸附距离与回弹幅度" },
    preview: "magnetic-snap",
    presetId: "motion.emphasis.magnetic-snap",
  },
  {
    id: "text-blur-reveal",
    category: "text",
    title: { en: "Blur Reveal", zh: "雾化显现" },
    description: { en: "Animate by word or character", zh: "支持按词或按字逐个显现" },
    preview: "text-blur",
    presetId: "text.enter.blur-reveal",
  },
  {
    id: "text-mask-sweep",
    category: "text",
    title: { en: "Masked Words", zh: "分词揭幕" },
    description: { en: "Directional mask with editable stagger", zh: "方向遮罩与可调分词间隔" },
    preview: "text-mask",
    presetId: "text.enter.mask-sweep",
  },
  {
    id: "text-prism-glow",
    category: "text",
    title: { en: "Prism Glow", zh: "棱彩流光" },
    description: { en: "Editable color and glow intensity", zh: "可调整流光颜色与强度" },
    preview: "text-glow",
    presetId: "text.emphasis.prism-glow",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-typewriter",
    category: "text",
    title: { en: "Typewriter", zh: "逐字出现" },
    description: { en: "Character timing and spacing controls", zh: "可调整逐字速度与间隔" },
    preview: "typewriter",
    presetId: "text.enter.typewriter",
  },
  {
    id: "text-decode",
    category: "text",
    title: { en: "Decode", zh: "字符解码" },
    description: { en: "A crisp technology-flavored reveal", zh: "利落的科技感文字显现" },
    preview: "decode",
    presetId: "text.enter.decode",
  },
  {
    id: "text-fold-reveal",
    category: "text",
    title: { en: "Fold Text", zh: "折叠文字" },
    description: { en: "Character or word panels unfold in 3D", zh: "支持按字或按词进行立体展开" },
    preview: "text-fold",
    presetId: "text.enter.fold-reveal",
  },
  {
    id: "text-shiny-sweep",
    category: "text",
    title: { en: "Theme Shine", zh: "主题流光" },
    description: { en: "Theme-aware shine with editable glow", zh: "跟随主题色并可调整辉光" },
    preview: "text-shine",
    presetId: "text.emphasis.shiny-sweep",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-true-focus",
    category: "text",
    title: { en: "True Focus", zh: "逐词聚焦" },
    description: { en: "Word focus with blur and scale controls", zh: "逐词聚焦，模糊与缩放可调" },
    preview: "text-focus",
    presetId: "text.emphasis.true-focus",
  },
  {
    id: "text-highlight-sweep",
    category: "text",
    title: { en: "Highlight Sweep", zh: "高亮扫过" },
    description: { en: "Editable word or character highlight", zh: "支持按词或按字的高亮扫过" },
    preview: "text-highlight",
    presetId: "text.emphasis.highlight-sweep",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-matrix-decode",
    category: "text",
    title: { en: "Matrix Decode", zh: "矩阵解码" },
    description: { en: "Character decode with density controls", zh: "可调密度的字符解码显现" },
    preview: "decode",
    presetId: "text.enter.matrix-decode",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-gradient-fill",
    category: "text",
    title: { en: "Gradient Fill", zh: "渐变填充" },
    description: { en: "Theme-aware gradient emphasis", zh: "跟随主题色的渐变文字强调" },
    preview: "text-shine",
    presetId: "text.emphasis.gradient-fill",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-neon-glow",
    category: "text",
    title: { en: "Neon Glow", zh: "霓虹辉光" },
    description: { en: "Editable glow color and strength", zh: "可调颜色与辉光强度" },
    preview: "text-glow",
    presetId: "text.emphasis.neon-glow",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-neon-accent",
    category: "text",
    title: { en: "Neon Accent", zh: "霓虹强调" },
    description: { en: "Accent glow with subtle drift", zh: "带轻微漂移的强调辉光" },
    preview: "text-glow",
    presetId: "text.emphasis.neon-accent",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-rgb-glitch",
    category: "text",
    title: { en: "RGB Glitch", zh: "RGB 故障" },
    description: { en: "Readable chromatic glitch", zh: "保持可读的色差故障" },
    preview: "decode",
    presetId: "text.emphasis.rgb-glitch",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-clip-wipe",
    category: "text",
    title: { en: "Clip Wipe", zh: "裁切揭幕" },
    description: { en: "Directional text wipe reveal", zh: "可调方向的文字裁切揭示" },
    preview: "text-mask",
    presetId: "text.enter.clip-wipe",
  },
  {
    id: "text-blend-difference",
    category: "text",
    title: { en: "Blend Difference", zh: "差值反色" },
    description: { en: "Invert-style text emphasis", zh: "反色混合风格文字强调" },
    preview: "text-focus",
    presetId: "text.emphasis.blend-difference",
  },
  {
    id: "text-weight-shift",
    category: "text",
    title: { en: "Weight Shift", zh: "字重切换" },
    description: { en: "Editable font-weight emphasis", zh: "可调字重的文字强调" },
    preview: "text-focus",
    presetId: "text.emphasis.weight-shift",
  },
  {
    id: "text-texture-fill",
    category: "text",
    title: { en: "Texture Fill", zh: "纹理填充" },
    description: { en: "Theme-aware texture-like fill", zh: "跟随主题的纹理填充感" },
    preview: "text-shine",
    presetId: "text.emphasis.texture-fill",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-kinetic-slam",
    category: "text",
    title: { en: "Kinetic Slam", zh: "动感冲击" },
    description: { en: "Readable kinetic type impact", zh: "保持可读的动感文字冲击" },
    preview: "text-fold",
    presetId: "text.emphasis.kinetic-slam",
  },
  {
    id: "text-emoji-pop",
    category: "text",
    title: { en: "Emoji Pop", zh: "Emoji 弹出" },
    description: { en: "Playful character pop emphasis", zh: "轻快的字符弹出强调" },
    preview: "typewriter",
    presetId: "text.emphasis.emoji-pop",
  },
  {
    id: "text-particle-burst",
    category: "text",
    title: { en: "Particle Burst", zh: "粒子爆发" },
    description: { en: "Particle-like keyword emphasis", zh: "粒子感关键词强调" },
    preview: "text-glow",
    presetId: "text.emphasis.particle-burst",
    parameters: { colorSource: "theme" },
  },
  {
    id: "box-scale",
    category: "general",
    title: { en: "Box Scale", zh: "盒子缩放" },
    description: { en: "A stable entrance for cards and images", zh: "适合卡片和图片的稳定进入" },
    preview: "box-scale",
    presetId: "element.enter.scale",
  },
  {
    id: "box-lift",
    category: "general",
    title: { en: "Box Lift", zh: "盒子浮起" },
    description: { en: "Subtle lift and focus", zh: "轻微上浮并聚焦内容" },
    preview: "box-lift",
    presetId: "element.emphasis.lift",
  },
  {
    id: "box-pulse",
    category: "general",
    title: { en: "Box Pulse", zh: "盒子呼吸" },
    description: { en: "A restrained scale pulse", zh: "克制的缩放呼吸强调" },
    preview: "box-pulse",
    presetId: "element.emphasis.pulse",
  },
  {
    id: "box-focus-tilt",
    category: "general",
    title: { en: "Depth Tilt", zh: "景深倾斜" },
    description: { en: "Editable direction and 3D intensity", zh: "可调整方向与立体倾斜强度" },
    preview: "box-tilt",
    presetId: "motion.emphasis.focus-tilt",
  },
  {
    id: "box-bounce-card",
    category: "general",
    title: { en: "Bounce Card", zh: "弹性卡片" },
    description: {
      en: "Directional entrance with a clean settle",
      zh: "带方向的弹性入场与稳定落位",
    },
    preview: "box-bounce",
    presetId: "element.enter.bounce-card",
  },
  {
    id: "box-spotlight-card",
    category: "general",
    title: { en: "Spotlight Card", zh: "聚光卡片" },
    description: { en: "Theme-aware focus and glow", zh: "跟随主题色的聚焦与辉光" },
    preview: "box-spotlight",
    presetId: "element.emphasis.spotlight-card",
    parameters: { colorSource: "theme" },
  },
  {
    id: "box-glare-sweep",
    category: "general",
    title: { en: "Glare Sweep", zh: "高光掠过" },
    description: { en: "A theme-aware material highlight", zh: "跟随主题色的材质高光掠过" },
    preview: "box-glare",
    presetId: "element.emphasis.glare-sweep",
    parameters: { colorSource: "theme" },
  },
];

export function resolveAnimationTemplatePreset(
  template: AnimationTemplateDefinition,
  targetKind: MotionTargetKind,
): MotionPreset | null {
  const presetId =
    template.presetId ?? (targetKind === "text" ? template.textPresetId : template.elementPresetId);
  return presetId ? (getMotionPreset(presetId) ?? null) : null;
}

export function resolveAnimationTemplateParameters(
  template: AnimationTemplateDefinition,
  preset: MotionPreset,
  variableBoundText: boolean,
): MotionParameters {
  const parameters = { ...preset.defaults, ...template.parameters };
  if (variableBoundText && "unit" in parameters) parameters.unit = "whole";
  return parameters;
}

function TemplatePreview({ template }: { template: AnimationTemplateDefinition }) {
  const boxPreview = template.id.startsWith("box-");
  return (
    <div
      className="hf-animation-template-preview relative h-[92px] overflow-hidden rounded-[8px]"
      data-preview={template.preview}
      aria-hidden="true"
    >
      <div className="hf-animation-template-grid" />
      <div className="hf-animation-template-glow hf-animation-template-glow-a" />
      <div className="hf-animation-template-glow hf-animation-template-glow-b" />
      <div className="hf-animation-template-subject">
        {template.category === "text" ? "Make motion clear." : null}
        {template.category === "general" && !boxPreview ? "Motion" : null}
        {boxPreview ? <span className="hf-animation-template-box" /> : null}
      </div>
    </div>
  );
}

export const AnimationTemplatesTab = memo(function AnimationTemplatesTab({
  onSelectTemplate,
}: {
  onSelectTemplate: (draft: AnimationTemplateDraft) => void;
}) {
  const { locale } = useStudioI18n();
  const { domEditSelection, selectedGsapAnimations } = useDomEditSelectionContext();
  const [search, setSearch] = useState("");
  const targetKind = domEditSelection ? resolveMotionTargetKind(domEditSelection) : null;
  const templateSections = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = ANIMATION_TEMPLATES.filter((template) => {
      if (!targetKind) return false;
      const preset = resolveAnimationTemplatePreset(template, targetKind);
      if (!preset?.targetKinds.includes(targetKind)) return false;
      return !query || (
        template.title.en.toLowerCase().includes(query) ||
        template.title.zh.includes(query) ||
        template.description.en.toLowerCase().includes(query) ||
        template.description.zh.includes(query)
      );
    });
    return [
      { category: "general" as const, templates: matches.filter((item) => item.category === "general") },
      ...(targetKind === "text"
        ? [{ category: "text" as const, templates: matches.filter((item) => item.category === "text") }]
        : []),
    ].filter((section) => section.templates.length > 0);
  }, [search, targetKind]);
  const appliedLabels = useMemo(() => {
    if (!targetKind) return [];
    const presetIds = new Set(
      resolveMotionInstances(selectedGsapAnimations).map(({ instance }) => instance.presetId),
    );
    return ANIMATION_TEMPLATES.filter((template) => {
      const preset = resolveAnimationTemplatePreset(template, targetKind);
      return preset ? presetIds.has(preset.id) : false;
    }).map((template) => template.title[locale]);
  }, [locale, selectedGsapAnimations, targetKind]);

  const applyTemplate = useCallback(
    (template: AnimationTemplateDefinition) => {
      if (!targetKind || !domEditSelection) return;
      const preset = resolveAnimationTemplatePreset(template, targetKind);
      if (!preset || !preset.targetKinds.includes(targetKind)) return;
      onSelectTemplate({
        templateId: template.id,
        presetId: preset.id,
        targetKind,
        selection: domEditSelection,
        parameters: resolveAnimationTemplateParameters(
          template,
          preset,
          domEditSelection.element.hasAttribute("data-var-text"),
        ),
      });
    },
    [domEditSelection, onSelectTemplate, targetKind],
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="animation-templates-tab"
    >
      <div className="flex-shrink-0 space-y-3 border-b border-panel-border px-4 pb-4 pt-3">
        <div className="relative">
          <img
            src={searchIconSrc}
            alt=""
            className="pointer-events-none absolute left-[11px] top-1/2 h-4 w-4 -translate-y-1/2"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={locale === "zh" ? "搜索动画…" : "Search animations…"}
            aria-label={locale === "zh" ? "搜索动画" : "Search animations"}
            className="h-[34px] w-full rounded-lg border-0 bg-panel-input pl-9 pr-3 text-[13px] text-panel-text-1 outline-none placeholder:text-[#a2a6af] focus:ring-1 focus:ring-[#20bbc0]/50"
          />
        </div>
        <div
          className={`rounded-[8px] px-3 py-2 text-[10px] leading-4 ${
            domEditSelection ? "bg-[#20bbc0]/10 text-[#168e92]" : "bg-panel-input text-panel-text-3"
          }`}
        >
          {domEditSelection
            ? locale === "zh"
              ? `已选中：${domEditSelection.label}${appliedLabels.length > 0 ? ` · 已有动画：${appliedLabels.join("、")}` : ""}`
              : `Selected: ${domEditSelection.label}${appliedLabels.length > 0 ? ` · Applied: ${appliedLabels.join(", ")}` : ""}`
            : locale === "zh"
              ? "先在播放区或剪辑区选中一个元素"
              : "Select an element in the preview or timeline first"}
        </div>
      </div>

      <div className="hf-animation-template-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {templateSections.length === 0 ? (
          <div className="grid h-24 place-items-center text-[11px] text-panel-text-3">
            {domEditSelection
              ? locale === "zh"
                ? "没有匹配的动画"
                : "No matching animations"
              : locale === "zh"
                ? "请先在视频播放区选中元素"
                : "Select an element in the video preview first"}
          </div>
        ) : (
          <div className="space-y-6">
            {templateSections.map((section) => (
              <section key={section.category}>
                <div className="mb-3">
                  <div className="text-[12px] font-semibold text-panel-text-1">
                    {CATEGORY_LABELS[section.category][locale]}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-4 text-panel-text-3">
                    {CATEGORY_LABELS[section.category].hint[locale]}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-[10px] gap-y-4">
                  {section.templates.map((template) => (
                    <article
                      key={template.id}
                      className="hf-animation-template-card group min-w-0"
                      data-testid="animation-template-card"
                    >
                      <TemplatePreview template={template} />
                      <div className="mt-2 truncate text-[12px] font-semibold text-panel-text-1">
                        {template.title[locale]}
                      </div>
                      <div className="mt-0.5 min-h-8 text-[10px] leading-4 text-panel-text-3">
                        {template.description[locale]}
                      </div>
                      <button
                        type="button"
                        onClick={() => applyTemplate(template)}
                        className="mt-2 h-7 w-full rounded-[6px] bg-panel-input text-[10px] font-medium text-panel-text-1 transition-colors hover:bg-[#20bbc0]/15 hover:text-[#168e92]"
                      >
                        {locale === "zh" ? "应用" : "Apply"}
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
