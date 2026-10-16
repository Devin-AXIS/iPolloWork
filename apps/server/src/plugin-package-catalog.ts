import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ApiError } from "./errors.js";

export const bundledPluginPackageIds = [
  "figma",
  "notion",
  "linear",
  "sentry",
  "stripe",
  "context7",
  "github",
  "wechat-official",
  "xiaohongshu-ops",
  "douyin-ops",
  "wechat-channels-ops",
  "design-agent",
  "video-agent",
  "reference-context",
  "plugin-workshop",
  "media-studio",
  "deepseek-harness",
  "operation-recorder",
  "short-video-studio",
  "jev-decision-model",
  "ipollo-onto",
] as const;

export const defaultBundledPluginPackageIds = ["reference-context"] as const;

// Repository source refresh is development-only. The local catalog also reads
// packages already provided by the host, independently of the online catalog.
export function usesLocalPluginPackages(): boolean {
  return process.env.IPOLLOWORK_DEV_MODE === "1";
}

export function localPluginPackageRoot(): string | null {
  const root = process.env.IPOLLOWORK_LOCAL_PLUGIN_PACKAGES_DIR?.trim();
  return usesLocalPluginPackages() && root ? resolve(root) : null;
}

export function runtimeCatalogPluginPackageIds(): readonly string[] {
  return catalogPluginPackageIds;
}

// Core Skills use the package projection machinery, but are not user extensions.
export function isInternalPluginPackage(pluginId: string): boolean {
  return pluginId === "reference-context";
}

export const catalogPluginPackageIds = bundledPluginPackageIds.filter(id => !isInternalPluginPackage(id));

export async function withPluginPackageCatalogRoot<T>(pluginId: string, operation: (root: string, source: string) => Promise<T>): Promise<T> {
  return operation(await resolveBundledPluginPackageRoot(pluginId), `bundled:${pluginId}`);
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export function bundledPluginPackageRoots(): string[] {
  const configured = process.env.IPOLLOWORK_BUNDLED_PLUGIN_PACKAGES_DIR?.trim();
  const local = localPluginPackageRoot();
  return [
    ...(local ? [local] : []),
    ...(configured ? [resolve(configured)] : []),
    resolve(moduleDirectory, "../../plugin-packages"),
    resolve(moduleDirectory, "../../../plugin-packages"),
    ...(usesLocalPluginPackages() ? [resolve(moduleDirectory, "../../../examples/plugin-packages")] : []),
  ];
}

export async function resolveBundledPluginPackageRoot(pluginId: string, roots = bundledPluginPackageRoots()): Promise<string> {
  if (!bundledPluginPackageIds.includes(pluginId as (typeof bundledPluginPackageIds)[number])) {
    throw new ApiError(404, "plugin_package_catalog_not_found", "Bundled plugin package was not found");
  }
  for (const root of roots) {
    const sourceRoot = join(root, pluginId);
    // Native recorder helpers are built into this package; source remains usable
    // for portable Chrome workflows when no native build has been prepared.
    const candidates = ["operation-recorder", "short-video-studio", "xiaohongshu-ops", "ipollo-onto"].includes(pluginId) ? [join(sourceRoot, "dist/package"), sourceRoot] : [sourceRoot];
    for (const packageRoot of candidates) {
      try {
        await access(join(packageRoot, "ipollowork.plugin.json"));
        return packageRoot;
      } catch {
        // Try the next development or packaged resource root.
      }
    }
  }
  throw new ApiError(404, "plugin_package_catalog_unavailable", `Bundled plugin package is unavailable: ${pluginId}`);
}
