import { z } from 'zod';
import { documentPattern, endpoint, hasFeature, type Message } from './api.ts';
import { decodeText, Failure, projectFile, readFileBounded, readRequest, rootFor,
  versionOf, writeVersion, type FileHost } from '../../_shared/workspace-document-files.ts';
import { readWorkbook, updateWorkbook } from './workbook.ts';

export const name = endpoint;
export const inject = ['connection', 'workspaceFiles', 'sessionQuery', 'sandboxPolicy', 'sessions', 'fs'];

interface Host extends FileHost {
  sessionQuery: { readSession(session: string): Promise<{ events: readonly { type: string; data: unknown }[] }> };
  effect(install: () => void | (() => void | Promise<void>)): unknown;
}

const sessionId = z.string().min(1).max(160);
const filePath = z.string().min(1).max(4096);
const session = z.object({ session: sessionId });
const version = z.string().regex(/^[0-9a-f]{64}$/);
const document = session.extend({ path: filePath });
const edit = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('markdown'), version, text: z.string().max(2_000_000) }),
  z.object({ kind: z.literal('workbook'), version, changes: z.array(z.object({
    sheet: z.string().min(1).max(100), address: z.string().max(10),
    kind: z.enum(['text', 'number', 'boolean', 'empty']),
    value: z.string().max(32_767).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)),
  })).min(1).max(1000) }),
]);
const messageValue = z.object({
  content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional(), name: z.string().optional() }))]),
  source: z.object({ kind: z.string() }).optional(),
});

function messagesFrom(events: Awaited<ReturnType<Host['sessionQuery']['readSession']>>['events']) {
  const messages: Message[] = [];
  let remaining = 2_000_000;
  for (const event of events) {
    let role: Message['role'];
    let raw = event.data;
    if (event.type === 'user/message') role = 'user';
    else if (event.type === 'assistant/message') {
      role = 'assistant';
      raw = z.object({ message: z.unknown() }).safeParse(raw).data?.message;
    } else continue;
    const parsed = messageValue.safeParse(raw);
    if (!parsed.success) continue;
    if (role === 'user' && parsed.data.source && parsed.data.source.kind !== 'user') continue;
    const content = parsed.data.content;
    const text = typeof content === 'string' ? content : content.flatMap(part => {
      if (part.type === 'text' && part.text) return [part.text];
      if (part.type === 'file' && part.name) return [`[File: ${part.name}]`];
      return [];
    }).join('\n\n');
    if (!text.trim()) continue;
    remaining -= text.length;
    if (remaining < 0 || messages.length >= 2000) throw new Failure('too-large', 413);
    messages.push({ role, text });
  }
  return messages;
}

async function json(request: Request, max: number) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new Failure('invalid-request', 415);
  const bytes = await readRequest(request, max);
  try { return JSON.parse(bytes.toString('utf8')) as unknown; }
  catch { throw new Failure('invalid-request'); }
}

function respond(status: number, value: unknown) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' } });
}

export async function apply(ctx: Host) {
  const editsDocuments = hasFeature('markdown-editor') || hasFeature('excel-editor');
  const readsMessages = hasFeature('conversation-export');
  const lifetime = new AbortController();
  const writes = new Map<string, Promise<unknown>>();
  const queued = async <T>(key: string, action: () => Promise<T>) => {
    const pending = Promise.resolve(writes.get(key)).catch(() => undefined).then(() => {
      lifetime.signal.throwIfAborted();
      return action();
    });
    writes.set(key, pending);
    try { return await pending; }
    finally { if (writes.get(key) === pending) writes.delete(key); }
  };
  ctx.effect(() => async () => {
    lifetime.abort();
    await Promise.allSettled(writes.values());
  });

  async function execute(req: Request) {
    const url = new URL(req.url);
    const kind = url.searchParams.get('action');
    const method = req.method;
    const signal = AbortSignal.any([lifetime.signal, req.signal]);
    if (readsMessages && kind === 'messages' && method === 'GET') {
      const id = sessionId.parse(url.searchParams.get('session'));
      if (!await ctx.workspaceFiles.scopeOf(id, signal)) throw new Failure('missing', 404);
      return messagesFrom((await ctx.sessionQuery.readSession(id)).events);
    }
    if (!editsDocuments || kind !== 'document' || (method !== 'GET' && method !== 'POST')) throw new Failure('missing', 404);
    const input = document.parse(Object.fromEntries(url.searchParams));
    const root = await rootFor(ctx, input.session, method === 'POST', signal);
    if (!documentPattern.test(input.path)) throw new Failure('unsupported-file', 415);
    const path = await projectFile(root, input.path);
    const markdown = /\.(?:md|markdown)$/i.test(path);
    if (method === 'GET') {
      const bytes = await readFileBounded(path);
      const current = versionOf(bytes);
      return markdown ? { version: current, kind: 'markdown', text: decodeText(bytes) }
        : { version: current, kind: 'workbook', sheets: readWorkbook(bytes) };
    }
    const change = edit.parse(await json(req, 8 * 1024 * 1024));
    if (markdown !== (change.kind === 'markdown')) throw new Failure('unsupported-file', 415);
    return queued(path, async () => {
      if (await rootFor(ctx, input.session, true, signal) !== root) throw new Failure('conflict', 409);
      await projectFile(root, path);
      const before = await readFileBounded(path);
      if (versionOf(before) !== change.version) throw new Failure('conflict', 409);
      const after = change.kind === 'markdown' ? Buffer.from(change.text) : updateWorkbook(before, change.changes);
      await writeVersion(root, path, change.version, after, signal);
      return { version: versionOf(after) };
    });
  }

  async function handle(req: Request) {
    try { return respond(200, await execute(req)); }
    catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      if (error instanceof Failure) return respond(error.status, { error: error.code });
      if (error instanceof z.ZodError) return respond(400, { error: 'invalid-request' });
      if (fileError.code === 'ENOENT') return respond(404, { error: 'missing' });
      if (['EACCES', 'EPERM', 'EBUSY'].includes(fileError.code ?? '')) return respond(409, { error: 'file-busy' });
      return respond(500, { error: 'failed' });
    }
  }
  if (readsMessages || editsDocuments) {
    ctx.connection.fetch.register({ path: '/api/' + endpoint, methods: ['GET'], requestBody: 'buffered', fetch: handle });
  }
  if (editsDocuments) {
    ctx.connection.fetch.register({ path: '/api/' + endpoint + '/write', methods: ['POST'], requestBody: 'streaming', fetch: handle });
  }
}
