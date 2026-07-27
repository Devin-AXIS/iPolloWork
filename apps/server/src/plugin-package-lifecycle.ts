import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
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
  disabledResourceIds: z.array(z.string()).default([]),
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
  files: OwnedFile[];
  writes: OwnedFile[];
  integrity: { sha256: string; status: "verified" | "unsigned" };
};

export type PluginPackageImportSafety = {
  level: "declarative";
  localCode: false;
  allowedResourceTypes: Array<"skill" | "agent" | "command" | "file" | "mcp">;
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
    entries.push(...mcpEntriesFromPayload(payload, resource.mcpServerName ?? resource.id, resource.path));
  }
  return entries;
}

function mcpEntriesFromPayload(
  payload: unknown,
  fallbackName: string,
  sourcePath: string,
): Array<{ name: string; config: Record<string, unknown> }> {
  if (!isRecord(payload)) {
    throw new ApiError(400, "plugin_package_mcp_invalid", `MCP resource must contain a JSON object: ${sourcePath}`);
  }
  const nested = isRecord(payload.mcpServers) ? payload.mcpServers : isRecord(payload.mcp) ? payload.mcp : null;
  if (!nested) return [{ name: fallbackName, config: payload }];
  return Object.entries(nested).map(([name, value]) => {
    if (!isRecord(value)) throw new ApiError(400, "plugin_package_mcp_invalid", `MCP config must be an object: ${name}`);
    return { name, config: value };
  });
}

function opencodeSpecForVersion(
  config: ServerConfig,
  workspaceId: string,
  pluginId: string,
  version: InstalledVersion,
): string | null {
  const path = manifestFromVersion(version).package?.entrypoints.opencode;
  return path ? pathToFileURL(resolveWithin(artifactRoot(config, workspaceId, pluginId, version.version), path)).href : null;
}

const WORKSPACE_ACTIVATION_PREFIXES = [".opencode/skills/", ".opencode/agents/", ".opencode/commands/"];

function workspaceActivationFiles(version: InstalledVersion): OwnedFile[] {
  return version.files.filter((file) => WORKSPACE_ACTIVATION_PREFIXES.some((prefix) => file.path.startsWith(prefix)));
}

function workspaceActivationPaths(version: InstalledVersion): Set<string> {
  return new Set(workspaceActivationFiles(version).map((file) => file.path));
}

function skillActivationPaths(version: InstalledVersion, resourceIds?: ReadonlySet<string>): Set<string> {
  const ownedPaths = new Set(version.files.map((file) => file.path));
  return new Set(manifestFromVersion(version).resources.flatMap((resource) => {
    if (resource.type !== "skill" || !resource.path || (resourceIds && !resourceIds.has(resource.id))) return [];
    if (ownedPaths.has(resource.path) && (resource.path === "SKILL.md" || resource.path.endsWith("/SKILL.md"))) return [resource.path];
    const nestedPath = `${resource.path.replace(/\/$/, "")}/SKILL.md`;
    return ownedPaths.has(nestedPath) ? [nestedPath] : [];
  }));
}

function inactiveActivationPaths(installed: InstalledPackage, version: InstalledVersion): Set<string> {
  if (!installed.enabled) return workspaceActivationPaths(version);
  return skillActivationPaths(version, new Set(installed.disabledResourceIds));
}

