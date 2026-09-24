import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-workspace";
import type { WorkspaceId } from "@deepseek-ai/dsh-workspace";

const MAX_REQUEST_BYTES = 20 * 1024 * 1024;

export class StudioHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : "";
}

export function sendJson(res: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

export function requireStudioToken(
  req: IncomingMessage,
  header: string,
  expected: string,
  studioTitle: string,
) {
  if (req.headers[header] !== expected) {
    throw new StudioHttpError(403, `${studioTitle} request is not authorized.`);
  }
}

export function safeRelativePath(value: string, prefix: string, studioTitle: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!normalized || isAbsolute(normalized) || normalized.includes("\0")) {
    throw new StudioHttpError(400, `Invalid ${studioTitle} file path.`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new StudioHttpError(400, `Invalid ${studioTitle} file path.`);
  }
  const prefixRoot = prefix.replace(/\/+$/, "");
  if (normalized !== prefixRoot && !normalized.startsWith(`${prefixRoot}/`)) {
    throw new StudioHttpError(403, `${studioTitle} can only access the workspace ${prefixRoot} folder.`);
  }
  return normalized;
}

export function safeAssetPath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (
    !normalized
    || isAbsolute(normalized)
    || normalized.includes("\0")
    || normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new StudioHttpError(400, "Invalid bundled asset path.");
  }
  return normalized;
}

export function inside(root: string, target: string) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export async function verifiedExistingPath(
  root: string,
  requested: string,
  prefix: string,
  studioTitle: string,
) {
  const target = resolve(root, safeRelativePath(requested, prefix, studioTitle));
  if (!inside(root, target)) throw new StudioHttpError(403, "File path escaped the workspace.");
  const canonical = await realpath(target).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") throw new StudioHttpError(404, `${studioTitle} file was not found.`);
    throw error;
  });
  if (!inside(root, canonical)) {
    throw new StudioHttpError(403, "Symbolic links outside the workspace are not allowed.");
  }
  return canonical;
}

export async function verifiedWritePath(
  root: string,
  requested: string,
  prefix: string,
  studioTitle: string,
) {
  const relativePath = safeRelativePath(requested, prefix, studioTitle);
  const target = resolve(root, relativePath);
  if (!inside(root, target)) throw new StudioHttpError(403, "File path escaped the workspace.");
  let canonicalParent = root;
  for (const segment of relativePath.split("/").slice(0, -1)) {
    const next = resolve(canonicalParent, segment);
    const existing = await lstat(next).catch((error: unknown) => {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    });
    if (!existing) {
      await mkdir(next).catch((error: unknown) => {
        if (errorCode(error) !== "EEXIST") throw error;
      });
    }
    else if (!existing.isDirectory() && !existing.isSymbolicLink()) {
      throw new StudioHttpError(400, `${studioTitle} folder path is not a directory.`);
    }
    canonicalParent = await realpath(next);
    if (!inside(root, canonicalParent)) {
      throw new StudioHttpError(403, "Symbolic links outside the workspace are not allowed.");
    }
  }
  return resolve(canonicalParent, basename(target));
}

export async function readStudioText(input: {
  root: string;
  requested: string;
  prefix: string;
  studioTitle: string;
  maxBytes: number;
}) {
  const path = await verifiedExistingPath(input.root, input.requested, input.prefix, input.studioTitle);
  const info = await stat(path);
  if (!info.isFile()) throw new StudioHttpError(400, `${input.studioTitle} path is not a file.`);
  if (info.size > input.maxBytes) throw new StudioHttpError(413, `${input.studioTitle} file is too large.`);
  return { path: input.requested, content: await readFile(path, "utf8"), bytes: info.size, updatedAt: info.mtimeMs };
}

export async function writeStudioText(input: {
  root: string;
  requested: string;
  prefix: string;
  studioTitle: string;
  content: string;
  maxBytes: number;
  baseUpdatedAt?: number | null;
  force?: boolean;
  conflictMessage?: string;
}) {
  if (Buffer.byteLength(input.content) > input.maxBytes) throw new StudioHttpError(413, `${input.studioTitle} file is too large.`);
  const path = await verifiedWritePath(input.root, input.requested, input.prefix, input.studioTitle);
  const current = await stat(path).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  });
  if (!input.force && input.baseUpdatedAt != null && current && Math.abs(current.mtimeMs - input.baseUpdatedAt) > 0.5) {
    throw new StudioHttpError(409, input.conflictMessage ?? `${input.studioTitle} changed since it was loaded. Reload before saving.`);
  }
  const temporary = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, input.content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  const info = await stat(path);
  return { ok: true, path: input.requested, bytes: info.size, updatedAt: info.mtimeMs, revision: `${info.mtimeMs}-${info.size}` };
}

export function workspaceRoot(ctx: Context, workspaceId: string) {
  const workspace = ctx.workspaceRegistry.get(workspaceId as WorkspaceId);
  if (!workspace) throw new StudioHttpError(404, "DeepSeek Harness workspace was not found.");
  return workspace.path;
}

export async function requestObject(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new StudioHttpError(413, "Studio request is too large.");
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new StudioHttpError(400, "Invalid JSON request.");
  }
}

export function field(value: object, name: string) {
  return Reflect.get(value, name);
}

export function stringField(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new StudioHttpError(400, `Missing ${name}.`);
  return value.trim();
}

const CONTENT_TYPES: Record<string, string> = {
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
};

export function contentType(path: string) {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export function streamFile(res: ServerResponse, path: string, info: { size: number }, cacheControl: string) {
  res.writeHead(200, {
    "content-type": contentType(path),
    "content-length": info.size,
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
  });
  createReadStream(path).pipe(res);
}

export async function handleStudioStatic(input: {
  routeRoot: `/${string}`;
  studioRoot: string;
  token: string;
  tokenPlaceholder: string;
  res: ServerResponse;
  url: URL;
}) {
  if (input.url.pathname === `${input.routeRoot}/studio`) {
    input.res.writeHead(307, { location: `${input.routeRoot}/studio/${input.url.search}` });
    input.res.end();
    return;
  }
  const requested = input.url.pathname.slice(`${input.routeRoot}/studio/`.length) || "index.html";
  if (requested.includes("\0") || requested.split("/").some((part) => part === "..")) {
    throw new StudioHttpError(400, "Invalid Studio asset path.");
  }
  const path = resolve(input.studioRoot, requested);
  if (!inside(input.studioRoot, path)) throw new StudioHttpError(403, "Studio asset path escaped its bundle.");
  const info = await stat(path).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") throw new StudioHttpError(404, "Studio asset was not found.");
    throw error;
  });
  if (!info.isFile()) throw new StudioHttpError(404, "Studio asset was not found.");
  if (basename(path) === "index.html") {
    const html = (await readFile(path, "utf8")).replace(input.tokenPlaceholder, input.token);
    input.res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(html),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
    });
    input.res.end(html);
    return;
  }
  streamFile(input.res, path, info, "public, max-age=31536000, immutable");
}
