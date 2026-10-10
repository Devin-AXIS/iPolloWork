import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "@deepseek-ai/dsh-workspace";
import {
  isCustomerVisibleBundledTemplate,
  templateManifestV1Schema,
  type TemplateManifestV1,
  type TemplateSessionSnapshot,
} from "../../../../packages/types/src/templates";
import {
  contentType,
  errorCode,
  field,
  handleStudioStatic,
  readStudioText,
  requireStudioToken,
  requestObject as requestJson,
  safeAssetPath as safeTemplatePath,
  safeRelativePath as sharedSafeRelativePath,
  sendJson,
  stringField,
  StudioHttpError as HttpError,
  verifiedExistingPath as sharedVerifiedExistingPath,
  verifiedWritePath as sharedVerifiedWritePath,
  writeStudioText,
  workspaceRoot,
} from "../../studio-host/src/http";
import {
  applyBundledTemplate,
  loadBundledTemplates,
  streamTemplateCover,
  templateById as sharedTemplateById,
  templateCatalog as sharedTemplateCatalog,
  type BundledTemplate,
} from "../../studio-host/src/templates";

export type DeepSeekDesignStudioMode = "design" | "slides";
export type DeepSeekDesignStudioPluginOptions = {
  mode: DeepSeekDesignStudioMode;
  routeRoot: `/${string}`;
  studioTitle: string;
  defaultTemplateId: string;
  projectSuffix?: string;
};

type Runtime = DeepSeekDesignStudioPluginOptions & {
  token: string;
  studioRoot: string;
  templatesRoot: string;
  templatePromise: Promise<BundledTemplate[]> | null;
  operations: Map<string, Promise<void>>;
};

const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_CATALOG_ENTRIES = 1_000;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESIGN_STUDIO_FILES = {
  prefix: "design",
  studioTitle: "Design Studio",
  maxBytes: MAX_TEXT_BYTES,
  conflictMessage: "The design changed since it was loaded. Reload before saving.",
};

function requireToken(req: IncomingMessage, runtime: Runtime) {
  requireStudioToken(req, "x-ipollowork-design-token", runtime.token, runtime.studioTitle);
}

function safeRelativePath(value: string, prefix = "design/") {
  return sharedSafeRelativePath(value, prefix, "Design Studio");
}

async function verifiedExistingPath(root: string, requested: string) {
  return sharedVerifiedExistingPath(root, requested, "design", "Design Studio");
}

async function verifiedWritePath(root: string, requested: string) {
  return sharedVerifiedWritePath(root, requested, "design", "Design Studio");
}

function projectSessionId(runtime: Runtime, sessionId: string) {
  if (!SESSION_ID.test(sessionId)) throw new HttpError(400, "Invalid session id.");
  const projectId = `${sessionId}${runtime.projectSuffix ?? ""}`;
  if (!SESSION_ID.test(projectId)) throw new HttpError(400, "Session id is too long for this Studio project.");
  return projectId;
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
  return loadBundledTemplates(runtime.templatesRoot, (manifest) => allowsTemplate(runtime, manifest));
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
  return readStudioText({ root, requested, ...DESIGN_STUDIO_FILES });
}

async function writeText(root: string, requested: string, content: string, baseUpdatedAt?: number | null, force = false) {
  return writeStudioText({
    root, requested, content, baseUpdatedAt, force, ...DESIGN_STUDIO_FILES,
  });
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

async function templateCatalog(runtime: Runtime) {
  return sharedTemplateCatalog(await bundledTemplates(runtime));
}

async function templateById(runtime: Runtime, templateId: string) {
  return sharedTemplateById(await bundledTemplates(runtime), templateId);
}

async function applyTemplate(root: string, sessionId: string, templateId: string, runtime: Runtime) {
  const projectId = projectSessionId(runtime, sessionId);
  const template = await templateById(runtime, templateId);
  const designRoot = resolve(root, "design");
  return applyBundledTemplate({
    operations: runtime.operations,
    operationKey: `${root}:${projectId}`,
    template,
    projectsRoot: designRoot,
    projectId,
    validateInstalled: () => templateSession(root, sessionId, runtime),
  });
}

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
    await streamTemplateCover(res, await templateById(runtime, templateId)); return;
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
            else if (url.pathname === `${runtime.routeRoot}/studio` || url.pathname.startsWith(`${runtime.routeRoot}/studio/`)) await handleStudioStatic({
              routeRoot: runtime.routeRoot,
              studioRoot: runtime.studioRoot,
              token: runtime.token,
              tokenPlaceholder: "__IPOLLOWORK_DESIGN_STUDIO_TOKEN_VALUE__",
              res,
              url,
            });
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
