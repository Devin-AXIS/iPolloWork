/** Import checked native Studio archives without rewriting their source or metadata. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
const [source, version, videoVersion = version, tag] = process.argv.slice(2);
if (!source || !version) throw new Error('Pass the archive directory and exact Studio version');
if (tag !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(tag)) throw new Error('Pass a valid GitHub Release tag');
const referenceSkill = 'skills/ipollowork-reference-analyzer/SKILL.md';
const expectedSkill = (await readFile(new URL('../../reference-context/business/' + referenceSkill, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const catalog = resolve('catalog');
const index = JSON.parse(await readFile(join(catalog, 'index.json'), 'utf8'));
const prior = JSON.parse(await readFile(join(catalog, 'bundled-releases.json'), 'utf8'));
const releases = prior.plugins.filter(item => !['deepseek-idesign', 'deepseek-ivideo'].includes(item.name));
for (const name of ['deepseek-idesign', 'deepseek-ivideo']) {
  const pluginVersion = name === "deepseek-ivideo" ? videoVersion : version;
  const archive = join(resolve(source), `${name}-${pluginVersion}.tgz`);
  const entry = path => execFileSync('tar', ['-xOzf', archive, `package/${path}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const manifest = JSON.parse(entry('package.json'));
  if (manifest.name !== name || manifest.version !== pluginVersion || !manifest.dsh?.bundle?.patch)
    throw new Error('Unexpected Studio package metadata');
  const patch = yaml.load(entry(manifest.dsh.bundle.patch.replace(/^\.\//, '')));
  const row = patch.flatMap(item => item.insert ?? []).find(item => item.name === name);
  if (!row) throw new Error('Studio archive lacks its native plugin entry');
  const host = entry('lib/index.js');
  if (!host.includes('ConnectionAuthentication') || !host.includes('connection.authentication') || !host.includes('admit(req)'))
    throw new Error('Studio archive lacks host-native owner authentication');
  if (entry(referenceSkill) !== expectedSkill || !host.includes('registerProvider') || !host.includes('ipollowork-reference-analyzer'))
    throw new Error('Studio archive lacks the native reference Skill');
  const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  const file = `${name}-${pluginVersion}-${sha256.slice(0, 12)}.tgz`;
  const item = index.plugins.find(item => item.name === name);
  if (!item) throw new Error('Studio is missing from the curated catalog');
  releases.push({ name, version: pluginVersion, file, sha256, ...(tag === undefined ? {} : { tag }), archive });
  item.versions = [{ version: pluginVersion, publishTimestamp: Math.floor(Date.now() / 1000), source: { type: 'npm' }, engines: { dsh: manifest.engines.dsh } }];
}
for (const release of releases) if (release.archive) await copyFile(release.archive, join(catalog, 'packages', release.file));
await writeFile(join(catalog, 'index.json'), JSON.stringify(index, null, 2) + '\n');
await writeFile(join(catalog, 'bundled-releases.json'), JSON.stringify({ format: 1, plugins: releases.map(({ archive, ...release }) => release) }, null, 2) + '\n');
const path = resolve('package.json');
const manifest = JSON.parse(await readFile(path, 'utf8'));
manifest.files = [...manifest.files.filter(file => !file.startsWith('catalog/packages/')), ...releases.map(item => 'catalog/packages/' + item.file)];
delete manifest.dependencies['@ipollo/dsh-design-resources'];
delete manifest.dependencies['@ipollo/dsh-video-resources'];
await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
for (const { name, version, sha256 } of releases) console.log(name, version, sha256.slice(0, 12));
