import {execFileSync,spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readdir,open,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve,dirname,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {withMacOSSigningKeychain} from './macos-signing-keychain.mjs';

if(process.platform!=='darwin'||process.arch!=='x64') throw Error('Intel macOS probe only');
const [installation,inputs]=process.argv.slice(2);
const require=createRequire(join(resolve(installation),'package.json'));
const engine=dirname(require.resolve('@deepseek-ai/libreoffice-kit-darwin-x64/package.json'));
const metadata=JSON.parse(await (await import('node:fs/promises')).readFile(join(engine,'prebuilds.json'),'utf8'));
const helper=join(engine,metadata.engine.executable);
const electron=require('electron');
const scratch=await mkdtemp(join(tmpdir(),'office-signature-probe-'));
const certificate=join(scratch,'certificate.p12');
await writeFile(certificate,Buffer.from(process.env.CERTIFICATE_P12??'','base64'),{mode:0o600});
const inspection=join(scratch,'inspect.keychain-db');
const password=randomBytes(32).toString('hex');
const security=args=>{
 try{return execFileSync('/usr/bin/security',args,{encoding:'utf8',stdio:'pipe',timeout:120000});}
 catch{throw Error('Certificate inspection failed');}
};
let created=false;
try{
 let identity;
 try{
  security(['create-keychain','-p',password,inspection]);created=true;
  security(['unlock-keychain','-p',password,inspection]);
  security(['import',certificate,'-k',inspection,'-P',process.env.CERTIFICATE_PASSWORD??'','-T','/usr/bin/codesign']);
  identity=security(['find-identity','-p','codesigning',inspection]).match(/"(Developer ID Application: [^"]+)"/)?.[1];
 }finally{if(created) security(['delete-keychain',inspection]);}
 if(!identity) throw Error('No Developer ID identity');
 await withMacOSSigningKeychain({CSC_LINK:certificate,CSC_KEY_PASSWORD:process.env.CERTIFICATE_PASSWORD??'',DSH_DESKTOP_MACOS_SIGNING_IDENTITY:identity.replace(/^Developer ID Application: /,'')},async signing=>{
  const sign=(file,plist)=>execFileSync('/usr/bin/codesign',['--force','--sign',identity,'--keychain',signing.CSC_KEYCHAIN,'--identifier','com.deepseek.harness.runtime.'+createHash('sha256').update(relative(engine,file)).digest('hex'),'--timestamp','--options','runtime',...(plist?['--entitlements',plist]:[]),file],{stdio:'pipe',timeout:120000});
  const jit=fileURLToPath(new URL('./jit-entitlements.plist',import.meta.url));
  const intel=fileURLToPath(new URL('./node-x64-entitlements.plist',import.meta.url));
  const entries=await readdir(engine,{recursive:true,withFileTypes:true});
  for(const entry of entries){
   if(!entry.isFile()) continue;
   const file=join(entry.parentPath,entry.name);const fd=await open(file,'r');const bytes=Buffer.alloc(4);
   try{await fd.read(bytes,0,4,0);}finally{await fd.close();}
   if(['cffaedfe','cefaedfe','feedfacf','feedface','cafebabe','bebafeca'].includes(bytes.toString('hex'))) sign(file,file===helper?jit:undefined);
  }
  const outcomes=[];
  for(const [label,plist] of [['signed-jit',jit],['signed-intel-memory',intel]]){
   sign(helper,plist);
   const home=await mkdtemp(join(tmpdir(),'office-signed-home-'));
   const env={...process.env,HOME:home,USERPROFILE:home,XDG_CACHE_HOME:join(home,'cache'),ELECTRON_RUN_AS_NODE:'1'};
   delete env.CERTIFICATE_P12;delete env.CERTIFICATE_PASSWORD;
   const code=await new Promise((accept,reject)=>{
    const child=spawn(electron,[fileURLToPath(new URL('./diagnose-office-engine.mjs',import.meta.url)),installation,inputs,label],{env,stdio:'inherit'});
    child.once('error',reject);child.once('exit',accept);
   });
   outcomes.push({label,code});
  }
  console.log('Signed probe outcomes:',JSON.stringify(outcomes));
 });
}finally{await rm(scratch,{recursive:true,force:true});}
