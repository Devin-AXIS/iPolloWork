import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { settingsSchema } from '../src/host/sandbox/common-config.ts';
import { ProjectStorage } from '../src/host/sandbox/project.ts';
import { SandboxRuntime, type RemoteSandbox } from '../src/host/sandbox/runtime.ts';
import type { SandboxId } from '../src/host/sandbox/runtime.ts';

test('persistent project volume is retained across sandbox replacement and reauthorized on every call', async () => {
 let allowed=true; let calls=0; let creates=0;
 const server=createServer((req,res)=>{
  calls++; assert.equal(req.headers.authorization,'Bearer fixture-key');
  if(!allowed){res.writeHead(403).end();return;}
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({projectId:'project',volume:{name:'project',mountPath:'/workspace',pvc:{claimName:'ipollo-project-'+ 'a'.repeat(40),createIfNotExists:true,deleteOnSandboxTermination:false,storage:'1048576',accessModes:['ReadWriteOnce']}}}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address(); assert(address && typeof address!=='string');
 process.env.PROJECT_FIXTURE_TOKEN='fixture-key';
 const settings=settingsSchema.parse({endpoint:'http://localhost:8080',image:'test',project:{serviceUrl:`http://127.0.0.1:${address.port}`,projectId:'project',tokenEnv:'PROJECT_FIXTURE_TOKEN'}});
 const project=new ProjectStorage(settings); const disk=new Map<string,string>(); let killed=0;
 const runtime=new SandboxRuntime(settings,'key',async options=>{
  creates++; assert.equal(options.volumes?.[0]?.pvc?.deleteOnSandboxTermination,false);
  return {id:String(creates) as SandboxId,commands:{async run(){throw Error('unused')}},files:{async readBytes(path){return Buffer.from(disk.get(path)??'')},async writeFiles(entries){for(const entry of entries)disk.set(entry.path,Buffer.from(entry.data).toString())}},async kill(){killed++},async close(){}} satisfies RemoteSandbox;
 },undefined,signal=>project.volume(signal));
 const signal=new AbortController().signal;
 try{
  await runtime.run('a',signal,remote=>remote.files.writeFiles([{path:'/workspace/notes.txt',data:'automatic'}]));
  await runtime.release('a');
  await runtime.run('b',signal,async remote=>assert.equal(Buffer.from(await remote.files.readBytes('/workspace/notes.txt',{offset:0,limit:100})).toString(),'automatic'));
  allowed=false;
  await assert.rejects(runtime.run('b',signal,async()=>{}),{code:'PROJECT_STORAGE_FAILED'});
  assert.equal(creates,2);assert.equal(killed,2);assert.equal(calls,3);
 }finally{await runtime.dispose();delete process.env.PROJECT_FIXTURE_TOKEN;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
