import { createHash, sign, createPublicKey, verify } from 'node:crypto';
import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
const root = new URL('../dist/package/', import.meta.url);
const keyPath = process.env.IPOLLOWORK_PLUGIN_SIGNING_KEY;
const keyId = process.env.IPOLLOWORK_PLUGIN_KEY_ID;
if (!keyPath || !keyId) throw new Error('Provide IPOLLOWORK_PLUGIN_SIGNING_KEY and IPOLLOWORK_PLUGIN_KEY_ID. Never bundle the private key.');
const manifest = JSON.parse(await readFile(new URL('ipollowork.plugin.json', root), 'utf8'));
// Bundled trust belongs to the host catalog; exported archives cannot grant it.
manifest.source = { ...manifest.source, origin: 'local', trusted: false };
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) ?? 'null' : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
const files = new Map();
async function collect(path) {
  if (path.split('/').some(p=>!p||p==='.'||p==='..') || path.startsWith('/')) throw new Error('Unsafe resource path');
  const stat=await lstat(new URL(path,root));if(stat.isSymbolicLink())throw new Error('Symlink not allowed');
  if(stat.isDirectory()){for(const entry of await readdir(new URL(`${path}/`,root)))await collect(`${path}/${entry}`)}
  else if(stat.isFile())files.set(path,await readFile(new URL(path,root)));else throw new Error('Not a regular file');
}
for(const resource of manifest.resources)if(resource.path)await collect(resource.path);
manifest.package.checksum=undefined;manifest.package.signature=undefined;
const hash=createHash('sha256');hash.update('ipollowork.plugin.json\0');hash.update(createHash('sha256').update(canonical(manifest)).digest('hex'));hash.update('\n');
for(const [path,data] of [...files].sort(([a],[b])=>a<b?-1:a>b?1:0)){hash.update(`${path}\0${createHash('sha256').update(data).digest('hex')}\n`)}
const digest=hash.digest('hex'), payload=Buffer.from(`ipollowork-plugin-package-v1\0${digest}`),key=await readFile(keyPath),signature=sign(null,payload,key);
if(signature.length!==64||!verify(null,payload,createPublicKey(key),signature))throw new Error('Invalid signing key');
manifest.package.checksum={algorithm:'sha256',value:digest};manifest.package.signature={algorithm:'ed25519',keyId,value:signature.toString('base64')};
const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
if(files.size+1>512||[...files.values()].reduce((n,b)=>n+b.length,manifestBytes.length)>10*1024*1024)throw new Error('Package exceeds host limits');
const zip=new JSZip();zip.file('ipollowork.plugin.json',manifestBytes);for(const [path,bytes] of files)zip.file(path,bytes);
const out=new URL(`../dist/short-video-studio-${manifest.package.version}.ipollowork-plugin`,import.meta.url);
await writeFile(out,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:9}}));
console.log(`Packaged: ${out.pathname}`);
