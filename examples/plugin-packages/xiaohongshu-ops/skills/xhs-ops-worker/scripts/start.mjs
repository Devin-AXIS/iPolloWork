import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 22)) {
  throw new Error('小红书运营台需要 Node.js 22.22 或更新版本。');
}
const appRoot = process.env.XHS_OPS_APP_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../app');
const require = createRequire(resolve(appRoot, 'package.json'));
const { register } = await import(pathToFileURL(require.resolve('tsx/esm/api')).href);
register();
process.env.XHS_OPS_DATA_DIR ??= resolve(homedir(), '.ipollowork/plugin-data/xiaohongshu-ops');
const { startServer } = await import(pathToFileURL(resolve(appRoot, 'src/server.ts')).href);
const app = startServer();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
console.log('小红书运营台已启动：http://127.0.0.1:4790/tasks');
