/** Package the independently installable workspace features for the default catalog. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceFeatures } from '../../plugins/workspace-tools/scripts/features.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const suite = join(root, 'plugins/ipollowork-suite');
const catalog = join(suite, 'catalog');
const output = join(root, 'dist/workspace-plugins');
const npm = process.env.npm_execpath;
if (!npm) throw Error('Run npm run package:workspace-market');
const requested = new Set(process.argv.slice(2));
for (const feature of requested) if (!workspaceFeatures.includes(feature)) throw Error(`Unknown workspace plugin ${feature}`);
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const indexFile = join(catalog, 'index.json');
const releasesFile = join(catalog, 'bundled-releases.json');
const [index, releases, pin] = await Promise.all([
  readJson(indexFile), readJson(releasesFile), readJson(join(root, 'integrations/runtime/upstream.json')),
]);
await mkdir(output, { recursive: true });

for (const feature of workspaceFeatures) {
  if (requested.size && !requested.has(feature)) continue;
  const directory = join(root, 'plugins', feature);
  const manifest = await readJson(join(directory, 'package.json'));
  if (manifest.name !== `@ipollo/dsh-${feature}` || manifest.engines.dsh !== pin.npmVersion) {
    throw Error(`Workspace bundle manifest does not match its feature or DSH pin: ${feature}`);
  }
  execFileSync(process.execPath, [join(root, 'plugins/workspace-tools/scripts/build.mjs'), feature], { cwd: directory, stdio: 'inherit' });
  const [packed] = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', output], {
    cwd: directory, encoding: 'utf8', maxBuffer: 2_000_000,
  }));
  const archive = join(output, packed.filename);
  const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  const file = packed.filename.replace(/\.tgz$/, `-${sha256.slice(0, 12)}.tgz`);
  const previous = releases.plugins.find(item => item.name === manifest.name);
  if (previous?.version === manifest.version && previous.sha256 !== sha256) {
    throw Error(`Increment the version before replacing the bytes for ${manifest.name}@${manifest.version}`);
  }
  const [zh, en, icon] = await Promise.all([
    readJson(join(directory, 'locale/zh.json')), readJson(join(directory, 'locale/en.json')),
    readFile(join(directory, manifest.icon)),
  ]);
  const release = { name: manifest.name, version: manifest.version, file, sha256 };
  const existing = index.plugins.find(item => item.name === manifest.name);
  const version = { version: manifest.version, source: { type: 'npm' }, engines: { dsh: manifest.engines.dsh } };
  const entry = { name: manifest.name, title: { zh: zh.meta.title, en: en.meta.title }, author: 'iPolloWork',
    description: { zh: zh.meta.description, en: en.meta.description }, metadata: { category: 'productivity', keywords: [feature] },
    versions: [existing?.versions.find(item => item.version === manifest.version) ?? { ...version, publishTimestamp: Math.floor(Date.now() / 1000) }],
    icon: 'data:image/svg+xml;base64,' + icon.toString('base64') };
  if (previous) releases.plugins[releases.plugins.indexOf(previous)] = release;
  else releases.plugins.push(release);
  if (existing) index.plugins[index.plugins.indexOf(existing)] = entry;
  else index.plugins.push(entry);
  await copyFile(archive, join(catalog, 'packages', file));
  console.log(`${manifest.name}@${manifest.version} ${sha256}`);
}

await writeFile(indexFile, JSON.stringify(index, null, 2) + '\n');
await writeFile(releasesFile, JSON.stringify(releases, null, 2) + '\n');
execFileSync(process.execPath, [join(suite, 'scripts/catalog-artwork.mjs'), '--write'], { cwd: suite, stdio: 'inherit' });
