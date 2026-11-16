import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandExitError, type SandboxOpts } from 'e2b';
import { SandboxRuntime, type SandboxFactory } from '../src/host/sandbox/runtime.ts';
import { Config as CommonConfig } from '../src/host/sandbox/common-config.ts';
import { createBackend, readRange, type E2bSandbox } from '../src/host/sandbox/aliyun/backend.ts';
import { settingsSchema } from '../src/host/sandbox/aliyun/config.ts';

const base={apiUrl:'https://api.cn-hangzhou.sandbox.aliyuncs.com',domain:'cn-hangzhou.sandbox.aliyuncs.com',template:'code-interpreter-v1'};
const project={serviceUrl:'https://accounts.example.com',projectId:'p',tokenEnv:'PROJECT_TOKEN'};
const storage={bucket:'project-files',endpoint:'https://oss-cn-hangzhou.aliyuncs.com',roleArn:'acs:ram::123456789:role/sandbox'};
const signal=new AbortController().signal;
function fake():E2bSandbox & {kills:number; commandsSeen:string[]} {
 return {sandboxId:'test-sandbox',kills:0,commandsSeen:[],
  commands:{async run(_command,opts){await opts.onStdout?.('hello');return {exitCode:0,stdout:'hello',stderr:''}}},
  files:{async read(){return new ReadableStream({start(c){c.enqueue(Buffer.from('abcdef'));c.close()}})},async write(){}},
  async kill(){this.kills++;return true}};
}
const opts:Parameters<SandboxFactory>[0]={image:'ignored',connectionConfig:{apiKey:'secret'},signal};

test('validates cloud endpoint and rejects incomplete persistence configuration',()=>{
 assert.throws(()=>settingsSchema.parse({...base,apiUrl:'http://evil.example'}));
 assert.throws(()=>settingsSchema.parse({...base,project}));
 assert.throws(()=>settingsSchema.parse({...base,storage}));
 assert.throws(()=>settingsSchema.parse({...base,domain:'https://wrong.example'}));
});

test('maps only an authorized project volume to a private OSS prefix',async()=>{
 const settings=settingsSchema.parse({...base,project,storage});
 const requests:SandboxOpts[]=[];
 const backend=createBackend(settings,async(template,options)=>{assert.equal(template,base.template);requests.push(options);return fake()});
 await assert.rejects(backend(opts),{code:'PROJECT_STORAGE_FAILED'});
 assert.equal(requests.length,0);
 const claim='ipollo-project-'+ 'a'.repeat(40);
 const remote=await backend({...opts,volumes:[{name:'project',mountPath:'/workspace',pvc:{claimName:claim}}]});
 const sent=requests[0]!;
 assert.equal(sent.apiKey,'secret');assert.equal(sent.secure,true);assert.equal(sent.timeoutMs,1800000);
 const mount=JSON.parse(sent.metadata!['fc.sandbox.storage.oss']!).mountPoints[0];
 assert.equal(mount.bucketPath,'/ipollowork/'+claim+'/');assert.equal(mount.mountDir,'/mnt/project');
 assert.equal(JSON.stringify(sent.metadata).includes('secret'),false);
 await remote.kill();
});

test('streams bounded ranges and cancels the body without reading the whole file',async()=>{
 let cancelled=false;
 const data=await readRange(new ReadableStream({start(c){c.enqueue(Buffer.from('abc'));c.enqueue(Buffer.from('defghi'))},cancel(){cancelled=true}}),2,4);
 assert.equal(Buffer.from(data).toString(),'cdef');assert.equal(cancelled,true);
});

test('command failure retains exit code while transport errors remain failures',async()=>{
 const instance=fake();
 instance.commands.run=async(_cmd,opts)=>{await opts.onStderr?.('missing');throw new CommandExitError({exitCode:2,stdout:'',stderr:'missing'})};
 const backend=createBackend(settingsSchema.parse(base),async()=>instance);
 const remote=await backend(opts);let stderr='';
 const result=await remote.commands.run('bad',{workingDirectory:'/tmp',timeoutSeconds:2},{onStderr:v=>{stderr+=v.text}},signal);
 assert.equal(result.exitCode,2);assert.equal(stderr,'missing');
 instance.commands.run=async()=>{throw Error('provider secret')};
 await assert.rejects(remote.commands.run('bad',{workingDirectory:'/tmp',timeoutSeconds:2},{},signal));
});

test('shared lifecycle quarantines excessive output, deletes sandbox, and redacts backend errors',async()=>{
 const instance=fake();
 instance.commands.run=async(_cmd,opts)=>{await opts.onStdout?.('x'.repeat(2048));return {stdout:'',stderr:'',exitCode:0}};
 const cfg={endpoint:base.apiUrl,image:base.template,maxOutputBytes:1024};
 const runtime=new SandboxRuntime({...CommonConfig(cfg),apiKeyEnv:'KEY',workspace:'/tmp',secureAccess:true,releaseAfterTurn:false,cpu:'1',memory:'2Gi',sandboxTtlSeconds:1800,requestTimeoutSeconds:30,commandTimeoutSeconds:120,maxOutputBytes:1024,maxFileBytes:1048576,maxSandboxes:10}, 'secret',createBackend(settingsSchema.parse({...base,maxOutputBytes:1024}),async()=>instance));
 await assert.rejects(runtime.run('a',signal,remote=>remote.commands.run('large',{workingDirectory:'/tmp',timeoutSeconds:2},{},signal)),{code:'SANDBOX_UNAVAILABLE'});
 assert.equal(instance.kills,1);await runtime.dispose();
});

test('unavailable project mount is never replaced with a temporary directory',async()=>{
 const instance=fake();instance.commands.run=async()=>{throw new CommandExitError({exitCode:1,stdout:'',stderr:''})};
 const backend=createBackend(settingsSchema.parse({...base,project,storage}),async()=>instance);
 await assert.rejects(backend({...opts,volumes:[{name:'project',mountPath:'/workspace',pvc:{claimName:'ipollo-project-'+'b'.repeat(40)}}]}),{code:'PROJECT_STORAGE_FAILED'});
 assert.equal(instance.kills,1);
});
