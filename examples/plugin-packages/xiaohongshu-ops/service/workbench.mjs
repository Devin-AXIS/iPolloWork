import { spawn } from 'node:child_process';
import { cp, mkdir, access, readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = process.env.XHS_OPS_ORIGIN || 'http://127.0.0.1:4790';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('运营台必须使用本机服务地址');
const dataDir = resolve(process.env.XHS_OPS_DATA_DIR || resolve(homedir(), '.ipollowork/plugin-data/xiaohongshu-ops'));

async function healthy() {
  try {
    const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(1500) });
    const status = await response.json();
    return response.ok && status.service === 'xiaohongshu-ops' && status.embedded === true;
  } catch { return false; }
}

function stopChild(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const stop = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    stop.on('error', () => child.kill());
  } else child.kill();
}

export default function createWorkbench(runtime) {
  let child;
  let starting;
  let disposed = false;
  const leases = new Map();
  const appRoot = resolve(runtime.storage.dataDir, 'runtime', runtime.plugin.version);
  const node = process.env.IPOLLOWORK_NODE_BIN?.trim()
    || (process.versions.bun ? (process.platform === 'win32' ? 'node.exe' : 'node') : process.execPath);

  async function start() {
    if (disposed) throw new Error('插件已关闭，请重新打开工作台。');
    if (await healthy()) return { url: `${origin}/accounts` };
    await mkdir(appRoot, { recursive: true });
    await cp(resolve(packageRoot, 'skills/xhs-ops-worker/app'), appRoot, { recursive: true });
    const ready = resolve(appRoot, '.dependencies-ready');
    if (!await access(ready).then(() => true, () => false)) {
      // Install into the plugin's private runtime, never into the host workspace.
      await new Promise((resolveInstall, reject) => {
        const command = 'pnpm install --ignore-workspace --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org';
        const installer = process.platform === 'win32'
          ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { cwd: appRoot, windowsHide: true, stdio: 'ignore' })
          : spawn('pnpm', ['install', '--ignore-workspace', '--frozen-lockfile', '--ignore-scripts', '--registry=https://registry.npmjs.org'], { cwd: appRoot, stdio: 'ignore' });
        child = installer;
        const timer = setTimeout(() => { stopChild(installer); reject(new Error('准备运营台依赖超时，请检查网络后重试。')); }, 45_000);
        installer.once('error', error => { clearTimeout(timer); reject(new Error('无法准备运营台依赖，请确认 pnpm 可用。', { cause: error })); });
        installer.once('exit', code => { clearTimeout(timer); code === 0 ? resolveInstall() : reject(new Error('运营台依赖安装失败，请检查网络和 pnpm 后重试。')); });
      });
      await writeFile(ready, runtime.plugin.version);
    }
    if (disposed) throw new Error('插件已关闭。');
    let failure = '';
    child = spawn(node, [resolve(packageRoot, 'skills/xhs-ops-worker/scripts/start.mjs')], {
      cwd: appRoot, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, XHS_OPS_APP_ROOT: appRoot,
        XHS_OPS_DATA_DIR: dataDir,
        XHS_OPS_HOST: new URL(origin).hostname, XHS_OPS_PORT: new URL(origin).port || '4790', XHS_OPS_ORIGIN: origin,
        XHS_OPS_EMBED_ORIGINS: 'http://localhost:* http://127.0.0.1:* file:',
      },
    });
    child.on('error', error => { failure = error.message; });
    child.stderr.on('data', chunk => { failure = (failure + chunk.toString()).slice(-1500); });
    for (let attempt = 0; attempt < 40; attempt++) {
      if (disposed) throw new Error('插件已关闭。');
      if (await healthy()) return { url: `${origin}/accounts` };
      if (child.exitCode !== null) throw new Error(`运营台启动失败：${failure || '进程提前退出'}`);
      await new Promise(resolveWait => setTimeout(resolveWait, 200));
    }
    stopChild(child);
    throw new Error('运营台启动超时，请确认 Node.js 22.22 或更新版本可用。');
  }

  function ensureStarted() {
    starting ??= start().finally(() => { starting = undefined; });
    return starting;
  }

  async function operationRequest(path, body) {
    await ensureStarted();
    const token = (await readFile(resolve(dataDir, 'api-token'), 'utf8')).trim();
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '小红书操作失败');
    return browserJobResult(result);
  }

  async function browserJobResult(result) {
    if (result.jobs) return { ...result, jobs: await Promise.all(result.jobs.map(async job => (await browserJobResult({ job })).job)) };
    const job = result.job;
    if (!job?.payload?.mediaPaths?.length) return result;
    if (!/^[a-f0-9-]{36}$/i.test(job.id)) throw new Error('任务 ID 无效');
    // The host browser accepts uploads from this workspace's plugin storage.
    // Keep the shared account database in place and expose only rendered images.
    const mediaDir = resolve(runtime.storage.dataDir, 'media', job.id);
    await mkdir(mediaDir, { recursive: true });
    const mediaPaths = await Promise.all(job.payload.mediaPaths.map(async source => {
      const sourcePath = resolve(source);
      const local = relative(resolve(dataDir, 'assets'), sourcePath);
      if (!local || local.startsWith('..') || isAbsolute(local) || !/\.(png|jpe?g|webp|mp4)$/i.test(sourcePath)) throw new Error('任务素材不在插件素材目录');
      const destination = resolve(mediaDir, basename(sourcePath));
      await cp(sourcePath, destination);
      return destination;
    }));
    return { ...result, job: { ...job, payload: { ...job.payload, mediaPaths } } };
  }

  async function executor(action, input, context) {
    if (!context.sessionId) throw new Error('执行操作需要当前会话');
    if (typeof input.jobId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.jobId)) throw new Error('任务 ID 无效');
    const token = (await readFile(resolve(dataDir, 'api-token'), 'utf8')).trim();
    const lease = leases.get(input.jobId);
    if (action !== 'claim' && (!lease || lease.sessionId !== context.sessionId)) throw new Error('请先在当前会话领取任务，或在运营台重新发起验证');
    const body = action === 'claim' ? { accountId: input.accountId, workerSessionId: context.sessionId, pluginSession: true, actualAccount: input.actualAccount, actualProfileId: input.actualProfileId }
      : { ...input, leaseToken: lease.token };
    const response = await fetch(`${origin}/api/executor/jobs/${input.jobId}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '执行任务失败');
    if (action === 'claim') {
      for (const [id, held] of leases) if (Date.now() - held.createdAt > 10 * 60_000) leases.delete(id);
      leases.set(input.jobId, { token: result.leaseToken, sessionId: context.sessionId, createdAt: Date.now() });
    }
    else leases.delete(input.jobId);
    return browserJobResult({ job: result.job });
  }

  return {
    // Credentials and leases stay in the service; model tools receive only job data.
    actions: {
      ...Object.fromEntries(['studio-state', 'save-post-draft', 'create-post-search', 'save-search-results', 'update-comment-candidates', 'set-search-error', 'prepare-draft-publish', 'prepare-comment-batch'].map(action => [action, (input, context) => {
        // Drafting is local workspace data; only execution needs a session lease.
        if (!context.workspaceId) throw new Error('主软件未传入工作区信息，请重新打开运营台');
        if (action.startsWith('prepare-') && !context.sessionId) throw new Error('主软件未传入当前对话信息，请更新主软件后在当前对话重试，无需创建日程');
        return operationRequest(`/api/executor/studio/${action}`, { ...input, sessionId: context.sessionId });
      }])),
      'import-media': async input => {
        if (typeof input.sourcePath !== 'string' || !input.sourcePath.trim()) throw new Error('请提供工作区内的素材路径');
        const root = await realpath(runtime.workspace.root);
        const source = await realpath(resolve(root, input.sourcePath));
        const local = relative(root, source);
        if (!local || local.startsWith('..') || isAbsolute(local)) throw new Error('只能导入当前工作区内的素材');
        const mimeType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4' }[extname(source).toLowerCase()];
        const metadata = await stat(source);
        if (!mimeType || !metadata.isFile() || metadata.size > (mimeType === 'video/mp4' ? 200 : 15) * 1024 * 1024) throw new Error('不支持的素材格式或文件过大');
        await ensureStarted();
        const token = (await readFile(resolve(dataDir, 'api-token'), 'utf8')).trim();
        const form = new FormData();
        form.set('file', new Blob([await readFile(source)], { type: mimeType }), basename(source));
        const response = await fetch(`${origin}/api/assets`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(60_000) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '导入素材失败');
        return result;
      },
      'list-accounts': () => operationRequest('/api/executor/accounts'),
      'prepare-job': (input, context) => {
        if (!context.workspaceId) throw new Error('主软件未传入工作区信息，请重新打开运营台');
        if (!context.sessionId) throw new Error('主软件未传入当前对话信息，请更新主软件后在当前对话重试，无需创建日程');
        return operationRequest('/api/executor/operations', {
          ...input, sessionId: context.sessionId,
          runKey: input.runKey || `${context.workspaceId}:${context.sessionId}`,
        });
      },
      'get-job': input => {
        if (typeof input.jobId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.jobId)) throw new Error('任务 ID 无效');
        return operationRequest(`/api/executor/jobs/${input.jobId}`);
      },
      'observe-browser-session': async (input, context) => {
        if (!context.sessionId) throw new Error('请先打开一个会话');
        const token = (await readFile(resolve(dataDir, 'api-token'), 'utf8')).trim();
        const response = await fetch(`${origin}/api/executor/browser-session`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...input, sessionId: context.sessionId }), signal: AbortSignal.timeout(5000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '自动连接账号失败');
        return result;
      },
      'claim-job': (input, context) => executor('claim', input, context),
      'complete-job': (input, context) => executor('complete', input, context),
      'block-job': (input, context) => executor('block', input, context),
      'fail-job': (input, context) => executor('fail', input, context),
      'uncertain-job': (input, context) => executor('uncertain', { ...input, code: 'result_uncertain' }, context),
      'rebind-session': async (input, context) => {
      if (typeof input.previousSessionId !== 'string' || typeof input.sessionId !== 'string' || input.sessionId !== context.sessionId) throw new Error('会话绑定参数不匹配');
      await start();
      const token = (await readFile(resolve(dataDir, 'api-token'), 'utf8')).trim();
      const response = await fetch(`${origin}/api/executor/rebind-session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(input), signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('更新账号绑定会话失败，请重新打开运营台检查绑定状态');
      return { ok: true };
    }, 'open-workbench': ensureStarted },
    dispose() { disposed = true; leases.clear(); stopChild(child); },
  };
}