async function assertOwnedFilesUnchanged(
  workspaceRoot: string,
  version: InstalledVersion,
  expectedMissing = new Set<string>(),
): Promise<void> {
  const conflicts: string[] = [];
  for (const file of workspaceActivationFiles(version)) {
    const target = resolveWithin(workspaceRoot, file.path);
    const exists = await fileExists(target);
    if (expectedMissing.has(file.path)) {
      if (exists) conflicts.push(file.path);
    } else if (!exists || await sha256(target) !== file.sha256) {
      conflicts.push(file.path);
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
  await writeFile(join(destinationRoot, MANIFEST_FILE), `${JSON.stringify(preview.manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return {
    version: preview.manifest.package.version,
    manifest: preview.manifest,
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
  const currentInactivePaths = current && installed ? inactiveActivationPaths(installed, current) : new Set<string>();
  const nextInactivePaths = installed ? inactiveActivationPaths(installed, next) : new Set<string>();
  if (current) await assertOwnedFilesUnchanged(workspaceRoot, current, currentInactivePaths);
  const currentActivationFiles = current ? workspaceActivationFiles(current) : [];
  const nextActivationFiles = workspaceActivationFiles(next);
  const currentPaths = new Set(currentActivationFiles.map((file) => file.path));
  const nextPaths = new Set(nextActivationFiles.map((file) => file.path));
  for (const file of nextActivationFiles) {
    const target = resolveWithin(workspaceRoot, file.path);
    if (!currentPaths.has(file.path) && await fileExists(target)) {
      throw new ApiError(409, "plugin_package_conflict", `Install target already exists: ${file.path}`, { paths: [file.path] });
    }
  }

  const nextArtifactRoot = artifactRoot(config, workspaceId, pluginId, next.version);
  const nextMcpEntries = await mcpEntriesForVersion(config, workspaceId, pluginId, next);
  const currentMcpEntries = current ? await mcpEntriesForVersion(config, workspaceId, pluginId, current) : [];
  const nextMcpNames = new Set(nextMcpEntries.map((entry) => entry.name));
  try {
    for (const file of nextActivationFiles) {
      const source = resolveWithin(nextArtifactRoot, file.path);
      const target = resolveWithin(workspaceRoot, file.path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }
    for (const path of nextInactivePaths) await rm(resolveWithin(workspaceRoot, path), { force: true });
    for (const file of currentActivationFiles) {
      if (!nextPaths.has(file.path)) await rm(resolveWithin(workspaceRoot, file.path), { force: true });
    }

    const currentSpec = current ? opencodeSpecForVersion(config, workspaceId, pluginId, current) : null;
    const nextSpec = opencodeSpecForVersion(config, workspaceId, pluginId, next);
    if (currentSpec && (currentSpec !== nextSpec || installed?.enabled === false)) await removePlugin(config, workspaceId, currentSpec);
    if (nextSpec && installed?.enabled !== false) await addPlugin(config, workspaceId, nextSpec);
    for (const entry of currentMcpEntries) {
      if (installed?.enabled === false || !nextMcpNames.has(entry.name)) await removeMcp(config, workspaceId, entry.name);
    }
    if (installed?.enabled !== false) {
      for (const entry of nextMcpEntries) await addMcp(config, workspaceId, entry.name, entry.config);
    }
  } catch (error) {
    if (current) {
      const currentArtifactRoot = artifactRoot(config, workspaceId, pluginId, current.version);
      for (const file of currentActivationFiles) {
        const source = resolveWithin(currentArtifactRoot, file.path);
        const target = resolveWithin(workspaceRoot, file.path);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
      }
      for (const path of currentInactivePaths) await rm(resolveWithin(workspaceRoot, path), { force: true });
      for (const file of nextActivationFiles) {
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
  const resourcePaths = [...new Set(manifest.resources.flatMap((resource) => resource.path ? [resource.path] : []))];
  const paths = new Set<string>();
  for (const resourcePath of resourcePaths) {
    for (const path of await packageResourceFiles(input.packageRoot, resourcePath)) paths.add(path);
  }
  const files: OwnedFile[] = [];
  for (const path of [...paths].sort()) files.push({ path, sha256: await sha256(resolveWithin(input.packageRoot, path)) });
  const writes = files.filter((file) => WORKSPACE_ACTIVATION_PREFIXES.some((prefix) => file.path.startsWith(prefix)));
  return { manifest, files, writes, integrity: integrityForManifest(manifest, files) };
}

const SAFE_IMPORT_RESOURCE_TYPES = new Set(["skill", "agent", "command", "file", "mcp"]);

function safeImportResourcePath(type: string, path: string): boolean {
  if (type === "skill") return path.startsWith(".opencode/skills/");
  if (type === "agent") return path.startsWith(".opencode/agents/");
  if (type === "command") return path.startsWith(".opencode/commands/");
  if (type === "mcp") return path.startsWith(".opencode/mcps/") && path.endsWith(".json");
  return type === "file" && WORKSPACE_ACTIVATION_PREFIXES.some((prefix) => path.startsWith(prefix));
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
  if (manifest.package?.entrypoints.opencode || manifest.package?.entrypoints.service) {
    reasons.push("Imported packages cannot include executable entrypoints");
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
      reasons.push(`Resource ${resource.id} must stay inside its .opencode activation directory`);
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
    const entries = mcpEntriesFromPayload(payload, resource.mcpServerName ?? resource.id, resource.path);
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
    await assertOwnedFilesUnchanged(input.workspaceRoot, current, inactiveActivationPaths(existing, current));
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
    await assertOwnedFilesUnchanged(input.workspaceRoot, current, inactiveActivationPaths(installed, current));
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
  await assertOwnedFilesUnchanged(input.workspaceRoot, current, inactiveActivationPaths(installed, current));
  const allActivationPaths = workspaceActivationPaths(current);
  const disabledSkillPaths = skillActivationPaths(current, new Set(installed.disabledResourceIds));
  const currentArtifactRoot = artifactRoot(input.serverConfig, input.workspaceId, installed.pluginId, current.version);
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
  const spec = opencodeSpecForVersion(input.serverConfig, input.workspaceId, installed.pluginId, current);
  if (spec) {
    if (input.enabled) await addPlugin(input.serverConfig, input.workspaceId, spec);
    else await removePlugin(input.serverConfig, input.workspaceId, spec);
  }
  const mcpEntries = await mcpEntriesForVersion(input.serverConfig, input.workspaceId, installed.pluginId, current);
  for (const entry of mcpEntries) {
    if (input.enabled) await addMcp(input.serverConfig, input.workspaceId, entry.name, entry.config);
    else await removeMcp(input.serverConfig, input.workspaceId, entry.name);
  }
  if (input.enabled) {
    for (const path of activationPathsToRestore) {
      const target = resolveWithin(input.workspaceRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolveWithin(currentArtifactRoot, path), target);
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
  const activationPath = [...skillActivationPaths(current, new Set([input.resourceId]))][0];
  if (!activationPath) throw new ApiError(409, "plugin_package_skill_invalid", "Plugin skill does not contain a SKILL.md activation file");
  const currentlyEnabled = !installed.disabledResourceIds.includes(input.resourceId);
  if (currentlyEnabled === input.enabled) {
    return { pluginId: installed.pluginId, resourceId: input.resourceId, enabled: currentlyEnabled, changed: false };
  }

  await assertOwnedFilesUnchanged(input.workspaceRoot, current, inactiveActivationPaths(installed, current));
  if (installed.enabled && input.enabled) {
    const target = resolveWithin(input.workspaceRoot, activationPath);
    if (await fileExists(target)) {
      throw new ApiError(409, "plugin_package_conflict", `Install target already exists: ${activationPath}`, { paths: [activationPath] });
    }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(
      resolveWithin(artifactRoot(input.serverConfig, input.workspaceId, installed.pluginId, current.version), activationPath),
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
  await assertOwnedFilesUnchanged(input.workspaceRoot, current, inactiveActivationPaths(installed, current));
  const spec = opencodeSpecForVersion(input.serverConfig, input.workspaceId, installed.pluginId, current);
  if (spec) await removePlugin(input.serverConfig, input.workspaceId, spec);
  for (const entry of await mcpEntriesForVersion(input.serverConfig, input.workspaceId, installed.pluginId, current)) {
    await removeMcp(input.serverConfig, input.workspaceId, entry.name);
  }
  for (const file of workspaceActivationFiles(current)) await rm(resolveWithin(input.workspaceRoot, file.path), { force: true });
  delete state.packages[input.pluginId];
  await writeState(input.serverConfig, input.workspaceId, state);
  await rm(join(stateDirectory(input.serverConfig, input.workspaceId), "artifacts", safeSegment(input.pluginId)), { recursive: true, force: true });
  return { status: "uninstalled", pluginId: input.pluginId, version: current.version };
}
