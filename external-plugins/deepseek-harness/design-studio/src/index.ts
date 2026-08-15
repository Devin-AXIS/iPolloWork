import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import {
  isCustomerVisibleBundledTemplate,
  sortTemplatesForCatalog,
  templateManifestV1Schema,
  type TemplateCatalogItem,
  type TemplateManifestV1,
  type TemplateSessionSnapshot,
} from "../../../../packages/types/src/templates";

export type DeepSeekDesignStudioMode = "design" | "slides";
export type DeepSeekDesignStudioPluginOptions = {
  mode: DeepSeekDesignStudioMode;
  routeRoot: `/${string}`;
  studioTitle: string;
  defaultTemplateId: string;
  projectSuffix?: string;
};

type BundledTemplate = { directory: string; manifest: TemplateManifestV1 };
type Runtime = DeepSeekDesignStudioPluginOptions & {
  token: string;
  studioRoot: string;
  templatesRoot: string;
  templatePromise: Promise<BundledTemplate[]> | null;
  operations: Map<string, Promise<void>>;
};

const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_CATALOG_ENTRIES = 1_000;
const MAX_TEMPLATE_ENTRIES = 100;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : "";
}

function sendJson(res: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  res.end(body);
}

function requireToken(req: IncomingMessage, runtime: Runtime) {
  if (req.headers["x-ipollowork-design-token"] !== runtime.token) throw new HttpError(403, `${runtime.studioTitle} request is not authorized.`);
}

function safeRelativePath(value: string, prefix = "design/") {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!normalized || isAbsolute(normalized) || normalized.includes("\0")) throw new HttpError(400, "Invalid Design Studio file path.");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new HttpError(400, "Invalid Design Studio file path.");
  const prefixRoot = prefix.replace(/\/+$/, "");
  if (normalized !== prefixRoot && !normalized.startsWith(`${prefixRoot}/`)) throw new HttpError(403, "Design Studio can only access the workspace design folder.");
  return normalized;
}

function safeTemplatePath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!normalized || isAbsolute(normalized) || normalized.includes("\0") || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new HttpError(400, "Invalid template file path.");
  }
  return normalized;
}

function inside(root: string, target: string) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function verifiedExistingPath(root: string, requested: string) {
  const target = resolve(root, safeRelativePath(requested));
  if (!inside(root, target)) throw new HttpError(403, "File path escaped the workspace.");
  const canonical = await realpath(target).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") throw new HttpError(404, "Design Studio file was not found.");
    throw error;
  });
  if (!inside(root, canonical)) throw new HttpError(403, "Symbolic links outside the workspace are not allowed.");
  return canonical;
}

async function verifiedWritePath(root: string, requested: string) {
  const relativePath = safeRelativePath(requested);
  const target = resolve(root, relativePath);
  if (!inside(root, target)) throw new HttpError(403, "File path escaped the workspace.");
  let canonicalParent = root;
  for (const segment of relativePath.split("/").slice(0, -1)) {
    const next = resolve(canonicalParent, segment);
    const existing = await lstat(next).catch((error: unknown) => {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    });
    if (!existing) await mkdir(next);
    else if (!existing.isDirectory() && !existing.isSymbolicLink()) throw new HttpError(400, "A Design Studio folder path is not a directory.");
    canonicalParent = await realpath(next);
    if (!inside(root, canonicalParent)) throw new HttpError(403, "Symbolic links outside the workspace are not allowed.");
  }
  return resolve(canonicalParent, basename(target));
}

function workspaceRoot(ctx: Context, workspaceId: string) {
  const workspace = ctx.workspaceRegistry.get(workspaceId as WorkspaceId);
  if (!workspace) throw new HttpError(404, "DeepSeek Harness workspace was not found.");
  return workspace.path;
}

function projectSessionId(runtime: Runtime, sessionId: string) {
  if (!SESSION_ID.test(sessionId)) throw new HttpError(400, "Invalid session id.");
  const projectId = `${sessionId}${runtime.projectSuffix ?? ""}`;
  if (!SESSION_ID.test(projectId)) throw new HttpError(400, "Session id is too long for this Studio project.");
  return projectId;
}

