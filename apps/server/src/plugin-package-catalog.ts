import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ApiError } from "./errors.js";
import { githubReleasePlugins, resolveGitHubReleasePluginBundle, withMaterializedCompatibleGitHubPluginBundle } from "./github-plugin-source.js";
import { assertPluginPackageSafeForImport, previewPluginPackage } from "./plugin-package-lifecycle.js";

export const bundledPluginPackageIds = [
  "figma",
  "notion",
  "linear",
  "sentry",
  "stripe",
  "context7",
  "github",
  "wechat-official",
  "design-agent",
  "video-agent",
  "image-studio",
  "video-console",
  "deepseek-harness",
] as const;

export const defaultBundledPluginPackageIds = ["design-agent", "video-agent", "image-studio", "video-console"] as const;

export const catalogPluginPackageIds = [...bundledPluginPackageIds, ...githubReleasePlugins.map(item => item.pluginId)];

export async function withPluginPackageCatalogRoot<T>(pluginId: string, operation: (root: string, source: string) => Promise<T>): Promise<T> {
  const releaseSource = githubReleasePlugins.find(item => item.pluginId === pluginId);
  if (!releaseSource) return operation(await resolveBundledPluginPackageRoot(pluginId), `bundled:${pluginId}`);
  const bundle = await resolveGitHubReleasePluginBundle(pluginId);
  return withMaterializedCompatibleGitHubPluginBundle(bundle, async root => {
    const preview = await previewPluginPackage({ packageRoot: root });
    await assertPluginPackageSafeForImport({ packageRoot: root, preview, purpose: "install" });
    return operation(root, `https://github.com/${releaseSource.owner}/${releaseSource.repo}/releases/tag/${bundle.preview.source.ref}`);
  });
}

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
