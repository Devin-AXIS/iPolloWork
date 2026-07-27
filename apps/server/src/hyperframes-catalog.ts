import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type HyperframesCatalogItem = {
  name: string;
  title: string;
  description: string;
  type: "hyperframes:block" | "hyperframes:component";
  category: string;
  tags: string[];
  duration?: number;
  preview?: { poster?: string; video?: string };
};

const CATEGORY_ORDER = [
  "scenes", "data", "code-animation", "social", "text-effects", "transitions",
  "captions", "effects", "vfx",
];

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
        const raw = JSON.parse(await readFile(resolve(groupRoot, entry.name, "registry-item.json"), "utf8")) as HyperframesCatalogItem;
        const tags = Array.isArray(raw.tags) ? raw.tags : [];
        items.push({ ...raw, tags, category: resolveCategory(tags) });
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
