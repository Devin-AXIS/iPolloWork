import { memo, useCallback, useMemo, useState } from "react";
import {
  getMotionPreset,
  type MotionParameters,
  type MotionPreset,
  type MotionTargetKind,
} from "@hyperframes/core/motion-presets";
import { usePanelLayoutContext } from "../../contexts/PanelLayoutContext";
import {
  useDomEditActionsContext,
  useDomEditSelectionContext,
} from "../../contexts/DomEditContext";
import { useStudioI18n } from "../../i18n";
import { resolveMotionTargetKind } from "../editor/SemanticMotionPanel";
import searchIconSrc from "../../icons/figmaAssetsSearch.svg?url";

export type AnimationTemplateCategory = "general" | "text" | "background" | "box";

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
  background: {
    en: "Background",
    zh: "背景动画",
    hint: {
      en: "For background layers and full-frame surfaces",
      zh: "适用于背景层、色块和全屏容器",
    },
  },
  box: {
    en: "Box",
    zh: "盒子动画",
    hint: { en: "For cards, images, buttons, and shapes", zh: "适用于卡片、图片、按钮和图形" },
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
    id: "background-molten-flow",
    category: "background",
    title: { en: "Molten Flow", zh: "熔光流动" },
    description: {
      en: "Three colors, brightness, glow, and flow",
      zh: "三色、亮度、辉光与流动幅度可调",
    },
    preview: "molten",
    presetId: "background.emphasis.molten-flow",
    parameters: { colorSource: "theme" },
  },
  {
    id: "background-aurora",
    category: "background",
    title: { en: "Aurora Breath", zh: "极光呼吸" },
    description: { en: "A restrained cyan-green atmosphere", zh: "克制的青绿色呼吸氛围" },
    preview: "aurora",
    presetId: "background.emphasis.aurora-breathe",
    parameters: { colorSource: "theme" },
  },
  {
    id: "background-prism",
    category: "background",
    title: { en: "Prism Shift", zh: "棱镜变色" },
    description: { en: "Warm color migration for surfaces", zh: "适合背景色块的暖色迁移" },
    preview: "prism",
    presetId: "background.emphasis.prism-shift",
    parameters: { colorSource: "theme" },
  },
  {
    id: "background-light-rays",
    category: "background",
    title: { en: "Theme Rays", zh: "主题光束" },
    description: { en: "Light pulses driven by theme colors", zh: "由主题色驱动的光束明暗脉冲" },
    preview: "light-rays",
    presetId: "background.emphasis.light-rays",
    parameters: { colorSource: "theme" },
  },
  {
    id: "background-grid-scan",
    category: "background",
    title: { en: "Grid Scan", zh: "网格扫描" },
    description: { en: "A restrained technical scan rhythm", zh: "克制的技术感扫描节奏" },
    preview: "grid-scan",
    presetId: "background.emphasis.grid-scan",
    parameters: { colorSource: "theme" },
  },
  {
    id: "background-iridescent",
    category: "background",
    title: { en: "Iridescent Flow", zh: "虹彩流动" },
    description: { en: "Theme palette with hue migration", zh: "主题色板与虹彩色相迁移" },
    preview: "iridescent",
    presetId: "background.emphasis.iridescent-flow",
    parameters: { colorSource: "theme" },
  },
  {
    id: "box-scale",
    category: "box",
    title: { en: "Box Scale", zh: "盒子缩放" },
    description: { en: "A stable entrance for cards and images", zh: "适合卡片和图片的稳定进入" },
    preview: "box-scale",
    presetId: "element.enter.scale",
  },
  {
    id: "box-lift",
    category: "box",
    title: { en: "Box Lift", zh: "盒子浮起" },
    description: { en: "Subtle lift and focus", zh: "轻微上浮并聚焦内容" },
    preview: "box-lift",
    presetId: "element.emphasis.lift",
  },
  {
    id: "box-pulse",
    category: "box",
    title: { en: "Box Pulse", zh: "盒子呼吸" },
    description: { en: "A restrained scale pulse", zh: "克制的缩放呼吸强调" },
    preview: "box-pulse",
    presetId: "element.emphasis.pulse",
  },
  {
    id: "box-focus-tilt",
    category: "box",
    title: { en: "Depth Tilt", zh: "景深倾斜" },
    description: { en: "Editable direction and 3D intensity", zh: "可调整方向与立体倾斜强度" },
    preview: "box-tilt",
    presetId: "motion.emphasis.focus-tilt",
  },
  {
    id: "box-bounce-card",
    category: "box",
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
    category: "box",
    title: { en: "Spotlight Card", zh: "聚光卡片" },
    description: { en: "Theme-aware focus and glow", zh: "跟随主题色的聚焦与辉光" },
    preview: "box-spotlight",
    presetId: "element.emphasis.spotlight-card",
    parameters: { colorSource: "theme" },
  },
  {
    id: "box-glare-sweep",
    category: "box",
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

const CATEGORY_ORDER: readonly AnimationTemplateCategory[] = [
  "general",
  "text",
  "background",
  "box",
];

function TemplatePreview({ template }: { template: AnimationTemplateDefinition }) {
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
        {template.category === "general" ? "Motion" : null}
        {template.category === "box" ? <span className="hf-animation-template-box" /> : null}
      </div>
    </div>
  );
}

