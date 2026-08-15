import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { z } from "zod";

import { ApiError } from "./errors.js";
import {
  parsePluginMcpEntries,
  pluginEngineAdapter,
  type PluginEngineVersion,
  type PluginWorkspaceFile,
} from "./plugin-engine-adapter.js";
import { parsePluginPackageManifest, type PluginPackageManifest } from "./plugin-package-manifest.js";
import { runtimeStorageDir } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";
import serverPackage from "../package.json" with { type: "json" };

const MANIFEST_FILE = "ipollowork.plugin.json";
const PACKAGE_SIGNATURE_PREFIX = "ipollowork-plugin-package-v1\0";
const TRUSTED_IMPORT_PUBLISHER_KEYS = new Map([
  [
    "smart-future-school/smart-future-school-2026",
    "MCowBQYDK2VwAyEARwKWW0VeQqnxh1WiOi8+kAutSITD476eRaRguDZkxYk=",
  ],
]);

const ownedFileSchema = z.object({ path: z.string(), sha256: z.string() });
const installedVersionSchema = z.object({
  version: z.string(),
  manifest: z.unknown(),
  files: z.array(ownedFileSchema),
  installedAt: z.number(),
});
const installedPackageSchema = z.object({
  pluginId: z.string(),
  enabled: z.boolean(),
  disabledResourceIds: z.array(z.string()).default([]),
  currentVersion: z.string(),
  previousVersion: z.string().nullable(),
  versions: z.record(z.string(), installedVersionSchema),
});
const lifecycleStateSchema = z.object({
  schemaVersion: z.literal(2),
  packages: z.record(z.string(), installedPackageSchema),
});

type OwnedFile = z.infer<typeof ownedFileSchema>;
type InstalledVersion = z.infer<typeof installedVersionSchema>;
type InstalledPackage = z.infer<typeof installedPackageSchema>;
type LifecycleState = z.infer<typeof lifecycleStateSchema>;

export type PluginPackagePreview = {
  manifest: PluginPackageManifest;
  files: OwnedFile[];
  writes: OwnedFile[];
  integrity: { sha256: string; status: "verified" | "unsigned" };
};

type PluginPackageResourceType = PluginPackageManifest["resources"][number]["type"];

export type PluginPackageImportSafety =
  | {
      level: "declarative";
      localCode: false;
      allowedResourceTypes: Array<"skill" | "agent" | "command" | "file" | "mcp">;
    }
  | {
      level: "signed";
      localCode: boolean;
      allowedResourceTypes: PluginPackageResourceType[];
      publisher: { id: string; name: string };
      signature: { algorithm: "ed25519"; keyId: string; status: "verified" };
    };

export type InstalledPluginPackageSummary = {
  pluginId: string;
  name: string;
  version: string;
  enabled: boolean;
  disabledResourceIds: string[];
  previousVersion: string | null;
  manifest: PluginPackageManifest;
  integrity: { sha256: string; status: "verified" | "unsigned" };
};

export type PluginPackageInstallResult = { status: "installed" | "unchanged"; pluginId: string; version: string };
export type PluginPackageUpdateResult = { status: "updated" | "unchanged"; pluginId: string; version: string; previousVersion?: string };
export type PluginPackageRollbackResult = { status: "rolled_back"; pluginId: string; version: string; previousVersion: string };
export type PluginPackageUninstallResult = { status: "uninstalled"; pluginId: string; version: string };
export type InstalledPluginService = {
  manifest: PluginPackageManifest;
  version: string;
  modulePath: string;
};

function emptyState(): LifecycleState {
  return { schemaVersion: 2, packages: {} };
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function stateDirectory(config: ServerConfig, workspaceId: string): string {
  return join(runtimeStorageDir(config), "plugin-packages", safeSegment(workspaceId));
}

function statePath(config: ServerConfig, workspaceId: string): string {
  return join(stateDirectory(config, workspaceId), "state.json");
}

function artifactRoot(config: ServerConfig, workspaceId: string, pluginId: string, version: string): string {
  return join(stateDirectory(config, workspaceId), "artifacts", safeSegment(pluginId), safeSegment(version));
}

function resolveWithin(root: string, relativePath: string): string {
  const base = resolve(root);
  const target = resolve(base, relativePath);
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new ApiError(400, "plugin_package_path_invalid", `Plugin path escapes its root: ${relativePath}`);
  }
  return target;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function activationTargetStatus(path: string, expectedSha256: string): Promise<"missing" | "matching" | "conflict"> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile()) return "conflict";
    return await sha256(path) === expectedSha256 ? "matching" : "conflict";
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "missing";
    throw error;
  }
}

