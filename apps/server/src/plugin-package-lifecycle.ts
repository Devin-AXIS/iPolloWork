import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import type { Dirent } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import type {
  PluginPromptCapabilitySummary,
  PluginUiResource,
  PluginWorkshopExportFormat,
  PluginWorkshopProjectSnapshot,
  PluginWorkshopProjectSummary,
  PluginWorkshopSourceBundle,
} from "@ipollowork/types/plugins";

import { ApiError } from "./errors.js";
import {
  parsePluginMcpEntries,
  pluginEngineCanActivate,
  pluginEngineAdapters,
  pluginEngineSourcePath,
  type PluginEngineAdapter,
  type PluginEngineVersion,
  type PluginWorkspaceFile,
} from "./plugin-engine-adapter.js";
import { parsePluginPackageManifest, type PluginPackageManifest, type PluginResource } from "./plugin-package-manifest.js";
import { parsePluginWorkshopDraftManifest, preparePluginWorkshopSourceBundle } from "./plugin-workshop-package.js";
import { runtimeStorageDir } from "./runtime-storage.js";
import { DEFAULT_ENGINE_ID, type ServerConfig } from "./types.js";
import serverPackage from "../package.json" with { type: "json" };

const MANIFEST_FILE = "ipollowork.plugin.json";
const PLUGIN_WORKSHOP_DIRECTORY = "plugins";
const MAX_PLUGIN_WORKSHOP_PROJECTS = 100;
const MAX_PLUGIN_WORKSHOP_FILES = 512;
const MAX_PLUGIN_WORKSHOP_BYTES = 10 * 1024 * 1024;
const MAX_PLUGIN_WORKSHOP_UI_BYTES = 5 * 1024 * 1024;
const PLUGIN_WORKSHOP_ID_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const PACKAGE_SIGNATURE_PREFIX = "ipollowork-plugin-package-v1\0";
const TRUSTED_IMPORT_PUBLISHER_KEYS = new Map([
  [
    "smart-future-school/smart-future-school-2026",
    [
      "MCowBQYDK2VwAyEARwKWW0VeQqnxh1WiOi8+kAutSITD476eRaRguDZkxYk=",
    ],
  ],
]);

function workspaceEngineAdapter(config: ServerConfig, workspaceId: string): PluginEngineAdapter {
  const workspace = config.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) throw new ApiError(404, "workspace_not_found", "Workspace not found");
  return pluginEngineAdapters.get(workspace.engineId?.trim() || DEFAULT_ENGINE_ID);
}

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
const installedPackagesSchema = z.record(z.string(), installedPackageSchema);
const lifecycleStateSchema = z.object({
  schemaVersion: z.literal(3),
  packages: installedPackagesSchema,
  suppressedDefaultPluginIds: z.array(z.string()).default([]),
});

type OwnedFile = z.infer<typeof ownedFileSchema>;
type InstalledVersion = z.infer<typeof installedVersionSchema>;
type InstalledPackage = z.infer<typeof installedPackageSchema>;
type LifecycleState = z.infer<typeof lifecycleStateSchema>;

const lifecycleMutationQueues = new WeakMap<ServerConfig, Promise<void>>();

async function enqueueLifecycleMutation<T>(config: ServerConfig, operation: () => Promise<T>): Promise<T> {
  const previous = lifecycleMutationQueues.get(config) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  lifecycleMutationQueues.set(config, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (lifecycleMutationQueues.get(config) === queued) lifecycleMutationQueues.delete(config);
  }
}

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
      allowedResourceTypes: Array<"skill" | "agent" | "command" | "file" | "mcp" | "ui">;
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

export type PortablePluginPromptCapability = PluginPromptCapabilitySummary & {
  content: string;
};

export type InstalledPluginUiResource = {
  pluginId: string;
  version: string;
  resource: PluginResource & {
    type: "ui";
    path: string;
    ui: NonNullable<PluginResource["ui"]>;
  };
  html: string;
};

