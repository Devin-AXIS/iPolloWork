import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type { WorkspaceId } from "@deepseek-ai/dsh-workspace";

export const inject = ["webServer", "workspaceRegistry"];

const ROUTE_ROOT = "/ipollowork-design";
const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_CATALOG_ENTRIES = 1_000;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const token = randomBytes(32).toString("base64url");
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const studioRoot = resolve(packageRoot, "studio/dist");

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function requireToken(req: IncomingMessage) {
  if (req.headers["x-ipollowork-design-token"] !== token) {
    throw new HttpError(403, "Design Studio request is not authorized.");
  }
}

function safeRelativePath(value: string, prefix = "design/") {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!normalized || isAbsolute(normalized) || normalized.includes("\0")) {
    throw new HttpError(400, "Invalid Design Studio file path.");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new HttpError(400, "Invalid Design Studio file path.");
  }
  const prefixRoot = prefix.replace(/\/+$/, "");
  if (normalized !== prefixRoot && !normalized.startsWith(`${prefixRoot}/`)) {
    throw new HttpError(403, "Design Studio can only access the workspace design folder.");
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
  const canonical = await realpath(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new HttpError(404, "Design Studio file was not found.");
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
    const existing = await lstat(next).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!existing) {
      await mkdir(next);
    } else if (!existing.isDirectory() && !existing.isSymbolicLink()) {
      throw new HttpError(400, "A Design Studio folder path is not a directory.");
    }
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

async function requestJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_TEXT_BYTES) throw new HttpError(413, "Design Studio file is too large.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid JSON request.");
  }
}

function stringField(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `Missing ${name}.`);
  return value.trim();
}

