import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudServer,settingsSchema,type CloudSandbox } from '../src/host/cloud/server.ts';

const project='11111111-1111-4111-8111-111111111111';
const config=settingsSchema.parse({accountOrigin:'https://account.test',apiUrl:'https://api.cn-hangzhou.sandbox.aliyuncs.com',domain:'cn-hangzhou.sandbox.aliyuncs.com',template:'ipollo-dsh',bucket:'private-projects',storageEndpoint:'https://oss-cn-hangzhou.aliyuncs.com',roleArn:'acs:ram::123:role/projects'});

test('cloud server deduplicates launch, starts the official profile and releases on unload',async()=>{
 const files=new Map<string,string>();const commands:string[]=[];let creates=0,kills=0,releases=0;
 const remote:CloudSandbox={commands:{async run(command,options){commands.push(command);if(options.background){assert.equal(options.envs?.IPOLLO_CLOUD_RUNTIME_TOKEN,'runtime-secret');return{stdout:''};}return{stdout:command.startsWith('hostname')?'10.0.0.2':'',exitCode:0};}},files:{async read(){return 'dsh web: https://3080-sandbox.cn-hangzhou.sandbox.aliyuncs.com/?token=owner-token';},async write(path,value){files.set(path,value);}},getHost:()=> '3080-sandbox.cn-hangzhou.sandbox.aliyuncs.com',async setTimeout(){},async kill(){kills++;return true;}};
 const api:typeof fetch=async(url,options)=>{
  if(String(url).endsWith('/inspect'))return Response.json({projectId:project,userId:'user'});
  if(String(url).endsWith('/claim'))return Response.json({projectId:project,userId:'user',ttlSeconds:1800,volumeKey:'ipollo-project-'+'a'.repeat(40),runtimeToken:'runtime-secret',managerToken:'manager-secret'});
  assert.equal(new Headers(options?.headers).get('Authorization'),'Bearer manager-secret');
  if(String(url).endsWith('/release'))releases++;
  return Response.json({ok:true});
 };
 const server=new CloudServer(config,'sandbox-secret',api,async(_template,options)=>{creates++;assert(!JSON.stringify(options.metadata).includes('runtime-secret'));return remote;});
 try{
  const result=await Promise.all([server.open('ticket'),server.open('ticket')]);
  assert.deepEqual(result[0],result[1]);assert.equal(creates,1);
  assert(commands.some(command=>command.includes('--profile web --patch')&&command.includes('--public-url')));
  assert(!commands.join('\n').includes('runtime-secret'));
  assert(![...files.values()].join('\n').includes('runtime-secret'));
  const patch=JSON.parse(files.get('/tmp/ipollowork-cloud.json')!);
  assert.equal(patch[0].config.host,'10.0.0.2');
  assert.equal(patch[1].config.documentsDirectory,'/mnt/project/workspace');
  assert.deepEqual(await server.open('another-ticket'),result[0]);assert.equal(creates,1);
 }finally{await server.dispose();}
 assert.equal(kills,1);assert.equal(releases,1);
 await assert.rejects(server.open('ticket'),{code:'IPW_CLOUD_DISABLED'});
});

test('invalid cloud origins fail before allocation',()=>{
 assert.equal(settingsSchema.safeParse({...config,accountOrigin:'http://remote.test'}).success,false);
 assert.equal(settingsSchema.safeParse({...config,apiUrl:'https://user:secret@api.test'}).success,false);
});

test('server disposal waits for a late allocation and deletes it before settling',async()=>{
 const {promise:waiting,resolve:allowCreate}=Promise.withResolvers<void>();const {promise:entering,resolve:started}=Promise.withResolvers<void>();let kills=0;
 const api:typeof fetch=async url=>Response.json(String(url).endsWith('/inspect')?{projectId:project,userId:'user'}:{projectId:project,userId:'user',ttlSeconds:1800,volumeKey:'ipollo-project-'+'a'.repeat(40),runtimeToken:'runtime',managerToken:'manager'});
 const server=new CloudServer(config,'key',api,async()=>{started();await waiting;return{commands:{async run(){return{stdout:'',exitCode:0};}},files:{async read(){return'';},async write(){}},getHost:()=>'',async setTimeout(){},async kill(){kills++;return true;}};});
 const opening=server.open('ticket');const rejected=assert.rejects(opening,{code:'IPW_CLOUD_DISABLED'});
 await entering;let stopped=false;const stopping=server.dispose().then(()=>{stopped=true;});
 await Promise.resolve();assert.equal(stopped,false);allowCreate();await Promise.all([rejected,stopping]);assert.equal(kills,1);
});