async function packageResourceFiles(packageRoot: string, resourcePath: string): Promise<string[]> {
  const source = resolveWithin(packageRoot, resourcePath);
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(source);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new ApiError(400, "plugin_package_resource_missing", `Package resource is missing: ${resourcePath}`);
    }
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    throw new ApiError(400, "plugin_package_resource_symlink", `Package resources may not be symbolic links: ${resourcePath}`);
  }
  if (metadata.isFile()) return [resourcePath];
  if (!metadata.isDirectory()) {
    throw new ApiError(400, "plugin_package_resource_invalid", `Package resource must be a file or directory: ${resourcePath}`);
  }

  const files: string[] = [];
  const visit = async (directoryPath: string): Promise<void> => {
    const entries = await readdir(resolveWithin(packageRoot, directoryPath), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = `${directoryPath}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new ApiError(400, "plugin_package_resource_symlink", `Package resources may not be symbolic links: ${entryPath}`);
      }
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      } else {
        throw new ApiError(400, "plugin_package_resource_invalid", `Package resource must be a regular file: ${entryPath}`);
      }
    }
  };
  await visit(resourcePath);
  if (files.length === 0) {
    throw new ApiError(400, "plugin_package_resource_empty", `Package resource directory is empty: ${resourcePath}`);
  }
  return files;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function compareRelativePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function packageSha256(manifest: unknown, files: OwnedFile[]): string {
  const hash = createHash("sha256");
  const packageMetadata = isRecord(manifest) && isRecord(manifest.package) ? manifest.package : null;
  const checksumFreeManifest = packageMetadata && isRecord(manifest)
    ? { ...manifest, package: { ...packageMetadata, checksum: undefined, signature: undefined } }
    : manifest;
  hash.update(MANIFEST_FILE);
  hash.update("\0");
  hash.update(createHash("sha256").update(canonicalJson(checksumFreeManifest)).digest("hex"));
  hash.update("\n");
  for (const file of [...files].sort((left, right) => compareRelativePaths(left.path, right.path))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.sha256);
    hash.update("\n");
  }
  return hash.digest("hex");
}

type VersionTuple = [major: number, minor: number, patch: number];

function versionTuple(value: string): VersionTuple {
  const match = value.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new ApiError(500, "plugin_platform_version_invalid", `Runtime version is invalid: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: VersionTuple, right: VersionTuple): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function satisfiesPredicate(version: VersionTuple, predicate: string): boolean {
  const match = predicate.trim().match(/^(\^|~|>=|<=|>|<)?\s*(\d+\.\d+\.\d+)/);
  if (!match) return predicate.trim() === "*";
  const operator = match[1] ?? "=";
  const target = versionTuple(match[2] ?? "0.0.0");
  const comparison = compareVersions(version, target);
  if (operator === ">=") return comparison >= 0;
  if (operator === "<=") return comparison <= 0;
  if (operator === ">") return comparison > 0;
  if (operator === "<") return comparison < 0;
  if (operator === "^") {
    const upper: VersionTuple = target[0] > 0 ? [target[0] + 1, 0, 0] : target[1] > 0 ? [0, target[1] + 1, 0] : [0, 0, target[2] + 1];
    return comparison >= 0 && compareVersions(version, upper) < 0;
  }
  if (operator === "~") return comparison >= 0 && compareVersions(version, [target[0], target[1] + 1, 0]) < 0;
  return comparison === 0;
}

function satisfiesRange(version: string, range: string): boolean {
  const tuple = versionTuple(version);
  if (range.trim() === "*") return true;
  if (range.includes(" || ")) return range.split(" || ").some((part) => satisfiesPredicate(tuple, part));
  if (range.includes(" - ")) {
    const [minimum, maximum] = range.split(" - ");
    return Boolean(minimum && maximum) && compareVersions(tuple, versionTuple(minimum ?? "")) >= 0 && compareVersions(tuple, versionTuple(maximum ?? "")) <= 0;
  }
  return satisfiesPredicate(tuple, range);
}

function assertRuntimeCompatibility(manifest: PluginPackageManifest): void {
  const compatibility = manifest.package?.compatibility;
  const supportedEngines = manifest.package?.engines;
  if (supportedEngines && !supportedEngines.includes(pluginEngineAdapter.id)) {
    throw new ApiError(409, "plugin_package_incompatible", `Plugin does not support ${pluginEngineAdapter.id}`, {
      engine: pluginEngineAdapter.id,
      supportedEngines,
    });
  }
  const checks = [
    { name: "iPolloWork", version: serverPackage.version, range: compatibility?.ipollowork },
    ...pluginEngineAdapter.compatibility(manifest),
  ];
  for (const check of checks) {
    if (check.range && !satisfiesRange(check.version, check.range)) {
      throw new ApiError(409, "plugin_package_incompatible", `${check.name} ${check.version} does not satisfy ${check.range}`, check);
    }
  }
}

function integrityForManifest(
  manifest: PluginPackageManifest,
  files: OwnedFile[],
  sourceManifest: unknown = manifest,
): PluginPackagePreview["integrity"] {
  const digest = packageSha256(sourceManifest, files);
  const declared = manifest.package?.checksum?.value.toLowerCase();
  if (declared && declared !== digest) {
    throw new ApiError(400, "plugin_package_checksum_mismatch", "Plugin package checksum does not match its resource files", {
      declared,
      actual: digest,
    });
  }
  return { sha256: digest, status: declared ? "verified" : "unsigned" };
}

async function readState(config: ServerConfig, workspaceId: string): Promise<LifecycleState> {
  try {
    return lifecycleStateSchema.parse(JSON.parse(await readFile(statePath(config, workspaceId), "utf8")));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeState(config: ServerConfig, workspaceId: string, state: LifecycleState): Promise<void> {
  const path = statePath(config, workspaceId);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.state.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(temporaryPath, 0o600).catch(() => undefined);
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function manifestFromVersion(version: InstalledVersion): PluginPackageManifest {
  return parsePluginPackageManifest(version.manifest);
}

function engineVersion(
  config: ServerConfig,
  workspaceId: string,
  pluginId: string,
  version: InstalledVersion,
): PluginEngineVersion {
  return {
    manifest: manifestFromVersion(version),
    artifactRoot: artifactRoot(config, workspaceId, pluginId, version.version),
    files: version.files,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function workspaceActivationFiles(
  config: ServerConfig,
  workspaceId: string,
  pluginId: string,
  version: InstalledVersion,
): PluginWorkspaceFile[] {
  return pluginEngineAdapter.workspaceFiles(engineVersion(config, workspaceId, pluginId, version));
}

function workspaceActivationPaths(
  config: ServerConfig,
  workspaceId: string,
  pluginId: string,
  version: InstalledVersion,
): Set<string> {
  return new Set(workspaceActivationFiles(config, workspaceId, pluginId, version).map((file) => file.targetPath));
}

function skillActivationPaths(
  config: ServerConfig,
  workspaceId: string,
  pluginId: string,
  version: InstalledVersion,
  resourceIds: ReadonlySet<string>,
): Set<string> {
  const projected = engineVersion(config, workspaceId, pluginId, version);
  return new Set([...resourceIds].flatMap((resourceId) => {
    const targetPath = pluginEngineAdapter.skillTargetPath(projected, resourceId);
    return targetPath ? [targetPath] : [];
  }));
}

function inactiveActivationPaths(
  config: ServerConfig,
  workspaceId: string,
  installed: InstalledPackage,
  version: InstalledVersion,
): Set<string> {
  if (!installed.enabled) return workspaceActivationPaths(config, workspaceId, installed.pluginId, version);
  return skillActivationPaths(config, workspaceId, installed.pluginId, version, new Set(installed.disabledResourceIds));
}

async function assertOwnedFilesUnchanged(
  config: ServerConfig,
  workspaceId: string,
  pluginId: string,
  workspaceRoot: string,
  version: InstalledVersion,
  expectedMissing = new Set<string>(),
): Promise<void> {
  const conflicts: string[] = [];
  for (const file of workspaceActivationFiles(config, workspaceId, pluginId, version)) {
    const target = resolveWithin(workspaceRoot, file.targetPath);
    const exists = await fileExists(target);
    if (expectedMissing.has(file.targetPath)) {
      if (exists) conflicts.push(file.targetPath);
    } else if (!exists || await sha256(target) !== file.sha256) {
      conflicts.push(file.targetPath);
    }
  }
  if (conflicts.length) {
    throw new ApiError(409, "plugin_package_conflict", "Plugin-owned files were modified outside the package manager", { paths: conflicts });
  }
}

async function snapshotPackage(
  config: ServerConfig,
  workspaceId: string,
  packageRoot: string,
  preview: PluginPackagePreview,
): Promise<InstalledVersion> {
  if (!preview.manifest.package) throw new ApiError(400, "plugin_package_metadata_required", "Package metadata is required for installation");
  const destinationRoot = artifactRoot(config, workspaceId, preview.manifest.id, preview.manifest.package.version);
  const sourceManifest: unknown = JSON.parse(await readFile(resolveWithin(packageRoot, MANIFEST_FILE), "utf8"));
  const destinationManifestPath = join(destinationRoot, MANIFEST_FILE);
  if (await fileExists(destinationManifestPath)) {
    const existingManifest: unknown = JSON.parse(await readFile(destinationManifestPath, "utf8"));
    if (canonicalJson(existingManifest) !== canonicalJson(sourceManifest)) {
      throw new ApiError(409, "plugin_package_version_changed", `Immutable package version changed: ${preview.manifest.package.version}`);
    }
  }
  for (const file of preview.files) {
    const source = resolveWithin(packageRoot, file.path);
    const destination = resolveWithin(destinationRoot, file.path);
    if (await fileExists(destination)) {
      if (await sha256(destination) !== file.sha256) {
        throw new ApiError(409, "plugin_package_version_changed", `Immutable package version changed: ${preview.manifest.package.version}`);
      }
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  await mkdir(destinationRoot, { recursive: true });
  await writeFile(destinationManifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return {
    version: preview.manifest.package.version,
    manifest: sourceManifest,
    files: preview.files,
    installedAt: Date.now(),
  };
}

async function applyVersion(
  config: ServerConfig,
  workspaceId: string,
  workspaceRoot: string,
  pluginId: string,
  next: InstalledVersion,
  current: InstalledVersion | null,
  installed?: InstalledPackage,
): Promise<void> {
  const currentInactivePaths = current && installed
    ? inactiveActivationPaths(config, workspaceId, installed, current)
    : new Set<string>();
  const nextInactivePaths = installed
    ? inactiveActivationPaths(config, workspaceId, installed, next)
    : new Set<string>();
  if (current) {
    await assertOwnedFilesUnchanged(config, workspaceId, pluginId, workspaceRoot, current, currentInactivePaths);
  }
  const currentEngineVersion = current ? engineVersion(config, workspaceId, pluginId, current) : null;
  const nextEngineVersion = engineVersion(config, workspaceId, pluginId, next);
  const currentActivationFiles = current
    ? workspaceActivationFiles(config, workspaceId, pluginId, current)
    : [];
  const nextActivationFiles = workspaceActivationFiles(config, workspaceId, pluginId, next);
  const currentPaths = new Set(currentActivationFiles.map((file) => file.targetPath));
  const nextPaths = new Set(nextActivationFiles.map((file) => file.targetPath));
  const adoptedPaths = new Set<string>();
  const conflicts: string[] = [];
  for (const file of nextActivationFiles) {
    if (currentPaths.has(file.targetPath)) continue;
    const target = resolveWithin(workspaceRoot, file.targetPath);
    const status = await activationTargetStatus(target, file.sha256);
    if (status === "matching") adoptedPaths.add(file.targetPath);
    else if (status === "conflict") conflicts.push(file.targetPath);
  }
  if (conflicts.length > 0) {
    throw new ApiError(409, "plugin_package_conflict", "Install targets already exist with different content", { paths: conflicts });
  }

  const enabled = installed?.enabled !== false;
  try {
    for (const file of nextActivationFiles) {
      const source = resolveWithin(nextEngineVersion.artifactRoot, file.sourcePath);
      const target = resolveWithin(workspaceRoot, file.targetPath);
      if (adoptedPaths.has(file.targetPath)) {
        if (await activationTargetStatus(target, file.sha256) !== "matching") {
          throw new ApiError(409, "plugin_package_conflict", `Install target changed during installation: ${file.targetPath}`, { paths: [file.targetPath] });
        }
        continue;
      }
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }
    for (const path of nextInactivePaths) await rm(resolveWithin(workspaceRoot, path), { force: true });
    for (const file of currentActivationFiles) {
      if (!nextPaths.has(file.targetPath)) await rm(resolveWithin(workspaceRoot, file.targetPath), { force: true });
    }
    await pluginEngineAdapter.syncRuntime({
      config,
      workspaceId,
      resolvePath: resolveWithin,
      current: currentEngineVersion,
      next: nextEngineVersion,
      enabled,
    });
  } catch (error) {
    await pluginEngineAdapter.syncRuntime({
      config,
      workspaceId,
      resolvePath: resolveWithin,
      current: nextEngineVersion,
      next: currentEngineVersion,
      enabled: Boolean(current) && enabled,
    }).catch(() => undefined);
    if (current) {
      if (!currentEngineVersion) {
        throw new ApiError(500, "plugin_package_state_invalid", "Current engine projection is missing");
      }
      for (const file of currentActivationFiles) {
        const source = resolveWithin(currentEngineVersion.artifactRoot, file.sourcePath);
        const target = resolveWithin(workspaceRoot, file.targetPath);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
      }
      for (const path of currentInactivePaths) await rm(resolveWithin(workspaceRoot, path), { force: true });
    }
    for (const file of nextActivationFiles) {
      if (!currentPaths.has(file.targetPath) && !adoptedPaths.has(file.targetPath)) {
        await rm(resolveWithin(workspaceRoot, file.targetPath), { force: true });
      }
    }
    throw error;
  }
}

export async function previewPluginPackage(input: { packageRoot: string; workspaceRoot: string }): Promise<PluginPackagePreview> {
  const manifestPath = resolveWithin(input.packageRoot, MANIFEST_FILE);
  let sourceManifest: unknown;
  let manifest: PluginPackageManifest;
  try {
    sourceManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest = parsePluginPackageManifest(sourceManifest);
  } catch (error) {
    if (errorCode(error) === "ENOENT") throw new ApiError(400, "plugin_package_manifest_missing", `${MANIFEST_FILE} is required`);
    throw error;
  }
  if (!manifest.package) throw new ApiError(400, "plugin_package_metadata_required", "Package metadata is required for installation");
  assertRuntimeCompatibility(manifest);
  const resourcePaths = [...new Set([
    ...manifest.resources.flatMap((resource) => resource.path ? [resource.path] : []),
    ...manifest.engineBindings?.flatMap((binding) => binding.capabilities.flatMap((capability) => capability.path ? [capability.path] : [])) ?? [],
  ])];
  const paths = new Set<string>();
  for (const resourcePath of resourcePaths) {
    for (const path of await packageResourceFiles(input.packageRoot, resourcePath)) paths.add(path);
  }
  const files: OwnedFile[] = [];
  for (const path of [...paths].sort()) files.push({ path, sha256: await sha256(resolveWithin(input.packageRoot, path)) });
  const writes = pluginEngineAdapter.workspaceFiles({ manifest, artifactRoot: input.packageRoot, files })
    .map((file) => ({ path: file.targetPath, sha256: file.sha256 }));
  return { manifest, files, writes, integrity: integrityForManifest(manifest, files, sourceManifest) };
}

const SAFE_IMPORT_RESOURCE_TYPES = new Set(["skill", "agent", "command", "file", "mcp"]);

function hasExecutableCapabilities(manifest: PluginPackageManifest): boolean {
  return manifest.resources.some((resource) => resource.type === "local-service" && Boolean(resource.path))
    || Boolean(manifest.engineBindings?.some((binding) => binding.capabilities.some((capability) => capability.path || capability.packageName)));
}

function signedImportSafety(manifest: PluginPackageManifest, integrity: PluginPackagePreview["integrity"]): PluginPackageImportSafety | null {
  const signature = manifest.package?.signature;
  if (!signature) return null;
  const publisher = manifest.package?.publisher;
  if (!publisher) {
    throw new ApiError(400, "plugin_package_signature_untrusted", "Signed plugin packages must declare their publisher");
  }
  if (integrity.status !== "verified") {
    throw new ApiError(400, "plugin_package_signature_requires_checksum", "Signed plugin packages must declare a matching SHA-256 checksum");
  }
  const publicKey = TRUSTED_IMPORT_PUBLISHER_KEYS.get(`${publisher.id}/${signature.keyId}`);
  if (!publicKey) {
    throw new ApiError(400, "plugin_package_signature_untrusted", "Plugin publisher or signing key is not trusted by this iPolloWork build", {
      publisherId: publisher.id,
      keyId: signature.keyId,
    });
  }
  const signatureBytes = Buffer.from(signature.value, "base64");
  const valid = signatureBytes.byteLength === 64 && verify(
    null,
    Buffer.from(`${PACKAGE_SIGNATURE_PREFIX}${integrity.sha256}`, "utf8"),
    createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" }),
    signatureBytes,
  );
  if (!valid) {
    throw new ApiError(400, "plugin_package_signature_invalid", "Plugin package publisher signature is invalid");
  }
  return {
    level: "signed",
    localCode: hasExecutableCapabilities(manifest),
    allowedResourceTypes: [...new Set(manifest.resources.map((resource) => resource.type))],
    publisher,
    signature: { algorithm: "ed25519", keyId: signature.keyId, status: "verified" },
  };
}

function safeImportResourcePath(type: string, path: string): boolean {
  if (type === "skill") return path.startsWith("skills/");
  if (type === "agent") return path.startsWith("agents/");
  if (type === "command") return path.startsWith("commands/");
  if (type === "mcp") return path.startsWith("mcp/") && path.endsWith(".json");
  return type === "file" && ["skills/", "agents/", "commands/"]
    .some((prefix) => path.startsWith(prefix));
}

function unsafeRemoteMcpField(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const field = unsafeRemoteMcpField(item);
      if (field) return field;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, entry] of Object.entries(value)) {
    if (["command", "env", "environment", "headers"].includes(key.toLowerCase())) return key;
    const field = unsafeRemoteMcpField(entry);
    if (field) return field;
  }
  return null;
}

export async function assertPluginPackageSafeForImport(input: {
  packageRoot: string;
  preview: PluginPackagePreview;
}): Promise<PluginPackageImportSafety> {
  const { manifest } = input.preview;
  const reasons: string[] = [];
  if (manifest.source.trusted) reasons.push("Imported packages cannot declare themselves trusted");
  if (reasons.length === 0) {
    const signedSafety = signedImportSafety(manifest, input.preview.integrity);
    if (signedSafety) return signedSafety;
  }
  if (hasExecutableCapabilities(manifest)) {
    reasons.push("Imported packages cannot include executable capabilities");
  }
  if ((manifest.permissions?.length ?? 0) > 0) reasons.push("Imported packages cannot request native runtime permissions");
  if ((manifest.authorization?.methods.length ?? 0) > 0) {
    reasons.push("Imported packages must use remote MCP OAuth instead of collecting credentials");
  }

  for (const resource of manifest.resources) {
    if (!SAFE_IMPORT_RESOURCE_TYPES.has(resource.type)) {
      reasons.push(`Resource ${resource.id} uses blocked executable type ${resource.type}`);
      continue;
    }
    if (!resource.path || !safeImportResourcePath(resource.type, resource.path)) {
      reasons.push(`Resource ${resource.id} must stay inside a supported declarative capability directory`);
      continue;
    }
    if (resource.type !== "mcp") continue;
    let payload: unknown;
    try {
      payload = JSON.parse(await readFile(resolveWithin(input.packageRoot, resource.path), "utf8"));
    } catch {
      reasons.push(`MCP resource ${resource.id} must contain valid JSON`);
      continue;
    }
    const entries = parsePluginMcpEntries(payload, resource.mcpServerName ?? resource.id, resource.path);
    for (const entry of entries) {
      const type = entry.config.type;
      const url = entry.config.url;
      if (type !== "remote" || typeof url !== "string" || !url.startsWith("https://")) {
        reasons.push(`MCP ${entry.name} must be a remote HTTPS server`);
      }
      const unsafeField = unsafeRemoteMcpField(entry.config);
      if (unsafeField) reasons.push(`MCP ${entry.name} cannot declare ${unsafeField}`);
    }
  }

  if (reasons.length > 0) {
    throw new ApiError(
      400,
      "plugin_package_import_unsafe",
      "This plugin contains local code or privileged capabilities that are only allowed in reviewed official packages",
      { reasons: [...new Set(reasons)] },
    );
  }
  return {
    level: "declarative",
    localCode: false,
    allowedResourceTypes: ["skill", "agent", "command", "file", "mcp"],
  };
}

export async function listInstalledPluginPackages(input: { serverConfig: ServerConfig; workspaceId: string }): Promise<InstalledPluginPackageSummary[]> {
  const state = await readState(input.serverConfig, input.workspaceId);
  return Object.values(state.packages).map((installed) => {
    const version = installed.versions[installed.currentVersion];
    if (!version) throw new ApiError(500, "plugin_package_state_invalid", `Missing current version for ${installed.pluginId}`);
    const manifest = manifestFromVersion(version);
    return {
      pluginId: installed.pluginId,
      name: manifest.name,
      version: installed.currentVersion,
      enabled: installed.enabled,
      disabledResourceIds: installed.disabledResourceIds,
      previousVersion: installed.previousVersion,
      manifest,
      integrity: integrityForManifest(manifest, version.files, version.manifest),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export async function resolveInstalledPluginService(input: {
  serverConfig: ServerConfig;
  workspaceId: string;
  pluginId: string;
}): Promise<InstalledPluginService> {
  const state = await readState(input.serverConfig, input.workspaceId);
  const installed = state.packages[input.pluginId];
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  if (!installed.enabled) throw new ApiError(409, "plugin_package_disabled", "Plugin package is disabled");
  const version = installed.versions[installed.currentVersion];
  if (!version) throw new ApiError(500, "plugin_package_state_invalid", "Installed package version is missing");
  const manifest = manifestFromVersion(version);
  const servicePath = manifest.resources.find((resource) => resource.type === "local-service" && resource.path)?.path;
  if (!servicePath) throw new ApiError(404, "plugin_service_not_found", "Plugin package does not provide a local service");
  return {
    manifest,
    version: version.version,
    modulePath: resolveWithin(artifactRoot(input.serverConfig, input.workspaceId, input.pluginId, version.version), servicePath),
  };
}

export async function installPluginPackage(input: {
  serverConfig: ServerConfig;
  workspaceId: string;
  packageRoot: string;
  workspaceRoot: string;
}): Promise<PluginPackageInstallResult> {
  const preview = await previewPluginPackage(input);
  if (!preview.manifest.package) throw new ApiError(400, "plugin_package_metadata_required", "Package metadata is required for installation");
  const state = await readState(input.serverConfig, input.workspaceId);
  const existing = state.packages[preview.manifest.id];
  if (existing) {
    if (existing.currentVersion !== preview.manifest.package.version) {
      throw new ApiError(409, "plugin_package_update_required", "Use the update operation to install a different version");
    }
    const current = existing.versions[existing.currentVersion];
    if (!current) throw new ApiError(500, "plugin_package_state_invalid", "Installed package version is missing");
    await assertOwnedFilesUnchanged(
      input.serverConfig,
      input.workspaceId,
      existing.pluginId,
      input.workspaceRoot,
      current,
      inactiveActivationPaths(input.serverConfig, input.workspaceId, existing, current),
    );
    return { status: "unchanged", pluginId: existing.pluginId, version: existing.currentVersion };
  }
  const version = await snapshotPackage(input.serverConfig, input.workspaceId, input.packageRoot, preview);
  await applyVersion(input.serverConfig, input.workspaceId, input.workspaceRoot, preview.manifest.id, version, null);
  state.packages[preview.manifest.id] = {
    pluginId: preview.manifest.id,
    enabled: true,
    disabledResourceIds: [],
    currentVersion: version.version,
    previousVersion: null,
    versions: { [version.version]: version },
  };
  await writeState(input.serverConfig, input.workspaceId, state);
  return { status: "installed", pluginId: preview.manifest.id, version: version.version };
}

export async function updatePluginPackage(input: {
  serverConfig: ServerConfig;
  workspaceId: string;
  packageRoot: string;
  workspaceRoot: string;
}): Promise<PluginPackageUpdateResult> {
  const preview = await previewPluginPackage(input);
  if (!preview.manifest.package) throw new ApiError(400, "plugin_package_metadata_required", "Package metadata is required for installation");
  const state = await readState(input.serverConfig, input.workspaceId);
  const installed = state.packages[preview.manifest.id];
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  const current = installed.versions[installed.currentVersion];
  if (!current) throw new ApiError(500, "plugin_package_state_invalid", "Installed package version is missing");
  if (installed.currentVersion === preview.manifest.package.version) {
    await assertOwnedFilesUnchanged(
      input.serverConfig,
      input.workspaceId,
      installed.pluginId,
      input.workspaceRoot,
      current,
      inactiveActivationPaths(input.serverConfig, input.workspaceId, installed, current),
    );
    return { status: "unchanged", pluginId: installed.pluginId, version: installed.currentVersion };
  }
  const next = await snapshotPackage(input.serverConfig, input.workspaceId, input.packageRoot, preview);
  await applyVersion(input.serverConfig, input.workspaceId, input.workspaceRoot, installed.pluginId, next, current, installed);
  installed.disabledResourceIds = installed.disabledResourceIds.filter((resourceId) =>
    preview.manifest.resources.some((resource) => resource.type === "skill" && resource.id === resourceId)
  );
  const previousVersion = installed.currentVersion;
  installed.versions[next.version] = next;
  installed.currentVersion = next.version;
  installed.previousVersion = previousVersion;
  await writeState(input.serverConfig, input.workspaceId, state);
  return { status: "updated", pluginId: installed.pluginId, previousVersion, version: next.version };
}

export async function rollbackPluginPackage(input: {
  serverConfig: ServerConfig;
  workspaceId: string;
  pluginId: string;
  workspaceRoot: string;
}): Promise<PluginPackageRollbackResult> {
  const state = await readState(input.serverConfig, input.workspaceId);
  const installed = state.packages[input.pluginId];
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  if (!installed.previousVersion) throw new ApiError(409, "plugin_package_rollback_unavailable", "No previous package version is available");
  const current = installed.versions[installed.currentVersion];
  const previous = installed.versions[installed.previousVersion];
  if (!current || !previous) throw new ApiError(500, "plugin_package_state_invalid", "Rollback package version is missing");
  await applyVersion(input.serverConfig, input.workspaceId, input.workspaceRoot, installed.pluginId, previous, current, installed);
  installed.disabledResourceIds = installed.disabledResourceIds.filter((resourceId) =>
    manifestFromVersion(previous).resources.some((resource) => resource.type === "skill" && resource.id === resourceId)
  );
  const previousVersion = installed.currentVersion;
  installed.currentVersion = previous.version;
  installed.previousVersion = previousVersion;
  await writeState(input.serverConfig, input.workspaceId, state);
  return { status: "rolled_back", pluginId: installed.pluginId, previousVersion, version: previous.version };
}

export async function setPluginPackageEnabled(input: {
  serverConfig: ServerConfig;
  workspaceId: string;
  pluginId: string;
  workspaceRoot: string;
  enabled: boolean;
}) {
  const state = await readState(input.serverConfig, input.workspaceId);
  const installed = state.packages[input.pluginId];
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  if (installed.enabled === input.enabled) return { pluginId: installed.pluginId, enabled: installed.enabled, changed: false };
  const current = installed.versions[installed.currentVersion];
  if (!current) throw new ApiError(500, "plugin_package_state_invalid", "Installed package version is missing");
  await assertOwnedFilesUnchanged(
    input.serverConfig,
    input.workspaceId,
    installed.pluginId,
    input.workspaceRoot,
    current,
    inactiveActivationPaths(input.serverConfig, input.workspaceId, installed, current),
  );
  const currentEngineVersion = engineVersion(input.serverConfig, input.workspaceId, installed.pluginId, current);
  const activationFiles = workspaceActivationFiles(input.serverConfig, input.workspaceId, installed.pluginId, current);
  const allActivationPaths = new Set(activationFiles.map((file) => file.targetPath));
  const disabledSkillPaths = skillActivationPaths(
    input.serverConfig,
    input.workspaceId,
    installed.pluginId,
    current,
    new Set(installed.disabledResourceIds),
  );
  const activationPathsToRestore = [...allActivationPaths].filter((path) => !disabledSkillPaths.has(path));
  if (input.enabled) {
    const conflicts: string[] = [];
    for (const path of activationPathsToRestore) {
      if (await fileExists(resolveWithin(input.workspaceRoot, path))) conflicts.push(path);
    }
    if (conflicts.length > 0) {
      throw new ApiError(409, "plugin_package_conflict", "Plugin skill targets already exist", { paths: conflicts });
    }
  }
  await pluginEngineAdapter.syncRuntime({
    config: input.serverConfig,
    workspaceId: input.workspaceId,
    resolvePath: resolveWithin,
    current: input.enabled ? null : currentEngineVersion,
    next: input.enabled ? currentEngineVersion : null,
    enabled: true,
  });
  if (input.enabled) {
    for (const path of activationPathsToRestore) {
      const file = activationFiles.find((entry) => entry.targetPath === path);
      if (!file) throw new ApiError(500, "plugin_package_state_invalid", `Missing activation source for ${path}`);
      const target = resolveWithin(input.workspaceRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolveWithin(currentEngineVersion.artifactRoot, file.sourcePath), target);
    }
  } else {
    for (const path of allActivationPaths) await rm(resolveWithin(input.workspaceRoot, path), { force: true });
  }
  installed.enabled = input.enabled;
  await writeState(input.serverConfig, input.workspaceId, state);
  return { pluginId: installed.pluginId, enabled: installed.enabled, changed: true };
}

export async function setPluginPackageResourceEnabled(input: {
  serverConfig: ServerConfig;
  workspaceId: string;
  pluginId: string;
  resourceId: string;
  workspaceRoot: string;
  enabled: boolean;
}) {
  const state = await readState(input.serverConfig, input.workspaceId);
  const installed = state.packages[input.pluginId];
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  const current = installed.versions[installed.currentVersion];
  if (!current) throw new ApiError(500, "plugin_package_state_invalid", "Installed package version is missing");
  const manifest = manifestFromVersion(current);
  const resource = manifest.resources.find((entry) => entry.id === input.resourceId);
  if (!resource || resource.type !== "skill") {
    throw new ApiError(404, "plugin_package_resource_not_found", "Plugin skill resource is not installed");
  }
  const activationPath = [...skillActivationPaths(
    input.serverConfig,
    input.workspaceId,
    installed.pluginId,
    current,
    new Set([input.resourceId]),
  )][0];
  if (!activationPath) throw new ApiError(409, "plugin_package_skill_invalid", "Plugin skill does not contain a SKILL.md activation file");
  const currentlyEnabled = !installed.disabledResourceIds.includes(input.resourceId);
  if (currentlyEnabled === input.enabled) {
    return { pluginId: installed.pluginId, resourceId: input.resourceId, enabled: currentlyEnabled, changed: false };
  }

  await assertOwnedFilesUnchanged(
    input.serverConfig,
    input.workspaceId,
    installed.pluginId,
    input.workspaceRoot,
    current,
    inactiveActivationPaths(input.serverConfig, input.workspaceId, installed, current),
  );
  if (installed.enabled && input.enabled) {
    const projected = workspaceActivationFiles(input.serverConfig, input.workspaceId, installed.pluginId, current)
      .find((file) => file.targetPath === activationPath);
    if (!projected) throw new ApiError(500, "plugin_package_state_invalid", `Missing activation source for ${activationPath}`);
    const target = resolveWithin(input.workspaceRoot, activationPath);
    if (await fileExists(target)) {
      throw new ApiError(409, "plugin_package_conflict", `Install target already exists: ${activationPath}`, { paths: [activationPath] });
    }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(
      resolveWithin(artifactRoot(input.serverConfig, input.workspaceId, installed.pluginId, current.version), projected.sourcePath),
      target,
    );
  } else if (installed.enabled) {
    await rm(resolveWithin(input.workspaceRoot, activationPath), { force: true });
  }
  installed.disabledResourceIds = input.enabled
    ? installed.disabledResourceIds.filter((resourceId) => resourceId !== input.resourceId)
    : [...installed.disabledResourceIds, input.resourceId];
  await writeState(input.serverConfig, input.workspaceId, state);
  return { pluginId: installed.pluginId, resourceId: input.resourceId, enabled: input.enabled, changed: true };
}

export async function uninstallPluginPackage(input: {
  serverConfig: ServerConfig;
  workspaceId: string;
  pluginId: string;
  workspaceRoot: string;
}): Promise<PluginPackageUninstallResult> {
  const state = await readState(input.serverConfig, input.workspaceId);
  const installed = state.packages[input.pluginId];
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  const current = installed.versions[installed.currentVersion];
  if (!current) throw new ApiError(500, "plugin_package_state_invalid", "Installed package version is missing");
  await assertOwnedFilesUnchanged(
    input.serverConfig,
    input.workspaceId,
    installed.pluginId,
    input.workspaceRoot,
    current,
    inactiveActivationPaths(input.serverConfig, input.workspaceId, installed, current),
  );
  await pluginEngineAdapter.syncRuntime({
    config: input.serverConfig,
    workspaceId: input.workspaceId,
    resolvePath: resolveWithin,
    current: engineVersion(input.serverConfig, input.workspaceId, installed.pluginId, current),
    next: null,
    enabled: true,
  });
  for (const file of workspaceActivationFiles(input.serverConfig, input.workspaceId, installed.pluginId, current)) {
    await rm(resolveWithin(input.workspaceRoot, file.targetPath), { force: true });
  }
  delete state.packages[input.pluginId];
  await writeState(input.serverConfig, input.workspaceId, state);
  await rm(join(stateDirectory(input.serverConfig, input.workspaceId), "artifacts", safeSegment(input.pluginId)), { recursive: true, force: true });
  return { status: "uninstalled", pluginId: input.pluginId, version: current.version };
}
