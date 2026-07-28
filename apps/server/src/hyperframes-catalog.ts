import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hyperframesCatalogItemSchema,
  hyperframesEffectEngineSchema,
  hyperframesEffectVariableSchema,
  type HyperframesCatalogItem,
  type HyperframesEffectVariable,
  type HyperframesEffectVariableUpdate,
} from "@ipollowork/types/hyperframes";
import { z } from "zod";

const CATEGORY_ORDER = [
  "scenes", "data", "code-animation", "social", "text-effects", "transitions",
  "captions", "effects", "vfx",
];

const legacyParamSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["color", "text", "number", "select"]),
  default: z.string(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  update: z.enum(["live", "rebuild", "reload"]).optional(),
}).passthrough();

const registryItemSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  type: z.enum(["hyperframes:block", "hyperframes:component"]),
  tags: z.array(z.string()).optional(),
  version: z.string().optional(),
  duration: z.number().optional(),
  dimensions: z.object({ width: z.number(), height: z.number() }).optional(),
  preview: z.object({ poster: z.string().optional(), video: z.string().optional() }).optional(),
  engine: z.unknown().optional(),
  variables: z.array(z.unknown()).optional(),
  params: z.array(z.unknown()).optional(),
  agentPrompt: z.string().optional(),
}).passthrough();

function resolveCategory(tags: string[]): string {
  const set = new Set(tags);
  if (set.has("captions") || set.has("caption-style")) return "captions";
  if (set.has("code-animation")) return "code-animation";
  if (set.has("transition")) return "transitions";
  if (set.has("social") || set.has("overlay")) return "social";
  if (set.has("data") || set.has("chart") || set.has("map")) return "data";
  if (set.has("html-in-canvas") || set.has("webgl") || set.has("shader")) return "vfx";
  if (set.has("text-effect")) return "text-effects";
  if (set.has("effect") || set.has("grain") || set.has("vignette")) return "effects";
  return "scenes";
}

function variableIdFromLegacyKey(key: string): string {
  return key
    .replace(/^--/, "")
    .replace(/-([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
}

function normalizeUpdate(update: HyperframesEffectVariableUpdate | undefined): HyperframesEffectVariableUpdate {
  return update ?? "live";
}

function normalizeLegacyParam(value: unknown): HyperframesEffectVariable | null {
  const result = legacyParamSchema.safeParse(value);
  if (!result.success) return null;
  const param = result.data;
  const base = {
    id: variableIdFromLegacyKey(param.key),
    label: param.label,
    update: normalizeUpdate(param.update),
  };
  if (param.type === "color") {
    const parsed = hyperframesEffectVariableSchema.safeParse({ ...base, type: "color", default: param.default });
    return parsed.success ? parsed.data : null;
  }
  if (param.type === "number") {
    const parsed = hyperframesEffectVariableSchema.safeParse({
      ...base,
      type: "number",
      default: Number(param.default),
      min: param.min,
      max: param.max,
      step: param.step,
    });
    return parsed.success ? parsed.data : null;
  }
  if (param.type === "select") {
    const parsed = hyperframesEffectVariableSchema.safeParse({
      ...base,
      type: "enum",
      default: param.default,
      options: param.options,
    });
    return parsed.success ? parsed.data : null;
  }
  const parsed = hyperframesEffectVariableSchema.safeParse({ ...base, type: "string", default: param.default });
  return parsed.success ? parsed.data : null;
}

function normalizeVariables(raw: z.infer<typeof registryItemSchema>): HyperframesEffectVariable[] {
  const declared = (raw.variables ?? [])
    .map((value) => hyperframesEffectVariableSchema.safeParse(value))
    .filter((result) => result.success)
    .map((result) => result.data);
  if (declared.length) return declared;
  return (raw.params ?? [])
    .map(normalizeLegacyParam)
    .filter((variable): variable is HyperframesEffectVariable => variable !== null);
}

export function normalizeHyperframesCatalogItem(value: unknown): HyperframesCatalogItem | null {
  const result = registryItemSchema.safeParse(value);
  if (!result.success) return null;
  const raw = result.data;
  const tags = raw.tags ?? [];
  const engineResult = hyperframesEffectEngineSchema.safeParse(raw.engine);
  const item = hyperframesCatalogItemSchema.safeParse({
    name: raw.name,
    title: raw.title,
    description: raw.description,
    type: raw.type,
    category: resolveCategory(tags),
    tags,
    version: raw.version,
    duration: raw.duration,
    dimensions: raw.dimensions,
    preview: raw.preview,
    engine: engineResult.success ? engineResult.data : undefined,
    variables: normalizeVariables(raw),
    agentPrompt: raw.agentPrompt,
  });
  return item.success ? item.data : null;
}

function registryRoot(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const resourcesPath = typeof process.resourcesPath === "string" ? process.resourcesPath : "";
  const candidates = [
    resolve(here, "..", "..", "..", "vendor", "hyperframes", "registry"),
    resolve(here, "..", "..", "..", "..", "vendor", "hyperframes", "registry"),
    resourcesPath ? resolve(resourcesPath, "hyperframes", "registry") : "",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(resolve(candidate, "registry.json"))) ?? null;
}

export async function listHyperframesCatalog(): Promise<HyperframesCatalogItem[]> {
  const root = registryRoot();
  if (!root) return [];
  const items: HyperframesCatalogItem[] = [];
  for (const group of ["blocks", "components"] as const) {
    const groupRoot = resolve(root, group);
    if (!existsSync(groupRoot)) continue;
    for (const entry of await readdir(groupRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const item = normalizeHyperframesCatalogItem(
          JSON.parse(await readFile(resolve(groupRoot, entry.name, "registry-item.json"), "utf8")),
        );
        if (item) items.push(item);
      } catch {
        // A malformed optional registry item must not hide the remaining catalog.
      }
    }
  }
  return items.sort((left, right) => {
    const category = CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category);
    return category || left.title.localeCompare(right.title);
  });
}
