import JSZip from "jszip";
import {
  pluginPackageArchiveExtension,
  type PluginPackageArchiveFormat,
} from "@ipollowork/types/plugins";

import type { iPolloWorkPluginPackageUpload } from "./ipollowork-server";

const MANIFEST_FILE = "ipollowork.plugin.json";
const MAX_ARCHIVE_BYTES = 12 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 10 * 1024 * 1024;
const MAX_PACKAGE_FILES = 512;

function decodedBase64Bytes(value: string): number {
  if (!value) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function safeRelativePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.startsWith("\\")) return false;
  return !value.replaceAll("\\", "/").split("/").some((part) => !part || part === "." || part === "..");
}

export async function readPluginPackageArchive(
  file: File,
  format: PluginPackageArchiveFormat,
  invalidExtensionMessage?: string,
): Promise<iPolloWorkPluginPackageUpload> {
  const expectedExtension = pluginPackageArchiveExtension(format);
  if (!file.name.toLowerCase().endsWith(expectedExtension)) {
    throw new Error(invalidExtensionMessage ?? `请选择 ${expectedExtension} 文件。`);
  }
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error("插件压缩包不能超过 12 MB。");
  const archive = await JSZip.loadAsync(new Uint8Array(await file.arrayBuffer()));
  const entries = Object.values(archive.files).filter((entry) =>
    !entry.dir && !entry.name.startsWith("__MACOSX/") && !entry.name.endsWith("/.DS_Store") && entry.name !== ".DS_Store"
  );
  const manifests = entries.filter((entry) => entry.name === MANIFEST_FILE || entry.name.endsWith(`/${MANIFEST_FILE}`));
  if (manifests.length !== 1) throw new Error(`插件压缩包必须且只能包含一个 ${MANIFEST_FILE}。`);
  const manifestPath = manifests[0]?.name ?? MANIFEST_FILE;
  const rootPrefix = manifestPath.slice(0, -MANIFEST_FILE.length);
  const packageEntries = entries.filter((entry) => entry.name.startsWith(rootPrefix));
  if (packageEntries.length > MAX_PACKAGE_FILES) throw new Error("插件包文件不能超过 512 个。");

  let totalBytes = 0;
  const files: iPolloWorkPluginPackageUpload["files"] = [];
  for (const entry of packageEntries) {
    const path = entry.name.slice(rootPrefix.length).replaceAll("\\", "/");
    if (!safeRelativePath(path)) throw new Error(`插件包包含不安全路径：${path}`);
    const contentBase64 = await entry.async("base64");
    totalBytes += decodedBase64Bytes(contentBase64);
    if (totalBytes > MAX_PACKAGE_BYTES) throw new Error("插件解压后的文件不能超过 10 MB。");
    files.push({ path, contentBase64 });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { archiveName: file.name, files };
}