async function requestJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_TEXT_BYTES) throw new HttpError(413, "Design Studio request is too large.");
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch { throw new HttpError(400, "Invalid JSON request."); }
}

function field(value: object, name: string) { return Reflect.get(value, name); }
function stringField(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `Missing ${name}.`);
  return value.trim();
}

async function ensureFile(path: string, content: string) {
  try { await writeFile(path, content, { encoding: "utf8", flag: "wx" }); }
  catch (error: unknown) { if (errorCode(error) !== "EEXIST") throw error; }
}

const DEFAULT_TOKENS = `/* ipw-theme:start */
:root {
  --ipw-color-bg: #f2f0eb; --ipw-color-surface: #ffffff; --ipw-color-text: #171717;
  --ipw-color-muted: #66645f; --ipw-color-border: #d7d3ca; --ipw-color-primary: #5b50e6;
  --ipw-color-secondary: #dcd8ff; --ipw-color-accent: #f26b38; --ipw-font-display: Georgia, serif;
  --ipw-font-body: Arial, sans-serif; --ipw-content-width: 1180px; --ipw-page-padding: 32px;
  --ipw-section-space: 96px; --ipw-card-bg: #ffffff; --ipw-card-border: #d7d3ca;
  --ipw-card-radius: 24px; --ipw-card-shadow: 0 24px 70px rgb(24 20 14 / 10%);
}
/* ipw-theme:end */
`;

function defaultManifest(runtime: Runtime): TemplateManifestV1 {
  const slides = runtime.mode === "slides";
  return {
    schemaVersion: 1, id: runtime.defaultTemplateId, version: "1.0.0", kind: "design",
    category: slides ? "slides" : "site", subcategory: slides ? "presentation" : "website", style: "minimal",
    tags: ["deepseek-harness", slides ? "ppt" : "studio"], surface: "design", title: runtime.studioTitle,
    description: `An editable ${runtime.studioTitle} document hosted by DeepSeek Harness.`, cover: "index.html", entry: "index.html",
    source: { name: "iPolloWork", license: "MIT" },
    designSystem: { tokenVersion: 1, editableGroups: ["theme", "background", "typography", "components"], tokens: "design-tokens.css", variables: [] },
    applyChecklist: ["Preserve the current document structure and linked design token contract."], minimumAppVersion: "0.21.2",
  };
}

