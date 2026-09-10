import { access, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ApiError } from "./errors.js";
import { withMaterializedPluginPackageUpload } from "./plugin-package-upload.js";
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

export const localPluginPackageIds: readonly string[] = ["xiaohongshu-ops", "douyin-ops"];
export const catalogPluginPackageIds = [...bundledPluginPackageIds, ...localPluginPackageIds];

export async function withPluginPackageCatalogRoot<T>(pluginId: string, operation: (root: string, source: string) => Promise<T>): Promise<T> {
  if (!localPluginPackageIds.includes(pluginId)) return operation(await resolveBundledPluginPackageRoot(pluginId), `bundled:${pluginId}`);
  const directory = process.env.IPOLLOWORK_LOCAL_PLUGIN_PACKAGES_DIR?.trim() || join(homedir(), ".ipollowork", "local-plugin-packages");
  const packagePath = resolve(directory, pluginId, "plugin-package.json");
  const file = await open(packagePath, "r").catch(() => {
    throw new ApiError(404, "plugin_package_catalog_unavailable", `本地插件包未生成，请在对应插件源码目录运行 pnpm package:local：${pluginId}`);
  });
  let payload: unknown;
  try {
    if ((await file.stat()).size > 15 * 1024 * 1024) throw new ApiError(413, "plugin_package_upload_too_large", "Local plugin package exceeds 15 MB");
    payload = JSON.parse(await file.readFile("utf8"));
  } finally { await file.close(); }
  return withMaterializedPluginPackageUpload(payload, "install", async ({ packageRoot }) => {
    const preview = await previewPluginPackage({ packageRoot });
    if (preview.manifest.id !== pluginId) throw new ApiError(400, "plugin_package_identity_mismatch", "Local plugin identity does not match the selected catalog entry");
    await assertPluginPackageSafeForImport({ packageRoot, preview, purpose: "install" });
    return operation(packageRoot, `local:${packagePath}`);
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
