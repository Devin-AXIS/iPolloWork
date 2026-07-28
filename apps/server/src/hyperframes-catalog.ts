import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hyperframesCatalogItemSchema,
  hyperframesEffectEngineSchema,
  hyperframesEffectVariableSchema,
  type HyperframesCatalogItem,
  type HyperframesEffectEngine,
  type HyperframesEffectVariable,
  type HyperframesEffectVariableUpdate,
} from "@ipollowork/types/hyperframes";
import { z } from "zod";

const CATEGORY_ORDER = [
  "scenes", "data", "code-animation", "social", "scroll", "svg", "text-effects", "transitions",
  "captions", "effects", "vfx",
];

const EFFECT_CATEGORIES = new Set(["scroll", "svg", "text-effects", "transitions", "captions", "effects", "vfx"]);

const catalogSourceSchema = z.object({
  provider: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(96),
  url: z.string().url().optional(),
}).strict();

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
  kind: z.enum(["animation", "effect"]).optional(),
  version: z.string().optional(),
  duration: z.number().optional(),
  dimensions: z.object({ width: z.number(), height: z.number() }).optional(),
  preview: z.object({ poster: z.string().optional(), video: z.string().optional() }).optional(),
  engine: z.unknown().optional(),
  source: z.unknown().optional(),
  files: z.array(z.object({
    path: z.string().min(1),
    type: z.string().min(1),
  }).passthrough()).optional(),
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
  if (set.has("scroll") || set.has("scroll-trigger")) return "scroll";
  if (set.has("svg") || set.has("morph-svg") || set.has("draw-svg") || set.has("motion-path")) return "svg";
  if (set.has("html-in-canvas") || set.has("webgl") || set.has("shader")) return "vfx";
  if (set.has("text-effect")) return "text-effects";
  if (set.has("effect") || set.has("grain") || set.has("vignette")) return "effects";
  return "scenes";
}

function resolveKind(
  type: z.infer<typeof registryItemSchema>["type"],
  declaredKind: z.infer<typeof registryItemSchema>["kind"],
  category: string,
): "animation" | "effect" {
  if (declaredKind) return declaredKind;
  return type === "hyperframes:component" || EFFECT_CATEGORIES.has(category) ? "effect" : "animation";
}

const GSAP_PLUGIN_PATTERNS = [
  ["ScrollTrigger", /\bScrollTrigger\b/],
  ["ScrollSmoother", /\bScrollSmoother\b/],
  ["ScrollToPlugin", /\bScrollToPlugin\b/],
  ["SplitText", /\bSplitText\b/],
  ["ScrambleTextPlugin", /\bScrambleTextPlugin\b/],
  ["TextPlugin", /\bTextPlugin\b/],
  ["DrawSVGPlugin", /\bDrawSVGPlugin\b/],
  ["MorphSVGPlugin", /\bMorphSVGPlugin\b/],
  ["MotionPathPlugin", /\bMotionPathPlugin\b/],
  ["Flip", /\bgsap\.registerPlugin\([^)]*\bFlip\b/],
  ["Draggable", /\bDraggable\b/],
  ["InertiaPlugin", /\bInertiaPlugin\b/],
  ["Observer", /\bObserver\b/],
  ["Physics2DPlugin", /\bPhysics2DPlugin\b/],
  ["PhysicsPropsPlugin", /\bPhysicsPropsPlugin\b/],
  ["PixiPlugin", /\bPixiPlugin\b/],
  ["EaselPlugin", /\bEaselPlugin\b/],
  ["CustomEase", /\bCustomEase\b/],
  ["CustomBounce", /\bCustomBounce\b/],
  ["CustomWiggle", /\bCustomWiggle\b/],
] satisfies ReadonlyArray<readonly [string, RegExp]>;

async function inferRuntimeEngine(value: unknown, directory: string): Promise<HyperframesEffectEngine | undefined> {
  const result = registryItemSchema.safeParse(value);
  if (!result.success) return undefined;
  const contents: string[] = [];
  for (const file of result.data.files ?? []) {
    if (!/\.(?:html|js|mjs|ts|tsx)$/i.test(file.path)) continue;
    const path = resolve(directory, file.path);
    const relativePath = relative(directory, path);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) continue;
    try {
      contents.push(await readFile(path, "utf8"));
    } catch {
      // Missing optional runtime files are ignored; the manifest remains usable.
    }
  }
  const runtime = contents.join("\n");
  if (!/\bgsap\.(?:timeline|to|from|fromTo|set)\b|\/gsap@[\d.]+/i.test(runtime)) return undefined;
  const version = runtime.match(/\/gsap@(?<version>\d+(?:\.\d+){1,2})/i)?.groups?.version;
  const plugins = GSAP_PLUGIN_PATTERNS
    .filter(([, pattern]) => pattern.test(runtime))
    .map(([name]) => name);
  return {
    name: "gsap",
    version,
    seekable: /\bhf-seek\b|timeline\s*\(\s*\{\s*paused:\s*true/i.test(runtime),
    ...(plugins.length ? { plugins } : {}),
  };
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

export function normalizeHyperframesCatalogItem(
  value: unknown,
  detectedEngine?: HyperframesEffectEngine,
): HyperframesCatalogItem | null {
  const result = registryItemSchema.safeParse(value);
  if (!result.success) return null;
  const raw = result.data;
  const tags = raw.tags ?? [];
  const category = resolveCategory(tags);
  const engineResult = hyperframesEffectEngineSchema.safeParse(raw.engine);
  const sourceResult = catalogSourceSchema.safeParse(raw.source);
  const explicitEngine = engineResult.success ? engineResult.data : undefined;
  const engine = explicitEngine
    ? {
        ...detectedEngine,
        ...explicitEngine,
        plugins: explicitEngine.plugins ?? detectedEngine?.plugins,
      }
    : detectedEngine;
  const item = hyperframesCatalogItemSchema.safeParse({
    name: raw.name,
    title: raw.title,
    description: raw.description,
    type: raw.type,
    kind: resolveKind(raw.type, raw.kind, category),
    category,
    tags,
    version: raw.version,
    duration: raw.duration,
    dimensions: raw.dimensions,
    preview: raw.preview,
    engine,
    source: sourceResult.success
      ? sourceResult.data
      : { provider: "hyperframes", label: "HyperFrames" },
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
        const directory = resolve(groupRoot, entry.name);
        const raw = JSON.parse(await readFile(resolve(directory, "registry-item.json"), "utf8"));
        const item = normalizeHyperframesCatalogItem(raw, await inferRuntimeEngine(raw, directory));
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
