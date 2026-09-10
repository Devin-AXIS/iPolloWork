import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { Operations, MAX_VIDEO_BYTES, fail } from './operations.mjs';
import { ApiError } from './api.mjs';

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../ui');
async function jsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 100_000) fail('请求过大', 'payload_too_large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail('请求不是有效 JSON'); }
}

export async function startServer({ dataDir, workspaceRoot, port = 0, token = randomBytes(32).toString('base64url'), api }) {
  const store = new Store(dataDir);
  const operations = new Operations({ store, dataDir, workspaceRoot, ...(api ? { api } : {}) });
  let origin, uploads = 0;
  const assets = new Map();
  for (const [path, name, type] of [['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/app.css', 'app.css', 'text/css']]) {
    assets.set(path, { body: await readFile(resolve(uiRoot, name)), type });
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors http://localhost:* http://127.0.0.1:* file:");
    const json = (status, data) => { if (!response.destroyed) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); } };
    try {
      if (request.headers.host !== new URL(origin).host) fail('本机服务地址不匹配', 'forbidden');
      if (request.headers.origin && request.headers.origin !== origin) fail('请求来源不匹配', 'forbidden');
      const url = new URL(request.url, origin);
      if (request.method === 'GET' && url.pathname === '/healthz') return json(200, { service: 'douyin-ops', ok: true });
      const asset = assets.get(url.pathname);
      if (request.method === 'GET' && asset) {
        response.writeHead(200, { 'Content-Type': `${asset.type}; charset=utf-8` }); response.end(asset.body); return;
      }
      const expected = Buffer.from(`Bearer ${token}`), actual = Buffer.from(request.headers.authorization ?? '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail('请从插件入口重新打开工作台', 'unauthorized');
      if (request.method === 'GET' && url.pathname === '/api/state') return json(200, operations.state());
      if (request.method === 'POST' && url.pathname === '/api/settings') return json(200, operations.saveSettings(await jsonBody(request)));
      if (request.method === 'POST' && /^\/api\/actions\/[a-z-]+$/.test(url.pathname)) {
        return json(200, await operations.action(url.pathname.split('/').pop(), await jsonBody(request)));
      }
      if (request.method === 'POST' && url.pathname === '/api/media') {
        if (uploads >= 2) fail('已有两个素材正在上传，请稍后重试', 'upload_busy');
        if (request.headers['content-type'] !== 'video/mp4') fail('仅支持 MP4 视频');
        const name = decodeURIComponent(request.headers['x-file-name'] ?? 'video.mp4');
        if (!name.toLowerCase().endsWith('.mp4') || name.length > 300) fail('请选择 MP4 文件');
        const id = randomUUID(), path = resolve(dataDir, 'assets', `${id}.mp4`);
        await mkdir(resolve(dataDir, 'assets'), { recursive: true, mode: 0o700 });
        let bytes = 0;
        uploads++;
        try {
          const limit = new Transform({ transform(chunk, encoding, done) {
            bytes += chunk.length;
            if (bytes > MAX_VIDEO_BYTES) done(Object.assign(new Error('文件超过 128 MiB'), { code: 'payload_too_large' }));
            else done(null, chunk);
          } });
          await pipeline(request, limit, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
          return json(200, await operations.registerMedia(id, name));
        } catch (error) { await unlink(path).catch(() => {}); throw error; }
        finally { uploads--; }
      }
      json(404, { error: '没有找到此操作', code: 'not_found' });
    } catch (error) {
      const status = error.code === 'unauthorized' ? 401 : error.code === 'forbidden' ? 403 : error.code === 'payload_too_large' ? 413 : 400;
      // API messages are sanitized in api.mjs. Filesystem/internal exceptions
      // do not reveal paths, request contents, or stored credentials.
      const known = typeof error.code === 'string' && /^[a-z][a-z0-9_]*$/.test(error.code);
      json(status, { error: known || error instanceof ApiError ? error.message : '操作失败，请检查连接和应用配置后重试', code: known ? error.code : error instanceof ApiError ? `douyin_${error.code}` : 'operation_failed' });
    }
  });
  server.requestTimeout = 180_000;
  server.headersTimeout = 10_000;
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); done(); });
  }).catch(error => { store.close(); throw error; });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, token, operations, server, async close() {
    await new Promise(done => { server.close(done); server.closeAllConnections(); });
    store.close();
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const service = await startServer({
    dataDir: process.env.DOUYIN_OPS_DATA_DIR || resolve(homedir(), '.ipollowork/plugin-data/douyin-ops'),
    workspaceRoot: process.env.DOUYIN_OPS_WORKSPACE_ROOT || process.cwd(),
    token: process.env.DOUYIN_OPS_TOKEN,
    port: Number(process.env.DOUYIN_OPS_PORT || 0),
  });
  if (process.send) process.send({ port: service.server.address().port });
  else console.log(`抖音运营台：${service.origin}/#token=${service.token}`);
  let closing = false;
  const stop = () => { if (!closing) { closing = true; void service.close().finally(() => process.exit(0)); } };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  if (process.send) process.on('disconnect', stop);
}
