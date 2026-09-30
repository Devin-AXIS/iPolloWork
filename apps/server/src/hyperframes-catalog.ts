import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hyperframesCatalogItemSchema,
  hyperframesEffectEngineSchema,
  hyperframesEffectVariableSchema,
  hyperframesMotionRecipeSchema,
  type HyperframesCatalogItem,
  type HyperframesEffectEngine,
  type HyperframesEffectVariable,
  type HyperframesEffectVariableUpdate,
} from "@ipollowork/types/hyperframes";
import { z } from "zod";
import { ApiError } from "./errors.js";

const CATEGORY_ORDER = [
  "scenes", "data", "code-animation", "social", "scroll", "svg", "text-effects", "transitions",
  "captions", "effects", "vfx",
];

const EFFECT_CATEGORIES = new Set(["scroll", "svg", "text-effects", "transitions", "captions", "effects", "vfx"]);

const RECIPE_PATTERN_LABELS: Record<string, string> = {
  "progressive-build": "逐步构建",
  "state-transformation": "状态变换",
  "kinetic-type": "动态文字",
  "path-journey": "路径与流程",
  compare: "并列对比",
  "focus-transfer": "焦点转移",
  "camera-journey": "空间运镜",
  "data-accumulation": "数据累积",
};

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
  motionRecipe: z.unknown().optional(),
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
  const recipeResult = hyperframesMotionRecipeSchema.safeParse(raw.motionRecipe);
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
    recipeSummary: recipeResult.success ? {
      pattern: recipeResult.data.pattern,
      intent: recipeResult.data.usage.intent,
      useWhen: recipeResult.data.usage.useWhen,
      avoidWhen: recipeResult.data.usage.avoidWhen,
    } : undefined,
    agentPrompt: raw.agentPrompt,
  });
  return item.success ? item.data : null;
}

function registryRoot(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const resourcesPath = typeof process.resourcesPath === "string" ? process.resourcesPath : "";
  const cli = process.env.HYPERFRAMES_CLI_PATH?.trim();
  const candidates = [
    process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT ? resolve(process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT, "..") : "",
    cli ? resolve(dirname(cli), "../../../registry") : "",
    resolve(here, "..", "..", "..", "vendor", "hyperframes", "registry"),
    resolve(here, "..", "..", "..", "..", "vendor", "hyperframes", "registry"),
    resourcesPath ? resolve(resourcesPath, "hyperframes", "registry") : "",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(resolve(candidate, "registry.json"))) ?? null;
}

const shotcraftStyleSchema = z.object({
  key: z.string(), label: z.string(), description: z.string(), use: z.string(),
  previewUrl: z.string().nullable(), previewStatus: z.number().nullable(), previewRevision: z.string(),
  implementationPath: z.string().nullable(), implementationPaths: z.array(z.string()), sourceResolution: z.string(),
  conversion: z.object({ status: z.string(), path: z.string().nullable(), url: z.string().nullable() }),
}).passthrough();
const shotcraftCardSchema = z.object({
  name: z.string(), summary: z.string(), use: z.string(), duration: z.string(), energy: z.string(),
  intention: z.string(), category: z.string(), tags: z.array(z.string()), sourcePath: z.string(), sourceUrl: z.string(),
  rules: z.string(), implementations: z.array(z.object({ path: z.string(), url: z.string(), dependencies: z.array(z.string()) }).passthrough()),
  styles: z.array(shotcraftStyleSchema),
});
const shotcraftCatalogSchema = z.object({
  schemaVersion: z.literal(1), repository: z.string(), revision: z.string(), conversionRepository: z.string(), conversionRevision: z.string(),
  license: z.string(), licenseFile: z.string(), stats: z.object({ cardCount: z.number(), styleCount: z.number() }),
  methodology: z.object({ sourceUrl: z.string(), rules: z.string() }), cards: z.array(shotcraftCardSchema),
});
export const videoRecipeCatalogInput = z.object({
  query: z.string().max(200).optional(), category: z.string().max(64).optional(),
  cardIds: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).min(1).max(3).optional(),
  offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(20).default(20),
  includeMethodology: z.boolean().default(false),
}).strict();