function defaultHtml(runtime: Runtime) {
  if (runtime.mode === "slides") return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Untitled Presentation</title><link rel="stylesheet" href="design-tokens.css" data-ipw-design-tokens><style>*{box-sizing:border-box}body{margin:0;background:#d9dce2;color:var(--ipw-color-text);font-family:var(--ipw-font-body)}.slide{position:relative;width:1600px;height:900px;overflow:hidden;padding:96px;background:var(--ipw-color-bg)}.eyebrow{color:var(--ipw-color-primary);font-weight:700;letter-spacing:.12em;text-transform:uppercase}h1{max-width:12ch;margin:28px 0;font-family:var(--ipw-font-display);font-size:112px;line-height:.94;letter-spacing:-.055em}p{max-width:48ch;color:var(--ipw-color-muted);font-size:28px;line-height:1.5}</style></head><body><main class="slide" data-ipw-slide><div class="eyebrow">DeepSeek iPPT</div><h1>Shape the story.</h1><p>Ask DeepSeek Harness to build the narrative, then refine every slide directly in Studio.</p></main></body></html>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Untitled Design</title><link rel="stylesheet" href="design-tokens.css" data-ipw-design-tokens><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--ipw-color-bg);color:var(--ipw-color-text);font-family:var(--ipw-font-body)}main{width:min(var(--ipw-content-width),calc(100% - 2 * var(--ipw-page-padding)));margin:0 auto;padding:var(--ipw-section-space) 0}.eyebrow{color:var(--ipw-color-primary);font-weight:700;letter-spacing:.12em;text-transform:uppercase}h1{max-width:12ch;margin:18px 0;font-family:var(--ipw-font-display);font-size:clamp(3rem,9vw,7rem);line-height:.94;letter-spacing:-.055em}p{max-width:56ch;color:var(--ipw-color-muted);font-size:1.12rem;line-height:1.55}.card{margin-top:48px;padding:28px;border:1px solid var(--ipw-card-border);border-radius:var(--ipw-card-radius);background:var(--ipw-card-bg);box-shadow:var(--ipw-card-shadow)}</style></head><body data-ipw-theme-role="page"><main><div class="eyebrow">iPolloWork Design Studio</div><h1>Select anything. Shape everything.</h1><p>Ask DeepSeek Harness to create your design, then fine-tune every element directly in Studio.</p><section class="card" data-ipw-theme-role="card">Your design starts here.</section></main></body></html>`;
}

function allowsTemplate(runtime: Runtime, manifest: TemplateManifestV1) {
  return manifest.surface === "design" && isCustomerVisibleBundledTemplate(manifest)
    && (runtime.mode === "slides" ? manifest.category === "slides" : manifest.category !== "slides");
}

async function loadTemplates(runtime: Runtime) {
  const templates: BundledTemplate[] = [];
  for (const name of await readdir(runtime.templatesRoot)) {
    if (templates.length >= MAX_TEMPLATE_ENTRIES) throw new HttpError(500, "Template catalog is larger than the supported limit.");
    const directory = resolve(runtime.templatesRoot, name);
    const info = await stat(directory);
    if (!info.isDirectory()) continue;
    const parsed = templateManifestV1Schema.safeParse(JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")));
    if (parsed.success && allowsTemplate(runtime, parsed.data)) templates.push({ directory, manifest: parsed.data });
  }
  return templates;
}

function bundledTemplates(runtime: Runtime) {
  runtime.templatePromise ??= loadTemplates(runtime).catch((error) => { runtime.templatePromise = null; throw error; });
  return runtime.templatePromise;
}

async function templateSession(root: string, sessionId: string, runtime: Runtime): Promise<TemplateSessionSnapshot> {
  const projectId = projectSessionId(runtime, sessionId);
  const directory = await verifiedWritePath(root, `design/${projectId}/index.html`).then(dirname);
  const manifestPath = resolve(directory, "manifest.json");
  const existingManifest = await readFile(manifestPath, "utf8").catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  });
  const manifest = existingManifest ? templateManifestV1Schema.parse(JSON.parse(existingManifest)) : defaultManifest(runtime);
  if (!allowsTemplate(runtime, manifest) && manifest.id !== runtime.defaultTemplateId) throw new HttpError(409, `This project belongs to a different ${runtime.studioTitle} catalog.`);
  if (!existingManifest) {
    await Promise.all([
      ensureFile(resolve(directory, "index.html"), defaultHtml(runtime)), ensureFile(resolve(directory, "design-tokens.css"), DEFAULT_TOKENS),
      ensureFile(resolve(directory, "brief.json"), `${JSON.stringify({ title: runtime.studioTitle, createdBy: "deepseek-harness" }, null, 2)}\n`),
      ensureFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
    ]);
  }
  const entry = resolve(directory, safeTemplatePath(manifest.entry));
  const entryInfo = await stat(entry).catch(() => null);
  if (!entryInfo?.isFile()) throw new HttpError(404, "Template entry file was not found.");
  const sourceType = manifest.id === runtime.defaultTemplateId ? "local" : "bundled";
  return {
    sessionId, surface: "design", authoring: true,
    state: { schemaVersion: 1, template: { id: manifest.id, version: manifest.version, sourceType }, entry: `design/${projectId}/${manifest.entry}`, briefPath: `design/${projectId}/brief.json`, createdAt: entryInfo.birthtimeMs || Date.now() },
    manifest,
  };
}

async function readText(root: string, requested: string) {
  const path = await verifiedExistingPath(root, requested);
  const info = await stat(path);
  if (!info.isFile()) throw new HttpError(400, "Design Studio path is not a file.");
  if (info.size > MAX_TEXT_BYTES) throw new HttpError(413, "Design Studio file is too large.");
  return { path: requested, content: await readFile(path, "utf8"), bytes: info.size, updatedAt: info.mtimeMs };
}

