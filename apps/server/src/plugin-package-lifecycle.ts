import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { z } from "zod";

import { ApiError } from "./errors.js";
import { addMcp, removeMcp } from "./mcp.js";
import { addPlugin, removePlugin } from "./plugins.js";
import { parsePluginPackageManifest, type PluginPackageManifest } from "./plugin-package-manifest.js";
import { runtimeStorageDir } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";
import serverPackage from "../package.json" with { type: "json" };
import constants from "../../../constants.json" with { type: "json" };

const MANIFEST_FILE = "ipollowork.plugin.json";

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
  currentVersion: z.string(),
  previousVersion: z.string().nullable(),
  versions: z.record(z.string(), installedVersionSchema),
});
const lifecycleStateSchema = z.object({
  schemaVersion: z.literal(1),
  packages: z.record(z.string(), installedPackageSchema),
});

type OwnedFile = z.infer<typeof ownedFileSchema>;
type InstalledVersion = z.infer<typeof installedVersionSchema>;
type InstalledPackage = z.infer<typeof installedPackageSchema>;
type LifecycleState = z.infer<typeof lifecycleStateSchema>;

export type PluginPackagePreview = {
  manifest: PluginPackageManifest;
  writes: OwnedFile[];
  integrity: { sha256: string; status: "verified" | "unsigned" };
};

