/** Bounded transfers owned by an explicitly enabled workspace. Existing files are never replaced. */
import { createReadStream } from 'node:fs';
import { mkdir, realpath, open, link, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
const SOURCE_LIMIT=5*1024*1024,VIDEO_LIMIT=512*1024*1024;
export async function sourceFile(workspace:string,input:string){
 const root=await realpath(workspace),file=await realpath(resolve(root,input)),path=relative(root,file);
 if(path==='..'||path.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(path))throw new Error('Source must be inside the enabled workspace');
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of createReadStream(file,{start:0,end:SOURCE_LIMIT})){size+=chunk.length;if(size>SOURCE_LIMIT)throw new Error('Source exceeds 5 MB; upload larger documents in Stage');chunks.push(Buffer.from(chunk));}
 return {name:basename(file),base64:Buffer.concat(chunks).toString('base64')};
}
export async function saveMovie(workspace:string,id:string,response:Response,signal:AbortSignal):Promise<string>{
 if(!/^[a-f0-9]{32}$/.test(id)||!response.ok||!response.body||!response.headers.get('Content-Type')?.startsWith('video/mp4')){await response.body?.cancel();throw new Error('Stage did not return a video');}
 const root=await realpath(workspace),directory=join(root,'stage-exports');await mkdir(directory,{recursive:true});
 if(await realpath(directory)!==directory){await response.body.cancel();throw new Error('Export directory must stay inside this workspace');}
 const nonce=randomBytes(6).toString('hex'),temporary=join(directory,'.'+id+'-'+nonce+'.part'),target=join(directory,'Stage-'+id+'-'+nonce+'.mp4');
 const file=await open(temporary,'wx',0o600),reader=response.body.getReader();let size=0;
 try{
  for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>VIDEO_LIMIT)throw new Error('Video exceeds the 512 MB export limit');await file.writeFile(value);}
  signal.throwIfAborted();const header=Buffer.alloc(12);await file.close();const input=await open(temporary,'r');try{await input.read(header,0,12,0);}finally{await input.close();}
  if(size<1000||header.toString('ascii',4,8)!=='ftyp')throw new Error('Stage returned an invalid MP4');
  await link(temporary,target);return target;
 }finally{await file.close().catch(()=>{});await reader.cancel().catch(()=>{});reader.releaseLock();await rm(temporary,{force:true});}
}
