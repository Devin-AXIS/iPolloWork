import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import type { Dirent } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { z } from "zod";

import { ApiError } from "./errors.js";
import {
  parsePluginMcpEntries,
  pluginEngineAdapters,
  pluginEnginePortablePath,
  pluginEngineSourcePath,
  type PluginEngineAdapter,
  type PluginEngineVersion,
  type PluginWorkspaceFile,
} from "./plugin-engine-adapter.js";
import { parsePluginPackageManifest, type PluginPackageManifest, type PluginResource } from "./plugin-package-manifest.js";
import { runtimeStorageDir } from "./runtime-opencode-config-store.js";
import { DEFAULT_ENGINE_ID, type ServerConfig } from "./types.js";
import serverPackage from "../package.json" with { type: "json" };

const MANIFEST_FILE = "ipollowork.plugin.json";
const PACKAGE_SIGNATURE_PREFIX = "ipollowork-plugin-package-v1\0";
const CURRENT_RESOURCE_KEYS = [
  "type",
  "id",
  "label",
  "description",
  "command",
  "envKey",
  "packageName",
  "providerId",
  "mcpServerName",
  "oauth",
  "localCommandRef",
  "actions",
  "environment",
  "requires",
  "provides",
  "required",
  "ui",
] as const;
const TRUSTED_IMPORT_PUBLISHER_KEYS = new Map([
  [
    "smart-future-school/smart-future-school-2026",
    [
      "MCowBQYDK2VwAyEARwKWW0VeQqnxh1WiOi8+kAutSITD476eRaRguDZkxYk=",
      // Published v1 marketplace packages used this key before the portable package migration.
      "MCowBQYDK2VwAyEANqxN7w94IK3NWdYZWtoyz/Y6daP7MEqWnKrJHz+XAyI=",
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
const lifecycleStateV1Schema = z.object({
  schemaVersion: z.literal(1),
  packages: z.record(z.string(), installedPackageSchema),
});
const lifecycleStateV2Schema = z.object({
  schemaVersion: z.literal(2),
  packages: installedPackagesSchema,
});
const lifecycleStateSchema = z.object({
  schemaVersion: z.literal(3),
  packages: installedPackagesSchema,
  suppressedDefaultPluginIds: z.array(z.string()).default([]),
});
// Desktop installs created before portable package manifests remain user-owned data.
// Keep v1 readable until an explicit artifact migration can rewrite those records safely.
const persistedLifecycleStateSchema = z.discriminatedUnion("schemaVersion", [
  lifecycleStateV1Schema,
  lifecycleStateV2Schema,
  lifecycleStateSchema,
]);

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

function legacyStateDirectory(config: ServerConfig, workspaceId: string): string {
  return join(stateDirectory(config), safeSegment(workspaceId));
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

function assertRuntimeCompatibility(manifest: PluginPackageManifest, engineAdapter?: PluginEngineAdapter): void {
  const compatibility = manifest.package?.compatibility;
  const supportedEngines = manifest.package?.engines;
  if (engineAdapter && supportedEngines && !supportedEngines.includes(engineAdapter.id)) {
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
    const state = persistedLifecycleStateSchema.parse(JSON.parse(await readFile(statePath(config), "utf8")));
    return state.schemaVersion === 3
      ? state
      : { schemaVersion: 3, packages: state.packages, suppressedDefaultPluginIds: [] };
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

function migrateInstalledManifest(value: unknown, pluginId: string): { manifest: unknown; changed: boolean } {
  if (isRecord(value) && value.schemaVersion === 1) {
    compatibleManifest(value);
    return { manifest: value, changed: false };
  }
  if (!isRecord(value) || !isRecord(value.authorization) || !Array.isArray(value.authorization.methods)) {
    return { manifest: parsePluginPackageManifest(value), changed: false };
  }
  let changed = false;
  const methods = value.authorization.methods.map((method) => {
    if (!isRecord(method) || typeof method.connectionId === "string") return method;
    changed = true;
    return { ...method, connectionId: pluginId };
  });
  const manifest = changed
    ? { ...value, authorization: { ...value.authorization, methods } }
    : value;
  return { manifest: parsePluginPackageManifest(manifest), changed };
}

async function readStateAt(path: string): Promise<LifecycleState | null> {
  try {
    const state = persistedLifecycleStateSchema.parse(JSON.parse(await readFile(path, "utf8")));
    return state.schemaVersion === 3
      ? state
      : { schemaVersion: 3, packages: state.packages, suppressedDefaultPluginIds: [] };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function pickDefined(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.flatMap((key) => value[key] === undefined ? [] : [[key, value[key]]]));
}

function legacyPortablePath(type: unknown, path: string): string {
  const portablePath = pluginEnginePortablePath(path);
  if (portablePath !== path) return portablePath;
  if (type === "local-service" && !path.startsWith("service/")) return `service/${path}`;
  return path;
}

function compatibleManifest(value: unknown): PluginPackageManifest {
  try {
    return parsePluginPackageManifest(value);
  } catch (error) {
    const legacy = legacyManifestSummary(value);
    if (legacy) return legacy;
    throw error;
  }
}

async function copyArtifactDirectory(sourceRoot: string, destinationRoot: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === MANIFEST_FILE) continue;
    const source = join(sourceRoot, entry.name);
    const destination = join(destinationRoot, entry.name);
    if (entry.isDirectory()) {
      await copyArtifactDirectory(source, destination);
      continue;
    }
    if (!entry.isFile()) throw new ApiError(500, "plugin_package_state_invalid", `Unsupported artifact entry: ${source}`);
    if (await fileExists(destination)) {
      if (await sha256(source) !== await sha256(destination)) {
        throw new ApiError(409, "plugin_package_version_changed", `Immutable plugin artifact changed: ${destination}`);
      }
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

function installedAt(installed: InstalledPackage): number {
  return installed.versions[installed.currentVersion]?.installedAt ?? 0;
}

function mergeInstalledPackage(current: InstalledPackage | undefined, incoming: InstalledPackage): InstalledPackage {
  const versions = { ...current?.versions };
  for (const [versionKey, version] of Object.entries(incoming.versions)) {
    const existing = versions[versionKey];
    if (existing?.installedAt === version.installedAt
      && canonicalJson({ version: existing.version, manifest: existing.manifest, files: existing.files })
        !== canonicalJson({ version: version.version, manifest: version.manifest, files: version.files })) {
      throw new ApiError(409, "plugin_package_version_changed", `Immutable package version changed: ${incoming.pluginId}@${versionKey}`);
    }
    if (!existing || version.installedAt > existing.installedAt) versions[versionKey] = version;
  }
  const selected = !current || installedAt(incoming) > installedAt(current) ? incoming : current;
  return { ...selected, versions };
}

async function migratedPackage(
  config: ServerConfig,
  sourceRoot: string,
  installed: InstalledPackage,
): Promise<{ installed: InstalledPackage; changed: boolean }> {
  let changed = false;
  const versions: InstalledPackage["versions"] = {};
  for (const [versionKey, version] of Object.entries(installed.versions)) {
    const migrated = migrateInstalledManifest(version.manifest, installed.pluginId);
    const destination = artifactRoot(config, installed.pluginId, version.version);
    if (sourceRoot !== stateDirectory(config)) {
      await copyArtifactDirectory(
        join(sourceRoot, "artifacts", safeSegment(installed.pluginId), safeSegment(version.version)),
        destination,
      );
    }
    for (const file of version.files) {
      const artifact = resolveWithin(destination, file.path);
      if (!await fileExists(artifact) || await sha256(artifact) !== file.sha256) {
        throw new ApiError(500, "plugin_package_state_invalid", `Plugin artifact is missing or corrupted: ${installed.pluginId}@${version.version}/${file.path}`);
      }
    }
    changed ||= migrated.changed;
    if (sourceRoot !== stateDirectory(config) || migrated.changed) {
      await writeJsonAtomic(join(destination, MANIFEST_FILE), migrated.manifest);
    }
    versions[versionKey] = { ...version, manifest: migrated.manifest };
  }
  return { installed: { ...installed, versions }, changed };
}

export async function migratePluginPackageLifecycle(config: ServerConfig): Promise<number> {
  const inventoryRoot = stateDirectory(config);
  const globalState = await readStateAt(statePath(config));
  const legacyRoots = [...new Set(config.workspaces.map((workspace) => legacyStateDirectory(config, workspace.id)))];
  const legacySources = (await Promise.all(
    legacyRoots.map(async (root) => ({ root, state: await readStateAt(join(root, "state.json")) })),
  )).filter((entry): entry is { root: string; state: LifecycleState } => entry.state !== null);
  const sources = [
    ...(globalState ? [{ root: inventoryRoot, state: globalState }] : []),
    ...legacySources,
  ];
  if (sources.length === 0) return 0;

  const packages: LifecycleState["packages"] = {};
  const suppressedDefaultPluginIds = new Set<string>();
  let manifestChanged = false;
  for (const source of sources) {
    source.state.suppressedDefaultPluginIds.forEach((pluginId) => suppressedDefaultPluginIds.add(pluginId));
    for (const installed of Object.values(source.state.packages)) {
      const migrated = await migratedPackage(config, source.root, installed);
      manifestChanged ||= migrated.changed;
      packages[installed.pluginId] = mergeInstalledPackage(packages[installed.pluginId], migrated.installed);
    }
  }
  if (legacySources.length === 0 && !manifestChanged) return 0;
  for (const installed of Object.values(packages)) {
    for (const version of Object.values(installed.versions)) {
      await writeJsonAtomic(join(artifactRoot(config, installed.pluginId, version.version), MANIFEST_FILE), version.manifest);
    }
  }
  await writeState(config, lifecycleStateSchema.parse({
    schemaVersion: 3,
    packages,
    suppressedDefaultPluginIds: [...suppressedDefaultPluginIds].sort(),
  }));
  for (const source of legacySources) await rm(source.root, { recursive: true, force: true });
  return legacySources.length + (manifestChanged ? 1 : 0);
}

function legacyManifestSummary(value: unknown): PluginPackageManifest | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const source = isRecord(value.source) ? value.source : {};
  const packageMetadata = isRecord(value.package) ? value.package : null;
  const legacyCompatibility = packageMetadata && isRecord(packageMetadata.compatibility)
    ? packageMetadata.compatibility
    : null;
  const compatibility = packageMetadata && isRecord(packageMetadata.compatibility)
    ? pickDefined(packageMetadata.compatibility, ["ipollowork"])
    : null;
  const legacyEntrypoints = packageMetadata && isRecord(packageMetadata.entrypoints) ? packageMetadata.entrypoints : null;
  const legacyPluginResource = Array.isArray(value.resources)
    ? value.resources.find((resource) => isRecord(resource) && resource.type === "opencode-plugin" && typeof resource.path === "string")
    : null;
  const legacyPluginPath = typeof legacyEntrypoints?.opencode === "string"
    ? legacyEntrypoints.opencode
    : isRecord(legacyPluginResource) && typeof legacyPluginResource.path === "string"
      ? legacyPluginResource.path
      : null;
  const opencodeCompatibility = typeof legacyCompatibility?.opencode === "string" ? legacyCompatibility.opencode : undefined;
  const packageSummary = packageMetadata ? {
    ...pickDefined(packageMetadata, ["version", "publisher", "updateId", "checksum", "signature"]),
    ...(compatibility && Object.keys(compatibility).length > 0 ? { compatibility } : {}),
    ...(legacyPluginPath || opencodeCompatibility ? { engines: ["opencode"] } : {}),
  } : null;
  const engineBindings = legacyPluginPath || opencodeCompatibility ? [{
    engine: "opencode",
    ...(opencodeCompatibility ? { compatibility: opencodeCompatibility } : {}),
    capabilities: legacyPluginPath ? [{
      id: isRecord(legacyPluginResource) && typeof legacyPluginResource.id === "string" ? legacyPluginResource.id : "legacy-runtime",
      kind: "plugin",
      path: pluginEnginePortablePath(legacyPluginPath),
      required: isRecord(legacyPluginResource) ? legacyPluginResource.required === true : true,
    }] : [],
  }] : undefined;
  const resources = Array.isArray(value.resources) ? value.resources.flatMap((resource) => {
    if (!isRecord(resource) || resource.type === "opencode-plugin") return [];
    const summary = pickDefined(resource, CURRENT_RESOURCE_KEYS);
    if (typeof resource.path === "string") summary.path = legacyPortablePath(resource.type, resource.path);
    return [summary];
  }) : [];
  const composer = isRecord(value.composer) && typeof value.composer.prompt === "string"
    ? { prompt: value.composer.prompt }
    : undefined;
  const authorization = isRecord(value.authorization) && Array.isArray(value.authorization.methods) && typeof value.id === "string"
    ? {
        ...value.authorization,
        methods: value.authorization.methods.map((method) => isRecord(method) && typeof method.connectionId !== "string"
          ? { ...method, connectionId: value.id }
          : method),
      }
    : value.authorization;
  const sourceSummary = {
    format: typeof source.format === "string" ? source.format : "ipollowork-extension-manifest",
    trusted: source.trusted === true,
    ...pickDefined(source, ["origin", "reference"]),
  };
  const summary = {
    schemaVersion: 2,
    ...pickDefined(value, [
      "id",
      "name",
      "description",
      "category",
      "preview",
      "icon",
      "setup",
      "relatedSkills",
      "defaultEnabled",
      "defaultHidden",
      "platform",
      "localization",
      "permissions",
    ]),
    source: sourceSummary,
    resources,
    ...(composer ? { composer } : {}),
    ...(authorization ? { authorization } : {}),
    ...(engineBindings ? { engineBindings } : {}),
    ...(packageSummary ? { package: packageSummary } : {}),
  };
  try {
    return parsePluginPackageManifest(summary);
  } catch {
    return parsePluginPackageManifest({
      schemaVersion: 2,
      ...pickDefined(value, ["id", "name", "description", "category", "preview"]),
      source: sourceSummary,
      resources,
      ...(composer ? { composer } : {}),
      ...(authorization ? { authorization } : {}),
      ...(engineBindings ? { engineBindings } : {}),
      ...(packageSummary ? { package: packageSummary } : {}),
    });
  }
}

function manifestFromVersion(version: InstalledVersion): PluginPackageManifest {
  return compatibleManifest(version.manifest);
}

function sourceResourcePaths(sourceManifest: unknown, manifest: PluginPackageManifest): string[] {
  if (!isRecord(sourceManifest) || sourceManifest.schemaVersion !== 1) {
    return [
      ...manifest.resources.flatMap((resource) => resource.path ? [resource.path] : []),
      ...manifest.engineBindings?.flatMap((binding) => binding.capabilities.flatMap((capability) => capability.path ? [capability.path] : [])) ?? [],
    ];
  }
  const resourcePaths = Array.isArray(sourceManifest.resources)
    ? sourceManifest.resources.flatMap((resource) => isRecord(resource) && typeof resource.path === "string" ? [resource.path] : [])
    : [];
  const packageMetadata = isRecord(sourceManifest.package) ? sourceManifest.package : null;
  const entrypoints = packageMetadata && isRecord(packageMetadata.entrypoints) ? packageMetadata.entrypoints : null;
  return [
    ...resourcePaths,
    ...entrypoints ? Object.values(entrypoints).flatMap((path) => typeof path === "string" ? [path] : []) : [],
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
  const engineAdapter = workspaceEngineAdapter(config, workspaceId);
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

export async function previewPluginPackage(input: { packageRoot: string; workspaceRoot: string; engineId?: string }): Promise<PluginPackagePreview> {
  const manifestPath = resolveWithin(input.packageRoot, MANIFEST_FILE);
  let sourceManifest: unknown;
  let manifest: PluginPackageManifest;
  try {
    sourceManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest = compatibleManifest(sourceManifest);
  } catch (error) {
    if (errorCode(error) === "ENOENT") throw new ApiError(400, "plugin_package_manifest_missing", `${MANIFEST_FILE} is required`);
    throw error;
  }
  if (!manifest.package) throw new ApiError(400, "plugin_package_metadata_required", "Package metadata is required for installation");
  const engineAdapter = input.engineId ? pluginEngineAdapters.get(input.engineId) : undefined;
  assertRuntimeCompatibility(manifest, engineAdapter);
  const resourcePaths = [...new Set(sourceResourcePaths(sourceManifest, manifest))];
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

async function reconcilePackageProjection(
  config: ServerConfig,
  workspaceId: string,
  workspaceRoot: string,
  installed: InstalledPackage,
): Promise<void> {
  const current = installed.versions[installed.currentVersion];
  if (!current) throw new ApiError(500, "plugin_package_state_invalid", `Missing current version for ${installed.pluginId}`);
  const adapter = workspaceEngineAdapter(config, workspaceId);
  const manifest = manifestFromVersion(current);
  if (manifest.package?.engines && !manifest.package.engines.includes(adapter.id)) return;

  const currentFiles = workspaceActivationFiles(config, workspaceId, installed.pluginId, current);
  const currentByPath = new Map(currentFiles.map((file) => [file.targetPath, file]));
  for (const version of Object.values(installed.versions)) {
    if (version.version === current.version) continue;
    for (const file of workspaceActivationFiles(config, workspaceId, installed.pluginId, version)) {
      const replacement = currentByPath.get(file.targetPath);
      if (replacement?.sha256 === file.sha256) continue;
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

  const inactivePaths = inactiveActivationPaths(config, workspaceId, installed, current);
  const conflicts: string[] = [];
  for (const file of currentFiles) {
    const target = resolveWithin(workspaceRoot, file.targetPath);
    const status = await activationTargetStatus(target, file.sha256);
    if (inactivePaths.has(file.targetPath)) {
      if (status === "matching") await rm(target, { force: true });
      else if (status === "conflict") conflicts.push(file.targetPath);
      continue;
    }
    if (status === "conflict") {
      conflicts.push(file.targetPath);
      continue;
    }
    if (status === "missing") {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolveWithin(artifactRoot(config, installed.pluginId, current.version), file.sourcePath), target);
    }
  }
  if (conflicts.length > 0) {
    throw new ApiError(409, "plugin_package_conflict", "Plugin-owned files conflict with the installed package", { paths: conflicts });
  }
  const currentEngineVersion = engineVersion(config, workspaceId, installed.pluginId, current);
  await adapter.syncRuntime({
    config,
    workspaceId,
    resolvePath: resolveWithin,
    current: currentEngineVersion,
    next: currentEngineVersion,
    enabled: installed.enabled,
  });
}

export async function reconcilePluginPackagesForWorkspace(input: {
  serverConfig: ServerConfig;
  workspaceId: string;
  workspaceRoot: string;
}): Promise<void> {
  const state = await readState(input.serverConfig);
  for (const installed of Object.values(state.packages)) {
    await reconcilePackageProjection(input.serverConfig, input.workspaceId, input.workspaceRoot, installed);
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

export async function installPluginPackage(input: {
  serverConfig: ServerConfig;
  workspaceId: string;
  packageRoot: string;
  workspaceRoot: string;
}): Promise<PluginPackageInstallResult> {
  const preview = await previewPluginPackage({
    packageRoot: input.packageRoot,
    workspaceRoot: input.workspaceRoot,
    engineId: workspaceEngineAdapter(input.serverConfig, input.workspaceId).id,
  });
  if (!preview.manifest.package) throw new ApiError(400, "plugin_package_metadata_required", "Package metadata is required for installation");
  const state = await readState(input.serverConfig);
  const existing = state.packages[preview.manifest.id];
  if (existing) {
    if (existing.currentVersion !== preview.manifest.package.version) {
      throw new ApiError(409, "plugin_package_update_required", "Use the update operation to install a different version");
    }
    const current = existing.versions[existing.currentVersion];
    if (!current) throw new ApiError(500, "plugin_package_state_invalid", "Installed package version is missing");
    await reconcilePackageProjection(
      input.serverConfig,
      input.workspaceId,
      input.workspaceRoot,
      existing,
    );
    if (state.suppressedDefaultPluginIds.includes(existing.pluginId)) {
      state.suppressedDefaultPluginIds = state.suppressedDefaultPluginIds.filter((pluginId) => pluginId !== existing.pluginId);
      await writeState(input.serverConfig, state);
    }
    return { status: "unchanged", pluginId: existing.pluginId, version: existing.currentVersion };
  }
  const version = await snapshotPackage(input.serverConfig, input.packageRoot, preview);
  await applyVersion(input.serverConfig, input.workspaceId, input.workspaceRoot, preview.manifest.id, version, null);
  state.packages[preview.manifest.id] = {
    pluginId: preview.manifest.id,
    enabled: true,
    disabledResourceIds: [],
    currentVersion: version.version,
    previousVersion: null,
    versions: { [version.version]: version },
  };
  state.suppressedDefaultPluginIds = state.suppressedDefaultPluginIds.filter((pluginId) => pluginId !== preview.manifest.id);
  await writeState(input.serverConfig, state);
  return { status: "installed", pluginId: preview.manifest.id, version: version.version };
}

export async function updatePluginPackage(input: {
  serverConfig: ServerConfig;
  workspaceId: string;
  packageRoot: string;
  workspaceRoot: string;
}): Promise<PluginPackageUpdateResult> {
  const preview = await previewPluginPackage({
    packageRoot: input.packageRoot,
    workspaceRoot: input.workspaceRoot,
    engineId: workspaceEngineAdapter(input.serverConfig, input.workspaceId).id,
  });
  if (!preview.manifest.package) throw new ApiError(400, "plugin_package_metadata_required", "Package metadata is required for installation");
  const state = await readState(input.serverConfig);
  const installed = state.packages[preview.manifest.id];
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  const current = installed.versions[installed.currentVersion];
  if (!current) throw new ApiError(500, "plugin_package_state_invalid", "Installed package version is missing");
  if (installed.currentVersion === preview.manifest.package.version) {
    await reconcilePackageProjection(
      input.serverConfig,
      input.workspaceId,
      input.workspaceRoot,
      installed,
    );
    return { status: "unchanged", pluginId: installed.pluginId, version: installed.currentVersion };
  }
  const next = await snapshotPackage(input.serverConfig, input.packageRoot, preview);
  await applyVersion(input.serverConfig, input.workspaceId, input.workspaceRoot, installed.pluginId, next, current, installed);
  installed.disabledResourceIds = installed.disabledResourceIds.filter((resourceId) =>
    preview.manifest.resources.some((resource) => resource.type === "skill" && resource.id === resourceId)
  );
  const previousVersion = installed.currentVersion;
  installed.versions[next.version] = next;
  installed.currentVersion = next.version;
  installed.previousVersion = previousVersion;
  state.suppressedDefaultPluginIds = state.suppressedDefaultPluginIds.filter((pluginId) => pluginId !== installed.pluginId);
  await writeState(input.serverConfig, state);
  return { status: "updated", pluginId: installed.pluginId, previousVersion, version: next.version };
}

export async function rollbackPluginPackage(input: {
  serverConfig: ServerConfig;
  workspaceId: string;
  pluginId: string;
  workspaceRoot: string;
}): Promise<PluginPackageRollbackResult> {
  const state = await readState(input.serverConfig);
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
  await writeState(input.serverConfig, state);
  return { status: "rolled_back", pluginId: installed.pluginId, previousVersion, version: previous.version };
}

export async function setPluginPackageEnabled(input: {
  serverConfig: ServerConfig;
  workspaceId: string;
  pluginId: string;
  workspaceRoot: string;
  enabled: boolean;
}) {
  const state = await readState(input.serverConfig);
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
  const engineAdapter = workspaceEngineAdapter(input.serverConfig, input.workspaceId);
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
  await engineAdapter.syncRuntime({
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
  await writeState(input.serverConfig, state);
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
      resolveWithin(artifactRoot(input.serverConfig, installed.pluginId, current.version), projected.sourcePath),
      target,
    );
  } else if (installed.enabled) {
    await rm(resolveWithin(input.workspaceRoot, activationPath), { force: true });
  }
  installed.disabledResourceIds = input.enabled
    ? installed.disabledResourceIds.filter((resourceId) => resourceId !== input.resourceId)
    : [...installed.disabledResourceIds, input.resourceId];
  await writeState(input.serverConfig, state);
  return { pluginId: installed.pluginId, resourceId: input.resourceId, enabled: input.enabled, changed: true };
}

export async function uninstallPluginPackage(input: {
  serverConfig: ServerConfig;
  pluginId: string;
}): Promise<PluginPackageUninstallResult> {
  const state = await readState(input.serverConfig);
  const installed = state.packages[input.pluginId];
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  const current = installed.versions[installed.currentVersion];
  if (!current) throw new ApiError(500, "plugin_package_state_invalid", "Installed package version is missing");
  for (const workspace of input.serverConfig.workspaces.filter((entry) => entry.workspaceType === "local")) {
    const adapter = workspaceEngineAdapter(input.serverConfig, workspace.id);
    const filesByPath = new Map<string, Set<string>>();
    const versions = Object.values(installed.versions).filter((version) => {
      const engines = manifestFromVersion(version).package?.engines;
      return !engines || engines.includes(adapter.id);
    });
    for (const version of versions) {
      for (const file of workspaceActivationFiles(input.serverConfig, workspace.id, installed.pluginId, version)) {
        const hashes = filesByPath.get(file.targetPath) ?? new Set<string>();
        hashes.add(file.sha256);
        filesByPath.set(file.targetPath, hashes);
      }
    }
    const conflicts: string[] = [];
    for (const [path, hashes] of filesByPath) {
      const target = resolveWithin(workspace.path, path);
      if (!await fileExists(target)) continue;
      if (!hashes.has(await sha256(target))) conflicts.push(path);
    }
    if (conflicts.length > 0) {
      throw new ApiError(409, "plugin_package_conflict", "Plugin-owned files were modified outside the package manager", {
        workspaceId: workspace.id,
        paths: conflicts,
      });
    }
    for (const version of versions) {
      await adapter.syncRuntime({
        config: input.serverConfig,
        workspaceId: workspace.id,
        resolvePath: resolveWithin,
        current: engineVersion(input.serverConfig, workspace.id, installed.pluginId, version),
        next: null,
        enabled: true,
      });
    }
    for (const path of filesByPath.keys()) await rm(resolveWithin(workspace.path, path), { force: true });
  }
  delete state.packages[input.pluginId];
  if (manifestFromVersion(current).defaultEnabled && !state.suppressedDefaultPluginIds.includes(input.pluginId)) {
    state.suppressedDefaultPluginIds.push(input.pluginId);
  }
  await writeState(input.serverConfig, state);
  await rm(join(stateDirectory(input.serverConfig), "artifacts", safeSegment(input.pluginId)), { recursive: true, force: true });
  return { status: "uninstalled", pluginId: input.pluginId, version: current.version };
}
