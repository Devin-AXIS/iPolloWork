import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  defaultMotionDuration,
  getMotionPreset,
  type MotionApplicationKind,
  type MotionMutationInput,
  type MotionParameters,
  type MotionPreset,
  type MotionTargetKind,
} from "@hyperframes/core/motion-presets";
import {
  useDomEditActionsContext,
  useDomEditSelectionContext,
} from "../../contexts/DomEditContext";
import { useStudioI18n } from "../../i18n";
import { resolveCaptionMotionTargetElement } from "../../utils/motionPreset";
import {
  resolveMotionInstances,
  resolveMotionTargetKind,
  type ResolvedMotionInstance,
} from "../editor/SemanticMotionPanel";
import type { DomEditSelection } from "../editor/domEditing";
import searchIconSrc from "../../icons/figmaAssetsSearch.svg?url";
import { ChevronDown } from "../../icons/SystemIcons";

const StructuredMotionThumbnail = lazy(() =>
  import("./StructuredMotionThumbnail").then((module) => ({
    default: module.StructuredMotionThumbnail,
  })),
);
const AnimationPropertiesPanel = lazy(() =>
  import("../editor/SemanticMotionPanel").then((module) => ({
    default: module.AnimationPropertiesPanel,
  })),
);

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
  keywords?: readonly string[];
}

export interface AnimationTemplateApplication {
  preset: MotionPreset;
  targetKind: MotionTargetKind;
  applicationKind: MotionApplicationKind;
}

export interface AnimationTemplateDraft {
  templateId: string;
  presetId: string;
  targetKind: MotionTargetKind;
  applicationKind: MotionApplicationKind;
  selection: DomEditSelection;
  parameters: MotionParameters;
}

export interface AnimationTemplateSection {
  key: string;
  title: { en: string; zh: string };
  hint: { en: string; zh: string };
  templates: AnimationTemplateDefinition[];
}

const MIGRATED_TEXT_TEMPLATE_ORDER = [
  "text-editorial-emphasis",
  "text-karaoke-flow",
  "text-camera-track",
  "text-visual-layers",
  "text-highlight-sweep",
  "text-matrix-decode",
  "text-gradient-fill",
  "text-neon-glow",
  "text-neon-accent",
  "text-rgb-glitch",
  "text-clip-wipe",
  "text-blend-difference",
  "text-weight-shift",
  "text-texture-fill",
  "text-kinetic-slam",
  "text-emoji-pop",
  "text-particle-burst",
] as const;

const MIGRATED_TEXT_TEMPLATE_RANK = new Map<string, number>(
  MIGRATED_TEXT_TEMPLATE_ORDER.map((id, index) => [id, index]),
);

