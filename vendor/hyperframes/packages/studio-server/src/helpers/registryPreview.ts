import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { RegistryItem } from "@hyperframes/core/registry";
import { getMimeType } from "./mime.js";

function resolveRegistryItem(
  registryRoot: string,
  itemName: string,
): { item: RegistryItem; itemRoot: string } | null {
  for (const subdir of ["blocks", "components"]) {
    const collectionRoot = resolve(registryRoot, subdir);
    const itemRoot = resolve(collectionRoot, itemName);
    const relativeItemPath = relative(collectionRoot, itemRoot);
    if (!relativeItemPath || relativeItemPath.startsWith("..") || isAbsolute(relativeItemPath)) {
      continue;
    }

    const manifestPath = join(itemRoot, "registry-item.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const item = JSON.parse(readFileSync(manifestPath, "utf-8")) as RegistryItem;
      if (item.name === itemName && item.type !== "hyperframes:example") return { item, itemRoot };
    } catch {
      return null;
    }
  }
  return null;
}

function resolveItemFile(itemRoot: string, relativeFilePath: string): string | null {
  const sourcePath = resolve(itemRoot, relativeFilePath);
  const relativePath = relative(itemRoot, sourcePath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return null;
  return existsSync(sourcePath) && statSync(sourcePath).isFile() ? sourcePath : null;
}

function previewMetric(
  html: string,
  name: "duration" | "width" | "height",
  fallback: number,
): number {
  const match = new RegExp(`data-${name}=["']([0-9]+(?:\\.[0-9]+)?)["']`, "i").exec(html);
  const value = match ? Number(match[1]) : fallback;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadRegistryPreviewFromRoot(
  registryRoot: string,
  blockName: string,
): {
  html: string;
  duration: number;
  dimensions: { width: number; height: number };
} | null {
  const resolved = resolveRegistryItem(registryRoot, blockName);
  if (!resolved) return null;

  const compositionPath =
    resolved.item.type === "hyperframes:block"
      ? resolved.item.files.find(
          (file) => file.type === "hyperframes:composition" && /\.html?$/i.test(file.path),
        )?.path
      : "demo.html";
  if (!compositionPath) return null;

  const sourcePath = resolveItemFile(resolved.itemRoot, compositionPath);
  if (!sourcePath) return null;
  const html = readFileSync(sourcePath, "utf-8");

  return resolved.item.type === "hyperframes:block"
    ? { html, duration: resolved.item.duration, dimensions: resolved.item.dimensions }
    : {
        html,
        duration: previewMetric(html, "duration", 6),
        dimensions: {
          width: previewMetric(html, "width", 1920),
          height: previewMetric(html, "height", 1080),
        },
      };
}

export function loadRegistryPreviewAssetFromRoot(
  registryRoot: string,
  blockName: string,
  assetPath: string,
): { body: Uint8Array; contentType: string } | null {
  const resolved = resolveRegistryItem(registryRoot, blockName);
  if (!resolved) return null;
  const sourcePath = resolveItemFile(resolved.itemRoot, assetPath);
  if (!sourcePath) return null;
  return {
    body: new Uint8Array(readFileSync(sourcePath)),
    contentType: getMimeType(sourcePath),
  };
}
