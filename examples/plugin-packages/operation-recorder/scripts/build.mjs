import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist/package');
const require = createRequire(resolve(root, 'package.json'));
const hostOnly = process.argv.includes('--host');
const platforms = hostOnly ? [process.platform] : ['win32', 'darwin', 'linux'];
const architectures = hostOnly ? [process.arch] : ['x64', 'arm64'];
const dependencyRoot = resolve(output, 'native/node_modules');

async function modifiedAt(path) {
  const info = await stat(path);
  if (!info.isDirectory()) return info.mtimeMs;
  return Math.max(info.mtimeMs, ...await Promise.all((await readdir(path)).map(name => modifiedAt(resolve(path, name)))));
}

if (hostOnly && process.argv.includes('--if-stale')) {
  try {
    const [built, inputs] = await Promise.all([
      stat(resolve(output, 'ipollowork.plugin.json')),
      Promise.all(['service', 'native', 'ui', 'skills', 'ipollowork.plugin.json', 'pnpm-lock.yaml', 'scripts/build.mjs'].map(name => modifiedAt(resolve(root, name)))).then(values => Math.max(...values)),
    ]);
    await stat(resolve(dependencyRoot, `uiohook-napi/prebuilds/${process.platform}-${process.arch}/uiohook-napi.node`));
    await stat(resolve(dependencyRoot, `@koromix/koffi-${process.platform}-${process.arch}/${process.platform}_${process.arch}/koffi.node`));
    await stat(resolve(output, 'service/recorder.js'));
    if (built.mtimeMs >= inputs) process.exit(0);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function installedModules() {
  const koffi = await realpath(dirname(require.resolve('koffi')));
  const hook = await realpath(resolve(dirname(require.resolve('uiohook-napi')), '..'));
  const wanted = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).dependencies;
  for (const [name, source] of [['koffi', koffi], ['uiohook-napi', hook]]) {
    if (JSON.parse(await readFile(resolve(source, 'package.json'), 'utf8')).version !== wanted[name]) throw new Error(`Install the pinned ${name} version.`);
  }
  const koffiRequire = createRequire(resolve(koffi, 'package.json'));
  const typescript = require('typescript');
  for (const platform of platforms) for (const architecture of architectures) {
    await stat(resolve(hook, `prebuilds/${platform}-${architecture}/uiohook-napi.node`));
    koffiRequire.resolve(`@koromix/koffi-${platform}-${architecture}/package.json`);
  }
  return { koffi, hook, typescript };
}

let modules;
try { modules = await installedModules(); }
catch {
  // Dependency downloads belong to development/packaging, never to recording.
  await new Promise((resolveRun, reject) => {
    const child = spawn(process.platform === 'win32' ? 'cmd.exe' : 'pnpm', process.platform === 'win32'
      ? ['/d', '/s', '/c', 'pnpm install --frozen-lockfile --ignore-scripts --prod=false'] : ['install', '--frozen-lockfile', '--ignore-scripts', '--prod=false'],
      { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`Recorder dependency installation exited ${code}`)));
  });
  modules = await installedModules();
}

// All paths removed here are fixed children of this plugin's dist directory.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['ui', 'skills', 'native']) await cp(resolve(root, name), resolve(output, name), { recursive: true });
// Electron's embedded Node.js does not enable TypeScript stripping by default.
// Compile only the service owner; no compiler ships in the installed plugin.
await mkdir(resolve(output, 'service'), { recursive: true });
for (const name of (await readdir(resolve(root, 'service'))).filter(name => name.endsWith('.ts'))) {
  const compiled = modules.typescript.transpileModule(await readFile(resolve(root, 'service', name), 'utf8'), {
    fileName: name, reportDiagnostics: true,
    compilerOptions: { module: modules.typescript.ModuleKind.ESNext, target: modules.typescript.ScriptTarget.ES2022, rewriteRelativeImportExtensions: true },
  });
  if (compiled.diagnostics?.some(diagnostic => diagnostic.category === modules.typescript.DiagnosticCategory.Error)) throw new Error(`Cannot compile recorder service: ${name}`);
  await writeFile(resolve(output, 'service', name.replace(/\.ts$/, '.js')), compiled.outputText);
}
await writeFile(resolve(output, 'service/package.json'), '{"type":"module"}\n');
const packageManifest = JSON.parse(await readFile(resolve(root, 'ipollowork.plugin.json'), 'utf8'));
for (const resource of packageManifest.resources) if (resource.type === 'local-service') resource.path = resource.path.replace(/\.ts$/, '.js');
await writeFile(resolve(output, 'ipollowork.plugin.json'), JSON.stringify(packageManifest, null, 2) + '\n');

async function copyModule(name, source, entries) {
  const target = resolve(dependencyRoot, name);
  await mkdir(target, { recursive: true });
  for (const entry of entries) await cp(resolve(source, entry), resolve(target, entry), { recursive: true, dereference: true });
}

const { koffi, hook } = modules;
const hookRequire = createRequire(resolve(hook, 'package.json'));
const loader = await realpath(dirname(hookRequire.resolve('node-gyp-build')));
await copyModule('koffi', koffi, ['package.json', 'index.js', 'index.cjs', 'src/koffi/index.js', 'src/koffi/index.cjs', 'src/koffi/src/static.js', 'src/koffi/src/static.cjs', 'LICENSE.txt']);
await copyModule('uiohook-napi', hook, ['package.json', 'dist', 'LICENSE']);
await copyModule('node-gyp-build', loader, ['package.json', 'index.js', 'node-gyp-build.js', 'LICENSE']);
const koffiRequire = createRequire(resolve(koffi, 'package.json'));
for (const platform of platforms) for (const architecture of architectures) {
  const target = `${platform}-${architecture}`;
  await cp(resolve(hook, 'prebuilds', target), resolve(dependencyRoot, 'uiohook-napi/prebuilds', target), { recursive: true });
  const name = `@koromix/koffi-${target}`;
  let source;
  try { source = await realpath(dirname(koffiRequire.resolve(`${name}/package.json`))); }
  catch { throw new Error(`Missing ${name}. Run pnpm install with this plugin's supportedArchitectures configuration before packaging.`); }
  // uiohook's Linux prebuilds target glibc. Do not ship unusable musl copies or
  // spend the host's 10 MiB package budget on a second libc implementation.
  const entries = (await readdir(source)).filter(entry => !entry.startsWith('musl_'));
  await copyModule(name, source, entries);
}

if (process.argv.includes('--sign')) {
  const privateKey = process.env.IPOLLOWORK_PLUGIN_SIGNING_KEY;
  const keyId = process.env.IPOLLOWORK_PLUGIN_SIGNING_KEY_ID;
  const hostRoot = process.env.IPOLLOWORK_PLUGIN_HOST_ROOT;
  if (!privateKey || !keyId || !hostRoot) throw new Error('Set IPOLLOWORK_PLUGIN_SIGNING_KEY, IPOLLOWORK_PLUGIN_SIGNING_KEY_ID and IPOLLOWORK_PLUGIN_HOST_ROOT to use your existing trusted publisher.');
  const manifest = JSON.parse(await readFile(resolve(output, 'ipollowork.plugin.json'), 'utf8'));
  await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [resolve(hostRoot, 'scripts/package-plugin.mjs'), '--root', output,
      '--out', resolve(root, `dist/${manifest.id}-${manifest.package.version}.ipollowork-plugin`), '--private-key', resolve(privateKey), '--key-id', keyId], { stdio: 'inherit', windowsHide: true });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`Plugin signing exited ${code}`)));
  });
}
process.stdout.write(`Built self-contained Node.js recorder: ${output}\n`);
