import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:5711';

export default function createService(runtime) {
  let child, starting, disposed = false;
  const data = resolve(runtime.storage.dataDir);
  const scope = createHash('sha256').update(data).digest('hex');
  async function healthy() {
    try {
      const response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(800) });
      const state = await response.json();
      return response.ok && state.ok === true && state.service === 'ipollo-onto' && state.scope === scope;
    } catch { return false; }
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise(resolveStop => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolveStop(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolveStop(); });
    });
  }
  async function start() {
    if (disposed) throw new Error('插件已关闭，请重新打开工作台。');
    if (await healthy()) return { url: origin + '/', database: 'sqlite' };
    const root = await access(resolve(packageRoot, 'runtime/src/server/index.mjs')).then(() => packageRoot, () => resolve(packageRoot, 'dist/package'));
    await access(resolve(root, 'runtime/src/server/index.mjs')).catch(() => { throw new Error('Onto 运行包不完整，请重新安装插件。'); });
    await mkdir(data, { recursive: true, mode: 0o700 });
    let failure = '';
    child = spawn(process.execPath, [resolve(root, 'runtime/src/server/index.mjs'), '--web'], {
      cwd: data, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, BUN_BE_BUN: '1', PORT: '5711', DATABASE_URL: '', ONTO_DATA_SCOPE: scope,
        ONTO_SQLITE_PATH: resolve(data, 'onto.sqlite'), DATA_SECRET_FILE: resolve(data, 'database.key'),
        DOCUMENT_FILES_DIR: resolve(data, 'document-files'), DATA_PLUGIN_DIR: resolve(data, 'extensions') },
    });
    child.on('error', () => { failure = '无法启动数据库工作台，请更新客户端后重试。'; });
    child.stderr.on('data', chunk => { failure = (failure + chunk.toString()).slice(-2000); });
    for (let attempt = 0; attempt < 50; attempt++) {
      if (disposed) { await stop(); throw new Error('插件已关闭。'); }
      if (await healthy()) return { url: origin + '/', database: 'sqlite' };
      if (failure && !child.pid) throw new Error(failure);
      if (child.exitCode !== null) throw new Error('Onto 启动失败，请检查插件日志或 5711 端口是否被占用。');
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    await stop();
    throw new Error(failure.includes('EADDRINUSE') ? '5711 端口被占用，请关闭冲突服务后重试。' : 'Onto 启动超时，请重试。');
  }
  return {
    actions: {
      'open-workbench': () => { starting ??= start().finally(() => { starting = undefined; }); return starting; },
    },
    dispose: async () => { disposed = true; await starting?.catch(() => {}); await stop(); },
  };
}
