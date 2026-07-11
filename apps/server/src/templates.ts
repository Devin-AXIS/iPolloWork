import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import {
  templateManifestV1Schema,
  type DesignSessionTemplateState,
  type TemplateCatalogItem,
  type TemplateManifestV1,
  type TemplateSourceType,
} from "@ipollowork/types/templates";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { ApiError } from "./errors.js";
import pkg from "../package.json" with { type: "json" };

const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 1_000;
const ALLOWED_EXTENSIONS = new Set([
  ".html", ".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg", ".jpeg",
  ".webp", ".gif", ".avif", ".woff", ".woff2", ".ttf", ".otf", ".txt", ".md",
]);
const EXECUTABLE_EXTENSIONS = new Set([".exe", ".dll", ".com", ".bat", ".cmd", ".sh", ".ps1", ".app", ".dmg", ".pkg"]);

type InstallationStatus = "installed" | "uninstalled";
type InstallationRow = {
  workspaceId: string;
  templateId: string;
  version: string;
  sourceType: TemplateSourceType;
  packagePath: string;
  packageHash: string;
  status: InstallationStatus;
  manifestJson: string;
  installedAt: number;
  updatedAt: number;
};

type TemplateDb = {
  get(workspaceId: string, templateId: string): InstallationRow | undefined;
  list(workspaceId: string): InstallationRow[];
  upsert(row: InstallationRow): void;
};

type ZipEntry = { name: string; data: Buffer };
type BundledTemplate = { manifest: TemplateManifestV1; directory: string; hash: string };
const dbByPath = new Map<string, Promise<TemplateDb>>();
const operationQueues = new Map<string, Promise<void>>();
let bundledTemplatePromise: Promise<BundledTemplate[]> | null = null;

function runtimeDbPath(config: ServerConfig): string {
  const override = process.env.IPOLLOWORK_RUNTIME_DB?.trim();
  if (override) return resolve(override);
  const configDir = config.configPath?.trim() ? dirname(config.configPath) : join(homedir(), ".config", "ipollowork");
  return join(configDir, "runtime.sqlite");
}

function templatesRoot(config: ServerConfig): string {
  return join(dirname(runtimeDbPath(config)), "templates");
}

function bundledRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(moduleDir, "bundled-templates"), join(moduleDir, "..", "bundled-templates")];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new ApiError(500, "bundled_templates_missing", "Bundled templates are missing from this iPolloWork build");
  return found;
}

async function openTemplateDb(path: string): Promise<TemplateDb> {
  await mkdir(dirname(path), { recursive: true });
  const sql = `CREATE TABLE IF NOT EXISTS template_installations (
    workspace_id TEXT NOT NULL,
    template_id TEXT NOT NULL,
    version TEXT NOT NULL,
    source_type TEXT NOT NULL,
    package_path TEXT NOT NULL,
    package_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    installed_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, template_id)
  )`;
  if (typeof process.versions.bun === "string") {
    const { Database } = await import("bun:sqlite");
    const sqlite = new Database(path, { create: true });
    sqlite.run(sql);
    const get = sqlite.query("SELECT workspace_id AS workspaceId, template_id AS templateId, version, source_type AS sourceType, package_path AS packagePath, package_hash AS packageHash, status, manifest_json AS manifestJson, installed_at AS installedAt, updated_at AS updatedAt FROM template_installations WHERE workspace_id = ? AND template_id = ?");
    const list = sqlite.query("SELECT workspace_id AS workspaceId, template_id AS templateId, version, source_type AS sourceType, package_path AS packagePath, package_hash AS packageHash, status, manifest_json AS manifestJson, installed_at AS installedAt, updated_at AS updatedAt FROM template_installations WHERE workspace_id = ? ORDER BY template_id");
    const upsert = sqlite.query("INSERT INTO template_installations (workspace_id, template_id, version, source_type, package_path, package_hash, status, manifest_json, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, template_id) DO UPDATE SET version=excluded.version, source_type=excluded.source_type, package_path=excluded.package_path, package_hash=excluded.package_hash, status=excluded.status, manifest_json=excluded.manifest_json, installed_at=excluded.installed_at, updated_at=excluded.updated_at");
    return {
      get: (workspaceId, templateId) => get.get(workspaceId, templateId) as InstallationRow | undefined,
      list: (workspaceId) => list.all(workspaceId) as InstallationRow[],
      upsert: (row) => { upsert.run(row.workspaceId, row.templateId, row.version, row.sourceType, row.packagePath, row.packageHash, row.status, row.manifestJson, row.installedAt, row.updatedAt); },
    };
  }
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(path);
  sqlite.exec(sql);
  const get = sqlite.prepare("SELECT workspace_id AS workspaceId, template_id AS templateId, version, source_type AS sourceType, package_path AS packagePath, package_hash AS packageHash, status, manifest_json AS manifestJson, installed_at AS installedAt, updated_at AS updatedAt FROM template_installations WHERE workspace_id = ? AND template_id = ?");
  const list = sqlite.prepare("SELECT workspace_id AS workspaceId, template_id AS templateId, version, source_type AS sourceType, package_path AS packagePath, package_hash AS packageHash, status, manifest_json AS manifestJson, installed_at AS installedAt, updated_at AS updatedAt FROM template_installations WHERE workspace_id = ? ORDER BY template_id");
  const upsert = sqlite.prepare("INSERT INTO template_installations (workspace_id, template_id, version, source_type, package_path, package_hash, status, manifest_json, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, template_id) DO UPDATE SET version=excluded.version, source_type=excluded.source_type, package_path=excluded.package_path, package_hash=excluded.package_hash, status=excluded.status, manifest_json=excluded.manifest_json, installed_at=excluded.installed_at, updated_at=excluded.updated_at");
  return {
    get: (workspaceId, templateId) => get.get(workspaceId, templateId) as unknown as InstallationRow | undefined,
    list: (workspaceId) => list.all(workspaceId) as unknown as InstallationRow[],
    upsert: (row) => { upsert.run(row.workspaceId, row.templateId, row.version, row.sourceType, row.packagePath, row.packageHash, row.status, row.manifestJson, row.installedAt, row.updatedAt); },
  };
}

