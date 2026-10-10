import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';

const host = process.env.IPOLLOWORK_ROOT;
if (!host) throw new Error('Set IPOLLOWORK_ROOT to the checkout containing the official signing-key registration.');
const { startServer } = await import(pathToFileURL(resolve(host, 'apps/server/src/server.ts')).href);
const originalFetch = globalThis.fetch;
const manifest = JSON.parse(await readFile(new URL('../ipollowork.plugin.json', import.meta.url), 'utf8'));
const archiveName = `${manifest.id}-${manifest.package.version}.ipollowork-plugin`;
const archive = await JSZip.loadAsync(await readFile(new URL(`../dist/${archiveName}`, import.meta.url)));
const upload = { archiveName, files: await Promise.all(
  Object.values(archive.files).filter(file => !file.dir).map(async file => ({ path: file.name, contentBase64: await file.async('base64') })),
) };

test.each(['opencode', 'deepseek-harness', 'codex-harness'])('Work import, authorization, service, uninstall and tamper rejection: %s', async engineId => {
  const root = await mkdtemp(join(tmpdir(), 'jev-work-test-'));
  const previousDb = process.env.IPOLLOWORK_RUNTIME_DB;
  process.env.IPOLLOWORK_RUNTIME_DB = join(root, 'runtime.sqlite');
  let calls = 0;
  let expectedKey = 'fixture-jev-first';
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== 'https://api.typesafe.ai/v1/systemone') return originalFetch(input, init);
    calls++;
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${expectedKey}`);
    const payload = JSON.parse(String(init?.body));
    return Response.json({ model: 'jev-test', answers: Object.fromEntries(Object.keys(payload.questions).map(id => [id, { type: 'noul', noul: 0.9 }])), usage: { input_tokens: 12, output_tokens: 4 } });
  }, { preconnect: originalFetch.preconnect });
  const server = await startServer({
    host: '127.0.0.1', port: 0, token: 'test-token', hostToken: 'test-host', configPath: join(root, 'server.json'),
    approval: { mode: 'auto', timeoutMs: 0 }, corsOrigins: [],
    workspaces: [{ id: 'test', name: 'Jev test', path: root, preset: 'starter', workspaceType: 'local', engineId }],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: 'generated', hostTokenSource: 'generated', logFormat: 'pretty', logRequests: false,
  });
  const base = `http://127.0.0.1:${server.port}`;
  const prefix = '/workspace/test/plugin-packages';
  const headers = { authorization: 'Bearer test-token', 'content-type': 'application/json' };
  async function call(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    expect(response.status, JSON.stringify(value)).toBe(200);
    return value;
  }
  const action = (name: string, args = {}) => call('/experimental/extensions/call', 'POST', { extensionId: 'jev-decision-model', action: name, args, context: { directory: root } });
  try {
    const preview = await call(prefix + '/import/validate', 'POST', upload);
    expect(preview.preview.manifest.name).toBe(manifest.name);
    expect(preview.preview.safety.publisher).toEqual({ id: 'ipollowork', name: 'iPolloWork' });
    expect(preview.preview.safety.signature.status).toBe('verified');
    const icon = preview.preview.manifest.icon.src;
    expect(icon).toStartWith('data:image/png;base64,');
    expect(Buffer.from(icon.split(',')[1], 'base64')).toEqual(await readFile(new URL('../assets/jev.png', import.meta.url)));
    await call(prefix + '/import', 'POST', upload);
    expect((await action('status')).result).toMatchObject({ configured: false, remoteVerified: false });
    expect(calls).toBe(0);
    await call(prefix + '/jev-decision-model/authorization/typesafe-api-key/credentials', 'POST', { accountId: 'default', values: { apiKey: expectedKey } });
    expect((await action('check-connection')).result.connected).toBe(true);
    expectedKey = 'fixture-jev-rotated';
    await call(prefix + '/jev-decision-model/authorization/typesafe-api-key/credentials', 'POST', { accountId: 'default', values: { apiKey: expectedKey } });
    const evaluation = await action('evaluate', { state: 'Task', questions: { need_slides: { type: 'noul', instructions: 'Does this task need slides?' } } });
    expect(evaluation.result.answers.need_slides.noul).toBe(0.9);
    expect(JSON.stringify(evaluation)).not.toContain(expectedKey);
    expect(calls).toBe(2);
    await call(prefix + '/jev-decision-model', 'DELETE');
    const missing = await fetch(base + '/experimental/extensions/call', { method: 'POST', headers, body: JSON.stringify({ extensionId: 'jev-decision-model', action: 'status', args: {}, context: { directory: root } }) });
    expect(missing.status).not.toBe(200);
    await call(prefix + '/import', 'POST', upload);
    const authorization = await call(prefix + '/jev-decision-model/authorization');
    expect(authorization.connections).toEqual([]);
    expect((await action('status')).result.configured).toBe(false);
    await call(prefix + '/jev-decision-model', 'DELETE');
    const tampered = { ...upload, files: upload.files.map(file => file.path === 'service/jev.mjs' ? { ...file, contentBase64: Buffer.from('tampered').toString('base64') } : file) };
    const rejected = await fetch(base + prefix + '/import/validate', { method: 'POST', headers, body: JSON.stringify(tampered) });
    expect(rejected.status).toBe(400);
  } finally {
    await server.stop();
    globalThis.fetch = originalFetch;
    if (previousDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB; else process.env.IPOLLOWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
