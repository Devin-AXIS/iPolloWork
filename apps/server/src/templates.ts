import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import {
  templateCategorySchema,
  templateManifestV1Schema,
  templateSourceTypeSchema,
  templateStyleSchema,
  sortTemplatesForCatalog,
  type TemplateSessionState,
  type TemplateSessionSnapshot,
  type TemplateCategory,
  type TemplateCatalogItem,
  type TemplateManifestV1,
  type TemplateSourceType,
  type TemplateSurface,
} from "@ipollowork/types/templates";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { ApiError } from "./errors.js";
import pkg from "../package.json" with { type: "json" };

const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 1_000;
// The market is opened from the account menu, so local templates belong to
// the signed-in desktop profile rather than an individual workstation. The
// workspace route remains the authorization and materialization boundary.
const PERSONAL_TEMPLATE_LIBRARY = "__ipollowork_personal__";
const ALLOWED_EXTENSIONS = new Set([
  ".html", ".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg", ".jpeg",
  ".webp", ".gif", ".avif", ".woff", ".woff2", ".ttf", ".otf", ".txt", ".md",
  ".glb", ".gltf", ".bin",
]);
const EXECUTABLE_EXTENSIONS = new Set([".exe", ".dll", ".com", ".bat", ".cmd", ".sh", ".ps1", ".app", ".dmg", ".pkg"]);
const HYPERFRAMES_VARIABLE_TYPES = new Set(["string", "number", "color", "boolean", "enum"]);

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

type TemplateSessionRow = {
  workspaceId: string;
  sessionId: string;
  surface: TemplateSurface;
  templateId: string;
  version: string;
  sourceType: TemplateSourceType;
  entry: string;
  briefPath: string;
  manifestJson: string;
  createdAt: number;
};

