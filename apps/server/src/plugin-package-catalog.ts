import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ApiError } from "./errors.js";

export const bundledPluginPackageIds = ["figma"] as const;

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export function bundledPluginPackageRoots(): string[] {
  const configured = process.env.IPOLLOWORK_BUNDLED_PLUGIN_PACKAGES_DIR?.trim();
  return [
    ...(configured ? [resolve(configured)] : []),
    resolve(moduleDirectory, "../../plugin-packages"),
    resolve(moduleDirectory, "../../../plugin-packages"),
    resolve(moduleDirectory, "../../../examples/plugin-packages"),
  ];
}

export async function resolveBundledPluginPackageRoot(pluginId: string, roots = bundledPluginPackageRoots()): Promise<string> {
  if (!bundledPluginPackageIds.includes(pluginId as (typeof bundledPluginPackageIds)[number])) {
    throw new ApiError(404, "plugin_package_catalog_not_found", "Bundled plugin package was not found");
  }
  for (const root of roots) {
    const packageRoot = join(root, pluginId);
    try {
      await access(join(packageRoot, "ipollowork.plugin.json"));
      return packageRoot;
    } catch {
      // Try the next development or packaged resource root.
    }
  }
  throw new ApiError(404, "plugin_package_catalog_unavailable", `Bundled plugin package is unavailable: ${pluginId}`);
}
