import { z } from "zod";
export const storyboardSettingsFieldsSchema = z.object({
  asset_source: z.string(), asset_kind: z.string(), asset_brief: z.string(),
  asset_reference: z.string(), asset_origin: z.string(), camera: z.string(),
  transition_in: z.string(), sound_effects: z.string(), sound_effect_reference: z.string(),
}).strict();
export type StoryboardSettingsFields = z.infer<typeof storyboardSettingsFieldsSchema>;
export const storyboardSettingsAssetSchema = z.object({
  path: z.string(), url: z.string(), kind: z.enum(["image", "video", "audio"]),
});
export type StoryboardSettingsAsset = z.infer<typeof storyboardSettingsAssetSchema>;
export const storyboardSettingsRequestSchema = z.object({
  type: z.literal("ipollowork:video-studio-settings-open"),
  projectId: z.string(), requestId: z.string(), frameIndex: z.number().int().positive(),
  title: z.string(), kind: z.enum(["picture", "sound"]),
  fields: storyboardSettingsFieldsSchema,
  assets: z.array(storyboardSettingsAssetSchema).max(2000),
  cameras: z.array(z.object({ value: z.string(), label: z.string() })),
});
export type StoryboardSettingsRequest = z.infer<typeof storyboardSettingsRequestSchema>;
export const storyboardSettingsApplySchema = z.object({
  type: z.literal("ipollowork:video-studio-settings-apply"),
  projectId: z.string(), requestId: z.string(), fields: storyboardSettingsFieldsSchema,
});
export { hyperframesStudioPort, videoProjectDirectory, videoProjectId } from "./hyperframes-project.js";

export const hyperframesEffectVariableUpdateSchema = z.enum(["live", "rebuild", "reload"]);

/** Authored semantic cues, not fabricated speech alignment. Times are scene-relative seconds. */
export const hyperframesMotionRecipeSchema = z.object({
  version: z.literal(1),
  pattern: z.string().min(1),
  minHoldSeconds: z.number().positive(),
  capacity: z.object({
    variable: z.string(), separator: z.string(), maxItems: z.number().int().positive(),
    minItems: z.number().int().positive().default(1),
    fieldSeparator: z.string().min(1).optional(),
    fieldsPerItem: z.number().int().positive().optional(),
    maxFieldLength: z.number().int().positive().optional(),
    numericField: z.number().int().nonnegative().optional(),
  }).strict().optional(),
  textLimits: z.record(z.string(), z.object({
    maxLines: z.number().int().positive(), maxLineLength: z.number().int().positive(),
  }).strict()).optional(),
  usage: z.object({
    useWhen: z.array(z.string().min(1).max(240)).min(1).max(4),
    avoidWhen: z.array(z.string().min(1).max(240)).min(1).max(4),
    inputRules: z.record(z.string(), z.string().min(1).max(240)),
    readingOrder: z.array(z.string().min(1).max(160)).min(2).max(8),
    cueBindings: z.record(z.string(), z.string().min(1).max(180)),
    fallback: z.object({
      overflow: z.string().min(1).max(240), missingInput: z.string().min(1).max(240),
      timingMismatch: z.string().min(1).max(240), inapplicable: z.string().min(1).max(240),
    }).strict(),
    example: z.object({
      values: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()])),
      narration: z.string().min(1).max(500),
    }).strict(),
    acceptance: z.array(z.string().min(1).max(240)).min(3).max(6),
  }).strict(),
  events: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    target: z.string().min(1),
    time: z.number().nonnegative(),
    duration: z.number().positive(),
    action: z.string().min(1),
  }).strict()).min(1).max(12),
}).strict().superRefine((recipe, context) => {
  const ids = recipe.events.map(event => event.id);
  if (new Set(ids).size !== ids.length || ids.some(id => !recipe.usage.cueBindings[id])
    || Object.keys(recipe.usage.cueBindings).some(id => !ids.includes(id))) {
    context.addIssue({ code: "custom", message: "Every unique event needs exactly one semantic narration binding." });
  }
  if (recipe.capacity && recipe.capacity.minItems > recipe.capacity.maxItems) {
    context.addIssue({ code: "custom", message: "Recipe minimum capacity exceeds its maximum." });
  }
});

export const hyperframesVideoInstanceSchema = z.object({
  sceneId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/).max(96),
  componentId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  start: z.number().nonnegative(),
  duration: z.number().positive().max(120),
  track: z.number().int().nonnegative().default(0),
  values: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()])),
  cueTimes: z.record(z.string(), z.number().nonnegative()).optional(),
  timingSource: z.enum(["voiceover", "estimated-reading", "visual-cue", "music", "media"]),
  transition: z.enum(["cut", "preset:element.enter.fade", "preset:element.enter.slide", "preset:element.enter.scale"]).default("cut"),
  transitionDuration: z.number().nonnegative().default(0),
  transitionIntent: z.enum(["continue", "topic-change", "time-change", "location-change", "compare", "reveal", "closure"]).default("continue"),
}).strict();

