import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { documentPattern, endpoint, hasFeature, limit, referencePattern, type Message } from './api.ts';
import { decodeText, Failure, projectFile, readFileBounded, readRequest, rootFor,
  versionOf, writeVersion, type FileHost } from '../../_shared/workspace-document-files.ts';
import { readWorkbook, updateWorkbook } from './workbook.ts';
import { extract, referenceSummary } from './references.ts';

export const name = endpoint;
export const inject = ['connection', 'workspaceFiles', 'sessionQuery', 'sandboxPolicy', 'sessions', 'fs', 'storageDomain'];

const title = z.string().trim().min(1).max(180);
const prompt = z.string().trim().min(1).max(50_000);
const template = z.object({ title, prompt });
const savedTemplate = template.extend({ id: z.uuid() });
const templates = z.array(savedTemplate).max(100);
type Templates = z.infer<typeof templates>;
const storage = { name: 'ipollo_workspace_tools', version: 1, tables: { templates: { valueSchema: templates } } } as const;
type TemplateTable = { get(key: string): Templates | undefined; put(key: string, value: Templates): Promise<void> };
const templateQueue = Symbol.for('ipollowork.workspace-tools.template-queue.v1');
const hostQueues = globalThis as typeof globalThis & { [templateQueue]?: Promise<unknown> };

interface Host extends FileHost {
  sessionQuery: { readSession(session: string): Promise<{ events: readonly { type: string; data: unknown }[] }> };
  storageDomain: { open(spec: typeof storage): Promise<{ table(name: 'templates'): TemplateTable; close(): Promise<void> }> };
  effect(install: () => void | (() => void | Promise<void>)): unknown;
}

// The independently installed template and importer bundles share one DSH domain.
async function useTemplates<T>(ctx: Host, signal: AbortSignal, action: (table: TemplateTable) => T | Promise<T>): Promise<T> {
  const pending = Promise.resolve(hostQueues[templateQueue]).catch(() => undefined).then(async () => {
    signal.throwIfAborted();
    const domain = await ctx.storageDomain.open(storage);
    try { return await action(domain.table('templates')); }
    finally { await domain.close(); }
  });
  hostQueues[templateQueue] = pending;
  try { return await pending; }
  finally { if (hostQueues[templateQueue] === pending) delete hostQueues[templateQueue]; }
}

const sessionId = z.string().min(1).max(160);
const filePath = z.string().min(1).max(4096);
const oldName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const session = z.object({ session: sessionId });
const binary = z.string().base64().max(Math.ceil(limit / 3) * 4);
const reference = z.object({ name: z.string().min(1).max(240).regex(referencePattern), data: binary });
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
const legacySkill = z.object({ name: oldName, description: z.string().max(1000).default(''), content: z.string().min(1).max(250_000) });
const legacy = session.extend({ templates: z.array(template).max(100), skills: z.array(legacySkill).max(100) });
const referenceBody = session.extend({ brief: z.string().trim().max(20_000), files: z.array(reference).min(1).max(8) });
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

async function directory(parent: string, name: string) {
  const path = join(parent, name);
  await mkdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(path) !== path)
    throw new Failure('outside-project', 403);
  return path;
}

