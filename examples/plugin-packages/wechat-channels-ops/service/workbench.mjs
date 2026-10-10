import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(readFileSync(new URL('../ipollowork.plugin.json', import.meta.url), 'utf8'));
const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));
export default function createWorkbench(runtime) {
  let child, origin, starting, disposed = false;
  const token = randomBytes(32).toString('base64url'), executorToken = randomBytes(32).toString('base64url');
  async function start() {
    if (disposed) throw new Error('插件已关闭');
    if (origin && child?.exitCode === null) return;
    const executable = process.env.IPOLLOWORK_NODE_BIN?.trim() || (process.versions.bun ? 'node' : process.execPath);
    const launched = child = spawn(executable, [serverPath], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { ...process.env, CHANNELS_OPS_DATA_DIR: runtime.storage.dataDir, CHANNELS_OPS_WORKSPACE_ROOT: runtime.workspace.root,
        CHANNELS_OPS_TOKEN: token, CHANNELS_OPS_EXECUTOR_TOKEN: executorToken, CHANNELS_OPS_PORT: '0' } });
    // Keep child stderr drained without exposing local paths or credentials.
    launched.stderr.on('data', () => {});
    origin = await new Promise((done, reject) => {
      const timer = setTimeout(() => { launched.kill(); reject(new Error('启动超时，请检查 Node.js 22.22+')); }, 15000);
      launched.once('error', () => { clearTimeout(timer); reject(new Error('无法启动视频号运营台')); });
      launched.once('exit', () => { clearTimeout(timer); if (child === launched) origin = undefined; reject(new Error('视频号运营台已退出')); });
      launched.once('message', message => {
        clearTimeout(timer);
        if (!Number.isInteger(message?.port) || message.port < 1 || message.port > 65535) { launched.kill(); reject(new Error('启动地址无效')); return; }
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
  const actions = manifest.resources.find(resource => resource.type === 'local-service').actions;
  return {
    actions: { 'open-workbench': ensureStarted,
      ...Object.fromEntries(actions.filter(action => action.id !== 'open-workbench').map(({ id }) => [id, async (input, context = {}) => {
        await ensureStarted();
        const response = await fetch(`${origin}/api/actions/${id}`, { method: 'POST',
          headers: { Authorization: `Bearer ${executorToken}`, 'Content-Type': 'application/json',
            ...(context.sessionId ? { 'X-Session-Id': context.sessionId } : {}) },
          body: JSON.stringify(input ?? {}), signal: AbortSignal.timeout(60000) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '视频号操作失败');
        return result;
      }])) },
    async dispose() {
      disposed = true; origin = undefined;
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      const stopped = child;
      await new Promise(done => {
        const timer = setTimeout(() => stopped.kill('SIGKILL'), 2000);
        stopped.once('close', () => { clearTimeout(timer); done(); }); stopped.kill();
      });
    },
  };
}