export type InstalledPluginPackageSummary = {
  pluginId: string;
  name: string;
  version: string;
  enabled: boolean;
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
  return { schemaVersion: 1, packages: {} };
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

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function packageSha256(manifest: PluginPackageManifest, files: OwnedFile[]): string {
  const hash = createHash("sha256");
  const packageMetadata = manifest.package;
  const checksumFreeManifest = packageMetadata
    ? { ...manifest, package: { ...packageMetadata, checksum: undefined } }
    : manifest;
  hash.update(MANIFEST_FILE);
  hash.update("\0");
  hash.update(createHash("sha256").update(canonicalJson(checksumFreeManifest)).digest("hex"));
  hash.update("\n");
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
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
  const checks = [
    { name: "iPolloWork", version: serverPackage.version, range: compatibility?.ipollowork },
    { name: "OpenCode", version: constants.opencodeVersion, range: compatibility?.opencode },
  ];
  for (const check of checks) {
    if (check.range && !satisfiesRange(check.version, check.range)) {
      throw new ApiError(409, "plugin_package_incompatible", `${check.name} ${check.version} does not satisfy ${check.range}`, check);
    }
  }
}

function integrityForManifest(manifest: PluginPackageManifest, files: OwnedFile[]): PluginPackagePreview["integrity"] {
  const digest = packageSha256(manifest, files);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function mcpEntriesForVersion(
  config: ServerConfig,
  workspaceId: string,
  pluginId: string,
  version: InstalledVersion,
): Promise<Array<{ name: string; config: Record<string, unknown> }>> {
  const manifest = manifestFromVersion(version);
  const root = artifactRoot(config, workspaceId, pluginId, version.version);
  const entries: Array<{ name: string; config: Record<string, unknown> }> = [];
  for (const resource of manifest.resources) {
    if (resource.type !== "mcp" || !resource.path) continue;
    const payload: unknown = JSON.parse(await readFile(resolveWithin(root, resource.path), "utf8"));
    if (!isRecord(payload)) throw new ApiError(400, "plugin_package_mcp_invalid", `MCP resource must contain a JSON object: ${resource.path}`);
    const nested = isRecord(payload.mcpServers) ? payload.mcpServers : isRecord(payload.mcp) ? payload.mcp : null;
    if (nested) {
      for (const [name, value] of Object.entries(nested)) {
        if (!isRecord(value)) throw new ApiError(400, "plugin_package_mcp_invalid", `MCP config must be an object: ${name}`);
        entries.push({ name, config: value });
      }
    } else {
      entries.push({ name: resource.mcpServerName ?? resource.id, config: payload });
    }
  }
  return entries;
}

function opencodeSpec(workspaceRoot: string, manifest: PluginPackageManifest): string | null {
  const path = manifest.package?.entrypoints.opencode;
  return path ? `file://${resolveWithin(workspaceRoot, path)}` : null;
}

async function assertOwnedFilesUnchanged(workspaceRoot: string, version: InstalledVersion): Promise<void> {
  const conflicts: string[] = [];
  for (const file of version.files) {
    const target = resolveWithin(workspaceRoot, file.path);
    if (!(await fileExists(target)) || await sha256(target) !== file.sha256) conflicts.push(file.path);
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
  for (const file of preview.writes) {
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
  await writeFile(join(destinationRoot, MANIFEST_FILE), `${JSON.stringify(preview.manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return {
    version: preview.manifest.package.version,
    manifest: preview.manifest,
    files: preview.writes,
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
): Promise<void> {
  if (current) await assertOwnedFilesUnchanged(workspaceRoot, current);
  const currentPaths = new Set(current?.files.map((file) => file.path) ?? []);
  const nextPaths = new Set(next.files.map((file) => file.path));
  for (const file of next.files) {
    const target = resolveWithin(workspaceRoot, file.path);
    if (!currentPaths.has(file.path) && await fileExists(target)) {
      throw new ApiError(409, "plugin_package_conflict", `Install target already exists: ${file.path}`, { paths: [file.path] });
    }
  }

  const nextManifest = manifestFromVersion(next);
  const currentManifest = current ? manifestFromVersion(current) : null;
  const nextArtifactRoot = artifactRoot(config, workspaceId, pluginId, next.version);
  const nextMcpEntries = await mcpEntriesForVersion(config, workspaceId, pluginId, next);
  const currentMcpEntries = current ? await mcpEntriesForVersion(config, workspaceId, pluginId, current) : [];
  const nextMcpNames = new Set(nextMcpEntries.map((entry) => entry.name));
  try {
    for (const file of next.files) {
      const source = resolveWithin(nextArtifactRoot, file.path);
      const target = resolveWithin(workspaceRoot, file.path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }
    for (const file of current?.files ?? []) {
      if (!nextPaths.has(file.path)) await rm(resolveWithin(workspaceRoot, file.path), { force: true });
    }

    const currentSpec = currentManifest ? opencodeSpec(workspaceRoot, currentManifest) : null;
    const nextSpec = opencodeSpec(workspaceRoot, nextManifest);
    if (currentSpec && currentSpec !== nextSpec) await removePlugin(config, workspaceId, currentSpec);
    if (nextSpec) await addPlugin(config, workspaceId, nextSpec);
    for (const entry of currentMcpEntries) {
      if (!nextMcpNames.has(entry.name)) await removeMcp(config, workspaceId, entry.name);
    }
    for (const entry of nextMcpEntries) await addMcp(config, workspaceId, entry.name, entry.config);
  } catch (error) {
    if (current) {
      const currentArtifactRoot = artifactRoot(config, workspaceId, pluginId, current.version);
      for (const file of current.files) {
        const source = resolveWithin(currentArtifactRoot, file.path);
        const target = resolveWithin(workspaceRoot, file.path);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
      }
      for (const file of next.files) {
        if (!currentPaths.has(file.path)) await rm(resolveWithin(workspaceRoot, file.path), { force: true });
      }
      for (const entry of nextMcpEntries) {
        if (!currentMcpEntries.some((currentEntry) => currentEntry.name === entry.name)) await removeMcp(config, workspaceId, entry.name);
      }
      for (const entry of currentMcpEntries) await addMcp(config, workspaceId, entry.name, entry.config);
    }
    throw error;
  }
}

export async function previewPluginPackage(input: { packageRoot: string; workspaceRoot: string }): Promise<PluginPackagePreview> {
  const manifestPath = resolveWithin(input.packageRoot, MANIFEST_FILE);
  let manifest: PluginPackageManifest;
  try {
    manifest = parsePluginPackageManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  } catch (error) {
    if (errorCode(error) === "ENOENT") throw new ApiError(400, "plugin_package_manifest_missing", `${MANIFEST_FILE} is required`);
    throw error;
  }
  if (!manifest.package) throw new ApiError(400, "plugin_package_metadata_required", "Package metadata is required for installation");
  assertRuntimeCompatibility(manifest);
  const paths = [...new Set(manifest.resources.flatMap((resource) => resource.path ? [resource.path] : []))];
  const writes: OwnedFile[] = [];
  for (const path of paths) {
    const source = resolveWithin(input.packageRoot, path);
    if (!(await fileExists(source))) throw new ApiError(400, "plugin_package_resource_missing", `Package resource is missing: ${path}`);
    writes.push({ path, sha256: await sha256(source) });
  }
  return { manifest, writes, integrity: integrityForManifest(manifest, writes) };
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
      previousVersion: installed.previousVersion,
      manifest,
      integrity: integrityForManifest(manifest, version.files),
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
  const servicePath = manifest.package?.entrypoints.service;
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
    await assertOwnedFilesUnchanged(input.workspaceRoot, current);
    return { status: "unchanged", pluginId: existing.pluginId, version: existing.currentVersion };
  }
  const version = await snapshotPackage(input.serverConfig, input.workspaceId, input.packageRoot, preview);
  await applyVersion(input.serverConfig, input.workspaceId, input.workspaceRoot, preview.manifest.id, version, null);
  state.packages[preview.manifest.id] = {
    pluginId: preview.manifest.id,
    enabled: true,
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
    await assertOwnedFilesUnchanged(input.workspaceRoot, current);
    return { status: "unchanged", pluginId: installed.pluginId, version: installed.currentVersion };
  }
  const next = await snapshotPackage(input.serverConfig, input.workspaceId, input.packageRoot, preview);
  await applyVersion(input.serverConfig, input.workspaceId, input.workspaceRoot, installed.pluginId, next, current);
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
  await applyVersion(input.serverConfig, input.workspaceId, input.workspaceRoot, installed.pluginId, previous, current);
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
  const spec = opencodeSpec(input.workspaceRoot, manifestFromVersion(current));
  if (spec) {
    if (input.enabled) await addPlugin(input.serverConfig, input.workspaceId, spec);
    else await removePlugin(input.serverConfig, input.workspaceId, spec);
  }
  const mcpEntries = await mcpEntriesForVersion(input.serverConfig, input.workspaceId, installed.pluginId, current);
  for (const entry of mcpEntries) {
    if (input.enabled) await addMcp(input.serverConfig, input.workspaceId, entry.name, entry.config);
    else await removeMcp(input.serverConfig, input.workspaceId, entry.name);
  }
  installed.enabled = input.enabled;
  await writeState(input.serverConfig, input.workspaceId, state);
  return { pluginId: installed.pluginId, enabled: installed.enabled, changed: true };
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
  await assertOwnedFilesUnchanged(input.workspaceRoot, current);
  const manifest = manifestFromVersion(current);
  const spec = opencodeSpec(input.workspaceRoot, manifest);
  if (spec) await removePlugin(input.serverConfig, input.workspaceId, spec);
  for (const entry of await mcpEntriesForVersion(input.serverConfig, input.workspaceId, installed.pluginId, current)) {
    await removeMcp(input.serverConfig, input.workspaceId, entry.name);
  }
  for (const file of current.files) await rm(resolveWithin(input.workspaceRoot, file.path), { force: true });
  delete state.packages[input.pluginId];
  await writeState(input.serverConfig, input.workspaceId, state);
  await rm(join(stateDirectory(input.serverConfig, input.workspaceId), "artifacts", safeSegment(input.pluginId)), { recursive: true, force: true });
  return { status: "uninstalled", pluginId: input.pluginId, version: current.version };
}