function emptyState(): LifecycleState {
  return { schemaVersion: 3, packages: {}, suppressedDefaultPluginIds: [] };
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function stateDirectory(config: ServerConfig): string {
  return join(runtimeStorageDir(config), "plugin-packages");
}

function statePath(config: ServerConfig): string {
  return join(stateDirectory(config), "state.json");
}

function artifactRoot(config: ServerConfig, pluginId: string, version: string): string {
  return join(stateDirectory(config), "artifacts", safeSegment(pluginId), safeSegment(version));
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

export type PluginPackageVersionChange = "install" | "same" | "upgrade" | "downgrade";

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

function assertRuntimeCompatibility(manifest: PluginPackageManifest, engineAdapter?: PluginEngineAdapter): void {
  const compatibility = manifest.package?.compatibility;
  const supportedEngines = manifest.package?.engines;
  if (
    engineAdapter
    && supportedEngines
    && !supportedEngines.includes(engineAdapter.id)
    && !pluginEngineCanActivate(engineAdapter, manifest)
  ) {
    throw new ApiError(409, "plugin_package_incompatible", `Plugin does not support ${engineAdapter.id}`, {
      engine: engineAdapter.id,
      supportedEngines,
    });
  }
  engineAdapter?.validate?.(manifest);
  const checks = [
    { name: "iPolloWork", version: serverPackage.version, range: compatibility?.ipollowork },
    ...(engineAdapter?.compatibility(manifest) ?? []),
  ];
  for (const check of checks) {
    if (check.range && !satisfiesRange(check.version, check.range)) {
      throw new ApiError(409, "plugin_package_incompatible", `${check.name} ${check.version} does not satisfy ${check.range}`, check);
    }
  }
}

function assertGlobalRuntimeCompatibility(config: ServerConfig, manifest: PluginPackageManifest): void {
  assertRuntimeCompatibility(manifest);
  const supportedEngines = manifest.package?.engines;
  const engineIds = new Set(config.workspaces
    .filter((workspace) => workspace.workspaceType === "local" && Boolean(workspace.path))
    .map((workspace) => workspace.engineId?.trim() || DEFAULT_ENGINE_ID));
  for (const engineId of engineIds) {
    const adapter = pluginEngineAdapters.get(engineId);
    if (supportedEngines && !supportedEngines.includes(engineId) && !pluginEngineCanActivate(adapter, manifest)) continue;
    assertRuntimeCompatibility(manifest, adapter);
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

async function readState(config: ServerConfig): Promise<LifecycleState> {
  try {
    return lifecycleStateSchema.parse(JSON.parse(await readFile(statePath(config), "utf8")));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.state.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(temporaryPath, 0o600).catch(() => undefined);
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeState(config: ServerConfig, state: LifecycleState): Promise<void> {
  await writeJsonAtomic(statePath(config), state);
}

function manifestFromVersion(version: InstalledVersion): PluginPackageManifest {
  return parsePluginPackageManifest(version.manifest);
}

function sourceResourcePaths(manifest: PluginPackageManifest): string[] {
  return [
    ...manifest.resources.flatMap((resource) => resource.path ? [resource.path] : []),
    ...manifest.engineBindings?.flatMap((binding) => binding.capabilities.flatMap((capability) => capability.path ? [capability.path] : [])) ?? [],
  ];
}

function engineVersion(
  config: ServerConfig,
  workspaceId: string,
  pluginId: string,
  version: InstalledVersion,
): PluginEngineVersion {
  return {
    manifest: manifestFromVersion(version),
    artifactRoot: artifactRoot(config, pluginId, version.version),
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
  return workspaceEngineAdapter(config, workspaceId).workspaceFiles(engineVersion(config, workspaceId, pluginId, version));
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
  const engineAdapter = workspaceEngineAdapter(config, workspaceId);
  return new Set([...resourceIds].flatMap((resourceId) => {
    const targetPath = engineAdapter.skillTargetPath(projected, resourceId);
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
  packageRoot: string,
  preview: PluginPackagePreview,
): Promise<InstalledVersion> {
  if (!preview.manifest.package) throw new ApiError(400, "plugin_package_metadata_required", "Package metadata is required for installation");
  const destinationRoot = artifactRoot(config, preview.manifest.id, preview.manifest.package.version);
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

type PackageProjection = {
  installed: InstalledPackage;
  version: InstalledVersion;
};

type WorkspaceProjectionTarget = {
  workspaceId: string;
  workspaceRoot: string;
};

function packageProjection(
  config: ServerConfig,
  workspaceId: string,
  installed: InstalledPackage | null,
): PackageProjection | null {
  if (!installed) return null;
  const version = installed.versions[installed.currentVersion];
  if (!version) {
    throw new ApiError(500, "plugin_package_state_invalid", `Missing current version for ${installed.pluginId}`);
  }
  const manifest = manifestFromVersion(version);
  const engineAdapter = workspaceEngineAdapter(config, workspaceId);
  const engines = manifest.package?.engines;
  if (engines && !engines.includes(engineAdapter.id) && !pluginEngineCanActivate(engineAdapter, manifest)) return null;
  assertRuntimeCompatibility(manifest, engineAdapter);
  return { installed, version };
}

function localProjectionTargets(config: ServerConfig): WorkspaceProjectionTarget[] {
  return config.workspaces.flatMap((workspace) =>
    workspace.workspaceType === "local" && workspace.path
      ? [{ workspaceId: workspace.id, workspaceRoot: workspace.path }]
      : []
  );
}

async function preflightProjection(
  config: ServerConfig,
  workspaceId: string,
  workspaceRoot: string,
  pluginId: string,
  current: PackageProjection | null,
  next: PackageProjection | null,
): Promise<void> {
  const currentInactivePaths = current
    ? inactiveActivationPaths(config, workspaceId, current.installed, current.version)
    : new Set<string>();
  if (current) {
    await assertOwnedFilesUnchanged(
      config,
      workspaceId,
      pluginId,
      workspaceRoot,
      current.version,
      currentInactivePaths,
    );
  }
  const currentActivationFiles = current
    ? workspaceActivationFiles(config, workspaceId, pluginId, current.version)
    : [];
  const nextActivationFiles = next
    ? workspaceActivationFiles(config, workspaceId, pluginId, next.version)
    : [];
  const currentPaths = new Set(currentActivationFiles.map((file) => file.targetPath));
  const conflicts: string[] = [];
  for (const file of nextActivationFiles) {
    if (currentPaths.has(file.targetPath)) continue;
    const target = resolveWithin(workspaceRoot, file.targetPath);
    const status = await activationTargetStatus(target, file.sha256);
    if (status === "conflict") conflicts.push(file.targetPath);
  }
  if (conflicts.length > 0) {
    throw new ApiError(409, "plugin_package_conflict", "Install targets already exist with different content", {
      workspaceId,
      paths: conflicts,
    });
  }
}

async function applyProjection(
  config: ServerConfig,
  workspaceId: string,
  workspaceRoot: string,
  pluginId: string,
  current: PackageProjection | null,
  next: PackageProjection | null,
): Promise<void> {
  await preflightProjection(config, workspaceId, workspaceRoot, pluginId, current, next);
  const currentInactivePaths = current
    ? inactiveActivationPaths(config, workspaceId, current.installed, current.version)
    : new Set<string>();
  const nextInactivePaths = next
    ? inactiveActivationPaths(config, workspaceId, next.installed, next.version)
    : new Set<string>();
  const currentEngineVersion = current ? engineVersion(config, workspaceId, pluginId, current.version) : null;
  const nextEngineVersion = next ? engineVersion(config, workspaceId, pluginId, next.version) : null;
  const currentActivationFiles = current
    ? workspaceActivationFiles(config, workspaceId, pluginId, current.version)
    : [];
  const nextActivationFiles = next
    ? workspaceActivationFiles(config, workspaceId, pluginId, next.version)
    : [];
  const currentPaths = new Set(currentActivationFiles.map((file) => file.targetPath));
  const nextPaths = new Set(nextActivationFiles.map((file) => file.targetPath));
  const adoptedPaths = new Set<string>();
  for (const file of nextActivationFiles) {
    if (currentPaths.has(file.targetPath)) continue;
    if (await activationTargetStatus(resolveWithin(workspaceRoot, file.targetPath), file.sha256) === "matching") {
      adoptedPaths.add(file.targetPath);
    }
  }

  const enabled = next?.installed.enabled === true;
  const engineAdapter = workspaceEngineAdapter(config, workspaceId);
  try {
    for (const file of nextActivationFiles) {
      if (!nextEngineVersion) {
        throw new ApiError(500, "plugin_package_state_invalid", "Next engine projection is missing");
      }
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
    await engineAdapter.syncRuntime({
      config,
      workspaceId,
      resolvePath: resolveWithin,
      current: currentEngineVersion,
      next: nextEngineVersion,
      enabled,
    });
  } catch (error) {
    await engineAdapter.syncRuntime({
      config,
      workspaceId,
      resolvePath: resolveWithin,
      current: nextEngineVersion,
      next: currentEngineVersion,
      enabled: current?.installed.enabled === true,
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

async function applyPackageTransition(
  config: ServerConfig,
  pluginId: string,
  currentInstalled: InstalledPackage | null,
  nextInstalled: InstalledPackage | null,
): Promise<void> {
  const transitions = localProjectionTargets(config).map((workspace) => ({
    ...workspace,
    current: packageProjection(config, workspace.workspaceId, currentInstalled),
    next: packageProjection(config, workspace.workspaceId, nextInstalled),
  }));
  for (const transition of transitions) {
    await preflightProjection(
      config,
      transition.workspaceId,
      transition.workspaceRoot,
      pluginId,
      transition.current,
      transition.next,
    );
  }
  const applied: typeof transitions = [];
  try {
    for (const transition of transitions) {
      await applyProjection(
        config,
        transition.workspaceId,
        transition.workspaceRoot,
        pluginId,
        transition.current,
        transition.next,
      );
      applied.push(transition);
    }
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const transition of applied.reverse()) {
      try {
        await applyProjection(
          config,
          transition.workspaceId,
          transition.workspaceRoot,
          pluginId,
          transition.next,
          transition.current,
        );
      } catch (rollbackError) {
        rollbackErrors.push(`${transition.workspaceId}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new ApiError(500, "plugin_package_rollback_failed", "Plugin projection rollback failed", {
        cause: error instanceof Error ? error.message : String(error),
        rollbackErrors,
      });
    }
    throw error;
  }
}

export async function previewPluginPackage(input: { packageRoot: string; engineId?: string }): Promise<PluginPackagePreview> {
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
  const engineAdapter = input.engineId ? pluginEngineAdapters.get(input.engineId) : undefined;
  assertRuntimeCompatibility(manifest, engineAdapter);
  const resourcePaths = [...new Set(sourceResourcePaths(manifest))];
  const paths = new Set<string>();
  for (const resourcePath of resourcePaths) {
    for (const path of await packageResourceFiles(input.packageRoot, resourcePath)) paths.add(path);
  }
  const files: OwnedFile[] = [];
  for (const path of [...paths].sort()) files.push({ path, sha256: await sha256(resolveWithin(input.packageRoot, path)) });
  const writes = engineAdapter
    ? engineAdapter.workspaceFiles({ manifest, artifactRoot: input.packageRoot, files })
      .map((file) => ({ path: file.targetPath, sha256: file.sha256 }))
    : [];
  return { manifest, files, writes, integrity: integrityForManifest(manifest, files, sourceManifest) };
}

const SAFE_IMPORT_RESOURCE_TYPES = new Set(["skill", "agent", "command", "file", "mcp", "ui"]);
type PluginPackageImportPurpose = "install" | "workshop-source";

function hasExecutableCapabilities(manifest: PluginPackageManifest): boolean {
  return manifest.resources.some((resource) => resource.type === "local-service" && Boolean(resource.path))
    || Boolean(manifest.engineBindings?.some((binding) => binding.capabilities.some((capability) => capability.path || capability.packageName)));
}

function compareSemverIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePackageVersions(left: string, right: string): number {
  const leftWithoutBuild = left.split("+", 1)[0] ?? "";
  const rightWithoutBuild = right.split("+", 1)[0] ?? "";
  const leftPrereleaseIndex = leftWithoutBuild.indexOf("-");
  const rightPrereleaseIndex = rightWithoutBuild.indexOf("-");
  const leftVersion = leftPrereleaseIndex < 0 ? leftWithoutBuild : leftWithoutBuild.slice(0, leftPrereleaseIndex);
  const rightVersion = rightPrereleaseIndex < 0 ? rightWithoutBuild : rightWithoutBuild.slice(0, rightPrereleaseIndex);
  const leftPrerelease = leftPrereleaseIndex < 0 ? undefined : leftWithoutBuild.slice(leftPrereleaseIndex + 1);
  const rightPrerelease = rightPrereleaseIndex < 0 ? undefined : rightWithoutBuild.slice(rightPrereleaseIndex + 1);
  const coreComparison = compareVersions(versionTuple(leftVersion), versionTuple(rightVersion));
  if (coreComparison !== 0) return coreComparison;
  if (!leftPrerelease && !rightPrerelease) return 0;
  if (!leftPrerelease) return 1;
  if (!rightPrerelease) return -1;
  const leftIdentifiers = leftPrerelease.split(".");
  const rightIdentifiers = rightPrerelease.split(".");
  const identifierCount = Math.max(leftIdentifiers.length, rightIdentifiers.length);
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = leftIdentifiers[index];
    const rightIdentifier = rightIdentifiers[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const comparison = compareSemverIdentifiers(leftIdentifier, rightIdentifier);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

export function pluginPackageVersionChange(
  installedVersion: string | null,
  incomingVersion: string,
): PluginPackageVersionChange {
  if (!installedVersion) return "install";
  const comparison = comparePackageVersions(incomingVersion, installedVersion);
  if (comparison === 0) return "same";
  return comparison > 0 ? "upgrade" : "downgrade";
}

function requestsUiNetworkAccess(manifest: PluginPackageManifest): boolean {
  return manifest.resources.some((resource) => resource.type === "ui" && [
    resource.ui?.csp?.connectDomains,
    resource.ui?.csp?.resourceDomains,
    resource.ui?.csp?.frameDomains,
    resource.ui?.csp?.baseUriDomains,
  ].some((domains) => Boolean(domains?.length)));
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
  const publicKeys = TRUSTED_IMPORT_PUBLISHER_KEYS.get(`${publisher.id}/${signature.keyId}`);
  if (!publicKeys) {
    throw new ApiError(400, "plugin_package_signature_untrusted", "Plugin publisher or signing key is not trusted by this iPolloWork build", {
      publisherId: publisher.id,
      keyId: signature.keyId,
    });
  }
  const signatureBytes = Buffer.from(signature.value, "base64");
  const valid = signatureBytes.byteLength === 64 && publicKeys.some((publicKey) => verify(
    null,
    Buffer.from(`${PACKAGE_SIGNATURE_PREFIX}${integrity.sha256}`, "utf8"),
    createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" }),
    signatureBytes,
  ));
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
  if (type === "ui") return path.startsWith("ui/") && path.endsWith(".html");
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
  purpose: PluginPackageImportPurpose;
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
  const blockedPermissions = manifest.permissions?.filter((permission) => !(
    input.purpose === "workshop-source"
    && permission.id === "network"
    && requestsUiNetworkAccess(manifest)
  )) ?? [];
  if (blockedPermissions.length > 0) {
    reasons.push(`Imported packages cannot request native runtime permissions: ${blockedPermissions.map((permission) => permission.id).join(", ")}`);
  }
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
    allowedResourceTypes: ["skill", "agent", "command", "file", "mcp", "ui"],
  };
}

export async function listInstalledPluginPackages(input: { serverConfig: ServerConfig }): Promise<InstalledPluginPackageSummary[]> {
  const state = await readState(input.serverConfig);
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

export async function listPortablePluginPromptCapabilities(input: {
  serverConfig: ServerConfig;
  engineId: string;
}): Promise<PortablePluginPromptCapability[]> {
  const state = await readState(input.serverConfig);
  const capabilities: PortablePluginPromptCapability[] = [];
  for (const installed of Object.values(state.packages)) {
    if (!installed.enabled) continue;
    const version = installed.versions[installed.currentVersion];
    if (!version) throw new ApiError(500, "plugin_package_state_invalid", `Missing current version for ${installed.pluginId}`);
    const manifest = manifestFromVersion(version);
    if (manifest.package?.engines && !manifest.package.engines.includes(input.engineId)) continue;
    const projected: PluginEngineVersion = {
      manifest,
      artifactRoot: artifactRoot(input.serverConfig, installed.pluginId, version.version),
      files: version.files,
    };
    for (const resource of manifest.resources) {
      if ((resource.type !== "command" && resource.type !== "agent") || !resource.path) continue;
      if (installed.disabledResourceIds.includes(resource.id)) continue;
      const sourcePath = pluginEngineSourcePath(projected, resource.path) ?? resource.path;
      if (!version.files.some((file) => file.path === sourcePath)) continue;
      const content = await readFile(resolveWithin(projected.artifactRoot, sourcePath), "utf8");
      capabilities.push({
        pluginId: installed.pluginId,
        resourceId: resource.id,
        type: resource.type,
        name: basename(resource.path, ".md"),
        ...(resource.description || resource.label || manifest.description
          ? { description: resource.description || resource.label || manifest.description }
          : {}),
        content,
      });
    }
  }
  return capabilities.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listSuppressedDefaultPluginIds(input: { serverConfig: ServerConfig }): Promise<string[]> {
  return (await readState(input.serverConfig)).suppressedDefaultPluginIds;
}

export async function readInstalledPluginUiResource(input: {
  serverConfig: ServerConfig;
  pluginId: string;
  resourceId: string;
}): Promise<InstalledPluginUiResource> {
  const state = await readState(input.serverConfig);
  const installed = state.packages[input.pluginId];
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  if (!installed.enabled) throw new ApiError(409, "plugin_package_disabled", "Plugin package is disabled");
  if (installed.disabledResourceIds.includes(input.resourceId)) {
    throw new ApiError(409, "plugin_resource_disabled", "Plugin UI resource is disabled");
  }
  const version = installed.versions[installed.currentVersion];
  if (!version) throw new ApiError(500, "plugin_package_state_invalid", "Installed package version is missing");
  const manifest = manifestFromVersion(version);
  const resource = manifest.resources.find((entry) => entry.id === input.resourceId && entry.type === "ui");
  if (!resource?.path || !resource.ui) {
    throw new ApiError(404, "plugin_ui_resource_not_found", "Plugin UI resource was not found");
  }
  if (!version.files.some((file) => file.path === resource.path)) {
    throw new ApiError(500, "plugin_package_state_invalid", "Plugin UI resource file is missing from the installed package");
  }
  const html = await readFile(resolveWithin(artifactRoot(input.serverConfig, input.pluginId, version.version), resource.path), "utf8");
  if (Buffer.byteLength(html, "utf8") > 5 * 1024 * 1024) {
    throw new ApiError(413, "plugin_ui_resource_too_large", "Plugin UI resource exceeds the 5MB limit");
  }
  return {
    pluginId: input.pluginId,
    version: version.version,
    resource: resource as InstalledPluginUiResource["resource"],
    html,
  };
}

type PluginWorkshopFile = {
  path: string;
  size: number;
  modifiedAt: number;
};

function pluginWorkshopProjectRoot(workspaceRoot: string, directoryId: string): string {
  if (!PLUGIN_WORKSHOP_ID_RE.test(directoryId)) {
    throw new ApiError(400, "plugin_workshop_id_invalid", "Plugin workshop project ID is invalid");
  }
  return resolveWithin(join(workspaceRoot, PLUGIN_WORKSHOP_DIRECTORY), directoryId);
}

function pluginWorkshopProjectExistsError(directoryId: string): ApiError {
  return new ApiError(
    409,
    "plugin_workshop_project_exists",
    `A Plugin Workshop project already exists at plugins/${directoryId}`,
    { directoryId, packageRoot: `${PLUGIN_WORKSHOP_DIRECTORY}/${directoryId}` },
  );
}

async function assertPluginWorkshopProjectDirectory(workspaceRoot: string, directoryId: string): Promise<string> {
  const projectRoot = pluginWorkshopProjectRoot(workspaceRoot, directoryId);
  const metadata = await lstat(projectRoot);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new ApiError(400, "plugin_workshop_directory_invalid", "Plugin workshop project must be a regular directory");
  }
  return projectRoot;
}

async function readPluginWorkshopProjectSummary(
  workspaceRoot: string,
  directoryId: string,
): Promise<PluginWorkshopProjectSummary> {
  const packageRoot = `${PLUGIN_WORKSHOP_DIRECTORY}/${directoryId}`;
  let modifiedAt = 0;
  try {
    const projectRoot = await assertPluginWorkshopProjectDirectory(workspaceRoot, directoryId);
    const manifestPath = resolveWithin(projectRoot, MANIFEST_FILE);
    modifiedAt = (await stat(manifestPath)).mtimeMs;
    const manifest = parsePluginWorkshopDraftManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
    return {
      directoryId,
      packageRoot,
      manifest,
      modifiedAt,
      error: manifest.id === directoryId
        ? null
        : `Manifest ID ${manifest.id} must match its plugins/${directoryId} directory`,
    };
  } catch (error) {
    return {
      directoryId,
      packageRoot,
      manifest: null,
      modifiedAt,
      error: error instanceof Error ? error.message : "Plugin manifest could not be read",
    };
  }
}

async function collectPluginWorkshopFiles(packageRoot: string): Promise<PluginWorkshopFile[]> {
  const files: PluginWorkshopFile[] = [];
  let totalBytes = 0;
  const visit = async (directoryPath: string): Promise<void> => {
    const entries = await readdir(resolveWithin(packageRoot, directoryPath), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = directoryPath ? `${directoryPath}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        throw new ApiError(400, "plugin_workshop_symlink_blocked", `Plugin workshop projects may not contain symbolic links: ${path}`);
      }
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) {
        throw new ApiError(400, "plugin_workshop_file_invalid", `Plugin workshop projects may only contain regular files: ${path}`);
      }
      const metadata = await stat(resolveWithin(packageRoot, path));
      totalBytes += metadata.size;
      if (files.length >= MAX_PLUGIN_WORKSHOP_FILES || totalBytes > MAX_PLUGIN_WORKSHOP_BYTES) {
        throw new ApiError(413, "plugin_workshop_project_too_large", "Plugin workshop projects are limited to 512 files and 10 MB");
      }
      files.push({ path, size: metadata.size, modifiedAt: metadata.mtimeMs });
    }
  };
  await visit("");
  return files;
}

export async function listPluginWorkshopProjects(input: {
  workspaceRoot: string;
}): Promise<PluginWorkshopProjectSummary[]> {
  const root = join(input.workspaceRoot, PLUGIN_WORKSHOP_DIRECTORY);
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  const directoryIds = entries
    .filter((entry) => entry.isDirectory() && PLUGIN_WORKSHOP_ID_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .slice(0, MAX_PLUGIN_WORKSHOP_PROJECTS);
  const projects = await Promise.all(directoryIds.map((directoryId) => (
    readPluginWorkshopProjectSummary(input.workspaceRoot, directoryId)
  )));
  return projects.sort((left, right) => right.modifiedAt - left.modifiedAt || left.directoryId.localeCompare(right.directoryId));
}

export async function readPluginWorkshopProjectSnapshot(input: {
  workspaceRoot: string;
  directoryId: string;
}): Promise<PluginWorkshopProjectSnapshot> {
  const project = await readPluginWorkshopProjectSummary(input.workspaceRoot, input.directoryId);
  if (!project.manifest || project.error) {
    throw new ApiError(400, "plugin_workshop_manifest_invalid", project.error ?? "Plugin manifest is invalid");
  }
  const packageRoot = await assertPluginWorkshopProjectDirectory(input.workspaceRoot, input.directoryId);
  const files = await collectPluginWorkshopFiles(packageRoot);
  const revision = files
    .map((file) => `${file.path}:${file.size}:${file.modifiedAt}`)
    .join("|");
  const workspaceContribution = project.manifest.contributions?.find((contribution) => contribution.type === "workspace-app");
  const resource = project.manifest.resources.find((entry) => (
    entry.type === "ui"
    && Boolean(entry.path && entry.ui)
    && (!workspaceContribution?.ref || entry.id === workspaceContribution.ref)
  ));
  if (!resource?.path || !resource.ui) {
    return { project, revision, ui: null };
  }
  const html = await readFile(resolveWithin(packageRoot, resource.path), "utf8");
  if (Buffer.byteLength(html, "utf8") > MAX_PLUGIN_WORKSHOP_UI_BYTES) {
    throw new ApiError(413, "plugin_workshop_ui_too_large", "Plugin Studio UI exceeds the 5 MB limit");
  }
  const uiResource: PluginUiResource = {
    ...resource,
    type: "ui",
    path: resource.path,
    ui: resource.ui,
  };
  return { project, revision, ui: { resource: uiResource, html } };
}

export async function exportPluginWorkshopProject(input: {
  workspaceRoot: string;
  directoryId: string;
  format?: PluginWorkshopExportFormat;
}): Promise<PluginWorkshopSourceBundle> {
  const project = await readPluginWorkshopProjectSummary(input.workspaceRoot, input.directoryId);
  if (!project.manifest || project.error) {
    throw new ApiError(400, "plugin_workshop_manifest_invalid", project.error ?? "Plugin manifest is invalid");
  }
  const packageRoot = await assertPluginWorkshopProjectDirectory(input.workspaceRoot, input.directoryId);
  const files = await collectPluginWorkshopFiles(packageRoot);
  const source = {
    pluginId: project.manifest.id,
    version: project.manifest.package?.version ?? "0.0.0",
    files: await Promise.all(files.map(async (file) => ({
      path: file.path,
      contentBase64: (await readFile(resolveWithin(packageRoot, file.path))).toString("base64"),
    }))),
    preparation: { localizedUrls: [], removedNetworkPermission: false },
  };
  return input.format === "source" ? source : preparePluginWorkshopSourceBundle(source);
}

export async function importPluginWorkshopProject(input: {
  workspaceRoot: string;
  packageRoot: string;
  engineId?: string;
  overwrite?: boolean;
}): Promise<PluginWorkshopProjectSnapshot> {
  const preview = await previewPluginPackage(input);
  await assertPluginPackageSafeForImport({ packageRoot: input.packageRoot, preview, purpose: "workshop-source" });
  const directoryId = preview.manifest.id;
  const projectsRoot = join(input.workspaceRoot, PLUGIN_WORKSHOP_DIRECTORY);
  const targetRoot = pluginWorkshopProjectRoot(input.workspaceRoot, directoryId);
  let targetExists = false;
  try {
    await assertPluginWorkshopProjectDirectory(input.workspaceRoot, directoryId);
    targetExists = true;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  if (targetExists && !input.overwrite) throw pluginWorkshopProjectExistsError(directoryId);

  const files = await collectPluginWorkshopFiles(input.packageRoot);
  await mkdir(projectsRoot, { recursive: true });
  const stagingRoot = resolveWithin(projectsRoot, `.import-${directoryId}-${randomUUID()}`);
  const backupRoot = targetExists
    ? resolveWithin(projectsRoot, `.replace-${directoryId}-${randomUUID()}`)
    : null;
  await mkdir(stagingRoot);
  try {
    for (const file of files) {
      const target = resolveWithin(stagingRoot, file.path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolveWithin(input.packageRoot, file.path), target);
    }
    let existingMoved = false;
    try {
      if (backupRoot) {
        await rename(targetRoot, backupRoot);
        existingMoved = true;
      }
      await rename(stagingRoot, targetRoot);
    } catch (error) {
      if (backupRoot && existingMoved) {
        try {
          await rename(backupRoot, targetRoot);
        } catch {
          throw new ApiError(
            500,
            "plugin_workshop_overwrite_restore_failed",
            `Could not restore the previous plugins/${directoryId} project after an overwrite failure`,
            { directoryId },
          );
        }
      }
      if (["EEXIST", "ENOTEMPTY"].includes(errorCode(error) ?? "")) {
        throw pluginWorkshopProjectExistsError(directoryId);
      }
      throw error;
    }
    if (backupRoot) await rm(backupRoot, { recursive: true, force: true });
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
  return readPluginWorkshopProjectSnapshot({ workspaceRoot: input.workspaceRoot, directoryId });
}

async function reconcilePackageProjection(
  config: ServerConfig,
  workspaceId: string,
  workspaceRoot: string,
  installed: InstalledPackage,
): Promise<void> {
  const adapter = workspaceEngineAdapter(config, workspaceId);
  const next = packageProjection(config, workspaceId, installed);
  const nextPaths = new Set(
    next
      ? workspaceActivationFiles(config, workspaceId, installed.pluginId, next.version).map((file) => file.targetPath)
      : [],
  );
  for (const version of Object.values(installed.versions)) {
    if (next?.version.version === version.version) continue;
    if (!pluginEngineCanActivate(adapter, manifestFromVersion(version))) continue;
    for (const file of workspaceActivationFiles(config, workspaceId, installed.pluginId, version)) {
      if (nextPaths.has(file.targetPath)) continue;
      const target = resolveWithin(workspaceRoot, file.targetPath);
      if (await activationTargetStatus(target, file.sha256) === "matching") await rm(target, { force: true });
    }
    await adapter.syncRuntime({
      config,
      workspaceId,
      resolvePath: resolveWithin,
      current: engineVersion(config, workspaceId, installed.pluginId, version),
      next: null,
      enabled: true,
    });
  }
  await applyProjection(config, workspaceId, workspaceRoot, installed.pluginId, null, next);
}

async function reconcilePluginPackagesForWorkspaceUnlocked(input: {
  serverConfig: ServerConfig;
  workspaceId: string;
  workspaceRoot: string;
}): Promise<void> {
  const state = await readState(input.serverConfig);
  const installedPackages = Object.values(state.packages);
  for (const installed of installedPackages) {
    await preflightProjection(
      input.serverConfig,
      input.workspaceId,
      input.workspaceRoot,
      installed.pluginId,
      null,
      packageProjection(input.serverConfig, input.workspaceId, installed),
    );
  }
  for (const installed of installedPackages) {
    await reconcilePackageProjection(input.serverConfig, input.workspaceId, input.workspaceRoot, installed);
  }
}

export function reconcilePluginPackagesForWorkspace(input: {
  serverConfig: ServerConfig;
  workspaceId: string;
  workspaceRoot: string;
}): Promise<void> {
  return enqueueLifecycleMutation(input.serverConfig, () => reconcilePluginPackagesForWorkspaceUnlocked(input));
}

async function reconcilePluginPackagesGlobally(config: ServerConfig): Promise<void> {
  const state = await readState(config);
  const tasks = localProjectionTargets(config).flatMap((workspace) =>
    Object.values(state.packages).map((installed) => ({ ...workspace, installed })),
  );
  for (const task of tasks) {
    await preflightProjection(
      config,
      task.workspaceId,
      task.workspaceRoot,
      task.installed.pluginId,
      null,
      packageProjection(config, task.workspaceId, task.installed),
    );
  }
  for (const task of tasks) {
    await reconcilePackageProjection(
      config,
      task.workspaceId,
      task.workspaceRoot,
      task.installed,
    );
  }
}

function copyInstalledPackage(installed: InstalledPackage): InstalledPackage {
  return {
    ...installed,
    disabledResourceIds: [...installed.disabledResourceIds],
    versions: { ...installed.versions },
  };
}

async function commitPackageTransition(input: {
  config: ServerConfig;
  state: LifecycleState;
  pluginId: string;
  current: InstalledPackage | null;
  next: InstalledPackage | null;
  updateState(): void;
}): Promise<void> {
  await applyPackageTransition(input.config, input.pluginId, input.current, input.next);
  try {
    input.updateState();
    await writeState(input.config, input.state);
  } catch (error) {
    await applyPackageTransition(input.config, input.pluginId, input.next, input.current);
    throw error;
  }
}

export async function resolveInstalledPluginService(input: {
  serverConfig: ServerConfig;
  pluginId: string;
}): Promise<InstalledPluginService> {
  const state = await readState(input.serverConfig);
  const installed = state.packages[input.pluginId];
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  if (!installed.enabled) throw new ApiError(409, "plugin_package_disabled", "Plugin package is disabled");
  const version = installed.versions[installed.currentVersion];
  if (!version) throw new ApiError(500, "plugin_package_state_invalid", "Installed package version is missing");
  const manifest = manifestFromVersion(version);
  const servicePath = manifest.resources.find((resource) => resource.type === "local-service" && resource.path)?.path;
  if (!servicePath) throw new ApiError(404, "plugin_service_not_found", "Plugin package does not provide a local service");
  const sourcePath = pluginEngineSourcePath({
    manifest,
    artifactRoot: artifactRoot(input.serverConfig, input.pluginId, version.version),
    files: version.files,
  }, servicePath) ?? servicePath;
  return {
    manifest,
    version: version.version,
    modulePath: resolveWithin(artifactRoot(input.serverConfig, input.pluginId, version.version), sourcePath),
  };
}

async function installPluginPackageUnlocked(input: {
  serverConfig: ServerConfig;
  packageRoot: string;
}): Promise<PluginPackageInstallResult> {
  const preview = await previewPluginPackage({
    packageRoot: input.packageRoot,
  });
  assertGlobalRuntimeCompatibility(input.serverConfig, preview.manifest);
  if (!preview.manifest.package) throw new ApiError(400, "plugin_package_metadata_required", "Package metadata is required for installation");
  const state = await readState(input.serverConfig);
  const existing = state.packages[preview.manifest.id];
  if (existing) {
    if (existing.currentVersion !== preview.manifest.package.version) {
      throw new ApiError(409, "plugin_package_update_required", "Use the update operation to install a different version");
    }
    const current = existing.versions[existing.currentVersion];
    if (!current) throw new ApiError(500, "plugin_package_state_invalid", "Installed package version is missing");
    await reconcilePluginPackagesGlobally(input.serverConfig);
    if (state.suppressedDefaultPluginIds.includes(existing.pluginId)) {
      state.suppressedDefaultPluginIds = state.suppressedDefaultPluginIds.filter((pluginId) => pluginId !== existing.pluginId);
      await writeState(input.serverConfig, state);
    }
    return { status: "unchanged", pluginId: existing.pluginId, version: existing.currentVersion };
  }
  const version = await snapshotPackage(input.serverConfig, input.packageRoot, preview);
  const installed: InstalledPackage = {
    pluginId: preview.manifest.id,
    enabled: true,
    disabledResourceIds: [],
    currentVersion: version.version,
    previousVersion: null,
    versions: { [version.version]: version },
  };
  await commitPackageTransition({
    config: input.serverConfig,
    state,
    pluginId: installed.pluginId,
    current: null,
    next: installed,
    updateState() {
      state.packages[installed.pluginId] = installed;
      state.suppressedDefaultPluginIds = state.suppressedDefaultPluginIds.filter((pluginId) => pluginId !== installed.pluginId);
    },
  });
  return { status: "installed", pluginId: preview.manifest.id, version: version.version };
}

async function updatePluginPackageUnlocked(input: {
  serverConfig: ServerConfig;
  packageRoot: string;
}): Promise<PluginPackageUpdateResult> {
  const preview = await previewPluginPackage({
    packageRoot: input.packageRoot,
  });
  assertGlobalRuntimeCompatibility(input.serverConfig, preview.manifest);
  if (!preview.manifest.package) throw new ApiError(400, "plugin_package_metadata_required", "Package metadata is required for installation");
  const state = await readState(input.serverConfig);
  const installed = state.packages[preview.manifest.id];
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  const current = installed.versions[installed.currentVersion];
  if (!current) throw new ApiError(500, "plugin_package_state_invalid", "Installed package version is missing");
  if (installed.currentVersion === preview.manifest.package.version) {
    await reconcilePluginPackagesGlobally(input.serverConfig);
    return { status: "unchanged", pluginId: installed.pluginId, version: installed.currentVersion };
  }
  const next = await snapshotPackage(input.serverConfig, input.packageRoot, preview);
  const updated = copyInstalledPackage(installed);
  updated.disabledResourceIds = updated.disabledResourceIds.filter((resourceId) =>
    preview.manifest.resources.some((resource) => resource.type === "skill" && resource.id === resourceId)
  );
  const previousVersion = installed.currentVersion;
  updated.versions[next.version] = next;
  updated.currentVersion = next.version;
  updated.previousVersion = previousVersion;
  await commitPackageTransition({
    config: input.serverConfig,
    state,
    pluginId: installed.pluginId,
    current: installed,
    next: updated,
    updateState() {
      state.packages[installed.pluginId] = updated;
      state.suppressedDefaultPluginIds = state.suppressedDefaultPluginIds.filter((pluginId) => pluginId !== installed.pluginId);
    },
  });
  return { status: "updated", pluginId: installed.pluginId, previousVersion, version: next.version };
}

async function rollbackPluginPackageUnlocked(input: {
  serverConfig: ServerConfig;
  pluginId: string;
}): Promise<PluginPackageRollbackResult> {
  const state = await readState(input.serverConfig);
  const installed = state.packages[input.pluginId];
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  if (!installed.previousVersion) throw new ApiError(409, "plugin_package_rollback_unavailable", "No previous package version is available");
  const current = installed.versions[installed.currentVersion];
  const previous = installed.versions[installed.previousVersion];
  if (!current || !previous) throw new ApiError(500, "plugin_package_state_invalid", "Rollback package version is missing");
  const rolledBack = copyInstalledPackage(installed);
  rolledBack.disabledResourceIds = rolledBack.disabledResourceIds.filter((resourceId) =>
    manifestFromVersion(previous).resources.some((resource) => resource.type === "skill" && resource.id === resourceId)
  );
  const previousVersion = installed.currentVersion;
  rolledBack.currentVersion = previous.version;
  rolledBack.previousVersion = previousVersion;
  await commitPackageTransition({
    config: input.serverConfig,
    state,
    pluginId: installed.pluginId,
    current: installed,
    next: rolledBack,
    updateState() {
      state.packages[installed.pluginId] = rolledBack;
    },
  });
  return { status: "rolled_back", pluginId: installed.pluginId, previousVersion, version: previous.version };
}

async function setPluginPackageEnabledUnlocked(input: {
  serverConfig: ServerConfig;
  pluginId: string;
  enabled: boolean;
}) {
  const state = await readState(input.serverConfig);
  const installed = state.packages[input.pluginId];
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  if (installed.enabled === input.enabled) return { pluginId: installed.pluginId, enabled: installed.enabled, changed: false };
  const updated = copyInstalledPackage(installed);
  updated.enabled = input.enabled;
  await commitPackageTransition({
    config: input.serverConfig,
    state,
    pluginId: installed.pluginId,
    current: installed,
    next: updated,
    updateState() {
      state.packages[installed.pluginId] = updated;
    },
  });
  return { pluginId: installed.pluginId, enabled: updated.enabled, changed: true };
}

async function setPluginPackageResourceEnabledUnlocked(input: {
  serverConfig: ServerConfig;
  pluginId: string;
  resourceId: string;
  enabled: boolean;
}) {
  const state = await readState(input.serverConfig);
  const installed = state.packages[input.pluginId];
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  const current = installed.versions[installed.currentVersion];
  if (!current) throw new ApiError(500, "plugin_package_state_invalid", "Installed package version is missing");
  const manifest = manifestFromVersion(current);
  const resource = manifest.resources.find((entry) => entry.id === input.resourceId);
  if (!resource || resource.type !== "skill") {
    throw new ApiError(404, "plugin_package_resource_not_found", "Plugin skill resource is not installed");
  }
  const resourcePath = resource.path?.trim() || null;
  const skillPath = !resourcePath
    ? null
    : resourcePath === "SKILL.md" || resourcePath.endsWith("/SKILL.md")
      ? resourcePath
      : `${resourcePath.replace(/\/$/, "")}/SKILL.md`;
  if (!skillPath || !current.files.some((file) => file.path === skillPath)) {
    throw new ApiError(409, "plugin_package_skill_invalid", "Plugin skill does not contain a SKILL.md activation file");
  }
  const currentlyEnabled = !installed.disabledResourceIds.includes(input.resourceId);
  if (currentlyEnabled === input.enabled) {
    return { pluginId: installed.pluginId, resourceId: input.resourceId, enabled: currentlyEnabled, changed: false };
  }

  const updated = copyInstalledPackage(installed);
  updated.disabledResourceIds = input.enabled
    ? updated.disabledResourceIds.filter((resourceId) => resourceId !== input.resourceId)
    : [...updated.disabledResourceIds, input.resourceId];
  await commitPackageTransition({
    config: input.serverConfig,
    state,
    pluginId: installed.pluginId,
    current: installed,
    next: updated,
    updateState() {
      state.packages[installed.pluginId] = updated;
    },
  });
  return { pluginId: installed.pluginId, resourceId: input.resourceId, enabled: input.enabled, changed: true };
}

async function uninstallPluginPackageUnlocked(input: {
  serverConfig: ServerConfig;
  pluginId: string;
}): Promise<PluginPackageUninstallResult> {
  const state = await readState(input.serverConfig);
  const installed = state.packages[input.pluginId];
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  const current = installed.versions[installed.currentVersion];
  if (!current) throw new ApiError(500, "plugin_package_state_invalid", "Installed package version is missing");
  const cleanupPlans: Array<{
    workspaceId: string;
    workspaceRoot: string;
    adapter: PluginEngineAdapter;
    versions: InstalledVersion[];
    filesByPath: Map<string, Set<string>>;
  }> = [];
  for (const workspace of localProjectionTargets(input.serverConfig)) {
    const adapter = workspaceEngineAdapter(input.serverConfig, workspace.workspaceId);
    const filesByPath = new Map<string, Set<string>>();
    const versions = Object.values(installed.versions).filter((version) =>
      pluginEngineCanActivate(adapter, manifestFromVersion(version)));
    for (const version of versions) {
      for (const file of workspaceActivationFiles(input.serverConfig, workspace.workspaceId, installed.pluginId, version)) {
        const hashes = filesByPath.get(file.targetPath) ?? new Set<string>();
        hashes.add(file.sha256);
        filesByPath.set(file.targetPath, hashes);
      }
    }
    const conflicts: string[] = [];
    for (const [path, hashes] of filesByPath) {
      const target = resolveWithin(workspace.workspaceRoot, path);
      if (!await fileExists(target)) continue;
      if (!hashes.has(await sha256(target))) conflicts.push(path);
    }
    if (conflicts.length > 0) {
      throw new ApiError(409, "plugin_package_conflict", "Plugin-owned files were modified outside the package manager", {
        workspaceId: workspace.workspaceId,
        paths: conflicts,
      });
    }
    cleanupPlans.push({
      workspaceId: workspace.workspaceId,
      workspaceRoot: workspace.workspaceRoot,
      adapter,
      versions,
      filesByPath,
    });
  }
  await applyPackageTransition(input.serverConfig, installed.pluginId, installed, null);
  try {
    for (const plan of cleanupPlans) {
      for (const version of plan.versions) {
        if (version.version === current.version) continue;
        await plan.adapter.syncRuntime({
          config: input.serverConfig,
          workspaceId: plan.workspaceId,
          resolvePath: resolveWithin,
          current: engineVersion(input.serverConfig, plan.workspaceId, installed.pluginId, version),
          next: null,
          enabled: false,
        });
      }
      for (const path of plan.filesByPath.keys()) {
        await rm(resolveWithin(plan.workspaceRoot, path), { force: true });
      }
    }
    delete state.packages[input.pluginId];
    if (manifestFromVersion(current).defaultEnabled && !state.suppressedDefaultPluginIds.includes(input.pluginId)) {
      state.suppressedDefaultPluginIds.push(input.pluginId);
    }
    await writeState(input.serverConfig, state);
  } catch (error) {
    await applyPackageTransition(input.serverConfig, installed.pluginId, null, installed);
    throw error;
  }
  await rm(join(stateDirectory(input.serverConfig), "artifacts", safeSegment(input.pluginId)), { recursive: true, force: true });
  return { status: "uninstalled", pluginId: input.pluginId, version: current.version };
}

export function installPluginPackage(input: Parameters<typeof installPluginPackageUnlocked>[0]) {
  return enqueueLifecycleMutation(input.serverConfig, () => installPluginPackageUnlocked(input));
}

export function updatePluginPackage(input: Parameters<typeof updatePluginPackageUnlocked>[0]) {
  return enqueueLifecycleMutation(input.serverConfig, () => updatePluginPackageUnlocked(input));
}

export function rollbackPluginPackage(input: Parameters<typeof rollbackPluginPackageUnlocked>[0]) {
  return enqueueLifecycleMutation(input.serverConfig, () => rollbackPluginPackageUnlocked(input));
}

export function setPluginPackageEnabled(input: Parameters<typeof setPluginPackageEnabledUnlocked>[0]) {
  return enqueueLifecycleMutation(input.serverConfig, () => setPluginPackageEnabledUnlocked(input));
}

export function setPluginPackageResourceEnabled(input: Parameters<typeof setPluginPackageResourceEnabledUnlocked>[0]) {
  return enqueueLifecycleMutation(input.serverConfig, () => setPluginPackageResourceEnabledUnlocked(input));
}

export function uninstallPluginPackage(input: Parameters<typeof uninstallPluginPackageUnlocked>[0]) {
  return enqueueLifecycleMutation(input.serverConfig, () => uninstallPluginPackageUnlocked(input));
}