async function writeText(root: string, requested: string, content: string, baseUpdatedAt?: number | null, force = false) {
  if (Buffer.byteLength(content) > MAX_TEXT_BYTES) throw new HttpError(413, "Design Studio file is too large.");
  const path = await verifiedWritePath(root, requested);
  const current = await stat(path).catch((error: unknown) => { if (errorCode(error) === "ENOENT") return null; throw error; });
  if (!force && baseUpdatedAt != null && current && Math.abs(current.mtimeMs - baseUpdatedAt) > 0.5) throw new HttpError(409, "The design changed since it was loaded. Reload before saving.");
  const temporary = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try { await writeFile(temporary, content, { encoding: "utf8", flag: "wx" }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => undefined); }
  const info = await stat(path);
  return { ok: true, path: requested, bytes: info.size, updatedAt: info.mtimeMs, revision: `${info.mtimeMs}-${info.size}` };
}

async function listFiles(root: string, requestedPrefix: string) {
  const prefix = requestedPrefix ? safeRelativePath(requestedPrefix) : "design";
  const start = await verifiedExistingPath(root, prefix).catch((error) => { if (error instanceof HttpError && error.status === 404) return null; throw error; });
  if (!start) return [];
  const items: Array<{ path: string; kind: "file" | "dir"; size: number; mtimeMs: number; revision: string }> = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch((error: unknown) => { if (errorCode(error) === "ENOENT") return []; throw error; })) {
      if (items.length >= MAX_CATALOG_ENTRIES) return;
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      const info = await stat(path);
      const workspacePath = relative(root, path).split(sep).join("/");
      items.push({ path: workspacePath, kind: entry.isDirectory() ? "dir" : "file", size: info.size, mtimeMs: info.mtimeMs, revision: `${info.mtimeMs}-${info.size}` });
      if (entry.isDirectory()) await walk(path);
    }
  };
  await walk(start);
  return items;
}

async function templateCatalog(runtime: Runtime): Promise<TemplateCatalogItem[]> {
  const sourceType: TemplateCatalogItem["sourceType"] = "bundled";
  const items: TemplateCatalogItem[] = (await bundledTemplates(runtime)).map(({ manifest }) => ({
    manifest, sourceType, installed: true, installedVersion: manifest.version, updateAvailable: false, verified: true,
  }));
  const byId = new Map(items.map((item) => [item.manifest.id, item]));
  return sortTemplatesForCatalog(items.map((item) => item.manifest))
    .map((manifest) => byId.get(manifest.id))
    .filter((item): item is TemplateCatalogItem => Boolean(item));
}

async function templateById(runtime: Runtime, templateId: string) {
  const template = (await bundledTemplates(runtime)).find((candidate) => candidate.manifest.id === templateId);
  if (!template) throw new HttpError(404, "Template was not found in this Studio catalog.");
  return template;
}

async function withOperationLock<T>(runtime: Runtime, key: string, operation: () => Promise<T>) {
  const previous = runtime.operations.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const tail = new Promise<void>((resolvePromise) => { release = resolvePromise; });
  const queued = previous.then(() => tail, () => tail);
  runtime.operations.set(key, queued);
  await previous.catch(() => undefined);
  try { return await operation(); }
  finally { release(); if (runtime.operations.get(key) === queued) runtime.operations.delete(key); }
}

