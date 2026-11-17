import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const suite=fileURLToPath(new URL('..',import.meta.url));
const cli=fileURLToPath(new URL('../../../.upstream/dsh/apps/cli/lib/bin.js',import.meta.url));

test('official cloud profile loads the suite, creates a workspace and rejects revoked project access',{skip:!existsSync(cli),timeout:90000},async()=>{
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
  if(req.url==='/api/v1/services'){res.end(JSON.stringify({points:100,items:[{id:'team',title:'Enterprise model',provider:'deepseek',capabilities:['chat'],origin:'https://provider.test',basePath:'/v1',models:[{id:'cloud-model',name:'Cloud model',contextWindow:32768,maxTokens:2048}],routes:[],available:true,enterprise:{id:'enterprise',name:'Enterprise'}}]}));return;}
  res.statusCode=404;res.end('{}');
 });
 await new Promise(resolve=>account.listen(0,'127.0.0.1',resolve));
 const address=account.address();assert(address&&typeof address!=='string');
 const accountOrigin='http://127.0.0.1:'+address.port;
 const env={...process.env,DSH_HOME:home,IPOLLO_CLOUD_RUNTIME_TOKEN:'fixture-runtime'};
 let child,logs='';
 try{
  execFileSync(process.execPath,[cli,'plugin','--profile','web','add','link:'+suite],{env,stdio:'pipe',timeout:10000});
  const fixture=join(home,'model-catalog.mjs');
  await writeFile(fixture,`export const inject=['webServer','sessionController'];export function apply(ctx){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/test-model-catalog',handler:async(req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await ctx.sessionController.modelCatalog()));}}));}`);
  const patch=join(home,'cloud.json');
  await writeFile(patch,JSON.stringify([
   {id:'webserver',config:{host:'127.0.0.1',port:0}},
   {id:'workspace-controller',config:{documentsDirectory:workspace}},
   {id:'ipollowork-suite',config:{accountOrigin,cloudRuntimeTokenEnv:'IPOLLO_CLOUD_RUNTIME_TOKEN'}},
   {id:'ipollowork-cloud-projects',disabled:true},
   ...['llm-pi-ai','llm-deepseek','llm-deepseek-account','deepseek-account'].map(id=>({id,disabled:true})),
   {insert:[{id:'model-catalog',name:fixture},{id:'cloud-bootstrap',name:'@ipollo/dsh-suite/cloud-bootstrap',config:{accountOrigin,workspace}}]},
  ]));
  child=spawn(process.execPath,[cli,'--profile','web','--patch',patch,'--no-open'],{env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',data=>{logs+=data;});child.stderr.on('data',data=>{logs+=data;});
  const deadline=Date.now()+60000;
  while(Date.now()<deadline&&!logs.includes('dsh web:')&&child.exitCode===null)await delay(50);
  assert.doesNotMatch(logs,/failed to import|failed to load|MODULE_NOT_FOUND|PluginError/i);
  const match=logs.match(/dsh web:\s+(http:\/\/[^\s]+)/);assert(match,`Official profile must publish its entry URL\n${logs.replace(/([?&]token=)[^\s&]+/g,'$1[redacted]').trim()}`);
  const url=new URL(match[1]);const entry=await fetch(url,{redirect:'manual'});assert.equal(entry.status,303);
  const cookie=entry.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert(cookie);
  const headers={Cookie:cookie};
  assert.equal((await fetch(new URL('/',url),{headers})).status,200);
  const availability=await fetch(new URL('/ipollowork-suite/cloud/availability',url),{headers});
  assert.equal(availability.status,200);assert.deepEqual(await availability.json(),{enabled:false});
  let catalog;
  for(let attempt=0;attempt<50;attempt++){
   catalog=await (await fetch(new URL('/test-model-catalog',url),{headers})).json();
   if(catalog.groups.length)break;await delay(50);
  }
  assert.deepEqual(catalog.groups.map(group=>group.id),['ipollo-team']);
  assert.equal(catalog.groups[0].models[0].id,'cloud-model');
  assert(activity>0,'Cloud bootstrap must authorize actual HTTP requests');
  const state=JSON.parse(await readFile(join(home,'storages/workspace.json'),'utf8'));
  const canonicalWorkspace=await realpath(workspace);
  assert(Object.values(state.tables.workspaces).some(record=>relative(canonicalWorkspace,record.path)===''));
  allowed=false;
  assert.equal((await fetch(new URL('/ipollowork-suite/cloud/availability',url),{headers})).status,403);
 }finally{
  if(child&&child.exitCode===null){const stopped=new Promise(resolve=>child.once('close',resolve));child.kill('SIGTERM');await stopped;}
  account.closeAllConnections();await new Promise(resolve=>account.close(resolve));await rm(home,{recursive:true,force:true});
 }
});
