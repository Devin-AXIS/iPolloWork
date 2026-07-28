import { z } from "zod";

export const hyperframesEffectVariableUpdateSchema = z.enum(["live", "rebuild", "reload"]);

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
