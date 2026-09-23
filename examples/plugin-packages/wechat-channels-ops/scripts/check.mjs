import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
for (const directory of ['service', 'ui', 'scripts', 'tests']) {
  for (const file of readdirSync(directory)) if (/\.(mjs|js)$/.test(file)) execFileSync(process.execPath, ['--check', `${directory}/${file}`], { stdio: 'inherit' });
}
const manifest = JSON.parse(readFileSync('ipollowork.plugin.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (manifest.package.version !== pkg.version || manifest.id !== pkg.name) throw new Error('插件版本或标识不一致');
for (const resource of manifest.resources) if (!existsSync(resource.path)) throw new Error(`资源不存在：${resource.path}`);
const actions = manifest.resources.find(resource => resource.type === 'local-service').actions;
if (new Set(actions.map(action => action.id)).size !== actions.length) throw new Error('重复操作');
console.log(`语法与插件清单检查通过，${actions.length} 个操作。`);
