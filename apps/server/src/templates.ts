import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { inflateRaw } from "node:zlib";
import { importNodeSqlite } from "./node-sqlite.js";
import {
  MAX_TEMPLATE_PACKAGE_BYTES,
  templateCategorySchema,
  templateManifestV1Schema,
  pptxCompatibilitySchema,
  templateSourceTypeSchema,
  templateStyleSchema,
  sortTemplatesForCatalog,
  isCustomerVisibleBundledTemplate,
  isTemplateAuthoringManifest,
  TEMPLATE_AUTHORING_ID_PREFIX,
  type PptxCompatibility,
  type TemplateAuthoringInput,
  type TemplateSessionState,
  type TemplateSessionSnapshot,
  type TemplateValidationIssue,
  type TemplateValidationReport,
  type TemplateCategory,
  type TemplateCatalogItem,
  type TemplateManifestV1,
  type TemplateSourceType,
  type TemplateSurface,
} from "@ipollowork/types/templates";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { ApiError, isApiError } from "./errors.js";
import pkg from "../package.json" with { type: "json" };

const MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 1_000;
export { MAX_TEMPLATE_PACKAGE_BYTES };
const WITHDRAWN_BUNDLED_TEMPLATE_IDS = new Set([
  "ipollowork.html-anything.deck-xhs-post",
  "ipollowork.html-anything.social-x-post-card",
]);
export { isCustomerVisibleBundledTemplate };
// The market is opened from the account menu, so local templates belong to
// the signed-in desktop profile rather than an individual workstation. The
// workspace route remains the authorization and materialization boundary.
const PERSONAL_TEMPLATE_LIBRARY = "__ipollowork_personal__";
const ENTERPRISE_TEMPLATE_LIBRARY_PREFIX = "__ipollowork_enterprise__";

export type TemplateLibraryScope = "personal" | `enterprise:${string}`;

export function parseTemplateLibraryScope(scope: string | null | undefined): TemplateLibraryScope {
  const normalized = scope?.trim() || "personal";
  if (normalized === "personal") return normalized;
  const match = /^enterprise:(ent_[A-Za-z0-9_-]+)$/u.exec(normalized);
  if (!match) {
    throw new ApiError(400, "invalid_template_scope", "Template scope must be personal or a valid Enterprise id");
  }
  return `enterprise:${match[1]}`;
}

function templateLibraryId(scope: string | null | undefined): string {
  const normalized = parseTemplateLibraryScope(scope);
  return normalized === "personal"
    ? PERSONAL_TEMPLATE_LIBRARY
    : `${ENTERPRISE_TEMPLATE_LIBRARY_PREFIX}${normalized.slice("enterprise:".length)}`;
}
const ALLOWED_EXTENSIONS = new Set([
  ".html", ".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg", ".jpeg",
  ".webp", ".gif", ".avif", ".woff", ".woff2", ".ttf", ".otf", ".txt", ".md",
  ".glb", ".gltf", ".bin", ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga",
  ".opus", ".mp4", ".webm", ".mov",
]);
const EXECUTABLE_EXTENSIONS = new Set([".exe", ".dll", ".com", ".bat", ".cmd", ".sh", ".ps1", ".app", ".dmg", ".pkg"]);
const SESSION_TEMPLATE_EXCLUDED_PATHS = ["brief.json", "template.json", "renders", "captures", "exports", ".hyperframes/backup"];
const HYPERFRAMES_VARIABLE_TYPES = new Set(["string", "number", "color", "boolean", "enum"]);
const CURRENT_IPOLLOWORK_LOGO_URL = "assets/ipollowork-logo.svg?v=20260729";
const SLIDE_DOCUMENT_PATTERN = /\bdata-ipw-slide(?:\s|=|>)|\bclass\s*=\s*["'](?:[^"']*\s)?(?:slide|slide-frame)(?=\s|["'])|\bclassName\s*=\s*["'](?:slide|slide-frame)["']|\bclassList\.add\(\s*["'](?:slide|slide-frame)["']/i;
const PPTX_OBJECT_PATTERN = /\bdata-pptx-(?:shape|text|image)\b/i;
const inflateRawAsync = promisify(inflateRaw);
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let entry = value;
  for (let bit = 0; bit < 8; bit += 1) entry = entry & 1 ? 0xedb88320 ^ (entry >>> 1) : entry >>> 1;
  return entry >>> 0;
});

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
  delete(workspaceId: string, templateId: string): void;
  getSession(workspaceId: string, sessionId: string): TemplateSessionRow | undefined;
  listSessions(workspaceId: string): TemplateSessionRow[];
  upsertSession(row: TemplateSessionRow): void;
  close(): void;
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

