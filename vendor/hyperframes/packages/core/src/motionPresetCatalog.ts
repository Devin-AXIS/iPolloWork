import type {
  MotionParameter,
  MotionParameterOption,
  MotionParameters,
  MotionPreset,
} from "./motionPresets.js";
import type { StructuredTextRecipe } from "./structuredTextMotion.js";

const EASE_OPTIONS: MotionParameterOption[] = [
  { value: "power2.out", label: "柔和" },
  { value: "power3.out", label: "顺滑" },
  { value: "back.out(1.7)", label: "弹性" },
  { value: "sine.inOut", label: "自然" },
  { value: "none", label: "匀速" },
];

const DIRECTION_OPTIONS: MotionParameterOption[] = [
  { value: "up", label: "向上" },
  { value: "down", label: "向下" },
  { value: "left", label: "向左" },
  { value: "right", label: "向右" },
];

const UNIT_OPTIONS: MotionParameterOption[] = [
  { value: "whole", label: "整段" },
  { value: "word", label: "按词" },
  { value: "character", label: "按字" },
];

export const MOTION_COMMON_PARAMETERS: MotionParameter[] = [
  { id: "ease", label: "速度曲线", kind: "select", options: EASE_OPTIONS },
];

export const MOTION_COLOR_SOURCE_PARAMETER: MotionParameter = {
  id: "colorSource",
  label: "颜色来源",
  kind: "select",
  options: [
    { value: "theme", label: "跟随主题" },
    { value: "custom", label: "自定义" },
  ],
};

const MOTION_INTENSITY_PARAMETER: MotionParameter = {
  id: "intensity",
  label: "强度",
  kind: "number",
  min: 0.2,
  max: 2,
  step: 0.1,
};

const MOTION_GLOW_PARAMETER: MotionParameter = {
  id: "glow",
  label: "辉光",
  kind: "number",
  min: 0,
  max: 2,
  step: 0.1,
};

const MOTION_BLUR_PARAMETER: MotionParameter = {
  id: "blur",
  label: "模糊",
  kind: "number",
  min: 0,
  max: 32,
  step: 1,
  unit: "px",
};

const MOTION_DENSITY_PARAMETER: MotionParameter = {
  id: "density",
  label: "密度",
  kind: "number",
  min: 0,
  max: 2,
  step: 0.1,
};

const MOTION_DISTANCE_PARAMETER: MotionParameter = {
  id: "distance",
  label: "移动距离",
  kind: "number",
  min: 0,
  max: 180,
  step: 2,
  unit: "px",
};

const MOTION_SPEED_PARAMETER: MotionParameter = {
  id: "speed",
  label: "Animation speed",
  kind: "number",
  min: 0.5,
  max: 2,
  step: 0.1,
  unit: "x",
};

const MOTION_READABILITY_PARAMETER: MotionParameter = {
  id: "preserveReadable",
  label: "保持可读",
  kind: "select",
  options: [
    { value: "true", label: "开启" },
    { value: "false", label: "关闭" },
  ],
};

export const MOTION_DIRECTION_PARAMETER: MotionParameter = {
  id: "direction",
  label: "方向",
  kind: "select",
  options: DIRECTION_OPTIONS,
};

export const MOTION_TEXT_PARAMETERS: MotionParameter[] = [
  { id: "unit", label: "文字方式", kind: "select", options: UNIT_OPTIONS },
  { id: "stagger", label: "字词间隔", kind: "number", min: 0, max: 0.3, step: 0.01, unit: "s" },
];

type PresetSeed = Omit<MotionPreset, "version" | "targetKinds" | "parameterSchema" | "defaults"> & {
  direction?: boolean;
  intensity?: boolean;
  color?: boolean;
  defaults?: MotionParameters;
};