async function ensureFile(path: string, content: string) {
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

const DEFAULT_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Untitled Design</title>
  <link rel="stylesheet" href="design-tokens.css" data-ipw-design-tokens>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--ipw-color-bg); color: var(--ipw-color-text); font-family: var(--ipw-font-body); }
    main { width: min(var(--ipw-content-width), calc(100% - 2 * var(--ipw-page-padding))); margin: 0 auto; padding: var(--ipw-section-space) 0; }
    .eyebrow { color: var(--ipw-color-primary); font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { max-width: 12ch; margin: 18px 0; font-family: var(--ipw-font-display); font-size: clamp(3rem, 9vw, 7rem); line-height: .94; letter-spacing: -.055em; }
    p { max-width: 56ch; color: var(--ipw-color-muted); font-size: 1.12rem; line-height: var(--ipw-body-line-height); }
    .card { margin-top: 48px; padding: 28px; border: 1px solid var(--ipw-card-border); border-radius: var(--ipw-card-radius); background: var(--ipw-card-bg); box-shadow: var(--ipw-card-shadow); }
  </style>
</head>
<body data-ipw-theme-role="page">
  <main>
    <div class="eyebrow">iPolloWork Design Studio</div>
    <h1>Select anything. Shape everything.</h1>
    <p>Start with this canvas, ask DeepSeek Harness to create your design, then fine-tune every element directly in Studio.</p>
    <section class="card" data-ipw-theme-role="card">Your design starts here.</section>
  </main>
</body>
</html>
`;

const DEFAULT_TOKENS = `/* ipw-theme:start */
:root {
  --ipw-color-bg: #f2f0eb;
  --ipw-color-surface: #ffffff;
  --ipw-color-text: #171717;
  --ipw-color-muted: #66645f;
  --ipw-color-border: #d7d3ca;
  --ipw-color-primary: #5b50e6;
  --ipw-color-secondary: #dcd8ff;
  --ipw-color-accent: #f26b38;
  --ipw-color-success: #25865b;
  --ipw-color-warning: #ad721c;
  --ipw-color-danger: #bd3f47;
  --ipw-color-on-primary: #ffffff;
  --ipw-font-display: Georgia, serif;
  --ipw-font-body: Arial, sans-serif;
  --ipw-type-scale: 1;
  --ipw-body-line-height: 1.55;
  --ipw-content-width: 1180px;
  --ipw-page-padding: 32px;
  --ipw-section-space: 96px;
  --ipw-button-radius: 999px;
  --ipw-card-bg: #ffffff;
  --ipw-card-border: #d7d3ca;
  --ipw-card-radius: 24px;
  --ipw-card-shadow: 0 24px 70px rgb(24 20 14 / 10%);
}
/* ipw-theme:end */
`;

async function templateSession(root: string, sessionId: string) {
  if (!SESSION_ID.test(sessionId)) throw new HttpError(400, "Invalid session id.");
  const directory = await verifiedWritePath(root, `design/${sessionId}/index.html`).then(dirname);
  const entry = resolve(directory, "index.html");
  const tokenPath = resolve(directory, "design-tokens.css");
  const brief = resolve(directory, "brief.json");
  await Promise.all([
    ensureFile(entry, DEFAULT_HTML),
    ensureFile(tokenPath, DEFAULT_TOKENS),
    ensureFile(brief, JSON.stringify({ title: "Untitled Design", createdBy: "deepseek-harness" }, null, 2)),
  ]);
  const source = await readFile(entry, "utf8");
  const category = /data-ipw-slide|class\s*=\s*["'][^"']*\b(?:slide|slide-frame)\b/i.test(source) ? "slides" : "site";
  const createdAt = (await stat(entry)).birthtimeMs || Date.now();
  return {
    sessionId,
    surface: "design",
    authoring: true,
    state: {
      schemaVersion: 1,
      template: { id: "ipollowork.deepseek-harness.design", version: "1.0.0", sourceType: "local" },
      entry: `design/${sessionId}/index.html`,
      briefPath: `design/${sessionId}/brief.json`,
      createdAt,
    },
    manifest: {
      schemaVersion: 1,
      id: "ipollowork.deepseek-harness.design",
      version: "1.0.0",
      kind: "design",
      category,
      subcategory: category === "slides" ? "presentation" : "website",
      style: "minimal",
      tags: ["deepseek-harness", "studio"],
      surface: "design",
      title: "DeepSeek Harness Design",
      description: "An editable iPolloWork Design Studio document hosted by DeepSeek Harness.",
      cover: "index.html",
      entry: "index.html",
      source: { name: "iPolloWork", license: "MIT" },
      designSystem: {
        tokenVersion: 1,
        editableGroups: ["theme", "background", "typography", "components"],
        tokens: "design-tokens.css",
        variables: [],
      },
      applyChecklist: ["Preserve the current document structure and linked design token contract."],
      minimumAppVersion: "0.21.2",
    },
  };
}

async function readText(root: string, requested: string) {
  const path = await verifiedExistingPath(root, requested);
  const info = await stat(path);
  if (!info.isFile()) throw new HttpError(400, "Design Studio path is not a file.");
  if (info.size > MAX_TEXT_BYTES) throw new HttpError(413, "Design Studio file is too large.");
  return {
    path: requested,
    content: await readFile(path, "utf8"),
    bytes: info.size,
    updatedAt: info.mtimeMs,
  };
}

async function writeText(root: string, requested: string, content: string, baseUpdatedAt?: number | null, force = false) {
  if (Buffer.byteLength(content) > MAX_TEXT_BYTES) throw new HttpError(413, "Design Studio file is too large.");
  const path = await verifiedWritePath(root, requested);
  const current = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!force && baseUpdatedAt != null && current && Math.abs(current.mtimeMs - baseUpdatedAt) > 0.5) {
    throw new HttpError(409, "The design changed since it was loaded. Reload before saving.");
  }
  const temporary = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  const info = await stat(path);
  return { ok: true, path: requested, bytes: info.size, updatedAt: info.mtimeMs, revision: `${info.mtimeMs}-${info.size}` };
}

async function listFiles(root: string, requestedPrefix: string) {
  const prefix = requestedPrefix ? safeRelativePath(requestedPrefix) : "design";
  const start = await verifiedExistingPath(root, prefix).catch((error) => {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  });
  if (!start) return [];
  const items: Array<{ path: string; kind: "file" | "dir"; size: number; mtimeMs: number; revision: string }> = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })) {
      if (items.length >= MAX_CATALOG_ENTRIES) return;
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      const info = await stat(path);
      const workspacePath = relative(root, path).split(sep).join("/");
      items.push({
        path: workspacePath,
        kind: entry.isDirectory() ? "dir" : "file",
        size: info.size,
        mtimeMs: info.mtimeMs,
        revision: `${info.mtimeMs}-${info.size}`,
      });
      if (entry.isDirectory()) await walk(path);
    }
  };
  await walk(start);
  return items;
}

async function handleApi(ctx: Context, req: IncomingMessage, res: ServerResponse, url: URL) {
  requireToken(req);
  const action = url.pathname.slice(`${ROUTE_ROOT}/api`.length);
  const workspaceId = url.searchParams.get("workspaceId")?.trim();

  if (req.method === "GET" && action === "/session") {
    const sessionId = url.searchParams.get("sessionId")?.trim();
    if (!workspaceId || !sessionId) throw new HttpError(400, "Missing workspaceId or sessionId.");
    sendJson(res, 200, await templateSession(workspaceRoot(ctx, workspaceId), sessionId));
    return;
  }
  if (req.method === "GET" && action === "/files") {
    if (!workspaceId) throw new HttpError(400, "Missing workspaceId.");
    sendJson(res, 200, await listFiles(workspaceRoot(ctx, workspaceId), url.searchParams.get("prefix")?.trim() || "design"));
    return;
  }
  if (req.method === "GET" && action === "/file") {
    const path = url.searchParams.get("path")?.trim();
    if (!workspaceId || !path) throw new HttpError(400, "Missing workspaceId or path.");
    sendJson(res, 200, await readText(workspaceRoot(ctx, workspaceId), path));
    return;
  }
  if (req.method === "POST" && action === "/file") {
    const body = await requestJson(req);
    const bodyWorkspaceId = stringField(body.workspaceId, "workspaceId");
    const path = stringField(body.path, "path");
    const content = typeof body.content === "string" ? body.content : null;
    if (content == null) throw new HttpError(400, "Missing content.");
    const baseUpdatedAt = typeof body.baseUpdatedAt === "number" ? body.baseUpdatedAt : null;
    sendJson(res, 200, await writeText(workspaceRoot(ctx, bodyWorkspaceId), path, content, baseUpdatedAt, body.force === true));
    return;
  }
  if (req.method === "GET" && action === "/raw") {
    const path = url.searchParams.get("path")?.trim();
    if (!workspaceId || !path) throw new HttpError(400, "Missing workspaceId or path.");
    const file = await verifiedExistingPath(workspaceRoot(ctx, workspaceId), path);
    const info = await stat(file);
    if (!info.isFile()) throw new HttpError(400, "Design Studio path is not a file.");
    res.writeHead(200, {
      "content-type": contentType(file),
      "content-length": info.size,
      "content-disposition": `inline; filename="${basename(file).replace(/["\\]/g, "_")}"`,
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(res);
    return;
  }
  throw new HttpError(404, "Unknown Design Studio API route.");
}

