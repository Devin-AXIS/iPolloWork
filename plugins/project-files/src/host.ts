import type { IncomingMessage, ServerResponse } from 'node:http';
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { endpoint, inputKey, rasterMediaType, type Artifact, type FileAction, type Input } from './API.ts';
import { evidenceFor, type Evidence, type Event, type StoredFile, type StoredImage } from './evidence.ts';
import { changeFile, copyAttachment, emptyState, FileFailure, followMoves, fromRecordedPath, getEntry,
  listFolder, stateSchema, visibleTrash, type FileState } from './files.ts';

export const name = 'ipollo-project-files';
export const inject = ['webServer', 'connection', 'connection.authentication', 'workspaceRegistry',
  'sessionQuery', 'attachments', 'fs', 'storageDomain'];

interface Workspace {
  id: string;
  path: string;
  title: string;
  sessionIds: readonly string[];
}
interface Table {
  get(key: string): FileState | undefined;
  put(key: string, state: FileState): Promise<void>;
}
const domainSpec = { name: 'ipollo_project_files', version: 1, tables: { projects: { valueSchema: stateSchema } } } as const;
interface Host {
  connection: { admit(req: IncomingMessage): { rejection: number } | { peer: { principal: { kind: string } } } };
  webServer: { register(spec: {
    kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  }): () => void };
  workspaceRegistry: { list(): readonly Workspace[] };
  sessionQuery: { readSession(sessionId: string): Promise<{ events: readonly Event[]; session: { cwd?: string } }> };
  attachments: {
    readImage(ref: StoredImage): Promise<{ ref: StoredImage; data: Uint8Array }>;
    readFileStream(ref: StoredFile, signal?: AbortSignal): AsyncIterable<Uint8Array>;
  };
  fs: { resolve(path: string): Promise<{ targetKey: string; displayPath: string }>;
    fileUrl(target: { targetKey: string; displayPath: string }): string };
  storageDomain: { open(spec: typeof domainSpec): Promise<{ table(name: 'projects'): Table; close(): Promise<void> }> };
  inject(names: ['workspaceChanges'], callback: (scope: Host & {
    workspaceChanges: { summary(id: string, seq: number): { files: readonly { path: string }[] } | undefined };
  }) => void): unknown;
  on(name: 'session/event', handle: (session: { id: string }) => void): unknown;
  effect(install: () => void | (() => void | Promise<void>)): unknown;
}

const shortName = z.string().min(1).max(255);
const path = z.string().max(4096);
const actionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('copy'), path, folder: path }),
  z.strictObject({ kind: z.literal('copy-attachment'), source: z.string().min(1).max(128),
    attachment: z.string().min(1).max(128), name: z.string().min(1).max(512), folder: path }),
  z.strictObject({ kind: z.literal('move'), path, folder: path }),
  z.strictObject({ kind: z.literal('rename'), path, name: shortName }),
  z.strictObject({ kind: z.literal('mkdir'), folder: path, name: shortName }),
  z.strictObject({ kind: z.literal('trash'), path }),
  z.strictObject({ kind: z.literal('restore'), id: z.uuid() }),
]);
const identifier = z.string().min(1).max(128);

function sessionPriority(session: string, record: { sessionId: string }) {
  return Number(record.sessionId === session);
}

function preferRecord(session: string, record: { sessionId: string; time: number },
  existing?: { sessionId: string; time: number }) {
  return !existing || (sessionPriority(session, record) - sessionPriority(session, existing) || record.time - existing.time) > 0;
}

function outputRank(session: string, a: Evidence['outputs'][number], b: Evidence['outputs'][number]) {
  return sessionPriority(session, a) - sessionPriority(session, b)
    || Number(a.source === 'presented') - Number(b.source === 'presented') || a.time - b.time;
}


function reply(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(payload));
}

async function readAction(req: IncomingMessage): Promise<FileAction> {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json'))
    throw new FileFailure('invalid-request', 415);
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const part of req) {
    const buffer = Buffer.from(part);
    length += buffer.byteLength;
    if (length > 16384) throw new FileFailure('invalid-request', 413);
    chunks.push(buffer);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new FileFailure('invalid-request'); }
  const parsed = actionSchema.safeParse(value);
  if (!parsed.success) throw new FileFailure('invalid-request');
  return parsed.data;
}

