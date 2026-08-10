import type {
  MotionParameter,
  MotionParameterOption,
  MotionParameters,
  MotionPreset,
} from "./motionPresets.js";

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

const MOTION_INTENSITY_PARAMETER: MotionParameter = {
  id: "intensity",
  label: "强度",
  kind: "number",
  min: 0.2,
  max: 2,
  step: 0.1,
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
      ...(seed.color ? [{ id: "color", label: "效果颜色", kind: "color" as const }] : []),
    ],
    defaults: {
      ease: seed.phase === "emphasis" ? "sine.inOut" : "power2.out",
      ...(seed.intensity ? { intensity: 1 } : {}),
      unit: "whole",
      stagger: 0.04,
      ...(seed.direction ? { direction: seed.phase === "exit" ? "up" : "up" } : {}),
      ...(seed.color ? { color: "#7c3aed" } : {}),
      ...seed.defaults,
    },
    semantics: seed.semantics,
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

export const MOTION_PRESETS: readonly MotionPreset[] = [
  ...TEXT_MOTION_PRESETS,
  ...ELEMENT_MOTION_PRESETS,
];
