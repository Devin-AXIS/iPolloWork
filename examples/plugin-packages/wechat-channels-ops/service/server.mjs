import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual, createHmac } from 'node:crypto';
import { mkdir, readFile, unlink, stat } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { resolve, dirname, extname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { Operations } from './operations.mjs';
import { fail, MEDIA_TYPES, VIDEO_LIMIT, IMAGE_LIMIT } from './media.mjs';

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../ui');
const equal = (a, b) => { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); };
async function jsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    if ((size += chunk.length) > 1024 * 1024) fail('请求过大', 'payload_too_large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail('请求不是有效 JSON'); }
}
export async function startServer({ dataDir, workspaceRoot, port = 0, token = randomBytes(32).toString('base64url'), executorToken = '' }) {
  const store = new Store(dataDir), operations = new Operations({ store, dataDir, workspaceRoot });
  let origin, uploads = 0;
  const assets = new Map();
  for (const [path, name, type] of [['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/app.css', 'app.css', 'text/css']]) {
    assets.set(path, { body: await readFile(resolve(uiRoot, name)), type });
  }
  const signature = (id, expires) => createHmac('sha256', token).update(`${id}:${expires}`).digest('hex');
  const state = () => {
    const result = operations.state(), expires = String(Date.now() + 30 * 60_000);
    result.assets = result.assets.map(asset => ({ ...asset, previewUrl: `/api/media/${asset.id}?expires=${expires}&signature=${signature(asset.id, expires)}` }));
    result.localOnly = !executorToken;
    return result;
  };
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors http://localhost:* http://127.0.0.1:* file:");
    const json = (status, data) => { if (!response.destroyed && !response.headersSent) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); } };
    try {
      if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) fail('请求来源不匹配', 'forbidden');
      const url = new URL(request.url, origin);
      if (request.method === 'GET' && url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      if (request.method === 'GET' && url.pathname === '/healthz') return json(200, { service: 'wechat-channels-ops', ok: true });
      const asset = assets.get(url.pathname);
      if (request.method === 'GET' && asset) {
        response.writeHead(200, { 'Content-Type': `${asset.type}; charset=utf-8` }); response.end(asset.body); return;
      }
      if (request.method === 'GET' && /^\/api\/media\/[0-9a-f-]{36}$/.test(url.pathname)) {
        const id = url.pathname.split('/').pop(), expires = url.searchParams.get('expires') || '';
        if (!/^\d{13}$/.test(expires) || Number(expires) < Date.now() || !equal(url.searchParams.get('signature') || '', signature(id, expires))) fail('预览已过期，请刷新页面', 'unauthorized');
        const { path, asset: metadata } = await operations.media.path(id), info = await stat(path);
        let start = 0, end = info.size - 1;
        if (request.headers.range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
          if (!match || Number(match[1]) >= info.size || (match[2] && Number(match[2]) < Number(match[1]))) {
            response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); response.end(); return;
          }
          start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), info.size - 1) : end;
        }
        response.writeHead(request.headers.range ? 206 : 200, { 'Content-Type': metadata.mimeType,
          'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
          ...(request.headers.range ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}) });
        await pipeline(createReadStream(path, { start, end }), response); return;
      }
      const authorization = request.headers.authorization || '';
      const executor = executorToken && equal(authorization, `Bearer ${executorToken}`);
      if (!executor && !equal(authorization, `Bearer ${token}`)) fail('请使用启动时提供的本地页面地址', 'unauthorized');
      if (request.method === 'GET' && url.pathname === '/api/state') return json(200, state());
      if (request.method === 'POST' && /^\/api\/actions\/[a-z-]+$/.test(url.pathname)) {
        const context = executor ? { trusted: true, sessionId: request.headers['x-session-id'] } : {};
        return json(200, await operations.action(url.pathname.split('/').pop(), await jsonBody(request), context));
      }
      if (request.method === 'POST' && url.pathname === '/api/media') {
        if (uploads >= 2) fail('已有素材正在上传，请稍后再试');
        const name = decodeURIComponent(request.headers['x-file-name'] ?? ''), extension = extname(name).toLowerCase();
        if (!name || name.length > 300 || !MEDIA_TYPES[extension] || request.headers['content-type'] !== MEDIA_TYPES[extension]) fail('请选择 MP4 视频或 PNG / JPG / WebP 封面');
        const maximum = extension === '.mp4' ? VIDEO_LIMIT : IMAGE_LIMIT;
        if (Number(request.headers['content-length']) > maximum) fail('文件超过本地上传限制', 'payload_too_large');
        const id = randomUUID(), path = resolve(dataDir, 'assets', `${id}${extension}`);
        await mkdir(resolve(dataDir, 'assets'), { recursive: true, mode: 0o700 });
        let bytes = 0; uploads++;
        try {
          const limit = new Transform({ transform(chunk, encoding, done) {
            bytes += chunk.length;
            if (bytes > maximum) done(Object.assign(new Error('文件超过本地上传限制'), { code: 'payload_too_large' }));
            else done(null, chunk);
          } });
          await pipeline(request, limit, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
          return json(200, { asset: await operations.media.register(id, name, extension) });
        } catch (error) { await unlink(path).catch(() => {}); throw error; }
        finally { uploads--; }
      }
      json(404, { error: '没有找到此操作', code: 'not_found' });
    } catch (error) {
      const known = typeof error.code === 'string' && /^[a-z][a-z0-9_]*$/.test(error.code);
      json(({ unauthorized: 401, forbidden: 403, host_required: 403, conflict: 409, payload_too_large: 413, not_found: 404 })[error.code] || 400,
        { error: known ? error.message : '操作失败，请检查文件或本地服务后重试', code: known ? error.code : 'operation_failed' });
    }
  });
  server.requestTimeout = 180_000; server.headersTimeout = 10_000;
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); done(); });
  }).catch(error => { store.close(); throw error; });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, token, operations, server, async close() {
    await new Promise(done => { server.close(done); server.closeAllConnections(); }); store.close();
  } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const service = await startServer({
    dataDir: process.env.CHANNELS_OPS_DATA_DIR || resolve(homedir(), '.ipollowork/plugin-data/wechat-channels-ops'),
    workspaceRoot: process.env.CHANNELS_OPS_WORKSPACE_ROOT || process.cwd(),
    token: process.env.CHANNELS_OPS_TOKEN, executorToken: process.env.CHANNELS_OPS_EXECUTOR_TOKEN,
    port: Number(process.env.CHANNELS_OPS_PORT || 0),
  });
  if (process.send) process.send({ port: service.server.address().port });
  else console.log(`视频号运营台：${service.origin}/#token=${service.token}`);
  let closing = false;
  const stop = () => { if (!closing) { closing = true; void service.close().finally(() => process.exit(0)); } };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  if (process.send) process.on('disconnect', stop);
}