function finiteParameter(parameters: MotionParameters, id: string, fallback: number): number {
  const value = Number(parameters[id] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function highlightTransformOrigin(direction: string): string {
  if (direction === "left") return "100% 50%";
  if (direction === "up") return "50% 100%";
  if (direction === "down") return "50% 0%";
  return "0% 50%";
}

function highlightColor(parameters: MotionParameters): string {
  const color = parameters.colorSource === "theme"
    ? "var(--ipw-color-accent, #ff1745)"
    : String(parameters.color ?? "#ff1745");
  return color.toLowerCase();
}

export function createHighlightSweepStructuredRecipe(
  parameters: MotionParameters = {},
): StructuredTextRecipe {
  const direction = String(parameters.direction ?? "right");
  const split = String(parameters.unit ?? "word") as StructuredTextRecipe["split"];
  const stagger = finiteParameter(parameters, "stagger", 0.05);
  const speed = finiteParameter(parameters, "speed", 1);
  const intensity = finiteParameter(parameters, "intensity", 1);
  const roundness = finiteParameter(parameters, "roundness", 10);
  const color = highlightColor(parameters);
  const defaultRed = color === "#ff1745";
  const endColor = defaultRed ? "#df1238" : `color-mix(in srgb, ${color} 87%, #000000)`;
  const shadowAlpha = Math.min(0.8, 0.32 * intensity).toFixed(2);
  const shadow = defaultRed
    ? `0 12px 30px rgba(229, 20, 58, ${shadowAlpha})`
    : `0 12px 30px color-mix(in srgb, ${color} ${Math.round(Number(shadowAlpha) * 100)}%, transparent)`;
  const transformOrigin = highlightTransformOrigin(direction);
  const horizontal = direction === "left" || direction === "right";
  const scaleProperty = horizontal ? "scaleX" : "scaleY";
  const hiddenScale = { [scaleProperty]: 0 };
  const visibleScale = { [scaleProperty]: 1 };
  const exitScale = { [scaleProperty]: 1.02 };

  return {
    version: 1,
    id: "caption-highlight.word-sweep",
    presetId: "text.emphasis.highlight-sweep",
    split,
    layers: [
      { role: "unit", perUnit: true, className: "ipw-highlight-word" },
      { role: "background", perUnit: true, className: "ipw-highlight-word-bg" },
      { role: "text", perUnit: true, className: "ipw-highlight-word-text" },
    ],
    tracks: [
      {
        role: "background",
        position: 0,
        duration: 0.15 / speed,
        stagger,
        keyframes: [
          {
            percentage: 0,
            properties: {
              opacity: 0,
              ...hiddenScale,
              transformOrigin,
              backgroundImage: `linear-gradient(135deg, ${color} 0%, ${endColor} 100%)`,
              borderRadius: `${roundness}px`,
              boxShadow: shadow,
            },
          },
          {
            percentage: 100,
            ease: "power2.out",
            properties: { opacity: 1, ...visibleScale, transformOrigin },
          },
        ],
      },
      {
        role: "background",
        position: 0.23 / speed,
        duration: 0.1 / speed,
        stagger,
        keyframes: [
          { percentage: 0, properties: { opacity: 1, ...visibleScale, transformOrigin } },
          {
            percentage: 100,
            ease: "power2.in",
            properties: { opacity: 0, ...exitScale, transformOrigin },
          },
        ],
      },
      {
        role: "background",
        position: 0.33 / speed,
        duration: 0,
        stagger,
        keyframes: [
          {
            percentage: 0,
            properties: { opacity: 0, ...hiddenScale, transformOrigin },
          },
        ],
      },
      {
        role: "unit",
        position: 0,
        duration: 0.24 / speed,
        stagger,
        keyframes: [
          { percentage: 0, properties: { filter: "brightness(1)" } },
          {
            percentage: 33,
            ease: "power2.out",
            properties: { filter: `brightness(${(1 + 0.05 * intensity).toFixed(2)})` },
          },
          { percentage: 100, ease: "power2.out", properties: { filter: "brightness(1)" } },
        ],
      },
      {
        role: "text",
        position: 0,
        duration: 0.24 / speed,
        stagger,
        keyframes: [
          { percentage: 0, properties: { color: "#ffffff", textShadow: "0 6px 18px rgba(0, 0, 0, 0.45)" } },
          { percentage: 100, properties: { color: "#ffffff", textShadow: "0 6px 18px rgba(0, 0, 0, 0.45)" } },
        ],
      },
    ],
  };
}

export function resolveStructuredTextRecipe(
  preset: MotionPreset,
  parameters: MotionParameters,
): StructuredTextRecipe | undefined {
  if (preset.id === "text.emphasis.highlight-sweep") {
    return createHighlightSweepStructuredRecipe(parameters);
  }
  return preset.structuredText;
}

function textPreset(seed: PresetSeed): MotionPreset {
  return {
    id: seed.id,
    version: 1,
    label: seed.label,
    phase: seed.phase,
    targetKinds: ["text"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      ...(seed.intensity ? [MOTION_INTENSITY_PARAMETER] : []),
      ...(seed.direction ? [MOTION_DIRECTION_PARAMETER] : []),
      ...MOTION_TEXT_PARAMETERS,
      ...(seed.color
        ? [
            MOTION_COLOR_SOURCE_PARAMETER,
            { id: "color", label: "效果颜色", kind: "color" as const },
          ]
        : []),
    ],
    defaults: {
      ease: seed.phase === "emphasis" ? "sine.inOut" : "power2.out",
      ...(seed.intensity ? { intensity: 1 } : {}),
      unit: "whole",
      stagger: 0.04,
      ...(seed.direction ? { direction: seed.phase === "exit" ? "up" : "up" } : {}),
      ...(seed.color ? { colorSource: "custom", color: "#7c3aed" } : {}),
      ...seed.defaults,
    },
    ...(seed.structuredText ? { structuredText: seed.structuredText } : {}),
    semantics: seed.semantics,
  };
}

function migratedTextPreset(
  seed: PresetSeed & {
    extraParameters?: MotionParameter[];
  },
): MotionPreset {
  return {
    ...textPreset(seed),
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_INTENSITY_PARAMETER,
      ...(seed.direction ? [MOTION_DIRECTION_PARAMETER] : []),
      ...MOTION_TEXT_PARAMETERS,
      ...(seed.color
        ? [
            MOTION_COLOR_SOURCE_PARAMETER,
            { id: "color", label: "效果颜色", kind: "color" as const },
          ]
        : []),
      ...(seed.extraParameters ?? []),
    ],
    defaults: {
      ease: seed.phase === "emphasis" ? "sine.inOut" : "power3.out",
      intensity: 1,
      unit: "whole",
      stagger: 0.04,
      ...(seed.direction ? { direction: "right" } : {}),
      ...(seed.color ? { colorSource: "theme", color: "#20BBC0" } : {}),
      ...seed.defaults,
    },
    ...(seed.structuredText ? { structuredText: seed.structuredText } : {}),
  };
}

function elementPreset(seed: PresetSeed): MotionPreset {
  return {
    id: seed.id,
    version: 1,
    label: seed.label,
    phase: seed.phase,
    targetKinds: ["element"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      ...(seed.intensity ? [MOTION_INTENSITY_PARAMETER] : []),
      ...(seed.direction ? [MOTION_DIRECTION_PARAMETER] : []),
    ],
    defaults: {
      ease: seed.phase === "emphasis" ? "sine.inOut" : "power2.out",
      ...(seed.intensity ? { intensity: 1 } : {}),
      ...(seed.direction ? { direction: "up" } : {}),
      ...seed.defaults,
    },
    semantics: seed.semantics,
  };
}

const TEXT_MOTION_PRESETS: readonly MotionPreset[] = [
  textPreset({
    id: "text.enter.fade",
    label: "淡入",
    phase: "enter",
    semantics: {
      intents: ["出现", "淡入"],
      tones: ["克制", "通用"],
      preferredFor: ["正文", "说明文字"],
      avoidFor: ["强冲击标题"],
    },
  }),
  textPreset({
    id: "text.enter.rise",
    label: "浮入",
    phase: "enter",
    intensity: true,
    direction: true,
    semantics: {
      intents: ["进入", "上浮"],
      tones: ["现代", "克制"],
      preferredFor: ["主标题", "章节标题"],
      avoidFor: ["密集字幕"],
    },
  }),
  textPreset({
    id: "text.enter.pop",
    label: "弹入",
    phase: "enter",
    intensity: true,
    defaults: { ease: "back.out(1.7)", intensity: 0.8 },
    semantics: {
      intents: ["弹出", "吸引注意"],
      tones: ["活泼", "友好"],
      preferredFor: ["短标题", "数字"],
      avoidFor: ["严肃长文"],
    },
  }),
  textPreset({
    id: "text.enter.zoom",
    label: "缩放进入",
    phase: "enter",
    intensity: true,
    semantics: {
      intents: ["放大进入", "聚焦"],
      tones: ["直接", "现代"],
      preferredFor: ["标题", "关键数据"],
      avoidFor: ["长段落"],
    },
  }),
  textPreset({
    id: "text.enter.flip",
    label: "翻转进入",
    phase: "enter",
    intensity: true,
    direction: true,
    semantics: {
      intents: ["翻转", "揭示"],
      tones: ["动感", "科技"],
      preferredFor: ["短标题", "标签"],
      avoidFor: ["正文"],
    },
  }),
  textPreset({
    id: "text.enter.wipe",
    label: "擦除进入",
    phase: "enter",
    direction: true,
    semantics: {
      intents: ["擦入", "揭幕"],
      tones: ["利落", "编辑感"],
      preferredFor: ["标题", "字幕"],
      avoidFor: ["超长文本"],
    },
  }),
  textPreset({
    id: "text.enter.typewriter",
    label: "逐字出现",
    phase: "enter",
    intensity: true,
    defaults: { unit: "character", stagger: 0.05, ease: "none" },
    semantics: {
      intents: ["打字", "逐字显示"],
      tones: ["叙事", "数字化"],
      preferredFor: ["短句", "对话", "代码"],
      avoidFor: ["大段正文"],
    },
  }),
  textPreset({
    id: "text.enter.decode",
    label: "字符解码",
    phase: "enter",
    intensity: true,
    defaults: { unit: "character", stagger: 0.03 },
    semantics: {
      intents: ["解码", "科技揭示"],
      tones: ["科技", "神秘"],
      preferredFor: ["科技标题", "编号"],
      avoidFor: ["正式正文"],
    },
  }),
  textPreset({
    id: "text.emphasis.pulse",
    label: "脉冲",
    phase: "emphasis",
    intensity: true,
    semantics: {
      intents: ["强调", "呼吸"],
      tones: ["克制", "柔和"],
      preferredFor: ["关键词", "数字"],
      avoidFor: ["连续循环"],
    },
  }),
  textPreset({
    id: "text.emphasis.bounce",
    label: "弹跳",
    phase: "emphasis",
    intensity: true,
    defaults: { ease: "power2.out" },
    semantics: {
      intents: ["弹跳", "提醒"],
      tones: ["活泼", "轻快"],
      preferredFor: ["短词", "CTA"],
      avoidFor: ["严肃正文"],
    },
  }),
  textPreset({
    id: "text.emphasis.wobble",
    label: "摇摆",
    phase: "emphasis",
    intensity: true,
    semantics: {
      intents: ["摇摆", "提示"],
      tones: ["轻松", "俏皮"],
      preferredFor: ["图形化文字", "短标题"],
      avoidFor: ["大段文字"],
    },
  }),
  textPreset({
    id: "text.emphasis.shake",
    label: "轻微抖动",
    phase: "emphasis",
    intensity: true,
    semantics: {
      intents: ["抖动", "警示"],
      tones: ["紧张", "醒目"],
      preferredFor: ["警告", "关键变化"],
      avoidFor: ["舒缓内容"],
    },
  }),
  textPreset({
    id: "text.emphasis.highlight",
    label: "高亮扫光",
    phase: "emphasis",
    intensity: true,
    color: true,
    semantics: {
      intents: ["高亮", "扫光"],
      tones: ["精致", "高级"],
      preferredFor: ["关键词", "品牌标题"],
      avoidFor: ["小字号正文"],
    },
  }),
  textPreset({
    id: "text.emphasis.glitch",
    label: "故障闪烁",
    phase: "emphasis",
    intensity: true,
    color: true,
    semantics: {
      intents: ["故障", "科技强调"],
      tones: ["科技", "强烈"],
      preferredFor: ["科技标题", "转折"],
      avoidFor: ["稳重品牌"],
    },
  }),
  textPreset({
    id: "text.exit.fade",
    label: "淡出",
    phase: "exit",
    semantics: {
      intents: ["消失", "淡出"],
      tones: ["克制", "通用"],
      preferredFor: ["正文", "说明文字"],
      avoidFor: ["强冲击收尾"],
    },
  }),
  textPreset({
    id: "text.exit.drift",
    label: "飘出",
    phase: "exit",
    intensity: true,
    direction: true,
    semantics: {
      intents: ["离开", "飘出"],
      tones: ["自然", "轻盈"],
      preferredFor: ["标题", "字幕"],
      avoidFor: ["紧凑切换"],
    },
  }),
  textPreset({
    id: "text.exit.shrink",
    label: "缩小退出",
    phase: "exit",
    intensity: true,
    semantics: {
      intents: ["缩小", "收束"],
      tones: ["直接", "现代"],
      preferredFor: ["标题", "关键数据"],
      avoidFor: ["长段落"],
    },
  }),
  textPreset({
    id: "text.exit.flip",
    label: "翻转退出",
    phase: "exit",
    intensity: true,
    direction: true,
    semantics: {
      intents: ["翻转离开"],
      tones: ["动感", "科技"],
      preferredFor: ["短标题", "标签"],
      avoidFor: ["正文"],
    },
  }),
  textPreset({
    id: "text.exit.wipe",
    label: "擦除退出",
    phase: "exit",
    direction: true,
    semantics: {
      intents: ["擦除", "收幕"],
      tones: ["利落", "编辑感"],
      preferredFor: ["标题", "字幕"],
      avoidFor: ["超长文本"],
    },
  }),
  textPreset({
    id: "text.exit.blur",
    label: "模糊消失",
    phase: "exit",
    intensity: true,
    semantics: {
      intents: ["模糊", "消散"],
      tones: ["柔和", "电影感"],
      preferredFor: ["标题", "情绪文字"],
      avoidFor: ["小字号说明"],
    },
  }),
] as const;

const MIGRATED_CAPTION_TEXT_PRESETS: readonly MotionPreset[] = [
  migratedTextPreset({
    id: "text.emphasis.highlight-sweep",
    label: "高亮扫过",
    phase: "emphasis",
    direction: true,
    color: true,
    defaults: {
      unit: "word",
      stagger: 0.05,
      colorSource: "custom",
      color: "#FF1745",
      roundness: 10,
      speed: 1,
    },
    extraParameters: [
      { id: "roundness", label: "圆角", kind: "number", min: 0, max: 24, step: 1, unit: "px" },
      MOTION_SPEED_PARAMETER,
    ],
    structuredText: createHighlightSweepStructuredRecipe(),
    semantics: {
      intents: ["高亮", "扫过", "关键词强化"],
      tones: ["清晰", "编辑感"],
      preferredFor: ["关键词", "标题", "字幕文字"],
      avoidFor: ["很小的正文"],
    },
  }),
  migratedTextPreset({
    id: "text.enter.matrix-decode",
    label: "矩阵解码",
    phase: "enter",
    color: true,
    defaults: { unit: "character", stagger: 0.03, color: "#32FF7E", density: 1, blur: 0 },
    extraParameters: [MOTION_DENSITY_PARAMETER, MOTION_BLUR_PARAMETER],
    semantics: {
      intents: ["解码", "科技显现", "字符扰动"],
      tones: ["科技", "利落"],
      preferredFor: ["科技标题", "编号", "短句"],
      avoidFor: ["长段正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.gradient-fill",
    label: "渐变填充",
    phase: "emphasis",
    direction: true,
    color: true,
    defaults: { color: "#FF4FD8", accentColor: "#20BBC0" },
    extraParameters: [{ id: "accentColor", label: "强调色", kind: "color" }],
    semantics: {
      intents: ["渐变", "填充", "流动"],
      tones: ["明亮", "品牌感"],
      preferredFor: ["标题", "关键词"],
      avoidFor: ["正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.neon-glow",
    label: "霓虹辉光",
    phase: "emphasis",
    color: true,
    defaults: { color: "#20BBC0", glow: 1 },
    extraParameters: [MOTION_GLOW_PARAMETER],
    semantics: {
      intents: ["霓虹", "发光", "强调"],
      tones: ["科技", "夜景"],
      preferredFor: ["标题", "品牌词"],
      avoidFor: ["长正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.neon-accent",
    label: "霓虹强调",
    phase: "emphasis",
    color: true,
    defaults: { color: "#FF4FD8", glow: 1 },
    extraParameters: [MOTION_GLOW_PARAMETER],
    semantics: {
      intents: ["霓虹", "强调色", "轻微漂移"],
      tones: ["活跃", "科技"],
      preferredFor: ["短标题", "关键词"],
      avoidFor: ["正式正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.rgb-glitch",
    label: "RGB 故障",
    phase: "emphasis",
    color: true,
    defaults: { color: "#FF1745", preserveReadable: "true", blur: 5, density: 1.35 },
    extraParameters: [MOTION_BLUR_PARAMETER, MOTION_DENSITY_PARAMETER, MOTION_READABILITY_PARAMETER],
    semantics: {
      intents: ["故障", "RGB", "扰动"],
      tones: ["强烈", "科技"],
      preferredFor: ["科技标题", "转折词"],
      avoidFor: ["稳重品牌", "长正文"],
    },
  }),
  migratedTextPreset({
    id: "text.enter.clip-wipe",
    label: "裁切揭幕",
    phase: "enter",
    direction: true,
    defaults: { unit: "word", stagger: 0.05 },
    semantics: {
      intents: ["裁切", "揭幕", "方向进入"],
      tones: ["利落", "编辑感"],
      preferredFor: ["标题", "短句", "字幕文字"],
      avoidFor: ["超长正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.blend-difference",
    label: "差值反色",
    phase: "emphasis",
    defaults: { preserveReadable: "true", blur: 0 },
    extraParameters: [MOTION_BLUR_PARAMETER, MOTION_READABILITY_PARAMETER],
    semantics: {
      intents: ["反色", "混合", "强调"],
      tones: ["实验", "编辑感"],
      preferredFor: ["标题", "海报文字"],
      avoidFor: ["小字号正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.weight-shift",
    label: "字重切换",
    phase: "emphasis",
    defaults: { unit: "word", stagger: 0.04, minWeight: 300, maxWeight: 700 },
    extraParameters: [
      { id: "minWeight", label: "起始字重", kind: "number", min: 100, max: 900, step: 50 },
      { id: "maxWeight", label: "强调字重", kind: "number", min: 100, max: 900, step: 50 },
    ],
    semantics: {
      intents: ["字重", "强调", "排版"],
      tones: ["克制", "高级"],
      preferredFor: ["标题", "关键词"],
      avoidFor: ["不支持可变字重的字体"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.texture-fill",
    label: "纹理填充",
    phase: "emphasis",
    direction: true,
    color: true,
    defaults: { color: "#FFFFFF", density: 1 },
    extraParameters: [MOTION_DENSITY_PARAMETER],
    semantics: {
      intents: ["纹理", "遮罩", "填充"],
      tones: ["设计感", "海报"],
      preferredFor: ["大标题", "品牌词"],
      avoidFor: ["小字号正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.kinetic-slam",
    label: "动感冲击",
    phase: "emphasis",
    direction: true,
    defaults: { unit: "word", preserveReadable: "true", distance: 120 },
    extraParameters: [MOTION_DISTANCE_PARAMETER, MOTION_READABILITY_PARAMETER],
    semantics: {
      intents: ["冲击", "动感", "强调"],
      tones: ["强烈", "节奏"],
      preferredFor: ["短标题", "关键词"],
      avoidFor: ["长正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.emoji-pop",
    label: "Emoji 弹出",
    phase: "emphasis",
    defaults: { unit: "character", stagger: 0.03 },
    semantics: {
      intents: ["emoji", "弹出", "轻松"],
      tones: ["playful", "社交"],
      preferredFor: ["社媒文字", "轻松标题"],
      avoidFor: ["正式报告"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.particle-burst",
    label: "粒子爆发",
    phase: "emphasis",
    color: true,
    defaults: { unit: "word", stagger: 0.06, color: "#FFB000", density: 1 },
    extraParameters: [MOTION_DENSITY_PARAMETER],
    semantics: {
      intents: ["粒子", "爆发", "关键词强化"],
      tones: ["活跃", "庆祝"],
      preferredFor: ["关键词", "数字", "短标题"],
      avoidFor: ["长正文"],
    },
  }),
];

const ELEMENT_MOTION_PRESETS: readonly MotionPreset[] = [
  elementPreset({
    id: "element.enter.fade",
    label: "淡入",
    phase: "enter",
    semantics: {
      intents: ["出现", "淡入"],
      tones: ["克制", "通用"],
      preferredFor: ["图片", "图标", "卡片", "形状"],
      avoidFor: ["需要强方向感的进入"],
    },
  }),
  elementPreset({
    id: "element.enter.slide",
    label: "滑入",
    phase: "enter",
    intensity: true,
    direction: true,
    semantics: {
      intents: ["进入", "滑入", "移动出现"],
      tones: ["清晰", "现代"],
      preferredFor: ["卡片", "图片", "流程节点"],
      avoidFor: ["全屏背景"],
    },
  }),
  elementPreset({
    id: "element.enter.scale",
    label: "缩放进入",
    phase: "enter",
    intensity: true,
    semantics: {
      intents: ["放大出现", "聚焦"],
      tones: ["直接", "稳重"],
      preferredFor: ["图标", "关键图片", "数据卡片"],
      avoidFor: ["大面积容器"],
    },
  }),
  elementPreset({
    id: "element.emphasis.lift",
    label: "浮起",
    phase: "emphasis",
    intensity: true,
    semantics: {
      intents: ["强调", "浮起", "聚焦"],
      tones: ["克制", "精致"],
      preferredFor: ["卡片", "按钮", "关键图标"],
      avoidFor: ["全屏背景"],
    },
  }),
  elementPreset({
    id: "element.emphasis.pulse",
    label: "呼吸",
    phase: "emphasis",
    intensity: true,
    semantics: {
      intents: ["强调", "呼吸", "提醒"],
      tones: ["柔和", "持续关注"],
      preferredFor: ["图标", "状态点", "CTA"],
      avoidFor: ["大面积图片"],
    },
  }),
  elementPreset({
    id: "element.emphasis.tilt",
    label: "轻摆",
    phase: "emphasis",
    intensity: true,
    semantics: {
      intents: ["轻摆", "提示", "活跃"],
      tones: ["轻巧", "友好"],
      preferredFor: ["图标", "贴纸", "小型形状"],
      avoidFor: ["严肃数据卡片", "大面积容器"],
    },
  }),
  elementPreset({
    id: "element.exit.fade",
    label: "淡出",
    phase: "exit",
    semantics: {
      intents: ["消失", "淡出"],
      tones: ["克制", "通用"],
      preferredFor: ["图片", "图标", "卡片", "形状"],
      avoidFor: ["需要强方向感的离开"],
    },
  }),
  elementPreset({
    id: "element.exit.slide",
    label: "滑出",
    phase: "exit",
    intensity: true,
    direction: true,
    semantics: {
      intents: ["离开", "滑出", "移动消失"],
      tones: ["清晰", "现代"],
      preferredFor: ["卡片", "图片", "流程节点"],
      avoidFor: ["全屏背景"],
    },
  }),
  elementPreset({
    id: "element.exit.scale",
    label: "缩小退出",
    phase: "exit",
    intensity: true,
    semantics: {
      intents: ["缩小", "收束", "退出"],
      tones: ["直接", "稳重"],
      preferredFor: ["图标", "关键图片", "数据卡片"],
      avoidFor: ["大面积容器"],
    },
  }),
] as const;

const REACT_BITS_TEXT_PRESETS: readonly MotionPreset[] = [
  {
    id: "text.enter.blur-reveal",
    version: 1,
    label: "雾化显现",
    phase: "enter",
    targetKinds: ["text"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_INTENSITY_PARAMETER,
      MOTION_DIRECTION_PARAMETER,
      ...MOTION_TEXT_PARAMETERS,
      { id: "blur", label: "模糊半径", kind: "number", min: 0, max: 32, step: 1, unit: "px" },
    ],
    defaults: {
      ease: "power3.out",
      intensity: 1,
      direction: "up",
      unit: "word",
      stagger: 0.08,
      blur: 14,
    },
    semantics: {
      intents: ["雾化", "分词显现", "文字进入"],
      tones: ["柔和", "电影感"],
      preferredFor: ["标题", "短句", "章节文字"],
      avoidFor: ["长段正文"],
    },
  },
  {
    id: "text.enter.mask-sweep",
    version: 1,
    label: "分词揭幕",
    phase: "enter",
    targetKinds: ["text"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_INTENSITY_PARAMETER,
      MOTION_DIRECTION_PARAMETER,
      ...MOTION_TEXT_PARAMETERS,
    ],
    defaults: {
      ease: "power3.out",
      intensity: 1,
      direction: "up",
      unit: "word",
      stagger: 0.06,
    },
    semantics: {
      intents: ["分词", "遮罩揭示", "文字进入"],
      tones: ["现代", "编辑感"],
      preferredFor: ["主标题", "字幕", "关键词"],
      avoidFor: ["密集小字"],
    },
  },
  {
    id: "text.emphasis.prism-glow",
    version: 1,
    label: "棱彩流光",
    phase: "emphasis",
    targetKinds: ["text"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_INTENSITY_PARAMETER,
      ...MOTION_TEXT_PARAMETERS,
      MOTION_COLOR_SOURCE_PARAMETER,
      { id: "color", label: "流光颜色", kind: "color" },
    ],
    defaults: {
      ease: "sine.inOut",
      intensity: 1,
      unit: "whole",
      stagger: 0.04,
      colorSource: "custom",
      color: "#20BBC0",
    },
    semantics: {
      intents: ["流光", "文字强调", "高亮"],
      tones: ["科技", "精致"],
      preferredFor: ["品牌标题", "关键词", "数据"],
      avoidFor: ["长段正文"],
    },
  },
  {
    id: "text.enter.fold-reveal",
    version: 1,
    label: "折叠文字",
    phase: "enter",
    targetKinds: ["text"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_INTENSITY_PARAMETER,
      MOTION_DIRECTION_PARAMETER,
      ...MOTION_TEXT_PARAMETERS,
      {
        id: "perspective",
        label: "透视距离",
        kind: "number",
        min: 300,
        max: 1400,
        step: 50,
        unit: "px",
      },
    ],
    defaults: {
      ease: "power3.out",
      intensity: 1,
      direction: "up",
      unit: "character",
      stagger: 0.045,
      perspective: 700,
    },
    semantics: {
      intents: ["折叠", "分字揭示", "立体文字"],
      tones: ["编辑感", "立体"],
      preferredFor: ["主标题", "短句", "章节文字"],
      avoidFor: ["长段正文", "小字号说明"],
    },
  },
  {
    id: "text.emphasis.shiny-sweep",
    version: 1,
    label: "主题流光",
    phase: "emphasis",
    targetKinds: ["text"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_INTENSITY_PARAMETER,
      MOTION_DIRECTION_PARAMETER,
      ...MOTION_TEXT_PARAMETERS,
      MOTION_COLOR_SOURCE_PARAMETER,
      { id: "color", label: "流光颜色", kind: "color" },
      { id: "glow", label: "辉光", kind: "number", min: 0, max: 2, step: 0.1 },
    ],
    defaults: {
      ease: "sine.inOut",
      intensity: 1,
      direction: "right",
      unit: "whole",
      stagger: 0.04,
      colorSource: "custom",
      color: "#FFFFFF",
      glow: 1,
    },
    semantics: {
      intents: ["流光", "高光扫过", "文字强调"],
      tones: ["精致", "品牌感"],
      preferredFor: ["品牌标题", "关键词", "关键数据"],
      avoidFor: ["长段正文"],
    },
  },
  {
    id: "text.emphasis.true-focus",
    version: 1,
    label: "逐词聚焦",
    phase: "emphasis",
    targetKinds: ["text"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_INTENSITY_PARAMETER,
      ...MOTION_TEXT_PARAMETERS,
      { id: "blur", label: "失焦半径", kind: "number", min: 0, max: 18, step: 1, unit: "px" },
      { id: "focusScale", label: "聚焦缩放", kind: "number", min: 1, max: 1.25, step: 0.01 },
    ],
    defaults: {
      ease: "sine.inOut",
      intensity: 1,
      unit: "word",
      stagger: 0.08,
      blur: 5,
      focusScale: 1.06,
    },
    semantics: {
      intents: ["聚焦", "逐词强调", "景深"],
      tones: ["克制", "叙事"],
      preferredFor: ["短句", "字幕", "关键表达"],
      avoidFor: ["单字标题", "密集小字"],
    },
  },
];

const REACT_BITS_GENERAL_PRESETS: readonly MotionPreset[] = [
  {
    id: "motion.enter.content-reveal",
    version: 1,
    label: "内容显现",
    phase: "enter",
    targetKinds: ["text", "element"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_DIRECTION_PARAMETER,
      { id: "distance", label: "移动距离", kind: "number", min: 0, max: 180, step: 2, unit: "px" },
      { id: "initialOpacity", label: "初始透明度", kind: "number", min: 0, max: 1, step: 0.05 },
      { id: "initialScale", label: "初始缩放", kind: "number", min: 0.5, max: 1.2, step: 0.05 },
    ],
    defaults: {
      ease: "power3.out",
      direction: "up",
      distance: 56,
      initialOpacity: 0,
      initialScale: 0.92,
    },
    semantics: {
      intents: ["内容进入", "滑动显现", "通用动画"],
      tones: ["现代", "克制"],
      preferredFor: ["文字", "图片", "卡片", "图形"],
      avoidFor: ["全屏背景"],
    },
  },
  {
    id: "motion.emphasis.soft-float",
    version: 1,
    label: "柔和漂浮",
    phase: "emphasis",
    targetKinds: ["text", "element"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_DIRECTION_PARAMETER,
      MOTION_INTENSITY_PARAMETER,
      { id: "distance", label: "漂浮距离", kind: "number", min: 2, max: 48, step: 1, unit: "px" },
    ],
    defaults: {
      ease: "sine.inOut",
      direction: "up",
      intensity: 1,
      distance: 12,
    },
    semantics: {
      intents: ["漂浮", "呼吸", "通用强调"],
      tones: ["柔和", "轻盈"],
      preferredFor: ["图标", "标题", "卡片", "装饰图形"],
      avoidFor: ["密集正文"],
    },
  },
  {
    id: "motion.emphasis.focus-tilt",
    version: 1,
    label: "景深倾斜",
    phase: "emphasis",
    targetKinds: ["text", "element"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_DIRECTION_PARAMETER,
      MOTION_INTENSITY_PARAMETER,
    ],
    defaults: { ease: "sine.inOut", direction: "right", intensity: 1 },
    semantics: {
      intents: ["倾斜", "聚焦", "通用强调"],
      tones: ["立体", "科技"],
      preferredFor: ["卡片", "图片", "短标题"],
      avoidFor: ["长段正文"],
    },
  },
  {
    id: "motion.enter.gradual-focus",
    version: 1,
    label: "渐进聚焦",
    phase: "enter",
    targetKinds: ["text", "element"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_DIRECTION_PARAMETER,
      MOTION_INTENSITY_PARAMETER,
      { id: "distance", label: "移动距离", kind: "number", min: 0, max: 120, step: 2, unit: "px" },
      { id: "blur", label: "模糊强度", kind: "number", min: 0, max: 32, step: 1, unit: "px" },
    ],
    defaults: {
      ease: "power3.out",
      direction: "up",
      intensity: 1,
      distance: 28,
      blur: 18,
    },
    semantics: {
      intents: ["渐进模糊", "聚焦进入", "内容显现"],
      tones: ["柔和", "电影感"],
      preferredFor: ["文字", "图片", "卡片", "图形"],
      avoidFor: ["需要快速响应的提示"],
    },
  },
  {
    id: "motion.enter.scan-reveal",
    version: 1,
    label: "扫描揭幕",
    phase: "enter",
    targetKinds: ["text", "element"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_DIRECTION_PARAMETER,
      MOTION_INTENSITY_PARAMETER,
      { id: "blur", label: "扫描柔化", kind: "number", min: 0, max: 16, step: 1, unit: "px" },
      { id: "contrast", label: "扫描对比", kind: "number", min: 0.8, max: 2, step: 0.05 },
    ],
    defaults: {
      ease: "power3.out",
      direction: "right",
      intensity: 1,
      blur: 6,
      contrast: 1.25,
    },
    semantics: {
      intents: ["扫描", "遮罩揭示", "数字化进入"],
      tones: ["科技", "利落"],
      preferredFor: ["标题", "图片", "信息卡片", "图形"],
      avoidFor: ["柔和情绪内容"],
    },
  },
  {
    id: "motion.emphasis.magnetic-snap",
    version: 1,
    label: "磁吸回弹",
    phase: "emphasis",
    targetKinds: ["text", "element"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_DIRECTION_PARAMETER,
      MOTION_INTENSITY_PARAMETER,
      { id: "distance", label: "吸附距离", kind: "number", min: 4, max: 64, step: 2, unit: "px" },
      { id: "overshoot", label: "回弹幅度", kind: "number", min: 0, max: 1, step: 0.05 },
    ],
    defaults: {
      ease: "power3.out",
      direction: "right",
      intensity: 1,
      distance: 22,
      overshoot: 0.35,
    },
    semantics: {
      intents: ["磁吸", "回弹", "聚焦强调"],
      tones: ["灵敏", "现代"],
      preferredFor: ["按钮", "图标", "卡片", "短标题"],
      avoidFor: ["长段正文", "全屏背景"],
    },
  },
];

const BACKGROUND_PARAMETER_SCHEMA: MotionParameter[] = [
  ...MOTION_COMMON_PARAMETERS,
  MOTION_COLOR_SOURCE_PARAMETER,
  { id: "color1", label: "暗部颜色", kind: "color" },
  { id: "color2", label: "中间色", kind: "color" },
  { id: "color3", label: "高光颜色", kind: "color" },
  { id: "brightness", label: "亮度", kind: "number", min: 0.6, max: 1.8, step: 0.05 },
  { id: "glow", label: "辉光", kind: "number", min: 0, max: 2, step: 0.1 },
  { id: "swirl", label: "流动幅度", kind: "number", min: -1.5, max: 1.5, step: 0.1 },
];

function backgroundPreset(
  id: string,
  label: string,
  defaults: MotionParameters,
  intents: string[],
): MotionPreset {
  return {
    id,
    version: 1,
    label,
    phase: "emphasis",
    targetKinds: ["element"],
    parameterSchema: BACKGROUND_PARAMETER_SCHEMA,
    defaults: { ease: "sine.inOut", colorSource: "custom", ...defaults },
    semantics: {
      intents,
      tones: ["氛围", "动态背景"],
      preferredFor: ["背景层", "色块", "全屏容器"],
      avoidFor: ["文字", "小图标"],
    },
  };
}

const REACT_BITS_BACKGROUND_PRESETS: readonly MotionPreset[] = [
  backgroundPreset(
    "background.emphasis.molten-flow",
    "熔光流动",
    {
      color1: "#1B1640",
      color2: "#6D4AFF",
      color3: "#F3B8FF",
      brightness: 1.1,
      glow: 1.2,
      swirl: 0.8,
    },
    ["熔融金属", "液态流光", "背景循环"],
  ),
  backgroundPreset(
    "background.emphasis.aurora-breathe",
    "极光呼吸",
    {
      color1: "#071A2B",
      color2: "#20BBC0",
      color3: "#9AF0D5",
      brightness: 1.05,
      glow: 0.9,
      swirl: 0.45,
    },
    ["极光", "呼吸", "渐变背景"],
  ),
  backgroundPreset(
    "background.emphasis.prism-shift",
    "棱镜变色",
    {
      color1: "#111827",
      color2: "#F97316",
      color3: "#FDE68A",
      brightness: 1.15,
      glow: 1.4,
      swirl: -0.6,
    },
    ["棱镜", "色彩迁移", "背景强调"],
  ),
  backgroundPreset(
    "background.emphasis.light-rays",
    "主题光束",
    {
      color1: "#0B1020",
      color2: "#2563EB",
      color3: "#FFFFFF",
      brightness: 1.05,
      glow: 1.25,
      swirl: 0.35,
    },
    ["光束", "明暗脉冲", "主题氛围"],
  ),
  backgroundPreset(
    "background.emphasis.grid-scan",
    "网格扫描",
    {
      color1: "#08111C",
      color2: "#0F766E",
      color3: "#5EEAD4",
      brightness: 1,
      glow: 0.75,
      swirl: 0.9,
    },
    ["扫描", "数字网格", "技术背景"],
  ),
  backgroundPreset(
    "background.emphasis.iridescent-flow",
    "虹彩流动",
    {
      color1: "#17122F",
      color2: "#7C3AED",
      color3: "#22D3EE",
      brightness: 1.08,
      glow: 1.15,
      swirl: -0.5,
    },
    ["虹彩", "色相流动", "氛围背景"],
  ),
];

const REACT_BITS_BOX_PRESETS: readonly MotionPreset[] = [
  {
    id: "element.enter.bounce-card",
    version: 1,
    label: "弹性卡片",
    phase: "enter",
    targetKinds: ["element"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_DIRECTION_PARAMETER,
      MOTION_INTENSITY_PARAMETER,
      { id: "rotation", label: "入场倾角", kind: "number", min: 0, max: 24, step: 1, unit: "°" },
    ],
    defaults: { ease: "back.out(1.7)", direction: "up", intensity: 1, rotation: 8 },
    semantics: {
      intents: ["弹性入场", "卡片落位", "回弹"],
      tones: ["活泼", "友好"],
      preferredFor: ["卡片", "图片", "按钮", "图形"],
      avoidFor: ["全屏背景", "严肃数据表"],
    },
  },
  {
    id: "element.emphasis.spotlight-card",
    version: 1,
    label: "聚光卡片",
    phase: "emphasis",
    targetKinds: ["element"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_INTENSITY_PARAMETER,
      MOTION_COLOR_SOURCE_PARAMETER,
      { id: "color", label: "聚光颜色", kind: "color" },
      { id: "glow", label: "聚光强度", kind: "number", min: 0, max: 2, step: 0.1 },
    ],
    defaults: {
      ease: "sine.inOut",
      intensity: 1,
      colorSource: "custom",
      color: "#FFFFFF",
      glow: 1,
    },
    semantics: {
      intents: ["聚光", "卡片强调", "层级提升"],
      tones: ["精致", "克制"],
      preferredFor: ["卡片", "图片", "按钮", "关键图形"],
      avoidFor: ["全屏背景", "大段正文"],
    },
  },
  {
    id: "element.emphasis.glare-sweep",
    version: 1,
    label: "高光掠过",
    phase: "emphasis",
    targetKinds: ["element"],
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_DIRECTION_PARAMETER,
      MOTION_INTENSITY_PARAMETER,
      MOTION_COLOR_SOURCE_PARAMETER,
      { id: "color", label: "高光颜色", kind: "color" },
      { id: "glow", label: "高光强度", kind: "number", min: 0, max: 2, step: 0.1 },
    ],
    defaults: {
      ease: "sine.inOut",
      direction: "right",
      intensity: 1,
      colorSource: "custom",
      color: "#FFFFFF",
      glow: 0.8,
    },
    semantics: {
      intents: ["高光", "掠过", "材质强调"],
      tones: ["精致", "现代"],
      preferredFor: ["卡片", "图片", "按钮", "形状"],
      avoidFor: ["扁平正文", "透明容器"],
    },
  },
];

export const MOTION_PRESETS: readonly MotionPreset[] = [
  ...TEXT_MOTION_PRESETS,
  ...MIGRATED_CAPTION_TEXT_PRESETS,
  ...ELEMENT_MOTION_PRESETS,
  ...REACT_BITS_TEXT_PRESETS,
  ...REACT_BITS_GENERAL_PRESETS,
  ...REACT_BITS_BACKGROUND_PRESETS,
  ...REACT_BITS_BOX_PRESETS,
];
