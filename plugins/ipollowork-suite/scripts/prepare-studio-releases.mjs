/** Add the rc.3 authentication dependency to reviewed local Studio release archives. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
const reviewed = {
  'deepseek-idesign': '9b6f4036941c54cbee4c59bb528c15490bbd5aa1be137005d65fff0e6b19e686',
  'deepseek-ivideo': 'f73f6454454151131e85cc117b1bf659697f9272c3ef34b752d5fafe46d80c5f',
};
const source = process.argv[2];
if (!source) throw new Error('Pass the directory containing the reviewed beta.19 archives');
const catalog = resolve('catalog');
const releases = { format: 1, plugins: [] };
const index = JSON.parse(await readFile(join(catalog, 'index.json'), 'utf8'));
for (const name of ['deepseek-idesign', 'deepseek-ivideo']) {
  const scratch = await mkdtemp(join(tmpdir(), 'ipw-studio-package-'));
  try {
    const archive = join(resolve(source), `${name}-1.0.0-beta.19.tgz`);
    if (createHash('sha256').update(await readFile(archive)).digest('hex') !== reviewed[name]) throw new Error('Studio archive differs from its reviewed source');
    execFileSync('tar', ['-xzf', archive, '-C', scratch]);
    const root = join(scratch, 'package');
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (manifest.name !== name || manifest.version !== '1.0.0-beta.19') throw new Error('Unexpected Studio release');
    manifest.version = '1.0.0-beta.19.ipollo.1';
    manifest.engines.dsh = '>=0.2.2-rc.3 <0.2.3-0';
    const patch = yaml.load(await readFile(join(root, 'cordis.patch.yml'), 'utf8'));
    const row = patch.flatMap(entry => entry.insert ?? []).find(entry => entry.name === name);
    if (!row) throw new Error('Studio plugin row is missing');
    row.inject = [...new Set([...(row.inject ?? []), 'connection.authentication'])];
    await writeFile(join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(join(root, 'cordis.patch.yml'), yaml.dump(patch));
    const output = join(scratch, 'release.tgz');
    execFileSync('tar', ['-czf', output, '-C', scratch, 'package'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    const sha256 = createHash('sha256').update(await readFile(output)).digest('hex');
    const file = `${name}-${manifest.version}-${sha256.slice(0, 12)}.tgz`;
    await rename(output, join(catalog, 'packages', file));
    releases.plugins.push({ name, version: manifest.version, file, sha256 });
    const entry = index.plugins.find(item => item.name === name);
    entry.versions = [{ version: manifest.version, publishTimestamp: Math.floor(Date.now() / 1000), source: { type: 'npm' }, engines: { dsh: manifest.engines.dsh } }];
    console.log(name, manifest.version, sha256.slice(0, 12));
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
await writeFile(join(catalog, 'index.json'), JSON.stringify(index, null, 2) + '\n');
await writeFile(join(catalog, 'bundled-releases.json'), JSON.stringify(releases, null, 2) + '\n');
