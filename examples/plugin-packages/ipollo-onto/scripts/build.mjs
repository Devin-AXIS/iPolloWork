import { cp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const repo = resolve(root, '../../..');
const output = resolve(root, 'dist/package');
const suffix = relative(root, output);
if (!suffix || suffix.startsWith('..' + sep) || suffix === '..') throw new Error('Unsafe build output');
async function modified(path) {
  const info = await stat(path);
  return info.isDirectory() ? Math.max(info.mtimeMs, ...await Promise.all((await readdir(path)).map(name => modified(resolve(path, name))))) : info.mtimeMs;
}
if (process.argv.includes('--if-stale')) {
  try {
    const latest = Math.max(...await Promise.all(['src', 'extensions', 'service', 'ui', 'skills', 'scripts', 'ipollowork.plugin.json', 'LICENSE', 'NOTICE', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts'].map(name => modified(resolve(root, name)))));
    if ((await stat(resolve(output, 'ipollowork.plugin.json'))).mtimeMs >= latest) {
      await stat(resolve(output, 'runtime/src/server/index.mjs'));
      await stat(resolve(output, 'runtime/dist/index.html'));
      process.exit(0);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const require = createRequire(resolve(root, 'package.json'));
try { require.resolve('vite'); }
catch { throw new Error('Run pnpm --dir examples/plugin-packages/ipollo-onto install --ignore-workspace --frozen-lockfile --ignore-scripts before building'); }
for (const command of [
  [require.resolve('typescript/bin/tsc'), '--noEmit'],
  [resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), 'build'],
]) {
  const result = spawnSync(process.execPath, command, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error('Onto build failed');
}
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'runtime/src/server'), { recursive: true });
const hostRequire = createRequire(resolve(repo, 'apps/app/package.json'));
const { build } = createRequire(hostRequire.resolve('vite/package.json'))('esbuild');
await build({ entryPoints: [resolve(root, 'src/server/index.ts')], bundle: true, format: 'esm', platform: 'node',
  target: 'node22', minify: true, external: ['bun:sqlite', 'pg-native'],
  banner: { js: "import { createRequire as ontoCreateRequire } from 'node:module'; const require = ontoCreateRequire(import.meta.url);" },
  alias: { 'node:sqlite': resolve(root, 'scripts/sqlite-runtime.mjs') },
  outfile: resolve(output, 'runtime/src/server/index.mjs') });
await mkdir(resolve(output, 'runtime/dist'), { recursive: true });
for (const entry of await readdir(resolve(root, 'dist'))) {
  if (entry === 'package' || entry.endsWith('.map')) continue;
  await cp(resolve(root, 'dist', entry), resolve(output, 'runtime/dist', entry), { recursive: true, filter: path => !path.endsWith('.map') });
}
for (const name of ['extensions', 'service', 'ui', 'skills', 'LICENSE', 'NOTICE'])
  await cp(resolve(root, name), resolve(output, name === 'extensions' ? 'runtime/extensions' : name), { recursive: true,
    filter: path => !/\.test\.(ts|mjs)$/.test(path) });
// Keep dependency notices with compiled third-party code, including transitive dependencies.
const notices = [];
for (const pkg of await readdir(resolve(root, 'node_modules/.pnpm'), { withFileTypes: true })) {
  if (!pkg.isDirectory() || pkg.name === 'node_modules') continue;
  const modules = resolve(root, 'node_modules/.pnpm', pkg.name, 'node_modules');
  for (const path of await readdir(modules, { recursive: true })) {
    if (!/(^|[\\/])(license|licence|copying|notice)(\.[^\\/]*)?$/i.test(path)) continue;
    const file = resolve(modules, path);
    if ((await stat(file)).isFile()) notices.push(`\n--- ${pkg.name}/${path} ---\n${await readFile(file, 'utf8')}`);
  }
}
await writeFile(resolve(output, 'THIRD-PARTY-LICENSES.txt'), notices.join('\n'));
await cp(resolve(root, 'ipollowork.plugin.json'), resolve(output, 'ipollowork.plugin.json'));
// Windows copies preserve source timestamps; freshness must reflect build completion.
await utimes(resolve(output, 'ipollowork.plugin.json'), new Date(), new Date());
const manifest = JSON.parse(await readFile(resolve(output, 'ipollowork.plugin.json'), 'utf8'));
console.log(JSON.stringify({ pluginId: manifest.id, version: manifest.package.version, database: 'sqlite', output }));