async function templateDb(config: ServerConfig) {
  const path = runtimeDbPath(config);
  const cached = dbByPath.get(path);
  if (cached) return cached;
  const opened = openTemplateDb(path);
  dbByPath.set(path, opened);
  return opened;
}

function safeRelativePath(input: string): string {
  if (!input || input.includes("\\") || input.includes("\0") || input.startsWith("/") || /^[A-Za-z]:/.test(input)) {
    throw new ApiError(400, "invalid_template_package", `Unsafe package path: ${input || "(empty)"}`);
  }
  if (input.split("/").some((segment) => segment === "..")) throw new ApiError(400, "invalid_template_package", `Unsafe package path: ${input}`);
  const normalized = posix.normalize(input);
  if (normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
    throw new ApiError(400, "invalid_template_package", `Unsafe package path: ${input}`);
  }
  return normalized.replace(/^\.\//, "");
}

function validateStaticFile(name: string, unixMode = 0) {
  const normalized = safeRelativePath(name);
  const extension = extname(normalized).toLowerCase();
  const isLicense = basename(normalized).toUpperCase() === "LICENSE";
  if ((unixMode & 0o170000) === 0o120000) throw new ApiError(400, "invalid_template_package", `Symbolic links are not allowed: ${name}`);
  if ((unixMode & 0o111) !== 0 || EXECUTABLE_EXTENSIONS.has(extension)) throw new ApiError(400, "invalid_template_package", `Executable files are not allowed: ${name}`);
  if (!isLicense && !ALLOWED_EXTENSIONS.has(extension)) throw new ApiError(400, "invalid_template_package", `Unsupported template file: ${name}`);
  return normalized;
}

function readZip(buffer: Buffer): ZipEntry[] {
  if (buffer.byteLength > MAX_PACKAGE_BYTES) throw new ApiError(413, "template_package_too_large", "Template package exceeds 50 MB");
  let eocd = -1;
  for (let offset = Math.max(0, buffer.length - 65_557); offset <= buffer.length - 22; offset += 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) eocd = offset;
  }
  if (eocd < 0) throw new ApiError(400, "invalid_template_package", "The .ipwt file is not a valid ZIP archive");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount > MAX_FILES) throw new ApiError(413, "template_package_too_large", "Template package contains more than 1,000 files");
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let expanded = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new ApiError(400, "invalid_template_package", "Invalid ZIP directory");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    const safeName = validateStaticFile(name, externalAttributes >>> 16);
    if (names.has(safeName)) throw new ApiError(400, "invalid_template_package", `Duplicate package path: ${safeName}`);
    names.add(safeName);
    if (uncompressedSize > MAX_FILE_BYTES) throw new ApiError(413, "template_package_too_large", `${safeName} exceeds 25 MB`);
    expanded += uncompressedSize;
    if (expanded > MAX_EXPANDED_BYTES) throw new ApiError(413, "template_package_too_large", "Expanded template exceeds 200 MB");
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new ApiError(400, "invalid_template_package", "Invalid ZIP entry");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > buffer.length) throw new ApiError(400, "invalid_template_package", `Corrupt ZIP entry: ${safeName}`);
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer | null = null;
    try { data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null; }
    catch { throw new ApiError(400, "invalid_template_package", `Corrupt ZIP entry: ${safeName}`); }
    if (!data || data.byteLength !== uncompressedSize) throw new ApiError(400, "invalid_template_package", `Unsupported or corrupt ZIP entry: ${safeName}`);
    entries.push({ name: safeName, data: Buffer.from(data) });
  }
  return entries;
}