export function resolveBundledTemplatesRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const configuredPath = process.env.IPOLLOWORK_BUNDLED_TEMPLATES_DIR?.trim();
  const resourcesPath = typeof process.resourcesPath === "string" && process.resourcesPath.trim()
    ? process.resourcesPath.trim()
    : "";
  const candidates = [
    ...(configuredPath ? [resolve(configuredPath)] : []),
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
    const remove = sqlite.query("DELETE FROM template_installations WHERE workspace_id = ? AND template_id = ?");
    const getSession = sqlite.query("SELECT workspace_id AS workspaceId, session_id AS sessionId, surface, template_id AS templateId, version, source_type AS sourceType, entry, brief_path AS briefPath, manifest_json AS manifestJson, created_at AS createdAt FROM template_session_snapshots WHERE workspace_id = ? AND session_id = ?");
    const listSessions = sqlite.query("SELECT workspace_id AS workspaceId, session_id AS sessionId, surface, template_id AS templateId, version, source_type AS sourceType, entry, brief_path AS briefPath, manifest_json AS manifestJson, created_at AS createdAt FROM template_session_snapshots WHERE workspace_id = ? ORDER BY created_at DESC, session_id");
    const upsertSession = sqlite.query("INSERT INTO template_session_snapshots (workspace_id, session_id, surface, template_id, version, source_type, entry, brief_path, manifest_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, session_id) DO UPDATE SET surface=excluded.surface, template_id=excluded.template_id, version=excluded.version, source_type=excluded.source_type, entry=excluded.entry, brief_path=excluded.brief_path, manifest_json=excluded.manifest_json, created_at=excluded.created_at");
    return {
      get: (workspaceId, templateId) => get.get(workspaceId, templateId) as InstallationRow | undefined,
      list: (workspaceId) => list.all(workspaceId) as InstallationRow[],
      upsert: (row) => { upsert.run(row.workspaceId, row.templateId, row.version, row.sourceType, row.packagePath, row.packageHash, row.status, row.manifestJson, row.installedAt, row.updatedAt); },
      delete: (workspaceId, templateId) => { remove.run(workspaceId, templateId); },
      getSession: (workspaceId, sessionId) => getSession.get(workspaceId, sessionId) as TemplateSessionRow | undefined,
      listSessions: (workspaceId) => listSessions.all(workspaceId) as TemplateSessionRow[],
      upsertSession: (row) => { upsertSession.run(row.workspaceId, row.sessionId, row.surface, row.templateId, row.version, row.sourceType, row.entry, row.briefPath, row.manifestJson, row.createdAt); },
      close: () => sqlite.close(),
    };
  }
  const { DatabaseSync } = await importNodeSqlite();
  const sqlite = new DatabaseSync(path);
  sqlite.exec(sql);
  const get = sqlite.prepare("SELECT workspace_id AS workspaceId, template_id AS templateId, version, source_type AS sourceType, package_path AS packagePath, package_hash AS packageHash, status, manifest_json AS manifestJson, installed_at AS installedAt, updated_at AS updatedAt FROM template_installations WHERE workspace_id = ? AND template_id = ?");
  const list = sqlite.prepare("SELECT workspace_id AS workspaceId, template_id AS templateId, version, source_type AS sourceType, package_path AS packagePath, package_hash AS packageHash, status, manifest_json AS manifestJson, installed_at AS installedAt, updated_at AS updatedAt FROM template_installations WHERE workspace_id = ? ORDER BY template_id");
  const upsert = sqlite.prepare("INSERT INTO template_installations (workspace_id, template_id, version, source_type, package_path, package_hash, status, manifest_json, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, template_id) DO UPDATE SET version=excluded.version, source_type=excluded.source_type, package_path=excluded.package_path, package_hash=excluded.package_hash, status=excluded.status, manifest_json=excluded.manifest_json, installed_at=excluded.installed_at, updated_at=excluded.updated_at");
  const remove = sqlite.prepare("DELETE FROM template_installations WHERE workspace_id = ? AND template_id = ?");
  const getSession = sqlite.prepare("SELECT workspace_id AS workspaceId, session_id AS sessionId, surface, template_id AS templateId, version, source_type AS sourceType, entry, brief_path AS briefPath, manifest_json AS manifestJson, created_at AS createdAt FROM template_session_snapshots WHERE workspace_id = ? AND session_id = ?");
  const listSessions = sqlite.prepare("SELECT workspace_id AS workspaceId, session_id AS sessionId, surface, template_id AS templateId, version, source_type AS sourceType, entry, brief_path AS briefPath, manifest_json AS manifestJson, created_at AS createdAt FROM template_session_snapshots WHERE workspace_id = ? ORDER BY created_at DESC, session_id");
  const upsertSession = sqlite.prepare("INSERT INTO template_session_snapshots (workspace_id, session_id, surface, template_id, version, source_type, entry, brief_path, manifest_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, session_id) DO UPDATE SET surface=excluded.surface, template_id=excluded.template_id, version=excluded.version, source_type=excluded.source_type, entry=excluded.entry, brief_path=excluded.brief_path, manifest_json=excluded.manifest_json, created_at=excluded.created_at");
  return {
    get: (workspaceId, templateId) => get.get(workspaceId, templateId) as unknown as InstallationRow | undefined,
    list: (workspaceId) => list.all(workspaceId) as unknown as InstallationRow[],
    upsert: (row) => { upsert.run(row.workspaceId, row.templateId, row.version, row.sourceType, row.packagePath, row.packageHash, row.status, row.manifestJson, row.installedAt, row.updatedAt); },
    delete: (workspaceId, templateId) => { remove.run(workspaceId, templateId); },
    getSession: (workspaceId, sessionId) => getSession.get(workspaceId, sessionId) as unknown as TemplateSessionRow | undefined,
    listSessions: (workspaceId) => listSessions.all(workspaceId) as unknown as TemplateSessionRow[],
    upsertSession: (row) => { upsertSession.run(row.workspaceId, row.sessionId, row.surface, row.templateId, row.version, row.sourceType, row.entry, row.briefPath, row.manifestJson, row.createdAt); },
    close: () => sqlite.close(),
  };
}

