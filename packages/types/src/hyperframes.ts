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

/** Input boundary for the shared registry row contract used by Studio and the host. */
export const hyperframesVisualComponentDataSchema = z.object({
  version: z.literal(1),
  kind: z.enum(["category-value", "region-value", "point-value", "route-value", "series-value"]),
  mode: z.enum(["replace", "override"]), rowId: z.string().min(1),
  binding: z.object({ variable: z.string().min(1), encoding: z.enum(["json", "key-value-list", "route-value-list", "label-detail-list"]) }),
  columns: z.array(z.object({
    id: z.string().min(1), label: z.string().min(1), type: z.enum(["string", "number"]),
    role: z.enum(["id", "label", "value", "source", "target"]), required: z.boolean().optional(),
    options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
    min: z.number().finite().optional(), max: z.number().finite().optional(),
    maxLength: z.number().int().positive().optional(),
    list: z.object({
      maxItems: z.number().int().nonnegative(), itemMaxLength: z.number().int().positive(),
      separators: z.string().min(1),
    }).optional(),
  }).passthrough().superRefine((column, context) => {
    if (column.type !== "number" && (column.min !== undefined || column.max !== undefined)) {
      context.addIssue({ code: "custom", message: "Numeric bounds require a number column." });
    }
    if (column.min !== undefined && column.max !== undefined && column.min > column.max) {
      context.addIssue({ code: "custom", message: "Column min must not exceed max." });
    }
  })).min(1),
  minRows: z.number().int().nonnegative().optional(), maxRows: z.number().int().nonnegative().optional(),
}).passthrough();

/** CSS-page geometry for real screenshot crops; pixel ratio describes the image bytes. */
export const hyperframesPageCaptureSchema = z.object({
  width: z.number().positive().max(8192), height: z.number().positive().max(16384),
  pixelRatio: z.number().min(1).max(4),
  regions: z.array(z.object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    x: z.number().nonnegative(), y: z.number().nonnegative(),
    width: z.number().positive(), height: z.number().positive(),
  }).strict()).min(6).max(8),
  heroId: z.string(), foregroundIds: z.array(z.string()).length(2),
}).strict().superRefine((capture, context) => {
  const ids = new Set(capture.regions.map(region => region.id));
  if (ids.size !== capture.regions.length || !ids.has(capture.heroId)
    || new Set(capture.foregroundIds).size !== 2 || capture.foregroundIds.some(id => !ids.has(id))) {
    context.addIssue({ code: "custom", message: "Capture regions need unique IDs and existing hero/foreground references." });
  }
  if (capture.regions.some(region => region.x + region.width > capture.width || region.y + region.height > capture.height)) {
    context.addIssue({ code: "custom", message: "Capture rectangles must stay inside the CSS-page dimensions." });
  }
});

/** Authored semantic cues, not fabricated speech alignment. Times are scene-relative seconds. */
export const hyperframesMotionRecipeSchema = z.object({
  version: z.literal(1),
  pattern: z.string().min(1),
  minHoldSeconds: z.number().positive(),
  capacity: z.object({
    variable: z.string(), encoding: z.enum(["delimited", "json"]).optional(),
    separator: z.string().optional(), maxItems: z.number().int().positive(),
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
    intent: z.string().min(12).max(240).optional(),
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
  if (recipe.capacity && recipe.capacity.encoding !== "json" && recipe.capacity.separator === undefined) {
    context.addIssue({ code: "custom", path: ["capacity", "separator"], message: "Delimited capacity needs a separator." });
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
  narration: z.object({
    timingSourcePath: z.string().regex(/^video\/[A-Za-z0-9_-]+\/assets\/[^/]+\.timings\.json$/),
    text: z.string().min(1).max(10000),
    bindings: z.record(z.string(), z.object({ phrase: z.string().min(1), occurrence: z.number().int().positive().optional() }).strict()),
  }).strict().optional(),
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
    intent: hyperframesMotionRecipeSchema.shape.usage.shape.intent,
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
