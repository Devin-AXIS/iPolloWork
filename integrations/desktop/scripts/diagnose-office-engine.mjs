import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

const [installation,inputRoot,mode]=process.argv.slice(2);
if(!installation||!inputRoot) throw Error('Expected engine installation and fixture directory');
if(!mode){
 const require=createRequire(join(resolve(installation),'package.json'));
 const electron=require('electron');
 const results=[];
 for(const [name,executable] of [['node',process.execPath],['electron',electron],['electron-bounded',electron],['electron-wasm',electron],['electron-scratch',electron]]){
  if(process.env.OFFICE_PROBE_CASE && process.env.OFFICE_PROBE_CASE!==name) continue;
  const home=await mkdtemp(join(tmpdir(),'office-intel-probe-'));
  const code=await new Promise((resolveResult,reject)=>{
   const child=spawn(executable,[fileURLToPath(import.meta.url),installation,inputRoot,name],{stdio:'inherit',env:{...process.env,HOME:home,USERPROFILE:home,XDG_CACHE_HOME:home,XDG_CONFIG_HOME:home,XDG_STATE_HOME:home,APPDATA:home,LOCALAPPDATA:home,ELECTRON_RUN_AS_NODE:'1'}});
   child.once('error',reject);child.once('exit',code=>resolveResult(code));
  });
  results.push({name,code});
 }
 console.log('Probe outcomes:',JSON.stringify(results));
 if(results.some(result=>result.code!==0)) process.exitCode=1;
}else{
 const {createConverter}=await import(pathToFileURL(join(resolve(installation),'node_modules/@deepseek-ai/libreoffice-kit/lib/index.js')).href);
 const output=await mkdtemp(join(tmpdir(),'office-intel-output-'));
 const resolver=createRequire(join(resolve(installation),'package.json'));
 const wasmResolver=name=>{
  if(name!=='@deepseek-ai/libreoffice-kit-wasm'){const error=Error('The probe selects the supported WASM engine');error.code='MODULE_NOT_FOUND';throw error;}
  return resolver.resolve(name+'/package.json');
 };
 const converter=await createConverter({timeoutMs:180000,maxImageResolution:192,maxInputBytes:50*1024*1024,maxOutputBytes:100*1024*1024,...(mode==='electron-wasm'?{resolveEnginePackage:wasmResolver}:{})});
 console.log(JSON.stringify({mode,platform:process.platform,arch:process.arch,versions:process.versions}));
 const operation=async(label,work)=>{
  const started=Date.now();console.log(JSON.stringify({event:'begin',mode,label,time:new Date().toISOString()}));
  try{await work();console.log(JSON.stringify({event:'pass',mode,label,milliseconds:Date.now()-started}));}
  catch(error){console.error(JSON.stringify({event:'fail',mode,label,milliseconds:Date.now()-started,code:error?.code,message:error?.message}));throw error;}
 };
 const withInput=async(extension,work)=>{
  if(mode!=='electron-scratch') return work(join(inputRoot,'input.'+extension));
  const directory=await mkdtemp(join(tmpdir(),'dsh-office-kit-'));
  const inputPath=join(directory,'source.'+extension);
  await writeFile(inputPath,await readFile(join(inputRoot,'input.'+extension)),{flag:'wx',mode:0o600});
  try{return await work(inputPath);}finally{await rm(directory,{recursive:true,force:true});}
 };
 try{
  for(const extension of ['docx','xlsx','pptx']) await operation('pdf-'+extension,async()=>{
   const outputPath=join(output,extension+'.pdf');await withInput(extension,inputPath=>converter.render({inputPath,outputPath},new AbortController().signal));
   const bytes=await readFile(outputPath);if(!bytes.subarray(0,8).toString().startsWith('%PDF-')) throw Error('Invalid PDF');
  });
  for(const extension of ['docx','xlsx','pptx']){
   const inputPath=join(inputRoot,'input.'+extension);
   await operation('images-'+extension,async()=>{
    const outputDir=join(output,'images-'+extension);
    const result=await withInput(extension,inputPath=>converter.renderImages({inputPath,outputDir,maxPages:4,maxPixels:16777216,maxDimension:8192,...(mode==='electron-bounded'&&extension==='xlsx'?{sheet:'Sheet',range:'A1:B2'}:{})},new AbortController().signal));
    if(!result.images.length) throw Error('No rendered images');
   });
   await operation('convert-'+extension,async()=>{
    const format={docx:'odt',xlsx:'ods',pptx:'odp'}[extension];const outputPath=join(output,'converted.'+format);
    await withInput(extension,inputPath=>converter.convert({inputPath,outputPath},new AbortController().signal));if((await readFile(outputPath)).subarray(0,4).toString('hex')!=='504b0304') throw Error('Invalid converted ZIP');
   });
   if(extension==='xlsx') await operation('recalculate-xlsx',async()=>{
    const outputPath=join(output,'recalculated.xlsx');await withInput(extension,inputPath=>converter.recalculate({inputPath,outputPath},new AbortController().signal));
    if((await readFile(outputPath)).subarray(0,4).toString('hex')!=='504b0304') throw Error('Invalid recalculated ZIP');
   });
  }
 }finally{await converter.dispose();}
}