type TemplateDb = {
  get(workspaceId: string, templateId: string): InstallationRow | undefined;
  list(workspaceId: string): InstallationRow[];
  upsert(row: InstallationRow): void;
  getSession(workspaceId: string, sessionId: string): TemplateSessionRow | undefined;
  listSessions(workspaceId: string): TemplateSessionRow[];
  upsertSession(row: TemplateSessionRow): void;
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
  const resourcesPath = typeof process.resourcesPath === "string" && process.resourcesPath.trim()
    ? process.resourcesPath.trim()
    : "";
  const candidates = [
    ...(resourcesPath ? [join(resourcesPath, "server", "dist", "bundled-templates")] : []),
    join(moduleDir, "bundled-templates"),
    join(moduleDir, "..", "bundled-templates"),
  ];
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
  );
  CREATE TABLE IF NOT EXISTS template_session_snapshots (
    workspace_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    surface TEXT NOT NULL CHECK(surface IN ('design', 'video')),
    template_id TEXT NOT NULL,
    version TEXT NOT NULL,
    source_type TEXT NOT NULL,
    entry TEXT NOT NULL,
    brief_path TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, session_id)
  );
  CREATE INDEX IF NOT EXISTS template_session_snapshots_workspace_surface
    ON template_session_snapshots (workspace_id, surface)`;
  if (typeof process.versions.bun === "string") {
    const { Database } = await import("bun:sqlite");
    const sqlite = new Database(path, { create: true });
    sqlite.run(sql);
    const get = sqlite.query("SELECT workspace_id AS workspaceId, template_id AS templateId, version, source_type AS sourceType, package_path AS packagePath, package_hash AS packageHash, status, manifest_json AS manifestJson, installed_at AS installedAt, updated_at AS updatedAt FROM template_installations WHERE workspace_id = ? AND template_id = ?");
    const list = sqlite.query("SELECT workspace_id AS workspaceId, template_id AS templateId, version, source_type AS sourceType, package_path AS packagePath, package_hash AS packageHash, status, manifest_json AS manifestJson, installed_at AS installedAt, updated_at AS updatedAt FROM template_installations WHERE workspace_id = ? ORDER BY template_id");
    const upsert = sqlite.query("INSERT INTO template_installations (workspace_id, template_id, version, source_type, package_path, package_hash, status, manifest_json, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, template_id) DO UPDATE SET version=excluded.version, source_type=excluded.source_type, package_path=excluded.package_path, package_hash=excluded.package_hash, status=excluded.status, manifest_json=excluded.manifest_json, installed_at=excluded.installed_at, updated_at=excluded.updated_at");
    const getSession = sqlite.query("SELECT workspace_id AS workspaceId, session_id AS sessionId, surface, template_id AS templateId, version, source_type AS sourceType, entry, brief_path AS briefPath, manifest_json AS manifestJson, created_at AS createdAt FROM template_session_snapshots WHERE workspace_id = ? AND session_id = ?");
    const listSessions = sqlite.query("SELECT workspace_id AS workspaceId, session_id AS sessionId, surface, template_id AS templateId, version, source_type AS sourceType, entry, brief_path AS briefPath, manifest_json AS manifestJson, created_at AS createdAt FROM template_session_snapshots WHERE workspace_id = ? ORDER BY created_at DESC, session_id");
    const upsertSession = sqlite.query("INSERT INTO template_session_snapshots (workspace_id, session_id, surface, template_id, version, source_type, entry, brief_path, manifest_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, session_id) DO UPDATE SET surface=excluded.surface, template_id=excluded.template_id, version=excluded.version, source_type=excluded.source_type, entry=excluded.entry, brief_path=excluded.brief_path, manifest_json=excluded.manifest_json, created_at=excluded.created_at");
    return {
      get: (workspaceId, templateId) => get.get(workspaceId, templateId) as InstallationRow | undefined,
      list: (workspaceId) => list.all(workspaceId) as InstallationRow[],
      upsert: (row) => { upsert.run(row.workspaceId, row.templateId, row.version, row.sourceType, row.packagePath, row.packageHash, row.status, row.manifestJson, row.installedAt, row.updatedAt); },
      getSession: (workspaceId, sessionId) => getSession.get(workspaceId, sessionId) as TemplateSessionRow | undefined,
      listSessions: (workspaceId) => listSessions.all(workspaceId) as TemplateSessionRow[],
      upsertSession: (row) => { upsertSession.run(row.workspaceId, row.sessionId, row.surface, row.templateId, row.version, row.sourceType, row.entry, row.briefPath, row.manifestJson, row.createdAt); },
    };
  }
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(path);
  sqlite.exec(sql);
  const get = sqlite.prepare("SELECT workspace_id AS workspaceId, template_id AS templateId, version, source_type AS sourceType, package_path AS packagePath, package_hash AS packageHash, status, manifest_json AS manifestJson, installed_at AS installedAt, updated_at AS updatedAt FROM template_installations WHERE workspace_id = ? AND template_id = ?");
  const list = sqlite.prepare("SELECT workspace_id AS workspaceId, template_id AS templateId, version, source_type AS sourceType, package_path AS packagePath, package_hash AS packageHash, status, manifest_json AS manifestJson, installed_at AS installedAt, updated_at AS updatedAt FROM template_installations WHERE workspace_id = ? ORDER BY template_id");
  const upsert = sqlite.prepare("INSERT INTO template_installations (workspace_id, template_id, version, source_type, package_path, package_hash, status, manifest_json, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, template_id) DO UPDATE SET version=excluded.version, source_type=excluded.source_type, package_path=excluded.package_path, package_hash=excluded.package_hash, status=excluded.status, manifest_json=excluded.manifest_json, installed_at=excluded.installed_at, updated_at=excluded.updated_at");
  const getSession = sqlite.prepare("SELECT workspace_id AS workspaceId, session_id AS sessionId, surface, template_id AS templateId, version, source_type AS sourceType, entry, brief_path AS briefPath, manifest_json AS manifestJson, created_at AS createdAt FROM template_session_snapshots WHERE workspace_id = ? AND session_id = ?");
  const listSessions = sqlite.prepare("SELECT workspace_id AS workspaceId, session_id AS sessionId, surface, template_id AS templateId, version, source_type AS sourceType, entry, brief_path AS briefPath, manifest_json AS manifestJson, created_at AS createdAt FROM template_session_snapshots WHERE workspace_id = ? ORDER BY created_at DESC, session_id");
  const upsertSession = sqlite.prepare("INSERT INTO template_session_snapshots (workspace_id, session_id, surface, template_id, version, source_type, entry, brief_path, manifest_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, session_id) DO UPDATE SET surface=excluded.surface, template_id=excluded.template_id, version=excluded.version, source_type=excluded.source_type, entry=excluded.entry, brief_path=excluded.brief_path, manifest_json=excluded.manifest_json, created_at=excluded.created_at");
  return {
    get: (workspaceId, templateId) => get.get(workspaceId, templateId) as unknown as InstallationRow | undefined,
    list: (workspaceId) => list.all(workspaceId) as unknown as InstallationRow[],
    upsert: (row) => { upsert.run(row.workspaceId, row.templateId, row.version, row.sourceType, row.packagePath, row.packageHash, row.status, row.manifestJson, row.installedAt, row.updatedAt); },
    getSession: (workspaceId, sessionId) => getSession.get(workspaceId, sessionId) as unknown as TemplateSessionRow | undefined,
    listSessions: (workspaceId) => listSessions.all(workspaceId) as unknown as TemplateSessionRow[],
    upsertSession: (row) => { upsertSession.run(row.workspaceId, row.sessionId, row.surface, row.templateId, row.version, row.sourceType, row.entry, row.briefPath, row.manifestJson, row.createdAt); },
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
  const legalName = basename(normalized).toUpperCase();
  const isLegalNotice = legalName === "LICENSE" || legalName === "NOTICE";
  if ((unixMode & 0o170000) === 0o120000) throw new ApiError(400, "invalid_template_package", `Symbolic links are not allowed: ${name}`);
  if ((unixMode & 0o111) !== 0 || EXECUTABLE_EXTENSIONS.has(extension)) throw new ApiError(400, "invalid_template_package", `Executable files are not allowed: ${name}`);
  if (!isLegalNotice && !ALLOWED_EXTENSIONS.has(extension)) throw new ApiError(400, "invalid_template_package", `Unsupported template file: ${name}`);
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

function invalidVideoTemplateVariables(message: string): never {
  throw new ApiError(400, "invalid_video_template_variables", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Video templates are rendered by HyperFrames, whose variables are declared
 * on the document element rather than in our manifest. Keep that contract at
 * the package boundary so an imported video is editable as soon as it opens
 * in the Video Studio. Design templates deliberately do not pass through
 * this validator: they remain ordinary static HTML/CSS projects.
 */
function validateVideoTemplateVariables(manifest: TemplateManifestV1, entryHtml: string) {
  if (manifest.surface !== "video") return new Set<string>();
  const htmlTag = entryHtml.match(/<html\b[^>]*>/i)?.[0];
  const encodedDeclarations = htmlTag?.match(/\bdata-composition-variables\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];
  if (!encodedDeclarations) {
    invalidVideoTemplateVariables("Video templates must declare editable HyperFrames variables on <html data-composition-variables='[...]'>");
  }

  let declarations: unknown;
  try {
    declarations = JSON.parse(encodedDeclarations);
  } catch {
    invalidVideoTemplateVariables("data-composition-variables must contain valid JSON");
  }
  if (!Array.isArray(declarations) || declarations.length === 0) {
    invalidVideoTemplateVariables("Video templates must declare at least one HyperFrames variable");
  }

  const ids = new Set<string>();
  for (const [index, declaration] of declarations.entries()) {
    const prefix = `HyperFrames variable #${index + 1}`;
    if (!isPlainObject(declaration)) invalidVideoTemplateVariables(`${prefix} must be an object`);
    const { id, type, label } = declaration;
    if (typeof id !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(id)) {
      invalidVideoTemplateVariables(`${prefix} needs a valid id`);
    }
    if (ids.has(id)) invalidVideoTemplateVariables(`HyperFrames variable ids must be unique: ${id}`);
    ids.add(id);
    if (typeof type !== "string" || !HYPERFRAMES_VARIABLE_TYPES.has(type)) {
      invalidVideoTemplateVariables(`${prefix} has an unsupported type`);
    }
    if (typeof label !== "string" || !label.trim()) invalidVideoTemplateVariables(`${prefix} needs a label`);
    if (!Object.hasOwn(declaration, "default")) invalidVideoTemplateVariables(`${prefix} needs a default value`);

    const defaultValue = declaration.default;
    if ((type === "string" || type === "color") && typeof defaultValue !== "string") {
      invalidVideoTemplateVariables(`${prefix} must use a string default`);
    }
    if (type === "number" && (typeof defaultValue !== "number" || !Number.isFinite(defaultValue))) {
      invalidVideoTemplateVariables(`${prefix} must use a finite numeric default`);
    }
    if (type === "boolean" && typeof defaultValue !== "boolean") {
      invalidVideoTemplateVariables(`${prefix} must use a boolean default`);
    }
    if (type === "enum") {
      const options = declaration.options;
      if (!Array.isArray(options) || options.length === 0 || options.some((option) => !isPlainObject(option) || typeof option.value !== "string" || typeof option.label !== "string" || !option.value || !option.label.trim())) {
        invalidVideoTemplateVariables(`${prefix} needs non-empty enum options with value and label`);
      }
      if (typeof defaultValue !== "string" || !options.some((option) => isPlainObject(option) && option.value === defaultValue)) {
        invalidVideoTemplateVariables(`${prefix} default must match an enum option`);
      }
    }
  }
  return ids;
}