test('a failed persistent mount rejects startup and releases the allocated environment',async()=>{
 let kills=0,releases=0,writes=0;
 const api:typeof fetch=async url=>{
  if(String(url).endsWith('/inspect'))return Response.json({projectId:project,userId:'user'});
  if(String(url).endsWith('/claim'))return Response.json({projectId:project,userId:'user',ttlSeconds:1800,volumeKey:'ipollo-project-'+'a'.repeat(40),runtimeToken:'runtime',managerToken:'manager'});
  releases++;return Response.json({ok:true});
 };
 const server=new CloudServer(config,'key',api,async()=>({commands:{async run(){return{stdout:'',exitCode:1};}},files:{async read(){return'';},async write(){writes++;}},getHost:()=>'',async setTimeout(){},async kill(){kills++;return true;}}));
 try{await assert.rejects(server.open('ticket'),{code:'IPW_CLOUD_STORAGE_UNAVAILABLE'});assert.equal(writes,0);assert.equal(kills,1);assert.equal(releases,1);}finally{await server.dispose();}
});

test('an idle cloud project is destroyed without deleting its persistent project metadata',async()=>{
 const released=Promise.withResolvers<void>();let renews=0,kills=0;
 const api:typeof fetch=async url=>{
  if(String(url).endsWith('/inspect'))return Response.json({projectId:project,userId:'user'});
  if(String(url).endsWith('/claim'))return Response.json({projectId:project,userId:'user',ttlSeconds:1800,volumeKey:'ipollo-project-'+'a'.repeat(40),runtimeToken:'runtime',managerToken:'manager'});
  if(String(url).endsWith('/release'))released.resolve();
  return Response.json({ok:true,lastActiveAt:0});
 };
 const server=new CloudServer({...config,checkIntervalMs:1000,idleTimeoutMs:1000},'key',api,async()=>({commands:{async run(command){return{stdout:command.startsWith('hostname')?'10.0.0.2':'',exitCode:0};}},files:{async read(){return'dsh web: https://3080-sandbox.cn-hangzhou.sandbox.aliyuncs.com/?token=owner';},async write(){}},getHost:()=> '3080-sandbox.cn-hangzhou.sandbox.aliyuncs.com',async setTimeout(){renews++;},async kill(){kills++;return true;}}));
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  await server.open('ticket');
  await Promise.race([released.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Idle cleanup did not finish')),5000);})]);
  assert.equal(kills,1);assert.equal(renews,0);
 }finally{clearTimeout(timer);await server.dispose();}
});


test('a printed entry URL cannot hide a failed cloud plugin import',async()=>{
 let kills=0;
 const api:typeof fetch=async url=>Response.json(String(url).endsWith('/inspect')?{projectId:project,userId:'user'}:{projectId:project,userId:'user',ttlSeconds:1800,volumeKey:'ipollo-project-'+'a'.repeat(40),runtimeToken:'runtime',managerToken:'manager'});
 const server=new CloudServer(config,'key',api,async()=>({commands:{async run(command){return{stdout:command.startsWith('hostname')?'10.0.0.2':'',exitCode:0};}},files:{async read(){return'cloud-bootstrap: failed to import\ndsh web: https://3080-sandbox.cn-hangzhou.sandbox.aliyuncs.com/?token=owner';},async write(){}},getHost:()=> '3080-sandbox.cn-hangzhou.sandbox.aliyuncs.com',async setTimeout(){},async kill(){kills++;return true;}}));
 try{await assert.rejects(server.open('ticket'),{code:'IPW_CLOUD_START_FAILED'});assert.equal(kills,1);}finally{await server.dispose();}
});