export async function queryVideoRecipeCatalog(raw: unknown) {
  const input = videoRecipeCatalogInput.parse(raw);
  const root = registryRoot();
  if (!root || !existsSync(resolve(root, "shotcraft-references.json"))) throw new ApiError(503, "video_recipe_catalog_unavailable", "The executable Shotcraft recipe catalog is missing from this runtime.");
  const catalog = shotcraftCatalogSchema.parse(JSON.parse(await readFile(resolve(root, "shotcraft-references.json"), "utf8")));
  const localSchema = z.object({ name: z.string(), motionRecipe: hyperframesMotionRecipeSchema, upstream: z.object({ rules: z.string(), implementation: z.string(), revision: z.string() }) });
  const locals: z.infer<typeof localSchema>[] = [];
  for (const entry of await readdir(resolve(root, "blocks"), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("shotcraft-")) continue;
    const parsed = localSchema.safeParse(JSON.parse(await readFile(resolve(root, "blocks", entry.name, "registry-item.json"), "utf8")));
    if (parsed.success) locals.push(parsed.data);
  }
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, string> = { trackingexpandreveal: "trackingexpand", multiplanereal: "multiplane", dollyzoomreal: "dollyzoom" };
  const cards = catalog.cards.map(card => ({ ...card, styles: card.styles.map(style => {
    const componentIds = locals.filter(local => {
      if (local.upstream.rules !== card.sourcePath || ![catalog.revision, catalog.conversionRevision].includes(local.upstream.revision)) return false;
      if (local.upstream.revision === catalog.conversionRevision && local.upstream.implementation === style.conversion.path) return true;
      if (card.styles.length === 1) return true;
      const path = local.upstream.implementation;
      const stem = normalize(path.endsWith("/index.html") ? path.split("/").at(-2)! : path.split("/").at(-1)!.replace(/\.tsx$/, ""));
      return normalize(style.key) === (aliases[stem] ?? stem);
    }).map(local => local.name);
    return { ...style, executable: componentIds.length > 0, componentIds,
      migrationStatus: componentIds.length ? "validated-local-recipe" : "unavailable" };
  }).filter(style => style.executable) })).filter(card => card.styles.length > 0);
  if (input.cardIds?.some(id => !cards.some(card => card.name === id))) throw new ApiError(404, "video_recipe_card_not_found", "One or more requested Shotcraft card IDs do not exist.");
  const tokens = input.query?.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean) ?? [];
  const selected = cards.filter(card => (!input.cardIds || input.cardIds.includes(card.name))
    && (!input.category || input.category === card.category)
    && tokens.every(token => [card.name, card.summary, card.use, card.intention, ...card.tags, ...card.styles.flatMap(style => [style.key, style.description, style.use])].join(" ").toLocaleLowerCase().includes(token)));
  const recipes = (await listHyperframesCatalog()).filter(item => item.recipeSummary);
  const matchingRecipes = input.cardIds ? [] : recipes.filter(item =>
    (!input.category || item.recipeSummary?.pattern === input.category)
    && tokens.every(token => [item.name, item.title, item.description, item.recipeSummary?.intent, item.recipeSummary?.useWhen, item.recipeSummary?.avoidWhen].join(" ").toLocaleLowerCase().includes(token)));
  const categoryCounts = new Map<string, number>();
  for (const recipe of recipes) {
    const pattern = recipe.recipeSummary?.pattern;
    if (pattern) categoryCounts.set(pattern, (categoryCounts.get(pattern) ?? 0) + 1);
  }
  const recipeCategories = [...categoryCounts].map(([name, count]) => ({ name, label: RECIPE_PATTERN_LABELS[name] ?? name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { repository: catalog.repository, revision: catalog.revision, conversionRevision: catalog.conversionRevision,
    license: catalog.license, licenseFile: catalog.licenseFile,
    stats: { cardCount: cards.length, styleCount: cards.flatMap(card => card.styles).length, executableVariantCount: cards.flatMap(card => card.styles).length, localRecipeCount: locals.length, availableRecipeCount: recipes.length },
    categories: [...new Set(cards.map(card => card.category))].sort(), total: selected.length,
    nextOffset: input.offset + input.limit < selected.length ? input.offset + input.limit : null,
    recipeCategories, recipeTotal: matchingRecipes.length,
    nextRecipeOffset: input.offset + input.limit < matchingRecipes.length ? input.offset + input.limit : null,
    recipes: matchingRecipes.slice(input.offset, input.offset + input.limit).map(item => ({
      componentId: item.name, title: item.title, description: item.description,
      pattern: item.recipeSummary?.pattern, intent: item.recipeSummary?.intent, useWhen: item.recipeSummary?.useWhen,
      avoidWhen: item.recipeSummary?.avoidWhen, source: item.source?.provider,
    })),
    policy: "Only locally installable recipes are listed. Install returned componentIds rather than copying preview markup. If no recipe fits, disclose the library gap under recipes-only policy. Finished-video requests continue after saving the script unless the user explicitly asks for review.",
    methodologySourceUrl: catalog.methodology.sourceUrl,
    methodology: input.includeMethodology ? { ...catalog.methodology, referenceOnly: true, adaptation: "The active iPolloWork video.md production order is authoritative. Upstream Remotion commands and genre-specific audio defaults do not override the HyperFrames runtime, user audio choices or an explicit script-review request." } : undefined,
    cards: selected.slice(input.offset, input.offset + input.limit).map(card => {
      const { rules, implementations, ...summary } = card;
      return input.cardIds ? { ...summary, rules, implementations } : summary;
    }),
  };
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