function contentType(path: string) {
  return ({
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  } as Record<string, string>)[extname(path).toLowerCase()] ?? "application/octet-stream";
}

async function handleStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (url.pathname === `${ROUTE_ROOT}/studio`) {
    res.writeHead(307, { location: `${ROUTE_ROOT}/studio/${url.search}` });
    res.end();
    return;
  }
  const requested = url.pathname.slice(`${ROUTE_ROOT}/studio/`.length) || "index.html";
  if (requested.includes("\0") || requested.split("/").some((part) => part === "..")) {
    throw new HttpError(400, "Invalid Studio asset path.");
  }
  const path = resolve(studioRoot, requested);
  if (!inside(studioRoot, path)) throw new HttpError(403, "Studio asset path escaped its bundle.");
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new HttpError(404, "Studio asset was not found.");
    throw error;
  });
  if (!info.isFile()) throw new HttpError(404, "Studio asset was not found.");
  if (basename(path) === "index.html") {
    const html = (await readFile(path, "utf8")).replace("__IPOLLOWORK_DESIGN_STUDIO_TOKEN_VALUE__", token);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(html),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
    });
    res.end(html);
    return;
  }
  res.writeHead(200, {
    "content-type": contentType(path),
    "content-length": info.size,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  createReadStream(path).pipe(res);
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: ROUTE_ROOT,
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? ROUTE_ROOT, "http://localhost");
        if (url.pathname.startsWith(`${ROUTE_ROOT}/api`)) {
          await handleApi(ctx, req, res, url);
        } else if (url.pathname === `${ROUTE_ROOT}/studio` || url.pathname.startsWith(`${ROUTE_ROOT}/studio/`)) {
          await handleStatic(req, res, url);
        } else {
          throw new HttpError(404, "Design Studio route was not found.");
        }
      } catch (error) {
        if (res.headersSent) {
          res.destroy(error instanceof Error ? error : undefined);
          return;
        }
        const status = error instanceof HttpError ? error.status : 500;
        const message = error instanceof Error ? error.message : "Design Studio request failed.";
        sendJson(res, status, { ok: false, message });
      }
    },
  }), "ipollowork-design-studio: routes");
}
