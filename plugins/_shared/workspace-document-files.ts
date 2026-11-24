import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const limit = 16 * 1024 * 1024;

export class Failure extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}

export const versionOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export interface FileHost {
  connection: { fetch: { register(route: { path: string; methods: ('GET' | 'POST')[];
    requestBody: 'buffered' | 'streaming'; fetch(request: Request): Promise<Response> }): () => Promise<void> } };
  workspaceFiles: { scopeOf(session: string, signal?: AbortSignal): Promise<{ workspaceRoot: string } | undefined> };
  sessions: { get(session: string): object | undefined };
  sandboxPolicy: { resolve(options: { session: object }): { mode: string } };
  fs: { resolve(path: string): Promise<{ targetKey: string; displayPath: string }>;
    fileUrl(target: { targetKey: string; displayPath: string }): string };
}

export async function rootFor(ctx: FileHost, id: string, write: boolean, signal: AbortSignal) {
  const scope = await ctx.workspaceFiles.scopeOf(id, signal);
  if (!scope || !isAbsolute(scope.workspaceRoot)) throw new Failure('unsupported-project', 409);
  const live = ctx.sessions.get(id);
  if (write && live && ctx.sandboxPolicy.resolve({ session: live }).mode === 'read-only')
    throw new Failure('read-only', 403);
  const root = await realpath(scope.workspaceRoot);
  const target = await ctx.fs.resolve(scope.workspaceRoot);
  const href = ctx.fs.fileUrl(target);
  if (!href.startsWith('file:') || resolve(fileURLToPath(href)) !== root)
    throw new Failure('unsupported-project', 409);
  return root;
}

export async function readRequest(request: Request, max: number) {
  if (Number(request.headers.get('content-length') ?? 0) > max) throw new Failure('too-large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new Failure('invalid-request');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      request.signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) return Buffer.concat(chunks, size);
      size += next.value.length;
      if (size > max) {
        await reader.cancel();
        throw new Failure('too-large', 413);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
}

export function within(root: string, path: string) {
  const local = relative(root, path);
  return local !== '' && local !== '..' && !local.startsWith('..' + sep) && !isAbsolute(local);
}

export async function projectFile(root: string, path: string) {
  if (path.includes('\0')) throw new Failure('outside-project', 403);
  const candidate = resolve(root, path);
  if (!within(root, candidate)) throw new Failure('outside-project', 403);
  const canonical = await realpath(candidate);
  if (!within(root, canonical) || (await lstat(candidate)).isSymbolicLink())
    throw new Failure('outside-project', 403);
  if (await realpath(dirname(candidate)) !== dirname(candidate))
    throw new Failure('outside-project', 403);
  return canonical;
}

export async function readFileBounded(path: string): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Failure('unsupported-file', 415);
    if (stat.size > limit) throw new Failure('too-large', 413);
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size !== stat.size) throw new Failure('conflict', 409);
    return bytes.subarray(0, size);
  } finally {
    await file.close();
  }
}

export async function writeVersion(root: string, path: string, before: string, next: Uint8Array, signal: AbortSignal) {
  if (next.byteLength > limit) throw new Failure('too-large', 413);
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const mode = (await lstat(path)).mode & 0o777;
  const file = await open(temp, 'wx', mode);
  try {
    try {
      await file.writeFile(next);
      await file.sync();
    } finally {
      await file.close();
    }
    if (await projectFile(root, path) !== path || versionOf(await readFileBounded(path)) !== before)
      throw new Failure('conflict', 409);
    signal.throwIfAborted();
    await rename(temp, path);
  } finally {
    await unlink(temp).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export function decodeText(bytes: Uint8Array) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes('\0')) throw new Failure('unsupported-file', 415);
    return text;
  } catch {
    throw new Failure('unsupported-file', 415);
  }
}
