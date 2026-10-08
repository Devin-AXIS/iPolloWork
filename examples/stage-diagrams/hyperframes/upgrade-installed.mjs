// Explicit, one-time replacement of the installed Stage Diagrams component packs.
// No legacy renderer or version dispatch survives the migration.
import {readFileSync,writeFileSync,readdirSync,mkdirSync,renameSync,rmSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
const root=resolve(process.env.HYPERFRAMES_COMPONENT_LIBRARY||join(homedir(),'.hyperframes/component-library'));
const dist=new URL('../dist/hyperframes/',import.meta.url);
const packs=readdirSync(dist).filter(n=>n.endsWith('.hfcomponent.json')).map(n=>JSON.parse(readFileSync(new URL(n,dist),'utf8')));
const items=new Map(packs.flatMap(p=>p.items).map(item=>[item.manifest.name,item]));
if(items.size!==35||[...items.values()].some(i=>i.manifest.version!=='4.0.0'||i.manifest.engine?.seekable!==true||i.manifest.visualComponent?.category!=='business'))throw Error('Build all 35 validated native components first.');
mkdirSync(root,{recursive:true});
const oldRoots=[];
for(const hash of readdirSync(root).filter(n=>/^[a-f0-9]{64}$/.test(n))){
 const dir=join(root,hash,'blocks');if(!existsSync(dir))continue;
 const names=readdirSync(dir);if(!names.some(n=>items.has(n)))continue;
 if(names.some(n=>!items.has(n)))throw Error('Mixed component pack: '+hash);
 oldRoots.push(hash);
}
const pending=[];
for(const pack of packs){
 const payload=JSON.stringify(pack),hash=createHash('sha256').update(payload).digest('hex'),stage=join(root,'.native-'+hash),dest=join(root,hash);
 if(existsSync(stage))throw Error('Unfinished migration: '+stage);
 mkdirSync(stage,{recursive:true});
 for(const item of pack.items){const dir=join(stage,'blocks',item.manifest.name);mkdirSync(dir,{recursive:true});
 for(const [name,content]of Object.entries(item.files)){const file=resolve(dir,name);if(!file.startsWith(dir+'/'))throw Error('Unsafe file');mkdirSync(dirname(file),{recursive:true});writeFileSync(file,content);}
 writeFileSync(join(dir,'registry-item.json'),JSON.stringify(item.manifest));}
 pending.push({stage,dest,hash});
}
// Publish only after every pack has been written successfully.
const retired=[];
try{
 for(const hash of oldRoots){const original=join(root,hash),temp=join(root,'.retired-'+hash);renameSync(original,temp);retired.push({original,temp});}
 for(const p of pending){if(existsSync(p.dest))rmSync(p.dest,{recursive:true});renameSync(p.stage,p.dest);}
}catch(error){for(const p of pending)if(existsSync(p.dest))rmSync(p.dest,{recursive:true});for(const p of retired)renameSync(p.temp,p.original);throw error;}
for(const p of retired)rmSync(p.temp,{recursive:true});
console.log(JSON.stringify({nativeComponents:items.size,replacedPacks:oldRoots.length},null,2));
