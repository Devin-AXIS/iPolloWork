import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const suite=fileURLToPath(new URL('..',import.meta.url));
const cli=fileURLToPath(new URL('../../../.upstream/dsh/apps/cli/lib/bin.js',import.meta.url));

test('official cloud profile loads the suite, creates a workspace and rejects revoked project access',{skip:!existsSync(cli),timeout:30000},async()=>{
 const home=await mkdtemp(join(tmpdir(),'ipw-cloud-native-'));
 const workspace=join(home,'workspace');await mkdir(workspace);
 let allowed=true,activity=0;
 const account=createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url.startsWith('/api/v1/cloud-runtime/')){
   assert.equal(req.headers.authorization,'Bearer fixture-runtime');activity++;
   res.statusCode=allowed?200:403;res.end(JSON.stringify({ok:allowed}));return;
  }
  if(req.url==='/api/auth/get-session'){res.end(JSON.stringify({user:{id:'fixture',name:'Fixture',email:'fixture@example.test'}}));return;}
  if(req.url==='/api/v1/me/summary'){res.end('{"points":{"balance":100},"enterprises":[]}');return;}
  if(req.url==='/api/v1/services'){res.end('{"items":[]}');return;}
  res.statusCode=404;res.end('{}');
 });
 await new Promise(resolve=>account.listen(0,'127.0.0.1',resolve));
 const address=account.address();assert(address&&typeof address!=='string');
 const accountOrigin='http://127.0.0.1:'+address.port;
 const env={...process.env,DSH_HOME:home,IPOLLO_CLOUD_RUNTIME_TOKEN:'fixture-runtime'};
 let child,logs='';
 try{
  execFileSync(process.execPath,[cli,'plugin','--profile','web','add','link:'+suite],{env,stdio:'pipe',timeout:10000});
  const patch=join(home,'cloud.json');
  await writeFile(patch,JSON.stringify([
   {id:'webserver',config:{host:'127.0.0.1',port:0}},
   {id:'workspace-controller',config:{documentsDirectory:workspace}},
   {id:'ipollowork-suite',config:{accountOrigin,cloudRuntimeTokenEnv:'IPOLLO_CLOUD_RUNTIME_TOKEN'}},
   {id:'ipollowork-cloud-projects',disabled:true},
   {insert:[{id:'cloud-bootstrap',name:'@ipollo/dsh-suite/cloud-bootstrap',config:{accountOrigin,workspace}}]},
  ]));
  child=spawn(process.execPath,[cli,'--profile','web','--patch',patch,'--no-open'],{env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',data=>{logs+=data;});child.stderr.on('data',data=>{logs+=data;});
  for(let i=0;i<200&&!logs.includes('dsh web:');i++){if(child.exitCode!==null)break;await delay(50);}
  assert.doesNotMatch(logs,/failed to import|failed to load|MODULE_NOT_FOUND|PluginError/i);
  const match=logs.match(/dsh web:\s+(http:\/\/[^\s]+)/);assert(match,'Official profile must publish its entry URL');
  const url=new URL(match[1]);const entry=await fetch(url,{redirect:'manual'});assert.equal(entry.status,303);
  const cookie=entry.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert(cookie);
  const headers={Cookie:cookie};
  assert.equal((await fetch(new URL('/',url),{headers})).status,200);
  const availability=await fetch(new URL('/ipollowork-suite/cloud/availability',url),{headers});
  assert.equal(availability.status,200);assert.deepEqual(await availability.json(),{enabled:false});
  assert(activity>0,'Cloud bootstrap must authorize actual HTTP requests');
  assert((await readFile(join(home,'storages/workspace.json'),'utf8')).includes(workspace));
  allowed=false;
  assert.equal((await fetch(new URL('/ipollowork-suite/cloud/availability',url),{headers})).status,403);
 }finally{
  if(child&&child.exitCode===null){const stopped=new Promise(resolve=>child.once('close',resolve));child.kill('SIGTERM');await stopped;}
  account.closeAllConnections();await new Promise(resolve=>account.close(resolve));await rm(home,{recursive:true,force:true});
 }
});
