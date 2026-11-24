import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { Failure, projectFile, readFileBounded, readRequest, rootFor, versionOf, writeVersion,
  type FileHost } from '../../_shared/workspace-document-files.ts';
import { assetPrefix, endpoint, maxBytes, mediaType } from './shared.ts';

export const name = 'ipollo-word-editor';
export const inject = ['connection', 'workspaceFiles', 'sandboxPolicy', 'sessions', 'fs'];

interface Host extends FileHost {
  effect(install: () => void | (() => void | Promise<void>)): unknown;
}

function validateDocument(bytes: Uint8Array) {
  const entries = new Set<string>();
  let expanded = 0;
  try {
    unzipSync(bytes, { filter(entry) {
      expanded += entry.originalSize;
      if (expanded > 100 * 1024 * 1024 || entries.size >= 2500 || entry.originalSize > 24 * 1024 * 1024)
        throw new Failure('too-large', 413);
      if (entries.has(entry.name) || entry.name.includes('\\') || entry.name.startsWith('/')
        || entry.name.split('/').some(segment => ['..', '__proto__', 'constructor'].includes(segment))
        || /^_xmlsignatures\//i.test(entry.name) || /vbaProject\.bin$/i.test(entry.name))
        throw new Failure('unsupported-file', 415);
      entries.add(entry.name);
      return false;
    } });
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure('unsupported-file', 415);
  }
  if (!entries.has('[Content_Types].xml') || !entries.has('word/document.xml'))
    throw new Failure('unsupported-file', 415);
}

const noCache = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
function errorReply(error: unknown) {
  const fileError = error as NodeJS.ErrnoException;
  let failure = error instanceof Failure ? error : new Failure('failed', 500);
  if (fileError.code === 'ENOENT') failure = new Failure('missing', 404);
  if (['EACCES', 'EPERM', 'EBUSY'].includes(fileError.code ?? '')) failure = new Failure('file-busy', 409);
  return Response.json({ error: failure.code }, { status: failure.status, headers: noCache });
}

export function apply(ctx: Host) {
  const lifetime = new AbortController();
  const writes = new Map<string, Promise<void>>();
  ctx.effect(() => async () => { lifetime.abort(); await Promise.allSettled(writes.values()); });
  for (const asset of ['engine.mjs', 'harfbuzz.wasm', 'harfbuzz-subset.wasm']) {
    ctx.connection.fetch.register({ path: '/api/' + assetPrefix + '/' + asset, methods: ['GET'], requestBody: 'buffered', async fetch() {
      try {
        const body = await readFile(new URL('./assets/' + asset, import.meta.url));
        const type = asset.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : 'application/wasm';
        return new Response(new Uint8Array(body), { headers: { ...noCache, 'Content-Type': type } });
      } catch (error) { return errorReply(error); }
    } });
  }
  async function documentRequest(req: Request) {
    try {
      const url = new URL(req.url);
      const id = url.searchParams.get('session');
      const path = url.searchParams.get('path');
      if (!id || id.length > 160 || !path || path.length > 4096 || !/\.docx$/i.test(path))
        throw new Failure('invalid-request');
      const method = req.method;
      if (method !== 'GET' && method !== 'POST') throw new Failure('invalid-request', 405);
      const signal = AbortSignal.any([lifetime.signal, req.signal]);
      const root = await rootFor(ctx, id, method === 'POST', signal);
      const file = await projectFile(root, path);
      if (method === 'GET') {
        const bytes = await readFileBounded(file);
        validateDocument(bytes);
        return new Response(new Uint8Array(bytes), { headers: { ...noCache, 'Content-Type': mediaType,
          'X-IPollo-File-Version': versionOf(bytes) } });
      }
      const before = req.headers.get('x-ipollo-file-version');
      if (before === null || !/^[0-9a-f]{64}$/.test(before)) throw new Failure('invalid-request');
      if (req.headers.get('content-type') !== mediaType) throw new Failure('invalid-request', 415);
      const next = await readRequest(req, maxBytes);
      validateDocument(next);
      const pending = (writes.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
        if (await rootFor(ctx, id, true, signal) !== root) throw new Failure('conflict', 409);
        if (await projectFile(root, file) !== file) throw new Failure('conflict', 409);
        const original = await readFileBounded(file);
        if (versionOf(original) !== before) throw new Failure('conflict', 409);
        validateDocument(original);
        await writeVersion(root, file, before, next, signal);
      });
      writes.set(file, pending);
      try { await pending; }
      finally { if (writes.get(file) === pending) writes.delete(file); }
      return new Response(null, { headers: { ...noCache, 'X-IPollo-File-Version': versionOf(next) } });
    } catch (error) { return errorReply(error); }
  }
  ctx.connection.fetch.register({ path: '/api/' + endpoint, methods: ['GET'], requestBody: 'buffered', fetch: documentRequest });
  ctx.connection.fetch.register({ path: '/api/' + endpoint + '/save', methods: ['POST'], requestBody: 'streaming', fetch: documentRequest });
}
