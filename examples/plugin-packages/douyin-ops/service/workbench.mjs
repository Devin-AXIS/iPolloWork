import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverPath = resolve(dirname(fileURLToPath(import.meta.url)), 'server.mjs');
export default function createWorkbench(runtime) {
  let child, origin, starting, disposed = false;
  const token = randomBytes(32).toString('base64url');
  async function start() {
    if (disposed) throw new Error('插件已关闭，请重新打开工作台');
    if (origin && child?.exitCode === null) return;
    const executable = process.env.IPOLLOWORK_NODE_BIN?.trim() || (process.versions.bun ? 'node' : process.execPath);
    child = spawn(executable, [serverPath], {
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { ...process.env, DOUYIN_OPS_DATA_DIR: runtime.storage.dataDir,
        DOUYIN_OPS_WORKSPACE_ROOT: runtime.workspace.root, DOUYIN_OPS_TOKEN: token, DOUYIN_OPS_PORT: '0' },
    });
    const launched = child;
    let startupError = '';
    launched.stderr.on('data', chunk => { startupError = (startupError + chunk.toString()).slice(-1500); });
    origin = await new Promise((done, reject) => {
      const timer = setTimeout(() => { launched.kill(); reject(new Error('抖音运营台启动超时，需要 Node.js 22.22 或更新版本')); }, 15_000);
      launched.once('error', () => { clearTimeout(timer); reject(new Error('无法启动抖音运营台，请检查 Node.js 22.22 或更新版本')); });
      launched.once('exit', () => { clearTimeout(timer); if (child === launched) origin = undefined; reject(new Error(`抖音运营台进程已退出：${startupError || '请确认 Node.js 22.22 或更新版本可用'}`)); });
      launched.once('message', message => {
        clearTimeout(timer);
        if (!message || !Number.isInteger(message.port) || message.port < 1 || message.port > 65535) { launched.kill(); reject(new Error('运营台返回了无效地址')); return; }
        done(`http://127.0.0.1:${message.port}`);
      });
    });
    if (disposed) { launched.kill(); throw new Error('插件已关闭'); }
  }
  async function ensureStarted() {
    starting ??= start().finally(() => { starting = undefined; });
    await starting;
    return { url: `${origin}/#token=${token}` };
  }
  const names = ['studio-state', 'list-accounts', 'start-authorization', 'import-media', 'save-draft', 'publish-draft',
    'list-videos', 'video-data', 'list-comments', 'reply-comment', 'search-videos', 'browser-target', 'get-job', 'resolve-job'];
  return {
    actions: { 'open-workbench': ensureStarted, ...Object.fromEntries(names.map(name => [name, async (input, context) => {
      if (['publish-draft', 'reply-comment'].includes(name) && !context?.sessionId) throw new Error('请在当前项目会话或日程中执行');
      await ensureStarted();
      const response = await fetch(`${origin}/api/actions/${name}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input ?? {}), signal: AbortSignal.timeout(name === 'publish-draft' ? 180_000 : 60_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '抖音操作失败');
      return result;
    }])) },
    async dispose() {
      disposed = true; origin = undefined;
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      const stopped = child;
      await new Promise(done => {
        const timer = setTimeout(() => stopped.kill('SIGKILL'), 2000);
        stopped.once('close', () => { clearTimeout(timer); if (child === stopped) child = undefined; done(); });
        stopped.kill();
      });
    },
  };
}
