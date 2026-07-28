import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { z } from "zod";

import { ApiError } from "./errors.js";

const MAX_PLUGIN_PACKAGE_FILES = 512;
const MAX_PLUGIN_PACKAGE_BYTES = 10 * 1024 * 1024;

const uploadSchema = z.object({
  archiveName: z.string().trim().min(1).max(255),
  files: z.array(z.object({
    path: z.string().min(1).max(512),
    contentBase64: z.string(),
  }).strict()).min(1).max(MAX_PLUGIN_PACKAGE_FILES),
}).strict();

export type PluginPackageUpload = z.infer<typeof uploadSchema>;

function safeRelativePath(value: string): boolean {
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  const normalized = value.replaceAll("\\", "/");
  return !normalized.split("/").some((part) => !part || part === "." || part === "..");
}

function resolveWithin(root: string, relativePath: string): string {
  const base = resolve(root);
  const target = resolve(base, relativePath);
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new ApiError(400, "plugin_package_upload_path_invalid", `Plugin upload path escapes its root: ${relativePath}`);
  }
  return target;
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new ApiError(400, "plugin_package_upload_invalid", "Plugin package contains invalid file data");
  }
  return Buffer.from(value, "base64");
}

export function parsePluginPackageUpload(value: unknown): PluginPackageUpload {
  const parsed = uploadSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "plugin_package_upload_invalid", "Plugin package upload is invalid", {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of parsed.data.files) {
    const path = file.path.replaceAll("\\", "/");
    if (!safeRelativePath(path)) {
      throw new ApiError(400, "plugin_package_upload_path_invalid", `Plugin upload path is invalid: ${file.path}`);
    }
    if (seen.has(path)) {
      throw new ApiError(400, "plugin_package_upload_duplicate", `Plugin upload contains a duplicate file: ${path}`);
    }
    seen.add(path);
    totalBytes += decodeBase64(file.contentBase64).byteLength;
    if (totalBytes > MAX_PLUGIN_PACKAGE_BYTES) {
      throw new ApiError(413, "plugin_package_upload_too_large", "Plugin package exceeds 10 MB");
    }
  }
  if (!seen.has("ipollowork.plugin.json")) {
    throw new ApiError(400, "plugin_package_manifest_missing", "ipollowork.plugin.json is required at the plugin package root");
  }
  return parsed.data;
}

export async function withMaterializedPluginPackageUpload<T>(
  value: unknown,
  operation: (input: { archiveName: string; packageRoot: string }) => Promise<T>,
): Promise<T> {
  const upload = parsePluginPackageUpload(value);
  const packageRoot = await mkdtemp(join(tmpdir(), "ipollowork-plugin-import-"));
  try {
    for (const file of upload.files) {
      const target = resolveWithin(packageRoot, file.path.replaceAll("\\", "/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, decodeBase64(file.contentBase64), { flag: "wx", mode: 0o600 });
    }
    return await operation({ archiveName: upload.archiveName, packageRoot });
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
}