async function readManifest(directory: string): Promise<TemplateManifestV1> {
  let value: unknown;
  try { value = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")); }
  catch { throw new ApiError(400, "invalid_template_manifest", "manifest.json is required at the package root"); }
  const parsed = templateManifestV1Schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "invalid_template_manifest", "Template manifest is invalid", parsed.error.flatten());
  const manifest = parsed.data;
  for (const relativePath of [manifest.entry, manifest.cover, manifest.designSystem.tokens].filter((path): path is string => Boolean(path))) {
    const safe = validateStaticFile(relativePath);
    const target = resolve(directory, ...safe.split("/"));
    if (!target.startsWith(`${resolve(directory)}${sep}`) || !existsSync(target)) throw new ApiError(400, "invalid_template_manifest", `Missing package file: ${relativePath}`);
  }
  if (manifest.surface === "video") {
    const entry = await readFile(join(directory, ...manifest.entry.split("/")), "utf8");
    const declared = validateVideoTemplateVariables(manifest, entry);
    for (const variable of manifest.designSystem.variables) {
      if (!declared.has(variable.id)) throw new ApiError(400, "invalid_template_manifest", `Manifest variable is missing from the HyperFrames document: ${variable.id}`);
    }
  } else if (manifest.designSystem.variables.length > 0) {
    if (!manifest.designSystem.tokens) throw new ApiError(400, "invalid_template_manifest", "Design templates with variables must include a token stylesheet");
    const tokens = await readFile(join(directory, ...manifest.designSystem.tokens.split("/")), "utf8");
    for (const variable of manifest.designSystem.variables) {
      if (!variable.id.startsWith("--ipw-") || !tokens.includes(variable.id)) {
        throw new ApiError(400, "invalid_template_manifest", `Design token variable is missing from the token stylesheet: ${variable.id}`);
      }
    }
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

async function copyTemplateSource(sourceDirectory: string, destination: string) {
  await cp(sourceDirectory, destination, { recursive: true, errorOnExist: true });
}

async function loadBundledTemplates(): Promise<BundledTemplate[]> {
  const root = bundledRoot();
  const items: BundledTemplate[] = [];
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

function isDevelopmentVersion(version: string) {
  return version === "0.0.0" || version.startsWith("0.0.0-");
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
    if (!isDevelopmentVersion(pkg.version) && compareVersions(input.manifest.minimumAppVersion, pkg.version) > 0) throw new ApiError(409, "template_requires_newer_app", `This template requires iPolloWork ${input.manifest.minimumAppVersion} or newer`);
    if (current?.status === "installed" && current.version === input.manifest.version && current.packageHash === input.hash && existsSync(current.packagePath)) {
      return { manifest: input.manifest, sourceType: input.sourceType, installed: true, installedVersion: current.version, updateAvailable: false, verified: input.sourceType !== "local" };
    }
    if (current?.status === "installed" && current.version === input.manifest.version && current.packageHash !== input.hash) throw new ApiError(409, "template_version_conflict", "A different package with this template version is already installed");
    const finalDirectory = join(templatesRoot(input.config), input.workspaceId, input.manifest.id, input.manifest.version);
    const tempParent = await mkdtemp(join(tmpdir(), "ipollowork-template-"));
    const staged = join(tempParent, "package");
    try {
      await copyTemplateSource(input.sourceDirectory, staged);
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
    if (!config.readOnly && !db.get(PERSONAL_TEMPLATE_LIBRARY, item.manifest.id)) await installDirectory({ config, workspaceId: PERSONAL_TEMPLATE_LIBRARY, sourceType: "bundled", sourceDirectory: item.directory, manifest: item.manifest, hash: item.hash });
  }
  const rows = db.list(PERSONAL_TEMPLATE_LIBRARY);
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
  return sortTemplatesForCatalog(items.map((item) => item.manifest)).map((manifest) => items.find((item) => item.manifest === manifest)!);
}

export async function installBundledTemplate(config: ServerConfig, workspaceId: string, templateId: string) {
  const item = (await bundledTemplates()).find((candidate) => candidate.manifest.id === templateId);
  if (!item) throw new ApiError(404, "template_not_found", "Bundled template not found");
  return installDirectory({ config, workspaceId: PERSONAL_TEMPLATE_LIBRARY, sourceType: "bundled", sourceDirectory: item.directory, manifest: item.manifest, hash: item.hash });
}

export async function importTemplate(config: ServerConfig, workspaceId: string, archive: Uint8Array, declaredCategory: string) {
  const category = templateCategorySchema.safeParse(declaredCategory);
  if (!category.success) throw new ApiError(400, "invalid_template_category", "Choose a supported template category before importing");
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
    if (manifest.category !== category.data) {
      throw new ApiError(400, "template_category_mismatch", "The selected template category does not match manifest.json");
    }
    if (manifest.id.startsWith("ipollowork.")) throw new ApiError(400, "reserved_template_id", "Local templates cannot use the reserved ipollowork.* namespace");
    return await installDirectory({ config, workspaceId: PERSONAL_TEMPLATE_LIBRARY, sourceType: "local", sourceDirectory, manifest, hash });
  } finally { await rm(tempParent, { recursive: true, force: true }); }
}

function localTemplateId(title: string) {
  const stem = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "template";
  return `personal.${stem}.${Date.now().toString(36)}`;
}

function escapeSvgText(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

function personalTemplateCover(title: string, category: TemplateCategory, style: string) {
  const label = escapeSvgText(title.slice(0, 38));
  const detail = escapeSvgText(`${category} · ${style}`.slice(0, 42));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" role="img" aria-label="${label}"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#4f46e5"/></linearGradient></defs><rect width="960" height="540" fill="url(#g)"/><circle cx="785" cy="105" r="180" fill="#ffffff" fill-opacity=".1"/><circle cx="145" cy="500" r="230" fill="#a5b4fc" fill-opacity=".16"/><text x="64" y="250" fill="#ffffff" font-family="Inter,Arial,sans-serif" font-size="58" font-weight="700">${label}</text><text x="68" y="304" fill="#c7d2fe" font-family="Inter,Arial,sans-serif" font-size="24">${detail}</text></svg>`;
}

async function sessionEntryPath(db: TemplateDb, workspaceId: string, sessionId: string, surface: TemplateSurface) {
  const folder = surface === "video" ? "video" : "design";
  const fallback = surface === "video" ? "index.html" : "entry.html";
  const snapshot = db.getSession(workspaceId, sessionId);
  const prefix = `${folder}/${sessionId}/`;
  if (snapshot?.surface === surface && snapshot.entry.startsWith(prefix)) return safeRelativePath(snapshot.entry.slice(prefix.length));
  return fallback;
}

export async function saveTemplateFromSession(config: ServerConfig, workspace: WorkspaceInfo, input: {
  sessionId: string;
  category: TemplateCategory;
  title: string;
  description?: string;
  subcategory?: string;
  style?: string;
  tags?: string[];
}) {
  const category = templateCategorySchema.safeParse(input.category);
  if (!category.success) throw new ApiError(400, "invalid_template_category", "Unsupported template category");
  const title = input.title.trim().slice(0, 96);
  if (!title) throw new ApiError(400, "invalid_template_title", "Template title is required");
  const surface: TemplateSurface = category.data === "video" ? "video" : "design";
  const sourceRoot = sessionRoot(workspace, input.sessionId, surface);
  if (!existsSync(sourceRoot)) throw new ApiError(409, "template_source_missing", "Create a design or video before saving it as a template");
  const entry = await sessionEntryPath(await templateDb(config), workspace.id, input.sessionId, surface);
  if (!existsSync(join(sourceRoot, ...entry.split("/")))) throw new ApiError(409, "template_entry_missing", "The current template entry is missing");
  const style = templateStyleSchema.safeParse(input.style?.trim() || "custom");
  if (!style.success) throw new ApiError(400, "invalid_template_style", "Unsupported template style");
  const tags = (input.tags ?? []).map((tag) => tag.trim().slice(0, 32)).filter(Boolean).slice(0, 12);
  const template: TemplateManifestV1 = templateManifestV1Schema.parse({
    schemaVersion: 1,
    id: localTemplateId(title),
    version: "1.0.0",
    kind: "design",
    category: category.data,
    subcategory: input.subcategory?.trim().slice(0, 64) || "custom",
    style: style.data,
    tags,
    surface,
    title,
    description: input.description?.trim().slice(0, 240) || `Personal ${category.data} template`,
    cover: "cover.svg",
    entry,
    source: { name: "Personal template", license: "Private" },
    designSystem: { tokenVersion: 1, tokens: existsSync(join(sourceRoot, "design-tokens.css")) ? "design-tokens.css" : undefined, editableGroups: ["theme", "background", "typography", "components"] },
    applyChecklist: ["Update copy, visual tokens, assets and calls to action."],
    minimumAppVersion: pkg.version.replace(/-.+$/, ""),
  });
  const tempParent = await mkdtemp(join(tmpdir(), "ipollowork-save-template-"));
  const sourceDirectory = join(tempParent, "package");
  try {
    await cp(sourceRoot, sourceDirectory, { recursive: true, errorOnExist: true });
    await Promise.all(["template.json", "brief.json", "manifest.json", "cover.svg"].map((file) => rm(join(sourceDirectory, file), { force: true })));
    await writeFile(join(sourceDirectory, "manifest.json"), `${JSON.stringify(template, null, 2)}\n`, "utf8");
    await writeFile(join(sourceDirectory, "cover.svg"), personalTemplateCover(template.title, template.category, template.style), "utf8");
    return await installDirectory({ config, workspaceId: PERSONAL_TEMPLATE_LIBRARY, sourceType: "local", sourceDirectory, manifest: template, hash: await hashDirectory(sourceDirectory) });
  } finally {
    await rm(tempParent, { recursive: true, force: true });
  }
}

export async function uninstallTemplate(config: ServerConfig, workspaceId: string, templateId: string) {
  return withTemplateLock(`${runtimeDbPath(config)}:${PERSONAL_TEMPLATE_LIBRARY}:${templateId}`, async () => {
    const db = await templateDb(config);
    const current = db.get(PERSONAL_TEMPLATE_LIBRARY, templateId);
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
  const row = db.get(PERSONAL_TEMPLATE_LIBRARY, templateId);
  const cover = validateStaticFile(item.manifest.cover);
  const bundled = item.sourceType === "bundled"
    ? (await bundledTemplates()).find((candidate) => candidate.manifest.id === templateId)
    : undefined;
  const directory = item.sourceType === "bundled"
    ? bundled?.directory
    : row?.status === "installed" && row.packagePath ? row.packagePath : undefined;
  if (!directory) throw new ApiError(404, "template_cover_not_found", "Template cover not found");
  const data = await readFile(join(directory, ...cover.split("/")));
  const extension = extname(cover).toLowerCase();
  const contentType = extension === ".svg" ? "image/svg+xml" : extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return { data, contentType };
}

function sessionRoot(workspace: WorkspaceInfo, sessionId: string, surface: TemplateSurface = "design"): string {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(sessionId)) throw new ApiError(400, "invalid_session_id", "Invalid template session id");
  return join(workspace.path, surface === "video" ? "video" : "design", sessionId);
}

export async function materializeTemplate(config: ServerConfig, workspace: WorkspaceInfo, templateId: string, sessionId: string, brief?: unknown) {
  const db = await templateDb(config);
  const row = db.get(PERSONAL_TEMPLATE_LIBRARY, templateId);
  if (!row || row.status !== "installed" || !existsSync(row.packagePath)) throw new ApiError(409, "template_not_installed", "Install this template before using it");
  const manifest = templateManifestV1Schema.parse(JSON.parse(row.manifestJson));
  const root = sessionRoot(workspace, sessionId, manifest.surface);
  if (existsSync(root)) throw new ApiError(409, "template_session_exists", "This session already has a template snapshot");
  const staged = `${root}.tmp-${Date.now()}`;
  let moved = false;
  try {
    await cp(row.packagePath, staged, { recursive: true, errorOnExist: true });
    const now = Date.now();
    const folder = manifest.surface === "video" ? "video" : "design";
    const state: TemplateSessionState = { schemaVersion: 1, template: { id: manifest.id, version: manifest.version, sourceType: row.sourceType }, entry: `${folder}/${sessionId}/${manifest.entry}`, briefPath: `${folder}/${sessionId}/brief.json`, createdAt: now };
    await writeFile(join(staged, "brief.json"), `${JSON.stringify(brief ?? {}, null, 2)}\n`, "utf8");
    await mkdir(dirname(root), { recursive: true });
    await rename(staged, root);
    moved = true;
    db.upsertSession({
      workspaceId: workspace.id,
      sessionId,
      surface: manifest.surface,
      templateId: manifest.id,
      version: manifest.version,
      sourceType: row.sourceType,
      entry: state.entry,
      briefPath: state.briefPath,
      manifestJson: JSON.stringify(manifest),
      createdAt: state.createdAt,
    });
    return { state, manifest };
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    if (moved) await rm(root, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Claims a pre-template Video Studio project for the session that already
 * owns it. Early Video Studio sessions wrote directly to video/<sessionId>
 * before template snapshots existed, so the Studio and the agent could lose
 * their common source of truth after an app restart. This migration records
 * that existing project; it never copies, replaces, or scans other folders.
 */
export async function adoptLegacyVideoSession(config: ServerConfig, workspace: WorkspaceInfo, sessionId: string): Promise<TemplateSessionSnapshot> {
  return withTemplateLock(`${runtimeDbPath(config)}:${workspace.id}:video-session:${sessionId}`, async () => {
    const db = await templateDb(config);
    const current = db.getSession(workspace.id, sessionId);
    if (current) {
      if (current.surface !== "video") throw new ApiError(409, "template_session_surface_conflict", "This session is already bound to a non-video template");
      return snapshotFromRow(current);
    }

    const root = sessionRoot(workspace, sessionId, "video");
    const entryPath = join(root, "index.html");
    const entry = await stat(entryPath).catch(() => null);
    if (!entry?.isFile()) throw new ApiError(404, "video_session_project_missing", "This session has no Video Studio project to adopt");

    const bundled = (await bundledTemplates()).find((candidate) => candidate.manifest.id === "ipollowork.html-anything.video-hyperframes");
    if (!bundled) throw new ApiError(500, "video_template_missing", "The bundled Video Studio template is unavailable");
    const manifest = bundled.manifest;
    const now = Date.now();
    const state: TemplateSessionState = {
      schemaVersion: 1,
      template: { id: manifest.id, version: manifest.version, sourceType: "bundled" },
      entry: `video/${sessionId}/index.html`,
      briefPath: `video/${sessionId}/brief.json`,
      createdAt: now,
    };

    // An object with one migration marker keeps the brief card from reopening
    // for an already-working Studio project, while leaving an existing brief
    // untouched.
    const briefFile = join(root, "brief.json");
    if (!existsSync(briefFile)) {
      await writeFile(briefFile, `${JSON.stringify({ source: "legacy-video-session" }, null, 2)}\n`, "utf8");
    }
    const row: TemplateSessionRow = {
      workspaceId: workspace.id,
      sessionId,
      surface: "video",
      templateId: manifest.id,
      version: manifest.version,
      sourceType: "bundled",
      entry: state.entry,
      briefPath: state.briefPath,
      manifestJson: JSON.stringify(manifest),
      createdAt: state.createdAt,
    };
    db.upsertSession(row);
    return snapshotFromRow(row);
  });
}

function snapshotFromRow(row: TemplateSessionRow): TemplateSessionSnapshot {
  const manifest = templateManifestV1Schema.parse(JSON.parse(row.manifestJson));
  if (manifest.surface !== row.surface || manifest.id !== row.templateId || manifest.version !== row.version) {
    throw new ApiError(500, "template_session_corrupt", "Template session metadata is inconsistent");
  }
  return {
    sessionId: row.sessionId,
    surface: row.surface,
    state: {
      schemaVersion: 1,
      template: { id: row.templateId, version: row.version, sourceType: row.sourceType },
      entry: row.entry,
      briefPath: row.briefPath,
      createdAt: row.createdAt,
    },
    manifest,
  };
}

export async function readTemplateSession(config: ServerConfig, workspace: WorkspaceInfo, sessionId: string): Promise<TemplateSessionSnapshot> {
  const row = (await templateDb(config)).getSession(workspace.id, sessionId);
  if (!row) throw new ApiError(404, "template_session_not_found", "This session has no template metadata");
  return snapshotFromRow(row);
}

export async function listTemplateSessions(config: ServerConfig, workspace: WorkspaceInfo): Promise<TemplateSessionSnapshot[]> {
  return (await templateDb(config)).listSessions(workspace.id).map(snapshotFromRow);
}

function parseLegacyTemplateSessionState(
  raw: unknown,
  workspace: WorkspaceInfo,
  sessionId: string,
  surface: TemplateSurface,
): TemplateSessionState {
  if (!raw || typeof raw !== "object") throw new ApiError(400, "invalid_template_session", "Legacy template session metadata is invalid");
  const state = raw as Partial<TemplateSessionState>;
  const folder = surface === "video" ? "video" : "design";
  const expectedPrefix = `${folder}/${sessionId}/`;
  const sourceType = templateSourceTypeSchema.parse(state.template?.sourceType);
  const entry = typeof state.entry === "string" ? state.entry : "";
  const briefPath = typeof state.briefPath === "string" ? state.briefPath : "";
  if (state.schemaVersion !== 1 || !state.template?.id || !state.template.version || !entry.startsWith(expectedPrefix) || !briefPath.startsWith(`${folder}/${sessionId}/`)) {
    throw new ApiError(400, "invalid_template_session", `Legacy template session ${sessionId} is invalid`);
  }
  const entryAbsolute = resolve(workspace.path, ...entry.split("/"));
  if (!entryAbsolute.startsWith(`${resolve(workspace.path)}${sep}`) || !existsSync(entryAbsolute)) {
    throw new ApiError(400, "invalid_template_session", `Legacy template session ${sessionId} has no entry file`);
  }
  return {
    schemaVersion: 1,
    template: { id: state.template.id, version: state.template.version, sourceType },
    entry,
    briefPath,
    createdAt: typeof state.createdAt === "number" && Number.isFinite(state.createdAt) ? state.createdAt : Date.now(),
  };
}

/**
 * One-time migration for pre-canonical snapshots. Runtime reads never inspect
 * template.json; after a successful database write the old metadata file is
 * removed, leaving the SQLite session record as the only metadata authority.
 */
export async function migrateTemplateSessionSnapshots(config: ServerConfig, workspaces = config.workspaces) {
  const db = await templateDb(config);
  let migrated = 0;
  for (const workspace of workspaces) {
    if (workspace.workspaceType !== "local" || !workspace.path) continue;
    for (const surface of ["design", "video"] as const) {
      const parent = join(workspace.path, surface);
      let entries: Array<import("node:fs").Dirent<string>>;
      try { entries = await readdir(parent, { withFileTypes: true }); }
      catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
        throw error;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^[A-Za-z0-9_-]{1,256}$/.test(entry.name)) continue;
        const root = sessionRoot(workspace, entry.name, surface);
        const legacyMetadataPath = join(root, "template.json");
        if (!existsSync(legacyMetadataPath)) continue;
        const current = db.getSession(workspace.id, entry.name);
        if (!current) {
          const state = parseLegacyTemplateSessionState(JSON.parse(await readFile(legacyMetadataPath, "utf8")), workspace, entry.name, surface);
          const manifest = templateManifestV1Schema.parse(JSON.parse(await readFile(join(root, "manifest.json"), "utf8")));
          if (manifest.surface !== surface || manifest.id !== state.template.id || manifest.version !== state.template.version) {
            throw new ApiError(400, "invalid_template_session", `Legacy template session ${entry.name} does not match its manifest`);
          }
          db.upsertSession({
            workspaceId: workspace.id,
            sessionId: entry.name,
            surface,
            templateId: manifest.id,
            version: manifest.version,
            sourceType: state.template.sourceType,
            entry: state.entry,
            briefPath: state.briefPath,
            manifestJson: JSON.stringify(manifest),
            createdAt: state.createdAt,
          });
          migrated += 1;
        }
        await rm(legacyMetadataPath, { force: true });
      }
    }
  }
  return { migrated };
}