function safeName(name: string) {
  return basename(name.replaceAll('\\', '/')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(-180);
}

async function saveReferences(root: string, brief: string, files: z.infer<typeof reference>[], signal: AbortSignal) {
  const input = files.map(file => ({ name: safeName(file.name), bytes: Buffer.from(file.data, 'base64') }));
  if (input.reduce((total, file) => total + file.bytes.length, 0) > limit) throw new Failure('too-large', 413);
  const id = randomUUID();
  const prefix = `references/${id}`;
  const parent = await directory(root, 'references');
  const staging = join(parent, '.' + id + '.tmp');
  const output = join(parent, id);
  await mkdir(staging);
  const sources = [];
  const evidence = [];
  const assets = [];
  const sections = [];
  const observations = [];
  const summaries = [];
  let totalAssets = 0;
  let referencedBytes = 0;
  try {
    for (const [index, file] of input.entries()) {
      signal.throwIfAborted();
      let data: Awaited<ReturnType<typeof extract>>;
      try { data = await extract(file.name, file.bytes); }
      catch (error) {
        if (error instanceof Failure) throw error;
        throw new Failure('invalid-reference', 422);
      }
      const folder = await directory(staging, `source-${index + 1}`);
      const sourceId = `source-${index + 1}`;
      const pointer = `/files/${index}`;
      const original = { workspacePath: `${prefix}/${sourceId}/${file.name}` };
      await writeFile(join(folder, file.name), file.bytes, { flag: 'wx' });
      const fileAssets = [];
      for (const [assetIndex, asset] of data.assets.entries()) {
        referencedBytes += asset.data.byteLength;
        if (++totalAssets > 150 || referencedBytes > 48 * 1024 * 1024) throw new Failure('too-large', 413);
        const assetName = `asset-${assetIndex + 1}-${safeName(asset.name)}`;
        await writeFile(join(folder, assetName), asset.data, { flag: 'wx' });
        const item = { id: `${sourceId}-asset-${assetIndex + 1}`, sourceId,
          evidencePointer: `${pointer}/assets/${assetIndex}`, kind: 'image', availability: 'local', page: asset.page,
          description: asset.name, file: { workspacePath: `${prefix}/${sourceId}/${assetName}` } };
        assets.push(item);
        fileAssets.push(item);
      }
      const warnings = data.warning ? [data.warning] : [];
      const known = data.chunks.some(chunk => chunk.text.trim());
      sources.push({ id: sourceId, name: file.name, evidencePointer: pointer, quality: known ? 'partial' : 'failed',
        textCoverage: known ? 'partial' : 'unknown', warnings, original });
      for (const [chunkIndex, chunk] of data.chunks.entries()) {
        if (!chunk.text.trim()) continue;
        sections.push({ id: `${sourceId}-section-${chunkIndex + 1}`, sourceId, page: chunk.page,
          evidencePointer: `${pointer}/chunks/${chunkIndex}`, heading: null, excerpt: chunk.text.slice(0, 600),
          excerptTruncated: chunk.text.length > 600 });
      }
      if (data.style) observations.push({ sourceId, evidencePointer: `${pointer}/style`, ...data.style });
      evidence.push({ name: file.name, sourceId, chunks: data.chunks, assets: fileAssets, style: data.style, warnings, original });
      summaries.push(referenceSummary(file.name, data));
    }
    const contextPath = `${prefix}/creative-context.json`;
    const context = { schemaVersion: 1, kind: 'creative-context', extraction: { mode: 'local', modelUsed: false },
      evidence: { workspacePath: `${prefix}/reference-context.json` }, brief: { user: { requirements: brief }, inferred: null },
      sources, content: { sections: sections.slice(0, 48), omittedSections: Math.max(0, sections.length - 48), order: 'source-order' },
      designSystem: { observations, interpretation: 'extracted-values-only' },
      layoutLanguage: { elements: [], omittedElements: 0, composition: null },
      assets: assets.slice(0, 96), omittedAssets: Math.max(0, assets.length - 96), motionLanguage: { status: 'not-analyzed' } };
    await writeFile(join(staging, 'creative-context.json'), JSON.stringify(context, null, 2), { flag: 'wx' });
    await writeFile(join(staging, 'reference-context.json'), JSON.stringify({ files: evidence }, null, 2), { flag: 'wx' });
    if (await realpath(parent) !== parent) throw new Failure('outside-project', 403);
    signal.throwIfAborted();
    await rename(staging, output);
    return { contextPath, summaries };
  } finally {
    if (await realpath(parent) === parent) await rm(staging, { recursive: true, force: true });
  }
}

export async function apply(ctx: Host) {
  const editsDocuments = hasFeature('markdown-editor') || hasFeature('excel-editor');
  const managesTemplates = hasFeature('task-templates');
  const readsMessages = managesTemplates || hasFeature('conversation-export');
  const importsLegacy = hasFeature('legacy-workspace-import');
  const preparesReferences = hasFeature('reference-preparation');
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
    if (managesTemplates && kind === 'templates' && method === 'GET') {
      return useTemplates(ctx, signal, table => table.get('owner') ?? []);
    }
    if (managesTemplates && kind === 'template' && method === 'POST') {
      const incoming = template.extend({ id: z.uuid().optional() }).parse(await json(req, 300_000));
      return queued('templates', () => useTemplates(ctx, signal, async table => {
        const existing = table.get('owner') ?? [];
        if (incoming.id && !existing.some(item => item.id === incoming.id)) throw new Failure('missing', 404);
        if (!incoming.id && existing.length >= 100) throw new Failure('too-large', 413);
        const item = { ...incoming, id: incoming.id ?? randomUUID() };
        await table.put('owner', [item, ...existing.filter(record => item.id !== record.id)]);
        return item;
      }));
    }
    if (managesTemplates && kind === 'template-delete' && method === 'POST') {
      const { id } = z.object({ id: z.uuid() }).parse(await json(req, 1000));
      return queued('templates', () => useTemplates(ctx, signal, async table => {
        await table.put('owner', (table.get('owner') ?? []).filter(item => item.id !== id));
        return { ok: true };
      }));
    }
    if (readsMessages && kind === 'messages' && method === 'GET') {
      const id = sessionId.parse(url.searchParams.get('session'));
      if (!await ctx.workspaceFiles.scopeOf(id, signal)) throw new Failure('missing', 404);
      return messagesFrom((await ctx.sessionQuery.readSession(id)).events);
    }
    if (importsLegacy && kind === 'legacy' && method === 'POST') {
      const selected = legacy.parse(await json(req, 4 * 1024 * 1024));
      const root = await rootFor(ctx, selected.session, true, signal);
      const templateCount = !selected.templates.length ? 0 : await queued('templates', () => useTemplates(ctx, signal, async table => {
        const existing = table.get('owner') ?? [];
        const unique = new Set(existing.map(item => JSON.stringify([item.title, item.prompt])));
        const imported = selected.templates.flatMap(item => {
          const fingerprint = JSON.stringify([item.title, item.prompt]);
          if (unique.has(fingerprint)) return [];
          unique.add(fingerprint);
          return [{ ...item, id: randomUUID() }];
        });
        if (existing.length + imported.length > 100) throw new Failure('too-large', 413);
        if (imported.length) await table.put('owner', [...existing, ...imported]);
        return imported.length;
      }));
      const skills = await queued(root, async () => {
        if (!selected.skills.length) return [];
        const skillRoot = await directory(await directory(root, '.agents'), 'skills');
        const outcomes = [];
        for (const item of selected.skills) {
          signal.throwIfAborted();
          if (!item.content.startsWith('---\n') && !item.content.startsWith('---\r\n')) {
            outcomes.push({ name: item.name, status: 'invalid' }); continue;
          }
          const destination = join(await directory(skillRoot, item.name), 'SKILL.md');
          try {
            await writeFile(destination, item.content, { flag: 'wx' });
            outcomes.push({ name: item.name, status: 'imported' });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            outcomes.push({ name: item.name, status: 'exists' });
          }
        }
        return outcomes;
      });
      return { templateCount, skills };
    }
    if (preparesReferences && kind === 'references' && method === 'POST') {
      const { session: id, files, brief } = referenceBody.parse(await json(req, 24 * 1024 * 1024));
      const root = await rootFor(ctx, id, true, signal);
      return queued(root, () => saveReferences(root, brief, files, signal));
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
  if (editsDocuments || managesTemplates || importsLegacy || preparesReferences) {
    ctx.connection.fetch.register({ path: '/api/' + endpoint + '/write', methods: ['POST'], requestBody: 'streaming', fetch: handle });
  }
}