export async function disposeTemplateStore(config: ServerConfig): Promise<void> {
  const path = runtimeDbPath(config);
  const pending = dbByPath.get(path);
  if (!pending) return;
  dbByPath.delete(path);
  const db = await pending;
  db.close();
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

function crc32(data: Uint8Array): number {
  let checksum = 0xffffffff;
  for (const byte of data) checksum = CRC32_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
}

async function readZip(buffer: Buffer): Promise<ZipEntry[]> {
  if (buffer.byteLength > MAX_TEMPLATE_PACKAGE_BYTES) throw new ApiError(413, "template_package_too_large", "Template package exceeds 50 MB");
  let eocd = -1;
  for (let offset = Math.max(0, buffer.length - 65_557); offset <= buffer.length - 22; offset += 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) eocd = offset;
  }
  if (eocd < 0) throw new ApiError(400, "invalid_template_package", "The template package is not a valid ZIP archive");
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
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const directoryEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (directoryEnd > buffer.length) throw new ApiError(400, "invalid_template_package", "Invalid ZIP directory");
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor = directoryEnd;
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
    const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8");
    if (localName !== name) throw new ApiError(400, "invalid_template_package", `Mismatched ZIP entry: ${safeName}`);
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer | null = null;
    try {
      data = method === 0
        ? Buffer.from(compressed)
        : method === 8
          ? await inflateRawAsync(compressed, { maxOutputLength: Math.max(1, uncompressedSize) })
          : null;
    }
    catch { throw new ApiError(400, "invalid_template_package", `Corrupt ZIP entry: ${safeName}`); }
    if (!data || data.byteLength !== uncompressedSize) throw new ApiError(400, "invalid_template_package", `Unsupported or corrupt ZIP entry: ${safeName}`);
    if (crc32(data) !== expectedCrc) throw new ApiError(400, "invalid_template_package", `Checksum mismatch: ${safeName}`);
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

function decodeHtmlAttribute(value: string) {
  return value.replace(/&(?:quot|apos|amp|lt|gt|#\d+|#x[0-9a-f]+);/gi, (entity) => {
    const named = entity.toLowerCase();
    if (named === "&quot;") return '"';
    if (named === "&apos;") return "'";
    if (named === "&amp;") return "&";
    if (named === "&lt;") return "<";
    if (named === "&gt;") return ">";
    const numeric = named.startsWith("&#x")
      ? Number.parseInt(named.slice(3, -1), 16)
      : Number.parseInt(named.slice(2, -1), 10);
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 0x10ffff
      ? String.fromCodePoint(numeric)
      : entity;
  });
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
    declarations = JSON.parse(decodeHtmlAttribute(encodedDeclarations));
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
  if (isPlainObject(value) && typeof value.schemaVersion === "number" && value.schemaVersion !== 1) {
    throw new ApiError(400, "unsupported_template_schema", `Template manifest schema ${value.schemaVersion} is not supported`);
  }
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
  } else {
    if (manifest.category === "slides") {
      const entry = await readFile(join(directory, ...manifest.entry.split("/")), "utf8");
      if (!SLIDE_DOCUMENT_PATTERN.test(entry)) throw new ApiError(400, "invalid_slides_template", "Slide templates must contain at least one recognized slide element");
      if (manifest.pptxCompatibility && !PPTX_OBJECT_PATTERN.test(entry)) throw new ApiError(400, "invalid_pptx_template", "PPTX-compatible templates must contain editable PowerPoint object markers");
    }
    if (manifest.designSystem.variables.length === 0) return manifest;
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

export async function validateTemplatePackageDirectory(directory: string): Promise<TemplateValidationReport> {
  try {
    const manifest = await readManifest(resolve(directory));
    return {
      ready: true,
      surface: manifest.surface,
      entry: manifest.entry,
      manifest,
      issues: [],
    };
  } catch (error) {
    return {
      ready: false,
      surface: "design",
      entry: "entry.html",
      manifest: null,
      issues: [validationIssue(error)],
    };
  }
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
  const root = resolveBundledTemplatesRoot();
  const items: BundledTemplate[] = [];
  for (const name of await readdir(root)) {
    const directory = join(root, name);
    if (!(await stat(directory)).isDirectory()) continue;
    const manifest = await readManifest(directory);
    if (WITHDRAWN_BUNDLED_TEMPLATE_IDS.has(manifest.id)) continue;
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
    if (current?.status === "installed" && current.version === input.manifest.version && existsSync(current.packagePath)) {
      const currentHash = current.packageHash === input.hash ? input.hash : await hashDirectory(current.packagePath);
      if (currentHash === input.hash) {
        if (current.packageHash !== input.hash) db.upsert({ ...current, packageHash: input.hash, updatedAt: Date.now() });
        return { manifest: input.manifest, sourceType: input.sourceType, installed: true, installedVersion: current.version, updateAvailable: false, verified: input.sourceType !== "local" };
      }
      throw new ApiError(409, "template_version_conflict", "A different package with this template version is already installed");
    }
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

async function purgeWithdrawnBundledTemplates(config: ServerConfig, libraryId: string, bundled: readonly BundledTemplate[]) {
  const db = await templateDb(config);
  const activeIds = new Set(bundled.map((item) => item.manifest.id));
  const withdrawn = db.list(libraryId).filter((row) => row.sourceType === "bundled" && !activeIds.has(row.templateId));
  await Promise.all(withdrawn.map(async (row) => {
    db.delete(libraryId, row.templateId);
    await rm(row.packagePath, { recursive: true, force: true }).catch(() => undefined);
  }));
}

export async function listTemplates(config: ServerConfig, workspaceId: string, scope: TemplateLibraryScope = "personal"): Promise<TemplateCatalogItem[]> {
  const db = await templateDb(config);
  const libraryId = templateLibraryId(scope);
  const bundled = await bundledTemplates();
  if (!config.readOnly) await purgeWithdrawnBundledTemplates(config, libraryId, bundled);
  for (const item of bundled) {
    if (!config.readOnly && !db.get(libraryId, item.manifest.id)) await installDirectory({ config, workspaceId: libraryId, sourceType: "bundled", sourceDirectory: item.directory, manifest: item.manifest, hash: item.hash });
  }
  const rows = db.list(libraryId);
  const byId = new Map(rows.map((row) => [row.templateId, row]));
  const visibleBundled = scope === "personal"
    ? bundled.filter((item) => isCustomerVisibleBundledTemplate(item.manifest))
    : bundled;
  const items: TemplateCatalogItem[] = visibleBundled.map((item) => {
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

export async function installBundledTemplate(config: ServerConfig, workspaceId: string, templateId: string, scope: TemplateLibraryScope = "personal") {
  if (scope !== "personal") throw new ApiError(400, "enterprise_template_import_required", "Enterprise templates must be imported from their Enterprise Server");
  const item = (await bundledTemplates()).find((candidate) => candidate.manifest.id === templateId);
  if (!item) throw new ApiError(404, "template_not_found", "Bundled template not found");
  return installDirectory({ config, workspaceId: templateLibraryId(scope), sourceType: "bundled", sourceDirectory: item.directory, manifest: item.manifest, hash: item.hash });
}

export async function importTemplate(config: ServerConfig, workspaceId: string, archive: Uint8Array, declaredCategory?: string, scope: TemplateLibraryScope = "personal") {
  const category = declaredCategory ? templateCategorySchema.safeParse(declaredCategory) : null;
  if (category && !category.success) throw new ApiError(400, "invalid_template_category", "Choose a supported template category before importing");
  const buffer = Buffer.from(archive);
  const tempParent = await mkdtemp(join(tmpdir(), "ipollowork-import-"));
  const sourceDirectory = join(tempParent, "package");
  try {
    await mkdir(sourceDirectory, { recursive: true });
    for (const entry of await readZip(buffer)) {
      const target = join(sourceDirectory, ...entry.name.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.data, { flag: "wx" });
    }
    const manifest = await readManifest(sourceDirectory);
    if (category?.success && manifest.category !== category.data) {
      throw new ApiError(400, "template_category_mismatch", "The selected template category does not match manifest.json");
    }
    if (manifest.id.startsWith("ipollowork.")) throw new ApiError(400, "reserved_template_id", "Local templates cannot use the reserved ipollowork.* namespace");
    return await installDirectory({ config, workspaceId: templateLibraryId(scope), sourceType: "local", sourceDirectory, manifest, hash: await hashDirectory(sourceDirectory) });
  } finally { await rm(tempParent, { recursive: true, force: true }); }
}

function localTemplateId(title: string, scope: TemplateLibraryScope) {
  const stem = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "template";
  return `${scope === "personal" ? "personal" : "enterprise"}.${stem}.${randomUUID()}`;
}

function escapeSvgText(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

function personalTemplateCover(title: string, category: TemplateCategory, style: string) {
  const label = escapeSvgText(title.slice(0, 38));
  const detail = escapeSvgText(`${category} · ${style}`.slice(0, 42));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" role="img" aria-label="${label}"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#4f46e5"/></linearGradient></defs><rect width="960" height="540" fill="url(#g)"/><circle cx="785" cy="105" r="180" fill="#ffffff" fill-opacity=".1"/><circle cx="145" cy="500" r="230" fill="#a5b4fc" fill-opacity=".16"/><text x="64" y="250" fill="#ffffff" font-family="Inter,Arial,sans-serif" font-size="58" font-weight="700">${label}</text><text x="68" y="304" fill="#c7d2fe" font-family="Inter,Arial,sans-serif" font-size="24">${detail}</text></svg>`;
}

const AUTHORING_DESIGN_VARIABLES = [
  { id: "--ipw-color-bg", label: "Background", type: "color", group: "background" },
  { id: "--ipw-color-surface", label: "Surface", type: "color", group: "background" },
  { id: "--ipw-color-text", label: "Text", type: "color", group: "theme" },
  { id: "--ipw-color-primary", label: "Primary", type: "color", group: "theme" },
  { id: "--ipw-font-display", label: "Display font", type: "font", group: "typography" },
  { id: "--ipw-font-body", label: "Body font", type: "font", group: "typography" },
  { id: "--ipw-page-padding", label: "Page padding", type: "number", group: "components" },
  { id: "--ipw-card-radius", label: "Card radius", type: "number", group: "components" },
] satisfies TemplateManifestV1["designSystem"]["variables"];

const AUTHORING_DESIGN_TOKENS = `/* ipw-theme:start */
/* ipw-design-system: default */
:root {
  --ipw-color-bg: #f6f7f9;
  --ipw-color-surface: #ffffff;
  --ipw-color-text: #16181d;
  --ipw-color-muted: #667085;
  --ipw-color-border: #d9dde5;
  --ipw-color-primary: #2563eb;
  --ipw-color-secondary: #0f766e;
  --ipw-color-accent: #d97706;
  --ipw-color-on-primary: #ffffff;
  --ipw-font-display: ui-sans-serif, system-ui, sans-serif;
  --ipw-font-body: ui-sans-serif, system-ui, sans-serif;
  --ipw-type-scale: 1;
  --ipw-body-line-height: 1.55;
  --ipw-content-width: 1080px;
  --ipw-page-padding: 32px;
  --ipw-section-space: 80px;
  --ipw-button-radius: 8px;
  --ipw-card-bg: var(--ipw-color-surface);
  --ipw-card-border: var(--ipw-color-border);
  --ipw-card-radius: 14px;
  --ipw-card-shadow: 0 12px 32px rgb(15 23 42 / 10%);
}
/* ipw-theme:end */
`;

function authoringLabel(category: TemplateCategory, pptxCompatibility?: PptxCompatibility) {
  if (pptxCompatibility) return "Native editable PPT";
  return ({
    site: "Site",
    video: "Video",
    app: "App",
    slides: "Presentation",
    poster: "Poster",
    cards: "Cards",
    report: "Report",
    article: "Article",
    other: "Design",
  } satisfies Record<TemplateCategory, string>)[category];
}

function sessionScaffoldManifest(
  category: TemplateCategory,
  pptxCompatibility?: PptxCompatibility,
  purpose: NonNullable<TemplateAuthoringInput["purpose"]> = "template-authoring",
): TemplateManifestV1 {
  const surface: TemplateSurface = category === "video" ? "video" : "design";
  const label = authoringLabel(category, pptxCompatibility);
  const authoring = purpose === "template-authoring";
  return templateManifestV1Schema.parse({
    schemaVersion: 1,
    id: authoring
      ? `${TEMPLATE_AUTHORING_ID_PREFIX}${pptxCompatibility ? "pptx" : category}`
      : `ipollowork.delivery.${pptxCompatibility ? "pptx" : category}`,
    version: "1.0.0",
    kind: "design",
    category,
    subcategory: pptxCompatibility ? "native-pptx" : authoring ? "authoring" : "delivery",
    style: category === "video" ? "cinematic" : "minimal",
    tags: [authoring ? "authoring" : "delivery", category, ...(pptxCompatibility ? ["pptx-compatible"] : [])],
    pptxCompatibility,
    surface,
    title: authoring ? `${label} template draft` : `${label} deliverable`,
    description: authoring
      ? `A guided ${label.toLowerCase()} template draft created in iPolloWork.`
      : `A ${label.toLowerCase()} deliverable created in iPolloWork.`,
    cover: "cover.svg",
    entry: surface === "video" ? "index.html" : "entry.html",
    source: { name: authoring ? "iPolloWork template authoring" : "iPolloWork artifact delivery", license: "Private" },
    designSystem: {
      tokenVersion: 1,
      tokens: "design-tokens.css",
      editableGroups: ["theme", "background", "typography", "components"],
      variables: surface === "video"
        ? [
            { id: "title", label: "Title", type: "text", group: "content" },
            { id: "accent", label: "Accent", type: "color", group: "theme" },
          ]
        : AUTHORING_DESIGN_VARIABLES,
    },
    applyChecklist: surface === "video"
      ? ["Confirm composition duration and tracks.", "Keep animation deterministic.", "Validate every declared HyperFrames variable."]
      : category === "slides"
        ? ["Keep the 16:9 stage and slide roots stable.", ...(pptxCompatibility ? ["Keep editable PPT text, shape and image markers."] : []), "Verify theme switching without moving slide geometry."]
        : ["Use semantic responsive HTML.", "Keep reusable content and visual variables current.", "Verify theme switching without changing structure."],
    minimumAppVersion: pkg.version.replace(/-.+$/, ""),
  });
}

function sessionScaffoldEntry(
  manifest: TemplateManifestV1,
  purpose: NonNullable<TemplateAuthoringInput["purpose"]>,
) {
  const authoring = purpose === "template-authoring";
  const videoTitle = authoring ? "Untitled video template" : "Untitled video";
  if (manifest.surface === "video") {
    return `<!doctype html>
<html lang="en" data-composition-variables='[{"id":"title","type":"string","label":"Title","default":"${videoTitle}"},{"id":"accent","type":"color","label":"Accent","default":"#2563eb"}]'>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${authoring ? "Video template draft" : "Video deliverable"}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; }
    body { overflow: hidden; background: var(--ipw-color-bg); color: var(--ipw-color-text); font-family: var(--ipw-font-body); line-height: var(--ipw-body-line-height); }
    .scene { position: absolute; inset: 0; display: grid; place-items: center; padding: var(--ipw-page-padding); background: var(--ipw-color-bg); border-radius: var(--ipw-card-radius); }
    h1 { max-width: 14ch; margin: 0; color: var(--accent, var(--ipw-color-primary)); font: 700 calc(96px * var(--ipw-type-scale))/1 var(--ipw-font-display); text-align: center; text-shadow: var(--ipw-card-shadow); }
  </style>
  <link rel="stylesheet" href="design-tokens.css" data-ipw-design-tokens>
</head>
<body>
  <main data-composition-id="main" data-start="0" data-duration="8" data-width="1920" data-height="1080">
    <section class="scene" data-track="visual" data-clip="intro" data-start="0" data-duration="8">
      <h1 data-var-text="title">${videoTitle}</h1>
    </section>
  </main>
</body>
</html>
`;
  }
  if (manifest.category === "slides") {
    const slideDescription = authoring
      ? "Describe the purpose, audience, and reusable story structure."
      : "The presentation deliverable is ready for AI generation.";
    const editable = manifest.pptxCompatibility
      ? `<p data-pptx-text>${slideDescription}</p><div class="shape" data-pptx-shape="rect" aria-hidden="true"></div><img data-pptx-image src="cover.svg" alt="${authoring ? "Template" : "Presentation"} placeholder">`
      : `<p>${slideDescription}</p>`;
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${authoring ? "Presentation template draft" : "Presentation deliverable"}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; }
    body { display: grid; place-items: center; overflow: hidden; background: #d9dde5; font-family: var(--ipw-font-body); }
    .stage { position: relative; width: min(100vw, calc(100vh * 16 / 9)); aspect-ratio: 16 / 9; overflow: hidden; background: var(--ipw-color-bg); color: var(--ipw-color-text); }
    .slide { position: absolute; inset: 0; display: grid; align-content: center; gap: 24px; padding: 72px; }
    h1 { max-width: 13ch; margin: 0; font: 700 64px/1 var(--ipw-font-display); }
    p { max-width: 48ch; margin: 0; color: var(--ipw-color-muted); font-size: 20px; }
    .shape { width: 180px; height: 18px; background: var(--ipw-color-primary); border-radius: var(--ipw-button-radius); }
    img { position: absolute; right: 48px; bottom: 48px; width: 160px; height: 90px; object-fit: cover; }
  </style>
  <link rel="stylesheet" href="design-tokens.css" data-ipw-design-tokens>
</head>
<body>
  <main class="stage" data-ipw-template-kind="slides">
    <section class="slide" data-ipw-slide="1" data-title="Cover">
      <h1${manifest.pptxCompatibility ? " data-pptx-text" : ""}>${authoring ? "Untitled presentation template" : "Untitled presentation"}</h1>
      ${editable}
    </section>
  </main>
</body>
</html>
`;
  }
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${manifest.title}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--ipw-color-bg); color: var(--ipw-color-text); font-family: var(--ipw-font-body); }
    main { width: min(100% - 32px, var(--ipw-content-width)); margin: 0 auto; padding: var(--ipw-section-space) var(--ipw-page-padding); }
    section { padding: 40px; border: 1px solid var(--ipw-card-border); border-radius: var(--ipw-card-radius); background: var(--ipw-card-bg); box-shadow: var(--ipw-card-shadow); }
    h1 { max-width: 14ch; margin: 0 0 20px; font: 700 calc(56px * var(--ipw-type-scale)) / 1 var(--ipw-font-display); }
    p { max-width: 60ch; margin: 0; color: var(--ipw-color-muted); line-height: var(--ipw-body-line-height); }
  </style>
  <link rel="stylesheet" href="design-tokens.css" data-ipw-design-tokens>
</head>
<body>
  <main data-ipw-template-kind="${manifest.category}">
    <section>
      <h1>Untitled ${authoringLabel(manifest.category).toLowerCase()}${authoring ? " template" : ""}</h1>
      <p>${authoring ? "Describe the purpose, audience, reusable content structure, variables, and visual direction with AI." : "The deliverable is ready for AI generation."}</p>
    </section>
  </main>
</body>
</html>
`;
}

async function writeSessionScaffoldPackage(
  directory: string,
  manifest: TemplateManifestV1,
  purpose: NonNullable<TemplateAuthoringInput["purpose"]>,
) {
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    writeFile(join(directory, manifest.entry), sessionScaffoldEntry(manifest, purpose), "utf8"),
    writeFile(join(directory, "design-tokens.css"), AUTHORING_DESIGN_TOKENS, "utf8"),
    writeFile(join(directory, "cover.svg"), personalTemplateCover(manifest.title, manifest.category, manifest.style), "utf8"),
    writeFile(join(directory, "brief.json"), `${JSON.stringify({ mode: purpose, category: manifest.category, pptxCompatibility: manifest.pptxCompatibility ?? null }, null, 2)}\n`, "utf8"),
  ]);
}

export async function createTemplateAuthoringSession(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  input: TemplateAuthoringInput,
): Promise<TemplateSessionSnapshot> {
  if (workspace.workspaceType !== "local" || !workspace.path) throw new ApiError(409, "template_authoring_requires_local_workspace", "Template authoring requires a local workspace");
  const category = templateCategorySchema.safeParse(input.category);
  if (!category.success) throw new ApiError(400, "invalid_template_category", "Unsupported template category");
  const compatibility = input.pptxCompatibility === undefined ? undefined : pptxCompatibilitySchema.safeParse(input.pptxCompatibility);
  if (compatibility && !compatibility.success) throw new ApiError(400, "invalid_pptx_compatibility", "Unsupported PPT compatibility mode");
  if (compatibility?.data && category.data !== "slides") throw new ApiError(400, "invalid_pptx_compatibility", "PPT compatibility is only available for presentations");
  const purpose = input.purpose ?? "template-authoring";
  if (purpose !== "template-authoring" && purpose !== "artifact-delivery") throw new ApiError(400, "invalid_template_session_purpose", "Unsupported template session purpose");
  const manifest = sessionScaffoldManifest(category.data, compatibility?.data, purpose);
  const root = sessionRoot(workspace, input.sessionId, manifest.surface);
  return withTemplateLock(`${runtimeDbPath(config)}:${workspace.id}:authoring:${input.sessionId}`, async () => {
    const db = await templateDb(config);
    if (db.getSession(workspace.id, input.sessionId) || existsSync(root)) throw new ApiError(409, "template_session_exists", "This session already has a template project");
    const staged = `${root}.tmp-${randomUUID()}`;
    let moved = false;
    try {
      await writeSessionScaffoldPackage(staged, manifest, purpose);
      await readManifest(staged);
      const now = Date.now();
      const folder = manifest.surface === "video" ? "video" : "design";
      const row: TemplateSessionRow = {
        workspaceId: workspace.id,
        sessionId: input.sessionId,
        surface: manifest.surface,
        templateId: manifest.id,
        version: manifest.version,
        sourceType: "local",
        entry: `${folder}/${input.sessionId}/${manifest.entry}`,
        briefPath: `${folder}/${input.sessionId}/brief.json`,
        manifestJson: JSON.stringify(manifest),
        createdAt: now,
      };
      await mkdir(dirname(root), { recursive: true });
      await rename(staged, root);
      moved = true;
      db.upsertSession(row);
      return snapshotFromRow(row);
    } catch (error) {
      await rm(staged, { recursive: true, force: true });
      if (moved) await rm(root, { recursive: true, force: true });
      throw error;
    }
  });
}

async function sessionEntryPath(db: TemplateDb, workspaceId: string, sessionId: string, surface: TemplateSurface) {
  const folder = surface === "video" ? "video" : "design";
  const fallback = surface === "video" ? "index.html" : "entry.html";
  const snapshot = db.getSession(workspaceId, sessionId);
  const prefix = `${folder}/${sessionId}/`;
  if (snapshot?.surface === surface && snapshot.entry.startsWith(prefix)) return safeRelativePath(snapshot.entry.slice(prefix.length));
  return fallback;
}

type PreparedSessionPackage = {
  directory: string;
  dispose: () => Promise<void>;
  manifest: TemplateManifestV1;
  snapshot: TemplateSessionSnapshot;
  issues: TemplateValidationIssue[];
};

function validationIssue(error: unknown): TemplateValidationIssue {
  if (isApiError(error)) return { code: error.code, severity: "error", message: error.message };
  return { code: "template_validation_failed", severity: "error", message: error instanceof Error ? error.message : "Template validation failed" };
}

async function normalizeStagedCover(directory: string): Promise<TemplateValidationIssue[]> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")); }
  catch { return []; }
  if (!isPlainObject(raw)) return [];
  const category = templateCategorySchema.safeParse(raw.category);
  const style = templateStyleSchema.safeParse(raw.style);
  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 96) : "Template";
  if (!category.success || !style.success || !title) return [];
  let usable = false;
  if (typeof raw.cover === "string") {
    try {
      const cover = validateStaticFile(raw.cover);
      usable = existsSync(join(directory, ...cover.split("/")));
    } catch { usable = false; }
  }
  if (usable) return [];
  raw.cover = "cover.svg";
  await writeFile(join(directory, "cover.svg"), personalTemplateCover(title, category.data, style.data), "utf8");
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return [{ code: "template_cover_generated", severity: "warning", path: "cover", message: "A 960 x 540 cover will be generated when the template is saved." }];
}

async function prepareSessionPackage(config: ServerConfig, workspace: WorkspaceInfo, sessionId: string): Promise<PreparedSessionPackage> {
  const db = await templateDb(config);
  const row = db.getSession(workspace.id, sessionId);
  if (!row) throw new ApiError(404, "template_session_not_found", "This session cannot be saved because it has no template snapshot");
  const snapshot = snapshotFromRow(row);
  const sourceRoot = sessionRoot(workspace, sessionId, snapshot.surface);
  if (!existsSync(sourceRoot)) throw new ApiError(409, "template_source_missing", "The current template project is missing");
  const tempParent = await mkdtemp(join(tmpdir(), "ipollowork-session-template-"));
  const directory = join(tempParent, "package");
  try {
    await cp(sourceRoot, directory, { recursive: true, errorOnExist: true });
    await Promise.all(SESSION_TEMPLATE_EXCLUDED_PATHS.map((name) => rm(join(directory, name), { recursive: true, force: true })));
    const issues = await normalizeStagedCover(directory);
    const manifest = await readManifest(directory);
    if (manifest.surface !== snapshot.surface) throw new ApiError(409, "template_surface_changed", "Template surface cannot be changed while authoring");
    if (snapshot.authoring && manifest.category !== snapshot.manifest.category) throw new ApiError(409, "template_category_changed", "Template category cannot be changed while authoring");
    if (snapshot.authoring && manifest.pptxCompatibility !== snapshot.manifest.pptxCompatibility) throw new ApiError(409, "template_pptx_mode_changed", "PPT editability mode cannot be changed while authoring");
    return {
      directory,
      manifest,
      snapshot,
      issues,
      dispose: () => rm(tempParent, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempParent, { recursive: true, force: true });
    throw error;
  }
}

async function prepareLegacySessionPackage(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  input: { sessionId: string; category: TemplateCategory; title: string; description?: string },
): Promise<PreparedSessionPackage> {
  const surface: TemplateSurface = input.category === "video" ? "video" : "design";
  const sourceRoot = sessionRoot(workspace, input.sessionId, surface);
  if (!existsSync(sourceRoot)) throw new ApiError(409, "template_source_missing", "Create a design or video before saving it as a template");
  const entry = await sessionEntryPath(await templateDb(config), workspace.id, input.sessionId, surface);
  if (!existsSync(join(sourceRoot, ...entry.split("/")))) throw new ApiError(409, "template_entry_missing", "The current template entry is missing");
  const tempParent = await mkdtemp(join(tmpdir(), "ipollowork-legacy-session-template-"));
  const directory = join(tempParent, "package");
  try {
    await cp(sourceRoot, directory, { recursive: true, errorOnExist: true });
    await Promise.all(SESSION_TEMPLATE_EXCLUDED_PATHS.map((name) => rm(join(directory, name), { recursive: true, force: true })));
    const manifest = templateManifestV1Schema.parse({
      schemaVersion: 1,
      id: `personal.legacy.${randomUUID()}`,
      version: "1.0.0",
      kind: "design",
      category: input.category,
      subcategory: "custom",
      style: "custom",
      tags: [],
      surface,
      title: input.title,
      description: input.description?.trim().slice(0, 240) || `Personal ${input.category} template`,
      cover: "cover.svg",
      entry,
      source: { name: "Personal template", license: "Private" },
      designSystem: {
        tokenVersion: 1,
        tokens: existsSync(join(directory, "design-tokens.css")) ? "design-tokens.css" : undefined,
        editableGroups: ["theme", "background", "typography", "components"],
        variables: [],
      },
      applyChecklist: ["Update copy, visual tokens, assets and calls to action."],
      minimumAppVersion: pkg.version.replace(/-.+$/, ""),
    });
    await writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(join(directory, "cover.svg"), personalTemplateCover(manifest.title, manifest.category, manifest.style), "utf8");
    const verified = await readManifest(directory);
    const now = Date.now();
    const folder = surface === "video" ? "video" : "design";
    return {
      directory,
      manifest: verified,
      issues: [],
      snapshot: {
        sessionId: input.sessionId,
        surface,
        authoring: false,
        state: {
          schemaVersion: 1,
          template: { id: verified.id, version: verified.version, sourceType: "local" },
          entry: `${folder}/${input.sessionId}/${entry}`,
          briefPath: `${folder}/${input.sessionId}/brief.json`,
          createdAt: now,
        },
        manifest: verified,
      },
      dispose: () => rm(tempParent, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempParent, { recursive: true, force: true });
    throw error;
  }
}

export async function validateTemplateFromSession(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
): Promise<TemplateValidationReport> {
  const db = await templateDb(config);
  const row = db.getSession(workspace.id, sessionId);
  if (!row) throw new ApiError(404, "template_session_not_found", "This session cannot be saved because it has no template snapshot");
  const snapshot = snapshotFromRow(row);
  const fallbackEntry = await sessionEntryPath(db, workspace.id, sessionId, snapshot.surface);
  try {
    const prepared = await prepareSessionPackage(config, workspace, sessionId);
    try {
      return {
        ready: true,
        surface: prepared.manifest.surface,
        entry: prepared.manifest.entry,
        manifest: prepared.manifest,
        issues: prepared.issues,
      };
    } finally {
      await prepared.dispose();
    }
  } catch (error) {
    return {
      ready: false,
      surface: snapshot.surface,
      entry: fallbackEntry,
      manifest: null,
      issues: [validationIssue(error)],
    };
  }
}

type TemplateFromSessionInput = {
  sessionId: string;
  category: TemplateCategory;
  title: string;
  description?: string;
  subcategory?: string;
  style?: string;
  tags?: string[];
};

async function prepareTemplateFromSession(config: ServerConfig, workspace: WorkspaceInfo, input: TemplateFromSessionInput, scope: TemplateLibraryScope) {
  const category = templateCategorySchema.safeParse(input.category);
  if (!category.success) throw new ApiError(400, "invalid_template_category", "Unsupported template category");
  const title = input.title.trim().slice(0, 96);
  if (!title) throw new ApiError(400, "invalid_template_title", "Template title is required");
  const style = templateStyleSchema.safeParse(input.style?.trim() || "custom");
  if (!style.success) throw new ApiError(400, "invalid_template_style", "Unsupported template style");
  let prepared: PreparedSessionPackage;
  try {
    prepared = await prepareSessionPackage(config, workspace, input.sessionId);
  } catch (error) {
    if (isApiError(error) && error.code === "template_session_not_found") {
      prepared = await prepareLegacySessionPackage(config, workspace, { sessionId: input.sessionId, category: category.data, title, description: input.description });
    } else {
      throw new ApiError(409, "template_validation_failed", "Fix template validation issues before saving or exporting", { issues: [validationIssue(error)] });
    }
  }
  try {
    const surface: TemplateSurface = category.data === "video" ? "video" : "design";
    if (surface !== prepared.snapshot.surface) throw new ApiError(409, "template_category_mismatch", "The selected category does not match the current template surface");
    if (prepared.snapshot.authoring && category.data !== prepared.manifest.category) throw new ApiError(409, "template_category_changed", "Template category is locked for this authoring session");
    const tags = (input.tags ?? prepared.manifest.tags).map((tag) => tag.trim().slice(0, 32)).filter(Boolean).slice(0, 12);
    const template = templateManifestV1Schema.parse({
      ...prepared.manifest,
      id: localTemplateId(title, scope),
      version: "1.0.0",
      category: category.data,
      subcategory: input.subcategory?.trim().slice(0, 64) || prepared.manifest.subcategory,
      style: input.style?.trim() ? style.data : prepared.manifest.style,
      tags,
      pptxCompatibility: category.data === "slides" ? prepared.manifest.pptxCompatibility : undefined,
      surface,
      title,
      description: input.description?.trim().slice(0, 240) || prepared.manifest.description,
      source: { name: scope === "personal" ? "Personal template" : "Enterprise template", license: "Private" },
      minimumAppVersion: pkg.version.replace(/-.+$/, ""),
    });
    await writeFile(join(prepared.directory, "manifest.json"), `${JSON.stringify(template, null, 2)}\n`, "utf8");
    const verified = await readManifest(prepared.directory);
    return { ...prepared, manifest: verified };
  } catch (error) {
    await prepared.dispose();
    throw error;
  }
}

export async function saveTemplateFromSession(config: ServerConfig, workspace: WorkspaceInfo, input: TemplateFromSessionInput, scope: TemplateLibraryScope = "personal") {
  const prepared = await prepareTemplateFromSession(config, workspace, input, scope);
  try {
    return await installDirectory({
      config,
      workspaceId: templateLibraryId(scope),
      sourceType: "local",
      sourceDirectory: prepared.directory,
      manifest: prepared.manifest,
      hash: await hashDirectory(prepared.directory),
    });
  } finally {
    await prepared.dispose();
  }
}

export async function exportTemplateFromSession(config: ServerConfig, workspace: WorkspaceInfo, input: TemplateFromSessionInput) {
  const prepared = await prepareTemplateFromSession(config, workspace, input, "personal");
  try {
    const packaged = await archiveTemplateDirectory(prepared.directory);
    return { ...packaged, manifest: prepared.manifest };
  } finally {
    await prepared.dispose();
  }
}

export async function uninstallTemplate(config: ServerConfig, workspaceId: string, templateId: string, scope: TemplateLibraryScope = "personal") {
  const libraryId = templateLibraryId(scope);
  return withTemplateLock(`${runtimeDbPath(config)}:${libraryId}:${templateId}`, async () => {
    const db = await templateDb(config);
    const current = db.get(libraryId, templateId);
    if (!current) throw new ApiError(404, "template_not_found", "Template not found");
    if (current.packagePath) await rm(current.packagePath, { recursive: true, force: true });
    db.upsert({ ...current, status: "uninstalled", packagePath: "", updatedAt: Date.now() });
    return { ok: true };
  });
}

export async function readTemplateCover(config: ServerConfig, workspaceId: string, templateId: string, scope: TemplateLibraryScope = "personal") {
  const libraryId = templateLibraryId(scope);
  const item = (await listTemplates(config, workspaceId, scope)).find((candidate) => candidate.manifest.id === templateId);
  if (!item) throw new ApiError(404, "template_not_found", "Template not found");
  const db = await templateDb(config);
  const row = db.get(libraryId, templateId);
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

async function packageDirectoryFiles(directory: string): Promise<ZipEntry[]> {
  const files: ZipEntry[] = [];
  let archiveBytes = 22;
  async function visit(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const absolute = join(current, entry.name);
      const name = relative(directory, absolute).split(sep).join("/");
      if (entry.isSymbolicLink()) throw new ApiError(400, "invalid_template_package", `Symbolic links are not allowed: ${name}`);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      const metadata = await lstat(absolute);
      if (!entry.isFile() || !metadata.isFile()) throw new ApiError(400, "invalid_template_package", `Unsupported template file: ${name}`);
      const safeName = validateStaticFile(name, metadata.mode);
      const encodedName = Buffer.from(safeName);
      if (encodedName.byteLength > 0xffff) throw new ApiError(400, "invalid_template_package", `Template path is too long: ${safeName}`);
      if (files.length >= MAX_FILES) throw new ApiError(413, "template_package_too_large", "Template package contains more than 1,000 files");
      if (metadata.size > MAX_FILE_BYTES) throw new ApiError(413, "template_package_too_large", `${safeName} exceeds 25 MB`);
      const data = await readFile(absolute);
      if (data.byteLength > MAX_FILE_BYTES) throw new ApiError(413, "template_package_too_large", `${safeName} exceeds 25 MB`);
      archiveBytes += data.byteLength + 76 + (encodedName.byteLength * 2);
      if (archiveBytes > MAX_TEMPLATE_PACKAGE_BYTES) throw new ApiError(413, "template_package_too_large", "Template package exceeds 50 MB");
      files.push({ name: safeName, data });
    }
  }
  await visit(directory);
  return files;
}

function createStoredZip(files: readonly ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const checksum = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(file.data.byteLength, 18);
    local.writeUInt32LE(file.data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    localParts.push(local, name, file.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(file.data.byteLength, 20);
    central.writeUInt32LE(file.data.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.byteLength + name.byteLength + file.data.byteLength;
  }
  const centralSize = centralParts.reduce((size, part) => size + part.byteLength, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

async function archiveTemplateDirectory(directory: string) {
  const archive = createStoredZip(await packageDirectoryFiles(directory));
  if (archive.byteLength > MAX_TEMPLATE_PACKAGE_BYTES) throw new ApiError(413, "template_package_too_large", "Template package exceeds 50 MB");
  return { archive, digest: createHash("sha256").update(archive).digest("hex") };
}

export async function exportLocalTemplatePackage(config: ServerConfig, workspaceId: string, templateId: string, scope: TemplateLibraryScope = "personal") {
  if (scope !== "personal") throw new ApiError(400, "personal_template_export_required", "Only personal templates can be exported");
  const row = (await templateDb(config)).get(templateLibraryId(scope), templateId);
  if (!row || row.status !== "installed" || row.sourceType !== "local" || !existsSync(row.packagePath)) {
    throw new ApiError(404, "local_template_not_found", "Only installed personal templates can be exported");
  }
  const manifest = await readManifest(row.packagePath);
  if (manifest.id !== row.templateId || manifest.version !== row.version) {
    throw new ApiError(400, "invalid_template_manifest", "Template changed after installation");
  }
  return { ...await archiveTemplateDirectory(row.packagePath), manifest };
}

function sessionRoot(workspace: WorkspaceInfo, sessionId: string, surface: TemplateSurface = "design"): string {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(sessionId)) throw new ApiError(400, "invalid_session_id", "Invalid template session id");
  return join(workspace.path, surface === "video" ? "video" : "design", sessionId);
}

export async function materializeTemplate(config: ServerConfig, workspace: WorkspaceInfo, templateId: string, sessionId: string, brief?: unknown, scope: TemplateLibraryScope = "personal") {
  const db = await templateDb(config);
  const row = db.get(templateLibraryId(scope), templateId);
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
    await refreshTemplateSessionLogo(workspace, sessionId, manifest.surface, manifest.entry);
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

    const bundled = (await bundledTemplates()).find((candidate) => candidate.manifest.id === "ipollowork.html-anything.motion-frames");
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
    authoring: isTemplateAuthoringManifest(manifest),
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

async function currentIpolloWorkLogoPath() {
  const currentLogo = join(await resolveBundledTemplatesRoot(), "ipollowork.hyperframes.course-journey", "assets", "ipollowork-logo.svg");
  return existsSync(currentLogo) ? currentLogo : undefined;
}

async function refreshTemplateSessionLogo(workspace: WorkspaceInfo, sessionId: string, surface: TemplateSurface, entryFile?: string) {
  const root = sessionRoot(workspace, sessionId, surface);
  const currentLogo = await currentIpolloWorkLogoPath();
  const sessionLogo = join(root, "assets", "ipollowork-logo.svg");
  if (currentLogo) {
    await mkdir(dirname(sessionLogo), { recursive: true });
    await cp(currentLogo, sessionLogo, { force: true });
  }

  const entryPath = join(root, ...(entryFile ?? (surface === "video" ? "index.html" : "entry.html")).split("/"));
  if (!existsSync(entryPath)) return;
  const entry = await readFile(entryPath, "utf8");
  const logoTagPattern = surface === "video"
    ? /<img\b[^>]*\bdata-var-src=(['"])logoUrl\1[^>]*>/gi
    : /<img\b[^>]*\bdata-ipw-logo\b[^>]*>/gi;
  const repaired = entry.replace(logoTagPattern, (tag) => {
    const withCurrentSrc = tag.replace(/\ssrc\s*=\s*(["'])assets\/ipollowork-logo\.svg(?:\?v=\d+)?\1/i, ` src="${CURRENT_IPOLLOWORK_LOGO_URL}"`);
    const withMarker = /\bdata-ipw-logo-fallback\s*=/i.test(withCurrentSrc)
      ? withCurrentSrc.replace(/\sdata-ipw-logo-fallback\s*=\s*(["']).*?\1/i, ' data-ipw-logo-fallback="current"')
      : withCurrentSrc.replace(/\s*\/?>$/, (ending) => ` data-ipw-logo-fallback="current"${ending}`);
    return /\sonerror\s*=/i.test(withMarker)
      ? withMarker.replace(/\sonerror\s*=\s*(["']).*?\1/i, ` onerror="this.onerror=null;this.src='${CURRENT_IPOLLOWORK_LOGO_URL}'"`)
      : withMarker.replace(/\s*\/?>$/, (ending) => ` onerror="this.onerror=null;this.src='${CURRENT_IPOLLOWORK_LOGO_URL}'"${ending}`);
  });
  if (repaired !== entry) await writeFile(entryPath, repaired, "utf8");
}

export async function readTemplateSession(config: ServerConfig, workspace: WorkspaceInfo, sessionId: string): Promise<TemplateSessionSnapshot> {
  const row = (await templateDb(config)).getSession(workspace.id, sessionId);
  if (!row) throw new ApiError(404, "template_session_not_found", "This session has no template metadata");
  const snapshot = snapshotFromRow(row);
  const prefix = `${snapshot.surface === "video" ? "video" : "design"}/${sessionId}/`;
  const entryFile = snapshot.state.entry.startsWith(prefix) ? snapshot.state.entry.slice(prefix.length) : undefined;
  await refreshTemplateSessionLogo(workspace, sessionId, snapshot.surface, entryFile);
  return snapshot;
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
