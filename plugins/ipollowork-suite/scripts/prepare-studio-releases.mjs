/** Import checked native Studio archives without rewriting their source or metadata. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
const [source, version] = process.argv.slice(2);
if (!source || !version) throw new Error('Pass the archive directory and exact Studio version');
const catalog = resolve('catalog');
const index = JSON.parse(await readFile(join(catalog, 'index.json'), 'utf8'));
const releases = [];
for (const name of ['deepseek-idesign', 'deepseek-ivideo']) {
  const archive = join(resolve(source), `${name}-${version}.tgz`);
  const entry = path => execFileSync('tar', ['-xOzf', archive, `package/${path}`], { encoding: 'utf8' });
  const manifest = JSON.parse(entry('package.json'));
  if (manifest.name !== name || manifest.version !== version || !manifest.dsh?.bundle?.patch)
    throw new Error('Unexpected Studio package metadata');
  const patch = yaml.load(entry(manifest.dsh.bundle.patch.replace(/^\.\//, '')));
  const row = patch.flatMap(item => item.insert ?? []).find(item => item.name === name);
  if (!row?.inject?.includes('connection.authentication')) throw new Error('Studio archive lacks native authentication');
  const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  const file = `${name}-${version}-${sha256.slice(0, 12)}.tgz`;
  const item = index.plugins.find(item => item.name === name);
  if (!item) throw new Error('Studio is missing from the curated catalog');
  releases.push({ name, version, file, sha256, archive });
  item.versions = [{ version, publishTimestamp: Math.floor(Date.now() / 1000), source: { type: 'npm' }, engines: { dsh: manifest.engines.dsh } }];
}
for (const release of releases) await copyFile(release.archive, join(catalog, 'packages', release.file));
await writeFile(join(catalog, 'index.json'), JSON.stringify(index, null, 2) + '\n');
await writeFile(join(catalog, 'bundled-releases.json'), JSON.stringify({ format: 1, plugins: releases.map(({ archive, ...release }) => release) }, null, 2) + '\n');
const path = resolve('package.json');
const manifest = JSON.parse(await readFile(path, 'utf8'));
manifest.files = manifest.files.filter(file => !/^catalog\/packages\/deepseek-i(?:design|video)-/.test(file));
manifest.files.push(...releases.map(item => `catalog/packages/${item.file}`));
await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
for (const { name, sha256 } of releases) console.log(name, version, sha256.slice(0, 12));