export const AnimationTemplatesTab = memo(function AnimationTemplatesTab() {
  const { locale } = useStudioI18n();
  const { setRightPanelTab } = usePanelLayoutContext();
  const { domEditSelection } = useDomEditSelectionContext();
  const { handleMotionMutation } = useDomEditActionsContext();
  const [category, setCategory] = useState<AnimationTemplateCategory>("general");
  const [search, setSearch] = useState("");
  const targetKind = domEditSelection ? resolveMotionTargetKind(domEditSelection) : null;
  const filteredTemplates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return ANIMATION_TEMPLATES.filter((template) => {
      if (template.category !== category) return false;
      if (!query) return true;
      return (
        template.title.en.toLowerCase().includes(query) ||
        template.title.zh.includes(query) ||
        template.description.en.toLowerCase().includes(query) ||
        template.description.zh.includes(query)
      );
    });
  }, [category, search]);

  const applyTemplate = useCallback(
    (template: AnimationTemplateDefinition) => {
      if (!targetKind) return;
      const preset = resolveAnimationTemplatePreset(template, targetKind);
      if (!preset || !preset.targetKinds.includes(targetKind)) return;
      handleMotionMutation(targetKind, {
        operation: "upsert",
        phase: preset.phase,
        presetId: preset.id,
        parameters: resolveAnimationTemplateParameters(
          template,
          preset,
          domEditSelection?.element.hasAttribute("data-var-text") === true,
        ),
      });
      setRightPanelTab("animation-properties");
    },
    [domEditSelection, handleMotionMutation, setRightPanelTab, targetKind],
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
            placeholder={locale === "zh" ? "搜索动画模板…" : "Search animation templates…"}
            aria-label={locale === "zh" ? "搜索动画模板" : "Search animation templates"}
            className="h-[34px] w-full rounded-lg border-0 bg-panel-input pl-9 pr-3 text-[13px] text-panel-text-1 outline-none placeholder:text-[#a2a6af] focus:ring-1 focus:ring-[#20bbc0]/50"
          />
        </div>
        <div className="grid grid-cols-4 gap-1 rounded-[8px] bg-panel-input p-1" role="tablist">
          {CATEGORY_ORDER.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={category === item}
              onClick={() => setCategory(item)}
              className={`h-8 rounded-[6px] px-1 text-[10px] font-medium transition-colors ${
                category === item
                  ? "bg-panel-bg text-panel-text-0 shadow-sm"
                  : "text-panel-text-3 hover:text-panel-text-1"
              }`}
            >
              {CATEGORY_LABELS[item][locale]}
            </button>
          ))}
        </div>
        <div className="text-[10px] leading-4 text-panel-text-3">
          {CATEGORY_LABELS[category].hint[locale]}
        </div>
        <div
          className={`rounded-[8px] px-3 py-2 text-[10px] leading-4 ${
            domEditSelection ? "bg-[#20bbc0]/10 text-[#168e92]" : "bg-panel-input text-panel-text-3"
          }`}
        >
          {domEditSelection
            ? locale === "zh"
              ? `已选中：${domEditSelection.label}`
              : `Selected: ${domEditSelection.label}`
            : locale === "zh"
              ? "先在播放区或剪辑区选中一个元素"
              : "Select an element in the preview or timeline first"}
        </div>
      </div>

      <div className="hf-animation-template-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {filteredTemplates.length === 0 ? (
          <div className="grid h-24 place-items-center text-[11px] text-panel-text-3">
            {locale === "zh" ? "没有匹配的动画模板" : "No matching animation templates"}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-[10px] gap-y-4">
            {filteredTemplates.map((template) => {
              const preset = targetKind
                ? resolveAnimationTemplatePreset(template, targetKind)
                : null;
              const compatible = Boolean(targetKind && preset?.targetKinds.includes(targetKind));
              return (
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
                    disabled={!compatible}
                    onClick={() => applyTemplate(template)}
                    className="mt-2 h-7 w-full rounded-[6px] bg-panel-input text-[10px] font-medium text-panel-text-1 transition-colors hover:bg-[#20bbc0]/15 hover:text-[#168e92] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {compatible
                      ? locale === "zh"
                        ? "应用"
                        : "Apply"
                      : locale === "zh"
                        ? "不适用于当前元素"
                        : "Not compatible"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