async function readManifest(directory: string): Promise<TemplateManifestV1> {
  let value: unknown;
  try { value = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")); }
  catch { throw new ApiError(400, "invalid_template_manifest", "manifest.json is required at the package root"); }
  const parsed = templateManifestV1Schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "invalid_template_manifest", "Template manifest is invalid", parsed.error.flatten());
  const manifest = parsed.data;
  for (const relativePath of [manifest.entry, manifest.cover]) {
    const safe = validateStaticFile(relativePath);
    const target = resolve(directory, ...safe.split("/"));
    if (!target.startsWith(`${resolve(directory)}${sep}`) || !existsSync(target)) throw new ApiError(400, "invalid_template_manifest", `Missing package file: ${relativePath}`);
  }
  return manifest;
}

async function hashDirectory(directory: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(current: string, prefix = "") {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new ApiError(400, "invalid_template_package", `Symbolic links are not allowed: ${relativePath}`);
      if (entry.isDirectory()) await visit(join(current, entry.name), relativePath);
      else {
        validateStaticFile(relativePath, (await stat(join(current, entry.name))).mode);
        hash.update(relativePath); hash.update("\0"); hash.update(await readFile(join(current, entry.name)));
      }
    }
  }
  await visit(directory);
  return hash.digest("hex");
}

async function loadBundledTemplates(): Promise<BundledTemplate[]> {
  const root = bundledRoot();
  const items = [];
  for (const name of await readdir(root)) {
    const directory = join(root, name);
    if (!(await stat(directory)).isDirectory()) continue;
    const manifest = await readManifest(directory);
    items.push({ manifest, directory, hash: await hashDirectory(directory) });
  }
  return items;
}

function bundledTemplates(): Promise<BundledTemplate[]> {
  bundledTemplatePromise ??= loadBundledTemplates().catch((error) => {
    bundledTemplatePromise = null;
    throw error;
  });
  return bundledTemplatePromise;
}

function compareVersions(left: string, right: string): number {
  const a = left.split("-")[0].split(".").map(Number);
  const b = right.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return left.localeCompare(right);
}

async function withTemplateLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = operationQueues.get(key) ?? Promise.resolve();
  let release = () => {};
  const tail = new Promise<void>((resolvePromise) => { release = resolvePromise; });
  const queued = previous.then(() => tail, () => tail);
  operationQueues.set(key, queued);
  await previous.catch(() => undefined);
  try { return await operation(); }
  finally { release(); if (operationQueues.get(key) === queued) operationQueues.delete(key); }
}

async function installDirectory(input: {
  config: ServerConfig; workspaceId: string; sourceType: TemplateSourceType; sourceDirectory: string; manifest: TemplateManifestV1; hash: string;
}): Promise<TemplateCatalogItem> {
  return withTemplateLock(`${runtimeDbPath(input.config)}:${input.workspaceId}:${input.manifest.id}`, async () => {
    const db = await templateDb(input.config);
    const current = db.get(input.workspaceId, input.manifest.id);
    if (compareVersions(input.manifest.minimumAppVersion, pkg.version) > 0) throw new ApiError(409, "template_requires_newer_app", `This template requires iPolloWork ${input.manifest.minimumAppVersion} or newer`);
    if (current?.status === "installed" && current.version === input.manifest.version && current.packageHash === input.hash && existsSync(current.packagePath)) {
      return { manifest: input.manifest, sourceType: input.sourceType, installed: true, installedVersion: current.version, updateAvailable: false, verified: input.sourceType !== "local" };
    }
    if (current?.status === "installed" && current.version === input.manifest.version && current.packageHash !== input.hash) throw new ApiError(409, "template_version_conflict", "A different package with this template version is already installed");
    const finalDirectory = join(templatesRoot(input.config), input.workspaceId, input.manifest.id, input.manifest.version);
    const tempParent = await mkdtemp(join(tmpdir(), "ipollowork-template-"));
    const staged = join(tempParent, "package");
    try {
      await cp(input.sourceDirectory, staged, { recursive: true, errorOnExist: true });
      const stagedManifest = await readManifest(staged);
      if (stagedManifest.id !== input.manifest.id || stagedManifest.version !== input.manifest.version) throw new ApiError(400, "invalid_template_manifest", "Template changed during installation");
      await mkdir(dirname(finalDirectory), { recursive: true });
      if (!existsSync(finalDirectory)) await rename(staged, finalDirectory);
      const now = Date.now();
      db.upsert({ workspaceId: input.workspaceId, templateId: input.manifest.id, version: input.manifest.version, sourceType: input.sourceType, packagePath: finalDirectory, packageHash: input.hash, status: "installed", manifestJson: JSON.stringify(input.manifest), installedAt: current?.installedAt ?? now, updatedAt: now });
      if (current?.packagePath && current.packagePath !== finalDirectory) await rm(current.packagePath, { recursive: true, force: true }).catch(() => undefined);
      return { manifest: input.manifest, sourceType: input.sourceType, installed: true, installedVersion: input.manifest.version, updateAvailable: false, verified: input.sourceType !== "local" };
    } finally { await rm(tempParent, { recursive: true, force: true }); }
  });
}