async function applyTemplate(root: string, sessionId: string, templateId: string, runtime: Runtime) {
  const projectId = projectSessionId(runtime, sessionId);
  const template = await templateById(runtime, templateId);
  const designRoot = resolve(root, "design");
  const target = resolve(designRoot, projectId);
  const staged = resolve(designRoot, `.${projectId}.${randomUUID()}.staged`);
  const backup = resolve(designRoot, `.${projectId}.${randomUUID()}.replaced`);
  return withOperationLock(runtime, `${root}:${projectId}`, async () => {
    await mkdir(designRoot, { recursive: true });
    let movedCurrent = false;
    let installedNew = false;
    try {
      await cp(template.directory, staged, { recursive: true, errorOnExist: true });
      const stagedManifest = templateManifestV1Schema.parse(JSON.parse(await readFile(resolve(staged, "manifest.json"), "utf8")));
      if (stagedManifest.id !== template.manifest.id || stagedManifest.version !== template.manifest.version) throw new HttpError(409, "Template changed while it was being applied.");
      await writeFile(resolve(staged, "brief.json"), "{}\n", "utf8");
      const current = await lstat(target).catch((error: unknown) => { if (errorCode(error) === "ENOENT") return null; throw error; });
      if (current) {
        if (!current.isDirectory() || current.isSymbolicLink()) throw new HttpError(409, "The current Studio project path is not replaceable.");
        await rename(target, backup); movedCurrent = true;
      }
      await rename(staged, target);
      installedNew = true;
      const snapshot = await templateSession(root, sessionId, runtime);
      if (movedCurrent) await rm(backup, { recursive: true, force: true });
      return snapshot;
    } catch (error) {
      await rm(staged, { recursive: true, force: true });
      if (installedNew) await rm(target, { recursive: true, force: true });
      if (movedCurrent) await rename(backup, target).catch(() => undefined);
      throw error;
    }
  });
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8", ".gif": "image/gif", ".html": "text/html; charset=utf-8", ".jpeg": "image/jpeg", ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2",
};
function contentType(path: string) { return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream"; }

async function handleApi(runtime: Runtime, ctx: Context, req: IncomingMessage, res: ServerResponse, url: URL) {
  requireToken(req, runtime);
  const action = url.pathname.slice(`${runtime.routeRoot}/api`.length);
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  if (req.method === "GET" && action === "/session") {
    const sessionId = url.searchParams.get("sessionId")?.trim();
    if (!workspaceId || !sessionId) throw new HttpError(400, "Missing workspaceId or sessionId.");
    sendJson(res, 200, await templateSession(workspaceRoot(ctx, workspaceId), sessionId, runtime)); return;
  }
  if (req.method === "GET" && action === "/templates") {
    if (!workspaceId) throw new HttpError(400, "Missing workspaceId.");
    workspaceRoot(ctx, workspaceId); sendJson(res, 200, await templateCatalog(runtime)); return;
  }
  if (req.method === "GET" && action === "/template-cover") {
    const templateId = url.searchParams.get("templateId")?.trim();
    if (!workspaceId || !templateId) throw new HttpError(400, "Missing workspaceId or templateId.");
    workspaceRoot(ctx, workspaceId);
    const template = await templateById(runtime, templateId);
    const file = await realpath(resolve(template.directory, safeTemplatePath(template.manifest.cover)));
    if (!inside(template.directory, file)) throw new HttpError(403, "Template cover escaped its package.");
    const info = await stat(file);
    if (!info.isFile()) throw new HttpError(404, "Template cover was not found.");
    res.writeHead(200, { "content-type": contentType(file), "content-length": info.size, "cache-control": "public, max-age=86400" }); createReadStream(file).pipe(res); return;
  }
  if (req.method === "POST" && action === "/template") {
    const body = await requestJson(req);
    const bodyWorkspaceId = stringField(field(body, "workspaceId"), "workspaceId");
    sendJson(res, 200, await applyTemplate(workspaceRoot(ctx, bodyWorkspaceId), stringField(field(body, "sessionId"), "sessionId"), stringField(field(body, "templateId"), "templateId"), runtime)); return;
  }
  if (req.method === "GET" && action === "/files") {
    if (!workspaceId) throw new HttpError(400, "Missing workspaceId.");
    sendJson(res, 200, await listFiles(workspaceRoot(ctx, workspaceId), url.searchParams.get("prefix")?.trim() || "design")); return;
  }
  if (req.method === "GET" && action === "/file") {
    const path = url.searchParams.get("path")?.trim();
    if (!workspaceId || !path) throw new HttpError(400, "Missing workspaceId or path.");
    sendJson(res, 200, await readText(workspaceRoot(ctx, workspaceId), path)); return;
  }
  if (req.method === "POST" && action === "/file") {
    const body = await requestJson(req);
    const bodyWorkspaceId = stringField(field(body, "workspaceId"), "workspaceId");
    const path = stringField(field(body, "path"), "path");
    const content = field(body, "content");
    if (typeof content !== "string") throw new HttpError(400, "Missing content.");
    const rawBaseUpdatedAt = field(body, "baseUpdatedAt");
    sendJson(res, 200, await writeText(workspaceRoot(ctx, bodyWorkspaceId), path, content, typeof rawBaseUpdatedAt === "number" ? rawBaseUpdatedAt : null, field(body, "force") === true)); return;
  }
  if (req.method === "GET" && action === "/raw") {
    const path = url.searchParams.get("path")?.trim();
    if (!workspaceId || !path) throw new HttpError(400, "Missing workspaceId or path.");
    const file = await verifiedExistingPath(workspaceRoot(ctx, workspaceId), path);
    const info = await stat(file);
    if (!info.isFile()) throw new HttpError(400, "Design Studio path is not a file.");
    res.writeHead(200, { "content-type": contentType(file), "content-length": info.size, "content-disposition": `inline; filename="${basename(file).replace(/["\\]/g, "_")}"`, "cache-control": "no-store" });
    createReadStream(file).pipe(res); return;
  }
  throw new HttpError(404, `Unknown ${runtime.studioTitle} API route.`);
}

async function handleStatic(runtime: Runtime, res: ServerResponse, url: URL) {
  if (url.pathname === `${runtime.routeRoot}/studio`) { res.writeHead(307, { location: `${runtime.routeRoot}/studio/${url.search}` }); res.end(); return; }
  const requested = url.pathname.slice(`${runtime.routeRoot}/studio/`.length) || "index.html";
  if (requested.includes("\0") || requested.split("/").some((part) => part === "..")) throw new HttpError(400, "Invalid Studio asset path.");
  const path = resolve(runtime.studioRoot, requested);
  if (!inside(runtime.studioRoot, path)) throw new HttpError(403, "Studio asset path escaped its bundle.");
  const info = await stat(path).catch((error: unknown) => { if (errorCode(error) === "ENOENT") throw new HttpError(404, "Studio asset was not found."); throw error; });
  if (!info.isFile()) throw new HttpError(404, "Studio asset was not found.");
  if (basename(path) === "index.html") {
    const html = (await readFile(path, "utf8")).replace("__IPOLLOWORK_DESIGN_STUDIO_TOKEN_VALUE__", runtime.token);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html), "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "same-origin" });
    res.end(html); return;
  }
  res.writeHead(200, { "content-type": contentType(path), "content-length": info.size, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" }); createReadStream(path).pipe(res);
}

export function createDeepSeekDesignStudioPlugin(options: DeepSeekDesignStudioPluginOptions) {
  const runtime: Runtime = { ...options, token: randomBytes(32).toString("base64url"), studioRoot: resolve(packageRoot, "studio/dist"), templatesRoot: resolve(packageRoot, "lib/templates"), templatePromise: null, operations: new Map() };
  return {
    inject: ["webServer", "workspaceRegistry"],
    apply(ctx: Context): void {
      ctx.effect(() => ctx.webServer.register({
        kind: "prefix", path: runtime.routeRoot,
        handler: async (req, res) => {
          try {
            const url = new URL(req.url ?? runtime.routeRoot, "http://localhost");
            if (url.pathname.startsWith(`${runtime.routeRoot}/api`)) await handleApi(runtime, ctx, req, res, url);
            else if (url.pathname === `${runtime.routeRoot}/studio` || url.pathname.startsWith(`${runtime.routeRoot}/studio/`)) await handleStatic(runtime, res, url);
            else throw new HttpError(404, `${runtime.studioTitle} route was not found.`);
          } catch (error) {
            if (res.headersSent) { res.destroy(error instanceof Error ? error : undefined); return; }
            sendJson(res, error instanceof HttpError ? error.status : 500, { ok: false, message: error instanceof Error ? error.message : `${runtime.studioTitle} request failed.` });
          }
        },
      }), `${runtime.defaultTemplateId}: routes`);
    },
  };
}

const plugin = createDeepSeekDesignStudioPlugin({ mode: "design", routeRoot: "/ipollowork-design", studioTitle: "DeepSeek iDesign", defaultTemplateId: "ipollowork.deepseek-harness.design" });
export const inject = plugin.inject;
export const apply = plugin.apply;
