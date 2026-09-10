import { spawn } from 'node:child_process';
import { cp, mkdir, access, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:4790';

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
        XHS_OPS_DATA_DIR: resolve(homedir(), '.ipollowork/plugin-data/xiaohongshu-ops'),
        XHS_OPS_HOST: '127.0.0.1', XHS_OPS_PORT: '4790', XHS_OPS_ORIGIN: origin,
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

  async function executor(action, input, context) {
    if (typeof input.jobId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.jobId)) throw new Error('任务 ID 无效');
    const token = (await readFile(resolve(homedir(), '.ipollowork/plugin-data/xiaohongshu-ops/api-token'), 'utf8')).trim();
    const lease = leases.get(input.jobId);
    if (action !== 'claim' && (!lease || lease.sessionId !== context.sessionId)) throw new Error('请先在当前会话领取任务，或在运营台重新发起验证');
    const body = action === 'claim' ? { accountId: input.accountId, workerSessionId: context.sessionId, verificationOnly: true }
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
    return { job: result.job };
  }

  return {
    // Credentials and leases stay in the service; model tools receive only job data.
    actions: {
      'observe-browser-session': async (input, context) => {
        if (!context.sessionId) throw new Error('请先打开一个会话');
        const token = (await readFile(resolve(homedir(), '.ipollowork/plugin-data/xiaohongshu-ops/api-token'), 'utf8')).trim();
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
      'rebind-session': async (input, context) => {
      if (typeof input.previousSessionId !== 'string' || typeof input.sessionId !== 'string' || input.sessionId !== context.sessionId) throw new Error('会话绑定参数不匹配');
      await start();
      const token = (await readFile(resolve(homedir(), '.ipollowork/plugin-data/xiaohongshu-ops/api-token'), 'utf8')).trim();
      const response = await fetch(`${origin}/api/executor/rebind-session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(input), signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('更新账号绑定会话失败，请重新打开运营台检查绑定状态');
      return { ok: true };
    }, 'open-workbench': () => {
      starting ??= start().finally(() => { starting = undefined; });
      return starting;
    } },
    dispose() { disposed = true; leases.clear(); stopChild(child); },
  };
}