export function isAdvancedTextAnimationTemplate(template: AnimationTemplateDefinition): boolean {
  return template.category === "text" && MIGRATED_TEXT_TEMPLATE_RANK.has(template.id);
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

const BOX_AUTOMATION_SECTION_LABEL = {
  title: { en: "Box & Automation", zh: "盒子与自动化" },
  hint: {
    en: "Card, box, material, and automated emphasis effects",
    zh: "卡片、盒子、材质与自动化强调效果",
  },
};

const ANIMATION_EDITOR_WIDTH = 200;

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
    parameters: { colorSource: "custom" },
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
    parameters: { colorSource: "custom" },
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
    id: "text-editorial-emphasis",
    category: "text",
    title: { en: "Editorial Emphasis", zh: "编辑重点" },
    description: {
      en: "Word-by-word editorial focus and settle",
      zh: "逐词聚焦并自然落回原有排版",
    },
    preview: "text-focus",
    presetId: "text.enter.editorial-emphasis",
    parameters: { colorSource: "custom", color: "#1FBAC0", unit: "word", stagger: 0.075 },
    keywords: ["advanced", "高级", "editorial", "编辑"],
  },
  {
    id: "text-karaoke-flow",
    category: "text",
    title: { en: "Karaoke Flow", zh: "移动卡拉 OK" },
    description: { en: "A teal pill follows each spoken word", zh: "蓝绿色胶囊按词接力高亮" },
    preview: "text-highlight",
    presetId: "text.emphasis.karaoke-flow",
    parameters: { colorSource: "custom", color: "#1FBAC0", unit: "word", stagger: 0.12 },
    keywords: ["advanced", "高级", "karaoke", "字幕", "逐词"],
  },
  {
    id: "text-camera-track",
    category: "text",
    title: { en: "Camera Track", zh: "镜头跟随" },
    description: {
      en: "Depth, tracking, and focus resolve by word",
      zh: "逐词景深、跟随与拉焦显现",
    },
    preview: "text-blur",
    presetId: "text.enter.camera-track",
    parameters: { unit: "word", stagger: 0.075 },
    keywords: ["advanced", "高级", "camera", "镜头", "拉焦"],
  },
  {
    id: "text-visual-layers",
    category: "text",
    title: { en: "Visual Layers", zh: "视觉层叠" },
    description: {
      en: "Blue and teal layers converge into readable type",
      zh: "蓝色与蓝绿色文字分层聚合并保持清晰",
    },
    preview: "text-glow",
    presetId: "text.enter.visual-layers",
    parameters: {
      colorSource: "custom",
      color: "#5B6CFF",
      accentColor: "#1FBAC0",
      unit: "word",
      stagger: 0.055,
    },
    keywords: ["advanced", "高级", "layers", "层叠", "色彩"],
  },
  {
    id: "text-highlight-sweep",
    category: "text",
    title: { en: "Highlight Sweep", zh: "高亮扫过" },
    description: { en: "Editable word or character highlight", zh: "支持按词或按字的高亮扫过" },
    preview: "text-highlight",
    presetId: "text.emphasis.highlight-sweep",
    parameters: { colorSource: "custom", color: "#FF1745" },
  },
  {
    id: "text-matrix-decode",
    category: "text",
    title: { en: "Matrix Decode", zh: "矩阵解码" },
    description: { en: "Character decode with density controls", zh: "可调密度的字符解码显现" },
    preview: "decode",
    presetId: "text.enter.matrix-decode",
    parameters: { colorSource: "custom", unit: "character", stagger: 0.035 },
  },
  {
    id: "text-gradient-fill",
    category: "text",
    title: { en: "Gradient Fill", zh: "渐变填充" },
    description: { en: "Theme-aware gradient emphasis", zh: "跟随主题色的渐变文字强调" },
    preview: "text-shine",
    presetId: "text.emphasis.gradient-fill",
    parameters: { colorSource: "custom", unit: "character", stagger: 0.045 },
  },
  {
    id: "text-neon-glow",
    category: "text",
    title: { en: "Neon Glow", zh: "霓虹辉光" },
    description: { en: "Editable glow color and strength", zh: "可调颜色与辉光强度" },
    preview: "text-glow",
    presetId: "text.emphasis.neon-glow",
    parameters: { colorSource: "custom", stagger: 0.09 },
  },
  {
    id: "text-neon-accent",
    category: "text",
    title: { en: "Neon Accent", zh: "霓虹强调" },
    description: { en: "Accent glow with subtle drift", zh: "带轻微漂移的强调辉光" },
    preview: "text-glow",
    presetId: "text.emphasis.neon-accent",
    parameters: { colorSource: "custom" },
  },
  {
    id: "text-rgb-glitch",
    category: "text",
    title: { en: "RGB Glitch", zh: "RGB 故障" },
    description: { en: "Readable chromatic glitch", zh: "保持可读的色差故障" },
    preview: "decode",
    presetId: "text.emphasis.rgb-glitch",
    parameters: { colorSource: "custom" },
  },
  {
    id: "text-clip-wipe",
    category: "text",
    title: { en: "Clip Wipe", zh: "裁切揭幕" },
    description: { en: "Directional text wipe reveal", zh: "可调方向的文字裁切揭示" },
    preview: "text-mask",
    presetId: "text.enter.clip-wipe",
    parameters: { colorSource: "custom", color: "#FFD700" },
  },
  {
    id: "text-blend-difference",
    category: "text",
    title: { en: "Blend Difference", zh: "差值反色" },
    description: { en: "Invert-style text emphasis", zh: "反色混合风格文字强调" },
    preview: "text-focus",
    presetId: "text.emphasis.blend-difference",
    parameters: { colorSource: "custom", color: "#FFFFFF" },
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
    parameters: { colorSource: "custom" },
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
    parameters: { colorSource: "custom" },
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

function isBoxAutomationTemplate(template: AnimationTemplateDefinition): boolean {
  return template.id.startsWith("box-");
}

export function resolveAnimationTemplateApplication(
  template: AnimationTemplateDefinition,
  targetKind: MotionTargetKind,
): AnimationTemplateApplication | null {
  const applicationTargetKind =
    targetKind === "text" && isBoxAutomationTemplate(template) ? "element" : targetKind;
  const preset = resolveAnimationTemplatePreset(template, applicationTargetKind);
  if (!preset?.targetKinds.includes(applicationTargetKind)) return null;
  return {
    preset,
    targetKind: applicationTargetKind,
    applicationKind:
      template.category === "text" ? "text" : isBoxAutomationTemplate(template) ? "box" : "general",
  };
}

export function resolveAnimationTemplateParameters(
  template: AnimationTemplateDefinition,
  preset: MotionPreset,
  _variableBoundText: boolean,
): MotionParameters {
  return { ...preset.defaults, ...template.parameters };
}

function TemplatePreview({
  template,
  active,
}: {
  template: AnimationTemplateDefinition;
  active: boolean;
}) {
  const boxPreview = template.id.startsWith("box-");
  const textPreset =
    template.category === "text" ? resolveAnimationTemplatePreset(template, "text") : null;
  const textParameters = textPreset
    ? resolveAnimationTemplateParameters(template, textPreset, false)
    : null;
  return (
    <div
      className="hf-animation-template-preview relative h-[100px] overflow-hidden rounded-[8px]"
      data-preview={textPreset ? undefined : template.preview}
      data-structured-preview-active={textPreset ? (active ? "true" : "false") : undefined}
      aria-hidden="true"
    >
      <div className="hf-animation-template-grid" />
      <div className="hf-animation-template-glow hf-animation-template-glow-a" />
      <div className="hf-animation-template-glow hf-animation-template-glow-b" />
      <div className="hf-animation-template-subject">
        {textPreset && textParameters && active ? (
          <Suspense fallback={<span>Make motion clear.</span>}>
            <StructuredMotionThumbnail
              presetId={textPreset.id}
              targetKind="text"
              parameters={textParameters}
              duration={defaultMotionDuration(textPreset)}
            />
          </Suspense>
        ) : template.category === "text" ? (
          "Make motion clear."
        ) : null}
        {template.category === "general" && !boxPreview ? "Motion" : null}
        {boxPreview ? <span className="hf-animation-template-box" /> : null}
      </div>
    </div>
  );
}

export function sortTextAnimationTemplates(
  templates: readonly AnimationTemplateDefinition[],
): AnimationTemplateDefinition[] {
  return [...templates].sort((a, b) => {
    const aRank = MIGRATED_TEXT_TEMPLATE_RANK.get(a.id);
    const bRank = MIGRATED_TEXT_TEMPLATE_RANK.get(b.id);
    if (aRank === undefined && bRank !== undefined) return -1;
    if (aRank !== undefined && bRank === undefined) return 1;
    return (aRank ?? 0) - (bRank ?? 0);
  });
}

export function createAnimationTemplateSections(
  templates: readonly AnimationTemplateDefinition[],
  targetKind: MotionTargetKind | null,
): AnimationTemplateSection[] {
  const generalTemplates = templates.filter(
    (item) => item.category === "general" && !isBoxAutomationTemplate(item),
  );
  const boxAutomationTemplates = templates.filter(isBoxAutomationTemplate);
  const textTemplates = sortTextAnimationTemplates(
    templates.filter((item) => item.category === "text"),
  );

  const generalSection =
    generalTemplates.length > 0
      ? ({
          key: "general",
          title: CATEGORY_LABELS.general,
          hint: CATEGORY_LABELS.general.hint,
          templates: generalTemplates,
        } satisfies AnimationTemplateSection)
      : null;
  const boxAutomationSection =
    boxAutomationTemplates.length > 0
      ? ({
          key: "box-automation",
          title: BOX_AUTOMATION_SECTION_LABEL.title,
          hint: BOX_AUTOMATION_SECTION_LABEL.hint,
          templates: boxAutomationTemplates,
        } satisfies AnimationTemplateSection)
      : null;

  if (targetKind !== "text") {
    return [generalSection, boxAutomationSection].filter(
      (section): section is AnimationTemplateSection => section !== null,
    );
  }

  const textSection: AnimationTemplateSection | null =
    textTemplates.length > 0
      ? {
          key: "text",
          title: { en: CATEGORY_LABELS.text.en, zh: CATEGORY_LABELS.text.zh },
          hint: CATEGORY_LABELS.text.hint,
          templates: textTemplates,
        }
      : null;
  return [generalSection, boxAutomationSection, textSection].filter(
    (section): section is AnimationTemplateSection => section !== null,
  );
}

export type AnimationLibraryCategory = "all" | "box-automation" | "text";

export function animationTemplateMatchesCategory(
  template: AnimationTemplateDefinition,
  category: AnimationLibraryCategory,
): boolean {
  if (category === "all") return true;
  if (category === "box-automation") return isBoxAutomationTemplate(template);
  return template.category === "text";
}

export function resolveAppliedAnimationTemplate(
  template: AnimationTemplateDefinition,
  targetKind: MotionTargetKind,
  motions: readonly ResolvedMotionInstance[],
): ResolvedMotionInstance | null {
  const application = resolveAnimationTemplateApplication(template, targetKind);
  if (!application) return null;
  for (let index = motions.length - 1; index >= 0; index -= 1) {
    const motion = motions[index];
    if (motion.instance.templateId) {
      if (motion.instance.templateId === template.id) return motion;
      continue;
    }
    if (
      motion.instance.applicationKind === application.applicationKind &&
      motion.instance.presetId === application.preset.id
    ) {
      return motion;
    }
  }
  return null;
}

type AnimationMutationHandler = (
  targetKind: MotionTargetKind,
  mutation: MotionMutationInput,
  selectionOverride?: DomEditSelection | null,
) => Promise<boolean>;

type AnimationMutationStatus = "applied" | "updated" | "removed" | "selection-required";

const AnimationTemplateCard = memo(function AnimationTemplateCard({
  template,
  locale,
  duration,
  applied,
  loading,
  onApply,
  onEdit,
  onRemove,
}: {
  template: AnimationTemplateDefinition;
  locale: "en" | "zh";
  duration: number;
  applied: ResolvedMotionInstance | null;
  loading: boolean;
  onApply: (template: AnimationTemplateDefinition) => void | Promise<void>;
  onEdit: (template: AnimationTemplateDefinition, anchor: HTMLElement) => void | Promise<void>;
  onRemove: (
    template: AnimationTemplateDefinition,
    motion: ResolvedMotionInstance,
  ) => void | Promise<void>;
}) {
  const { t } = useStudioI18n();
  const [previewActive, setPreviewActive] = useState(false);
  const advanced = isAdvancedTextAnimationTemplate(template);
  const state = loading ? "loading" : applied ? "applied" : "available";
  const preview = (
    <div className="relative">
      <div className="relative rounded-[8px]">
        <TemplatePreview template={template} active={previewActive} />
        <span
          className="pointer-events-none absolute inset-0 rounded-[8px] border-2 border-[#1FBAC0] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          data-testid="animation-card-hover-border"
        />
      </div>
      <span className="absolute left-2 top-2 rounded-[4px] bg-[#f6f7fb] px-1 py-0.5 text-[9px] font-semibold text-[#161e24]">
        {Number(duration.toFixed(1))} s
      </span>
      {applied || loading ? (
        <span className="absolute right-2 top-2 grid min-h-4 place-items-center rounded-[4px] bg-[#087b82] px-1 text-[9px] font-semibold text-[#a9e7ea]">
          {loading ? (
            <span className="size-3 animate-spin rounded-full border border-[#a9e7ea]/40 border-t-[#a9e7ea] motion-reduce:animate-none" />
          ) : (
            t("animation.inUse")
          )}
        </span>
      ) : null}
    </div>
  );

  return (
    <article
      className="hf-animation-template-card group relative min-w-0"
      data-testid="animation-template-card"
      data-template-id={template.id}
      data-state={state}
      data-applied={applied ? "true" : "false"}
      data-loading={loading ? "true" : "false"}
      data-advanced-text-animation={advanced ? "true" : undefined}
      style={{ contentVisibility: "auto", containIntrinsicSize: "128px" }}
      onMouseEnter={() => setPreviewActive(true)}
      onMouseLeave={() => setPreviewActive(false)}
    >
      {applied ? (
        preview
      ) : (
        <button
          type="button"
          disabled={loading}
          data-animation-action="apply"
          aria-label={`${t("animation.apply")} ${template.title[locale]}`}
          onClick={() => void onApply(template)}
          className="block w-full rounded-[8px] text-left outline-none active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-[#1FBAC0]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-panel-bg disabled:cursor-wait disabled:opacity-60"
        >
          {preview}
        </button>
      )}
      <div className="mt-1 flex h-5 min-w-0 items-center justify-between gap-1 pl-1">
        <div className="min-w-0 flex-1 truncate text-[12px] font-semibold text-black dark:text-panel-text-1">
          {template.title[locale]}
        </div>
        {applied ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              data-animation-action="edit"
              onClick={(event) => void onEdit(template, event.currentTarget)}
              className="h-5 rounded-[2px] px-1 text-[10px] text-[#5a6774] transition-[color,background-color,transform] hover:bg-[#f5f6f9] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1FBAC0]/50 dark:text-panel-text-2 dark:hover:bg-panel-hover dark:hover:text-panel-text-1"
            >
              {t("animation.edit")}
            </button>
            <button
              type="button"
              disabled={loading}
              data-animation-action="remove"
              onClick={() => void onRemove(template, applied)}
              className="h-5 rounded-[2px] px-1 text-[10px] text-[#5a6774] transition-[color,background-color,transform] hover:bg-[#f5f6f9] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1FBAC0]/50 disabled:cursor-wait disabled:opacity-60 dark:text-panel-text-2 dark:hover:bg-panel-hover dark:hover:text-panel-text-1"
            >
              {t("animation.remove")}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
});

function AnimationTemplateGroup({
  testId,
  title,
  expanded,
  onToggle,
  children,
}: {
  testId: string;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId} data-expanded={expanded ? "true" : "false"}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex h-12 w-full items-center justify-between px-[17px] text-[12px] font-medium text-[#2c2d2a] shadow-[inset_3px_0_0_#1FBAC0] transition-colors hover:bg-[#f5f6f9] active:bg-[#eceef2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1FBAC0]/50 dark:text-panel-text-1 dark:hover:bg-panel-input dark:active:bg-panel-hover"
      >
        {title}
        <ChevronDown
          size={16}
          className={`transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`}
        />
      </button>
      {expanded ? children : null}
    </section>
  );
}

interface AnimationEditorState {
  templateId: string;
  animationId: string;
  selection: DomEditSelection;
  anchor: { top: number; right: number; bottom: number; left: number };
}

export const AnimationTemplatesTab = memo(function AnimationTemplatesTab({
  onMutate,
  onStatus,
}: {
  onMutate: AnimationMutationHandler;
  onStatus?: (status: AnimationMutationStatus) => void;
}) {
  const { locale, t } = useStudioI18n();
  const { buildDomSelectionFromTarget } = useDomEditActionsContext();
  const { domEditSelection, selectedGsapAnimations } = useDomEditSelectionContext();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<AnimationLibraryCategory>("all");
  const [usedExpanded, setUsedExpanded] = useState(true);
  const [unusedExpanded, setUnusedExpanded] = useState(true);
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);
  const [applyFailed, setApplyFailed] = useState(false);
  const [editor, setEditor] = useState<AnimationEditorState | null>(null);
  const captionMotionTarget = domEditSelection
    ? resolveCaptionMotionTargetElement(domEditSelection.element)
    : null;
  const targetKind = domEditSelection
    ? captionMotionTarget !== domEditSelection.element
      ? "text"
      : resolveMotionTargetKind(domEditSelection)
    : null;
  const motions = useMemo(
    () => resolveMotionInstances(selectedGsapAnimations),
    [selectedGsapAnimations],
  );
  const matchingTemplates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return ANIMATION_TEMPLATES.filter((template) => {
      if (targetKind && !resolveAnimationTemplateApplication(template, targetKind)) return false;
      const advancedAliasMatch =
        isAdvancedTextAnimationTemplate(template) &&
        ["advanced", "高级", "高级文字动画"].some(
          (keyword) => keyword.includes(query) || query.includes(keyword),
        );
      return (
        !query ||
        advancedAliasMatch ||
        template.title.en.toLowerCase().includes(query) ||
        template.title.zh.includes(query) ||
        template.description.en.toLowerCase().includes(query) ||
        template.description.zh.includes(query) ||
        template.keywords?.some((keyword) => keyword.toLowerCase().includes(query))
      );
    });
  }, [search, targetKind]);
  const visibleTemplates = useMemo(
    () =>
      matchingTemplates.filter((template) => animationTemplateMatchesCategory(template, category)),
    [category, matchingTemplates],
  );
  const templateEntries = useMemo(
    () =>
      visibleTemplates.map((template) => ({
        template,
        applied: targetKind ? resolveAppliedAnimationTemplate(template, targetKind, motions) : null,
      })),
    [motions, targetKind, visibleTemplates],
  );
  const usedTemplates = templateEntries.filter((entry) => entry.applied !== null);
  const unusedTemplates = templateEntries.filter((entry) => entry.applied === null);
  const editorMotion = editor
    ? (motions.find((motion) => motion.animation.id === editor.animationId) ?? null)
    : null;
  const editorTemplate = editor
    ? (ANIMATION_TEMPLATES.find((template) => template.id === editor.templateId) ?? null)
    : null;

  useEffect(() => {
    if (editor && !editorMotion) setEditor(null);
  }, [editor, editorMotion]);

  const resolveSelection = useCallback(async () => {
    if (!domEditSelection) return null;
    if (!captionMotionTarget || captionMotionTarget === domEditSelection.element) {
      return domEditSelection;
    }
    return buildDomSelectionFromTarget(captionMotionTarget, { exactTarget: true });
  }, [buildDomSelectionFromTarget, captionMotionTarget, domEditSelection]);

  const applyTemplate = useCallback(
    async (template: AnimationTemplateDefinition) => {
      if (pendingTemplateId) return;
      if (!domEditSelection) {
        onStatus?.("selection-required");
        return;
      }
      setPendingTemplateId(template.id);
      setApplyFailed(false);
      try {
        const selection = await resolveSelection();
        if (!selection) return;
        const application = resolveAnimationTemplateApplication(
          template,
          resolveMotionTargetKind(selection),
        );
        if (!application) return;
        const applied = await onMutate(
          application.targetKind,
          {
            operation: "upsert",
            phase: application.preset.phase,
            presetId: application.preset.id,
            templateId: template.id,
            applicationKind: application.applicationKind,
            duration: defaultMotionDuration(application.preset),
            loop: false,
            parameters: resolveAnimationTemplateParameters(
              template,
              application.preset,
              selection.element.hasAttribute("data-var-text"),
            ),
          },
          selection,
        );
        if (!applied) {
          setApplyFailed(true);
          return;
        }
        onStatus?.("applied");
      } catch {
        setApplyFailed(true);
      } finally {
        setPendingTemplateId(null);
      }
    },
    [domEditSelection, onMutate, onStatus, pendingTemplateId, resolveSelection],
  );

  const removeTemplate = useCallback(
    async (template: AnimationTemplateDefinition, motion: ResolvedMotionInstance) => {
      if (pendingTemplateId) return;
      setPendingTemplateId(template.id);
      setApplyFailed(false);
      try {
        const selection = await resolveSelection();
        if (!selection) return;
        const removed = await onMutate(
          motion.instance.targetKind,
          {
            operation: "remove",
            phase: motion.instance.phase,
            templateId: motion.instance.templateId,
            applicationKind: motion.instance.applicationKind,
          },
          selection,
        );
        if (!removed) {
          setApplyFailed(true);
          return;
        }
        if (editor?.animationId === motion.animation.id) setEditor(null);
        onStatus?.("removed");
      } catch {
        setApplyFailed(true);
      } finally {
        setPendingTemplateId(null);
      }
    },
    [editor?.animationId, onMutate, onStatus, pendingTemplateId, resolveSelection],
  );

  const openEditor = useCallback(
    async (template: AnimationTemplateDefinition, anchorElement: HTMLElement) => {
      if (!targetKind) return;
      const motion = resolveAppliedAnimationTemplate(template, targetKind, motions);
      if (!motion) return;
      const anchorRect = anchorElement.getBoundingClientRect();
      const selection = await resolveSelection();
      if (!selection) return;
      setEditor({
        templateId: template.id,
        animationId: motion.animation.id,
        selection,
        anchor: {
          top: anchorRect.top,
          right: anchorRect.right,
          bottom: anchorRect.bottom,
          left: anchorRect.left,
        },
      });
    },
    [motions, resolveSelection, targetKind],
  );

  const renderCards = (entries: typeof templateEntries) => (
    <div className="grid grid-cols-2 gap-x-[10px] gap-y-4 px-4 py-2">
      {entries.map(({ template, applied }) => {
        const application = resolveAnimationTemplateApplication(
          template,
          targetKind ?? (template.category === "text" ? "text" : "element"),
        );
        return (
          <AnimationTemplateCard
            key={template.id}
            template={template}
            locale={locale}
            duration={
              applied?.instance.duration ??
              (application ? defaultMotionDuration(application.preset) : 0)
            }
            applied={applied}
            loading={pendingTemplateId === template.id}
            onApply={applyTemplate}
            onEdit={openEditor}
            onRemove={removeTemplate}
          />
        );
      })}
    </div>
  );

  const editorPosition = editor
    ? {
        top: Math.max(8, Math.min(editor.anchor.top, window.innerHeight - 360)),
        left: Math.max(
          8,
          editor.anchor.left >= ANIMATION_EDITOR_WIDTH + 16
            ? editor.anchor.left - ANIMATION_EDITOR_WIDTH - 8
            : editor.anchor.right + 8,
        ),
      }
    : null;

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
            placeholder={t("animation.searchPlaceholder")}
            aria-label={t("animation.searchLabel")}
            className="h-[34px] w-full rounded-lg border-0 bg-panel-input pl-9 pr-3 text-[13px] text-panel-text-1 outline-none placeholder:text-[#a2a6af] focus:ring-1 focus:ring-[#1FBAC0]/50"
          />
        </div>
        {domEditSelection ? (
          <div className="rounded-[8px] bg-[#1FBAC0]/10 px-3 py-2 text-[10px] leading-4 text-[#168e92]">
            {t("animation.selected", { label: domEditSelection.label })}
          </div>
        ) : null}
      </div>

      <div className="hf-animation-template-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="flex h-11 items-center gap-1.5 px-4 pt-2">
            {(
              [
                ["all", `${t("animation.filterAll")} ${matchingTemplates.length}`],
                ["box-automation", t("animation.filterBoxAutomation")],
                ["text", t("animation.filterText")],
              ] satisfies Array<[AnimationLibraryCategory, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                data-testid="animation-category-filter"
                data-category={id}
                aria-pressed={category === id}
                onClick={() => setCategory(id)}
                className={`hf-animation-category-filter h-7 rounded-[6px] px-2.5 text-[10px] font-medium transition-[color,background-color,box-shadow,transform] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1FBAC0]/50 focus-visible:ring-offset-1 focus-visible:ring-offset-panel-bg ${
                  category === id
                    ? "bg-black text-white dark:bg-panel-accent/20 dark:text-panel-text-0 dark:ring-1 dark:ring-inset dark:ring-panel-accent/45"
                    : "bg-[#f5f6f9] text-[#5a6774] hover:bg-[#eceef2] dark:bg-panel-input dark:text-panel-text-2 dark:hover:bg-panel-hover dark:hover:text-panel-text-1"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {applyFailed ? (
            <p role="alert" className="mx-4 mt-2 text-[10px] leading-4 text-red-500">
              {t("animation.saveError")}
            </p>
          ) : null}

          {templateEntries.length === 0 ? (
            <div className="grid h-24 place-items-center text-[11px] text-panel-text-3">
              {t("animation.noMatches")}
            </div>
          ) : (
            <div className="pb-4 pt-1">
              {usedTemplates.length === 0 ? (
                renderCards(unusedTemplates)
              ) : (
                <>
                  <AnimationTemplateGroup
                    testId="animation-used-section"
                    title={t("animation.used")}
                    expanded={usedExpanded}
                    onToggle={() => setUsedExpanded((value) => !value)}
                  >
                    {renderCards(usedTemplates)}
                  </AnimationTemplateGroup>
                  <AnimationTemplateGroup
                    testId="animation-unused-section"
                    title={t("animation.unused")}
                    expanded={unusedExpanded}
                    onToggle={() => setUnusedExpanded((value) => !value)}
                  >
                    {renderCards(unusedTemplates)}
                  </AnimationTemplateGroup>
                </>
              )}
            </div>
          )}
      </div>

      {editor && editorMotion && editorTemplate && editorPosition ? (
        <div className="fixed z-[80]" style={editorPosition}>
          <Suspense
            fallback={<div className="h-[320px] w-[200px] rounded-[8px] bg-white" />}
          >
            <AnimationPropertiesPanel
              draft={null}
              element={editor.selection}
              animations={[editorMotion.animation]}
              title={editorTemplate.title[locale]}
              onMutate={onMutate}
              onApplied={() => {
                setEditor(null);
                onStatus?.("updated");
              }}
              onClose={() => setEditor(null)}
            />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
});
