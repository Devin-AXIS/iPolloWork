import { createHash, sign, createPrivateKey } from 'node:crypto';
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, resolve, sep } from 'node:path';
import JSZip from 'jszip';

// iPolloWork package format v1. No host checkout is needed to build this package.
const root = fileURLToPath(new URL('../', import.meta.url));
const keyPath = process.env.IPOLLOWORK_PLUGIN_SIGNING_KEY;
const keyId = process.env.IPOLLOWORK_PLUGIN_KEY_ID;
if (!keyPath || !keyId) throw new Error('Set IPOLLOWORK_PLUGIN_SIGNING_KEY and IPOLLOWORK_PLUGIN_KEY_ID.');
const key = createPrivateKey(await readFile(keyPath));
if (key.asymmetricKeyType !== 'ed25519') throw new Error('An Ed25519 signing key is required.');
const manifest = JSON.parse(await readFile(resolve(root, 'ipollowork.plugin.json'), 'utf8'));
manifest.source = { ...manifest.source, origin: 'local', trusted: false };
delete manifest.package.checksum;
delete manifest.package.signature;
manifest.icon = { src: `data:image/png;base64,${(await readFile(resolve(root, 'assets/jev.png'))).toString('base64')}` };

const sha256 = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
const digest = createHash('sha256');
digest.update(`ipollowork.plugin.json\0${sha256(canonical(manifest))}\n`);
const archive = new JSZip();
let bytes = 0;
const paths = [...new Set(manifest.resources.map(resource => resource.path).filter(Boolean))].sort();
if (paths.length > 511) throw new Error('Too many package resources.');
for (const path of paths) {
  if (path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid resource path.');
  const absolute = await realpath(resolve(root, path));
  const suffix = relative(root, absolute);
  if (!suffix || suffix.startsWith(`..${sep}`) || suffix === '..' || resolve(root, suffix) !== absolute) throw new Error('Resource escapes package root.');
  const content = await readFile(absolute);
  bytes += content.length;
  digest.update(`${path}\0${sha256(content)}\n`);
  archive.file(path, content);
}
const checksum = digest.digest('hex');
manifest.package.checksum = { algorithm: 'sha256', value: checksum };
manifest.package.signature = { algorithm: 'ed25519', keyId, value: sign(null, Buffer.from(`ipollowork-plugin-package-v1\0${checksum}`), key).toString('base64') };
const metadata = JSON.stringify(manifest, null, 2) + '\n';
if (bytes + Buffer.byteLength(metadata) > 10 * 1024 * 1024) throw new Error('Package exceeds the Work import limit.');
archive.file('ipollowork.plugin.json', metadata);
const output = resolve(root, 'dist', `${manifest.id}-${manifest.package.version}.ipollowork-plugin`);
await mkdir(resolve(root, 'dist'), { recursive: true });
await writeFile(output, await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
console.log(JSON.stringify({ output, sha256: checksum, files: paths.length + 1, publisher: manifest.package.publisher.id, keyId }));