export async function listTemplates(config: ServerConfig, workspaceId: string): Promise<TemplateCatalogItem[]> {
  const db = await templateDb(config);
  const bundled = await bundledTemplates();
  for (const item of bundled) {
    if (!config.readOnly && !db.get(workspaceId, item.manifest.id)) await installDirectory({ config, workspaceId, sourceType: "bundled", sourceDirectory: item.directory, manifest: item.manifest, hash: item.hash });
  }
  const rows = db.list(workspaceId);
  const byId = new Map(rows.map((row) => [row.templateId, row]));
  const items: TemplateCatalogItem[] = bundled.map((item) => {
    const row = byId.get(item.manifest.id);
    return { manifest: item.manifest, sourceType: "bundled", installed: row?.status === "installed", installedVersion: row?.status === "installed" ? row.version : null, updateAvailable: row?.status === "installed" && compareVersions(item.manifest.version, row.version) > 0, verified: true };
  });
  for (const row of rows) {
    if (row.sourceType === "bundled" || row.status !== "installed") continue;
    const parsed = templateManifestV1Schema.safeParse(JSON.parse(row.manifestJson));
    if (parsed.success) items.push({ manifest: parsed.data, sourceType: row.sourceType, installed: true, installedVersion: row.version, updateAvailable: false, verified: row.sourceType === "market" });
  }
  return items;
}

export async function installBundledTemplate(config: ServerConfig, workspaceId: string, templateId: string) {
  const item = (await bundledTemplates()).find((candidate) => candidate.manifest.id === templateId);
  if (!item) throw new ApiError(404, "template_not_found", "Bundled template not found");
  return installDirectory({ config, workspaceId, sourceType: "bundled", sourceDirectory: item.directory, manifest: item.manifest, hash: item.hash });
}

export async function importTemplate(config: ServerConfig, workspaceId: string, archive: Uint8Array) {
  const buffer = Buffer.from(archive);
  const hash = createHash("sha256").update(buffer).digest("hex");
  const tempParent = await mkdtemp(join(tmpdir(), "ipollowork-import-"));
  const sourceDirectory = join(tempParent, "package");
  try {
    await mkdir(sourceDirectory, { recursive: true });
    for (const entry of readZip(buffer)) {
      const target = join(sourceDirectory, ...entry.name.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.data, { flag: "wx" });
    }
    const manifest = await readManifest(sourceDirectory);
    if (manifest.id.startsWith("ipollowork.")) throw new ApiError(400, "reserved_template_id", "Local templates cannot use the reserved ipollowork.* namespace");
    return await installDirectory({ config, workspaceId, sourceType: "local", sourceDirectory, manifest, hash });
  } finally { await rm(tempParent, { recursive: true, force: true }); }
}

export async function uninstallTemplate(config: ServerConfig, workspaceId: string, templateId: string) {
  return withTemplateLock(`${runtimeDbPath(config)}:${workspaceId}:${templateId}`, async () => {
    const db = await templateDb(config);
    const current = db.get(workspaceId, templateId);
    if (!current) throw new ApiError(404, "template_not_found", "Template not found");
    if (current.packagePath) await rm(current.packagePath, { recursive: true, force: true });
    db.upsert({ ...current, status: "uninstalled", packagePath: "", updatedAt: Date.now() });
    return { ok: true };
  });
}