const variableBaseSchema = z.object({
  id: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/).max(64),
  label: z.string().trim().min(1).max(64),
  description: z.string().trim().min(1).max(240).optional(),
  update: hyperframesEffectVariableUpdateSchema.default("live"),
}).strict();

const stringVariableSchema = variableBaseSchema.extend({
  type: z.literal("string"),
  default: z.string(),
  placeholder: z.string().optional(),
  maxLength: z.number().int().positive().optional(),
}).strict();

const numberVariableSchema = variableBaseSchema.extend({
  type: z.literal("number"),
  default: z.number().finite(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().positive().finite().optional(),
  unit: z.string().trim().min(1).max(16).optional(),
}).strict().superRefine((variable, context) => {
  if (variable.min !== undefined && variable.max !== undefined && variable.min > variable.max) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["min"], message: "min must not exceed max" });
  }
  if (variable.min !== undefined && variable.default < variable.min) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["default"], message: "default must be at least min" });
  }
  if (variable.max !== undefined && variable.default > variable.max) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["default"], message: "default must not exceed max" });
  }
});

const colorVariableSchema = variableBaseSchema.extend({
  type: z.literal("color"),
  default: z.string().regex(/^#[0-9a-fA-F]{6}$/),
}).strict();

const booleanVariableSchema = variableBaseSchema.extend({
  type: z.literal("boolean"),
  default: z.boolean(),
}).strict();

const enumVariableSchema = variableBaseSchema.extend({
  type: z.literal("enum"),
  default: z.string(),
  options: z.array(z.object({
    value: z.string().min(1),
    label: z.string().trim().min(1).max(64),
  }).strict()).min(1),
}).strict().superRefine((variable, context) => {
  if (!variable.options.some((option) => option.value === variable.default)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["default"], message: "default must match an option" });
  }
});

export const hyperframesEffectVariableSchema = z.union([
  stringVariableSchema,
  numberVariableSchema,
  colorVariableSchema,
  booleanVariableSchema,
  enumVariableSchema,
]);

export const hyperframesEffectEngineSchema = z.object({
  name: z.string().trim().min(1).max(32),
  version: z.string().trim().min(1).max(32).optional(),
  seekable: z.boolean().default(true),
  plugins: z.array(z.string().trim().min(1).max(64)).optional(),
}).strict();

export const hyperframesCatalogKindSchema = z.enum(["animation", "effect"]);

export const hyperframesCatalogItemSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  type: z.enum(["hyperframes:block", "hyperframes:component"]),
  kind: hyperframesCatalogKindSchema.default("animation"),
  category: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).default([]),
  version: z.string().trim().min(1).optional(),
  duration: z.number().positive().optional(),
  dimensions: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict().optional(),
  preview: z.object({
    poster: z.string().optional(),
    video: z.string().optional(),
  }).strict().optional(),
  engine: hyperframesEffectEngineSchema.optional(),
  source: z.object({
    provider: z.string().trim().min(1).max(64),
    label: z.string().trim().min(1).max(96),
    url: z.string().url().optional(),
  }).strict().optional(),
  variables: z.array(hyperframesEffectVariableSchema).default([]),
  recipeSummary: z.object({
    pattern: hyperframesMotionRecipeSchema.shape.pattern,
    useWhen: hyperframesMotionRecipeSchema.shape.usage.shape.useWhen,
    avoidWhen: hyperframesMotionRecipeSchema.shape.usage.shape.avoidWhen,
  }).strict().optional(),
  agentPrompt: z.string().optional(),
}).strict();

export type HyperframesEffectVariableUpdate = z.infer<typeof hyperframesEffectVariableUpdateSchema>;
export type HyperframesEffectVariable = z.infer<typeof hyperframesEffectVariableSchema>;
export type HyperframesEffectEngine = z.infer<typeof hyperframesEffectEngineSchema>;
export type HyperframesCatalogKind = z.infer<typeof hyperframesCatalogKindSchema>;
export type HyperframesEffectVariableValue = string | number | boolean;
export type HyperframesEffectVariableValues = Record<string, HyperframesEffectVariableValue>;
export type HyperframesCatalogItem = z.infer<typeof hyperframesCatalogItemSchema>;

export type HyperframesAnimationSelection = {
  item: HyperframesCatalogItem;
  values: HyperframesEffectVariableValues;
};

export function defaultHyperframesEffectVariableValues(
  item: Pick<HyperframesCatalogItem, "variables">,
): HyperframesEffectVariableValues {
  return Object.fromEntries(item.variables.map((variable) => [variable.id, variable.default]));
}

export function resolveHyperframesEffectVariableValues(
  item: Pick<HyperframesCatalogItem, "variables">,
  overrides: HyperframesEffectVariableValues,
): HyperframesEffectVariableValues {
  return { ...defaultHyperframesEffectVariableValues(item), ...overrides };
}
