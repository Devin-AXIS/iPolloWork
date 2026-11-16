import { globSync } from 'node:fs';
import { mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const root = resolve('../..');
const own = JSON.parse(await readFile('package.json', 'utf8'));
const names = Object.keys(own.peerDependencies);
for (const file of globSync(['packages/*/*/package.json', 'vendor/*/package.json'], { cwd: resolve(root, '.upstream/dsh') })) {
 const path = resolve(root, '.upstream/dsh', file);
 const manifest = JSON.parse(await readFile(path, 'utf8'));
 if (!names.includes(manifest.name)) continue;
 const target = resolve('node_modules', manifest.name);
 await mkdir(dirname(target), { recursive: true }); await rm(target, { recursive: true, force: true });
 await symlink(dirname(path), target, process.platform === 'win32' ? 'junction' : 'dir');
}