export async function readTemplateCover(config: ServerConfig, workspaceId: string, templateId: string) {
  const item = (await listTemplates(config, workspaceId)).find((candidate) => candidate.manifest.id === templateId);
  if (!item) throw new ApiError(404, "template_not_found", "Template not found");
  const db = await templateDb(config);
  const row = db.get(workspaceId, templateId);
  const bundled = item.sourceType === "bundled"
    ? (await bundledTemplates()).find((candidate) => candidate.manifest.id === templateId)?.directory
    : undefined;
  const directory = row?.status === "installed" && row.packagePath ? row.packagePath : bundled;
  if (!directory) throw new ApiError(404, "template_cover_not_found", "Template cover not found");
  const cover = validateStaticFile(item.manifest.cover);
  const data = await readFile(join(directory, ...cover.split("/")));
  const extension = extname(cover).toLowerCase();
  const contentType = extension === ".svg" ? "image/svg+xml" : extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return { data, contentType };
}

function sessionRoot(workspace: WorkspaceInfo, sessionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(sessionId)) throw new ApiError(400, "invalid_session_id", "Invalid Design session id");
  return join(workspace.path, "design", sessionId);
}

export async function materializeTemplate(config: ServerConfig, workspace: WorkspaceInfo, templateId: string, sessionId: string, brief?: unknown) {
  const db = await templateDb(config);
  const row = db.get(workspace.id, templateId);
  if (!row || row.status !== "installed" || !existsSync(row.packagePath)) throw new ApiError(409, "template_not_installed", "Install this template before using it");
  const manifest = templateManifestV1Schema.parse(JSON.parse(row.manifestJson));
  const root = sessionRoot(workspace, sessionId);
  if (existsSync(root)) throw new ApiError(409, "design_session_exists", "This Design session already has a template snapshot");
  const staged = `${root}.tmp-${Date.now()}`;
  try {
    await cp(row.packagePath, staged, { recursive: true, errorOnExist: true });
    const now = Date.now();
    const state: DesignSessionTemplateState = { schemaVersion: 1, template: { id: manifest.id, version: manifest.version, sourceType: row.sourceType }, entry: `design/${sessionId}/${manifest.entry}`, briefPath: `design/${sessionId}/brief.json`, createdAt: now };
    await writeFile(join(staged, "template.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await writeFile(join(staged, "brief.json"), `${JSON.stringify(brief ?? {}, null, 2)}\n`, "utf8");
    await mkdir(dirname(root), { recursive: true });
    await rename(staged, root);
    return { state, manifest };
  } catch (error) { await rm(staged, { recursive: true, force: true }); throw error; }
}

export async function readDesignSessionTemplate(workspace: WorkspaceInfo, sessionId: string) {
  const root = sessionRoot(workspace, sessionId);
  try {
    const state = JSON.parse(await readFile(join(root, "template.json"), "utf8")) as DesignSessionTemplateState;
    const manifest = templateManifestV1Schema.parse(JSON.parse(await readFile(join(root, "manifest.json"), "utf8")));
    return { state, manifest };
  } catch (error) {
    if (!existsSync(join(root, "template.json"))) throw new ApiError(404, "design_template_not_found", "This Design session has no template metadata");
    throw error;
  }
}

export async function adoptDesignSession(workspace: WorkspaceInfo, sessionId: string, input: { templateId: string; entry: string; brief?: unknown }) {
  const root = sessionRoot(workspace, sessionId);
  const entry = safeRelativePath(input.entry);
  const entryAbsolute = resolve(workspace.path, ...entry.split("/"));
  if (!entryAbsolute.startsWith(`${resolve(workspace.path)}${sep}`) || !existsSync(entryAbsolute)) throw new ApiError(400, "invalid_design_entry", "The existing Design entry was not found");
  await mkdir(root, { recursive: true });
  if (existsSync(join(root, "template.json"))) return readDesignSessionTemplate(workspace, sessionId);
  const bundled = (await bundledTemplates()).find((candidate) => candidate.manifest.id === input.templateId);
  if (!bundled) throw new ApiError(404, "template_not_found", "Template metadata was not found");
  await cp(join(bundled.directory, "manifest.json"), join(root, "manifest.json"), { errorOnExist: false });
  const state: DesignSessionTemplateState = { schemaVersion: 1, template: { id: bundled.manifest.id, version: bundled.manifest.version, sourceType: "bundled" }, entry, briefPath: `design/${sessionId}/brief.json`, createdAt: Date.now() };
  await writeFile(join(root, "template.json"), `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
  if (input.brief !== undefined && !existsSync(join(root, "brief.json"))) await writeFile(join(root, "brief.json"), `${JSON.stringify(input.brief, null, 2)}\n`, "utf8");
  return { state, manifest: bundled.manifest };
}