function owner(ctx: Host, req: IncomingMessage) {
  const admission = ctx.connection.admit(req);
  if ('rejection' in admission) throw new FileFailure('unauthorized', admission.rejection);
  if (admission.peer.principal.kind !== 'owner' || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'] ?? ''))
    throw new FileFailure('unauthorized', 403);
}

async function localRoot(ctx: Host, workspace: Workspace) {
  const root = await realpath(workspace.path).catch(() => { throw new FileFailure('missing', 404); });
  // Never apply a host operation to a path from a different filesystem provider.
  const target = await ctx.fs.resolve(root);
  const href = ctx.fs.fileUrl(target);
  if (!href.startsWith('file:') || fileURLToPath(href) !== root) throw new FileFailure('unsupported-project', 409);
  return root;
}

export async function apply(ctx: Host) {
  const domain = await ctx.storageDomain.open(domainSpec);
  const table = domain.table('projects');
  const lifetime = new AbortController();
  const writes = new Map<string, Promise<unknown>>();
  type History = { evidence: Evidence; cwd: string | undefined };
  const cache = new Map<string, { expiry: number; result: Promise<History> }>();
  ctx.on('session/event', session => cache.delete(session.id));
  let changed: ((id: string, seq: number) => readonly { path: string }[]) | undefined;
  ctx.inject(['workspaceChanges'], scope => scope.effect(() => {
    changed = (id, seq) => scope.workspaceChanges.summary(id, seq)?.files ?? [];
    cache.clear();
    return () => { changed = undefined; cache.clear(); };
  }));
  ctx.effect(() => async () => {
    lifetime.abort();
    await Promise.allSettled(writes.values());
    cache.clear();
    await domain.close();
  });

  const readEvidence = (id: string): Promise<History> => {
    const cached = cache.get(id);
    if (cached && Date.now() < cached.expiry) return cached.result;
    const result = ctx.sessionQuery.readSession(id).then(snap => ({
      evidence: evidenceFor(id, snap.events, seq => changed?.(id, seq) ?? []), cwd: snap.session.cwd,
    }));
    cache.set(id, { expiry: Date.now() + 30000, result });
    if (cache.size > 400) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    return result;
  };

  const resolveAttachment = async (workspace: Workspace, source: string, id: string, name: string | null) => {
    if (!workspace.sessionIds.includes(source)) throw new FileFailure('missing', 404);
    const record = (await readEvidence(source)).evidence.inputs.find(item => item.id === id && (name === null || item.name === name));
    if (!record) throw new FileFailure('missing', 404);
    return record;
  };

  const mutate = (workspace: Workspace, action: FileAction) => {
    const id = workspace.id;
    const preceding = writes.get(id);
    const operation = Promise.resolve(preceding).catch(() => undefined).then(async () => {
      lifetime.signal.throwIfAborted();
      const current = ctx.workspaceRegistry.list().find(item => item.id === id);
      if (!current || current.path !== workspace.path) throw new FileFailure('missing', 404);
      const root = await localRoot(ctx, current);
      if (action.kind === 'copy-attachment') {
        const record = await resolveAttachment(current, action.source, action.attachment, action.name);
        const bytes = record.stored.type === 'file'
          ? ctx.attachments.readFileStream(record.stored.attachment, lifetime.signal)
          : Readable.from([(await ctx.attachments.readImage(record.stored.attachment)).data]);
        return copyAttachment(root, action.folder, record.name, bytes, lifetime.signal);
      }
      return changeFile(root, action, table.get(id) ?? emptyState, state => table.put(id, state));
    });
    writes.set(id, operation);
    void operation.finally(() => {
      if (writes.get(id) === operation) writes.delete(id);
    }).catch(() => undefined);
    return operation;
  };

  ctx.effect(() => ctx.webServer.register({ path: endpoint, kind: 'exact', async handler(req, res) {
    try {
      owner(ctx, req);
      const url = new URL(req.url ?? endpoint, 'http://localhost');
      const session = identifier.safeParse(url.searchParams.get('session')).data;
      if (!session) throw new FileFailure('invalid-request');
      const project = ctx.workspaceRegistry.list().find(item => item.sessionIds.includes(session));
      if (!project) throw new FileFailure('no-project', 404);

      if (req.method === 'POST') {
        const action = await readAction(req);
        const path = await mutate(project, action);
        return reply(res, 200, { path });
      }
      if (req.method !== 'GET') throw new FileFailure('invalid-request', 405);
      const signal = lifetime.signal;
      const attachment = url.searchParams.get('attachment');
      if (attachment !== null) {
        const related = identifier.safeParse(url.searchParams.get('source')).data;
        if (!related) throw new FileFailure('missing', 404);
        const record = await resolveAttachment(project, related, attachment, url.searchParams.get('name'));
        const thumbnail = url.searchParams.has('thumbnail');
        const image = record.stored.type === 'image' ? await ctx.attachments.readImage(record.stored.attachment) : null;
        const media = image?.ref.mediaType ?? (thumbnail && record.bytes <= 16 * 1024 * 1024
          ? rasterMediaType(record.name) : undefined);
        if (thumbnail && !media) throw new FileFailure('missing', 404);
        const name = encodeURIComponent(record.name).replace(/[!'()*]/g, value => '%' + value.charCodeAt(0).toString(16));
        res.writeHead(200, {
          'Content-Type': media ?? 'application/octet-stream',
          'Content-Security-Policy': "sandbox; default-src 'none'",
          'Content-Disposition': (thumbnail ? 'inline' : 'attachment') + "; filename*=UTF-8''" + name,
          'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        });
        if (image) return void res.end(image.data);
        if (record.stored.type === 'file')
          await pipeline(Readable.from(ctx.attachments.readFileStream(record.stored.attachment, signal)), res, { signal });
        return;
      }

      const folder = path.safeParse(url.searchParams.get('folder') ?? '').data;
      if (folder === undefined) throw new FileFailure('invalid-request');
      const root = await localRoot(ctx, project);
      const state = table.get(project.id) ?? emptyState;
      const catalog = await listFolder(root, folder);
      const deleted = await visibleTrash(root, state.trash);
      const inputs = new Map<string, Input>();
      const references = new Map<string, Evidence['references'][number]>();
      const outputs = new Map<string, Evidence['outputs'][number]>();
      const hidden = (path: string, time: number) => deleted.some(item => time <= item.time
        && (path === item.path || path.startsWith(item.path + '/')));
      let partial = catalog.partial;
      for (let index = 0; index < project.sessionIds.length; index += 6) {
        signal.throwIfAborted();
        const batch = await Promise.allSettled(project.sessionIds.slice(index, index + 6).map(readEvidence));
        for (const result of batch) {
          if (result.status === 'rejected') { partial = true; continue; }
          const { evidence, cwd } = result.value;
          const projectPath = (recorded: string, time: number) => {
            const absolute = cwd && isAbsolute(cwd) ? resolve(cwd, recorded.replaceAll('\\', '/')) : recorded;
            const raw = fromRecordedPath(root, absolute) ?? fromRecordedPath(project.path, absolute);
            return raw && followMoves(raw, time, state.moves);
          };
          for (const { stored, ...input } of evidence.inputs) {
            const key = inputKey(input);
            if (preferRecord(session, input, inputs.get(key))) inputs.set(key, input);
          }
          for (const reference of evidence.references) {
            const path = projectPath(reference.path, reference.time);
            if (path && !hidden(path, reference.time) && preferRecord(session, reference, references.get(path)))
              references.set(path, reference);
          }
          for (const output of evidence.outputs) {
            const path = projectPath(output.path, output.time);
            if (!path || hidden(path, output.time)) continue;
            const previous = outputs.get(path);
            if (!previous || outputRank(session, output, previous) > 0) outputs.set(path, output);
          }
        }
      }
      const sorted = [...outputs].sort((a, b) => outputRank(session, b[1], a[1]));
      const artifacts = new Map<string, Artifact>();
      for (let index = 0; index < sorted.length; index += 24) {
        signal.throwIfAborted();
        const page = await Promise.all(sorted.slice(index, index + 24).map(async ([path, record]) => {
          let entry = await getEntry(root, path);
          if (entry?.kind === 'directory') {
            if (record.source !== 'presented') return undefined;
            for (const indexFile of ['index.html', 'index.htm']) {
              const candidate = path + '/' + indexFile;
              if (hidden(candidate, record.time)) continue;
              const page = await getEntry(root, candidate);
              if (page?.kind === 'file') { entry = page; break; }
            }
          }
          return entry && { ...entry, source: record.source, sessionId: record.sessionId,
            ...(record.title ? { title: record.title } : {}) };
        }));
        for (const entry of page) if (entry && !artifacts.has(entry.path)) artifacts.set(entry.path, entry);
      }
      const referenced = [...references];
      for (let index = 0; index < referenced.length; index += 24) {
        const batch = await Promise.all(referenced.slice(index, index + 24).map(async ([path, reference]) => {
          const entry = await getEntry(root, path);
          return entry ? { id: 'path:' + path, path, kind: entry.kind, sessionId: reference.sessionId, type: 'reference' as const,
            time: reference.time, bytes: entry.bytes, name: entry.name } : undefined;
        }));
        for (const entry of batch) if (entry) inputs.set(entry.id, entry);
      }
      reply(res, 200, { project: { id: project.id, title: project.title, root }, folder, entries: catalog.entries,
        inputs: [...inputs.values()].sort((a, b) => sessionPriority(session, b) - sessionPriority(session, a) || b.time - a.time),
        outputs: [...artifacts.values()],
        trash: deleted, partial });
    } catch (error) {
      if (res.headersSent) return void res.destroy();
      const failure = error instanceof FileFailure ? error : new FileFailure('operation-failed', 500);
      reply(res, failure.status, { error: failure.code });
    }
  } }));
}
