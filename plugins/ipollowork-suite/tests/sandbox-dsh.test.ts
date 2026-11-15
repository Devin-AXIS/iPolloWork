import test from 'node:test';
import assert from 'node:assert/strict';
import type {} from '@deepseek-ai/dsh-tools';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import { Context } from '@deepseek-ai/cordis';
import { brandString } from '@deepseek-ai/dsh-brand';
import { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk, type ToolCallId } from '@deepseek-ai/dsh-llm';
import type { SessionId } from '@deepseek-ai/dsh-session';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';
import { applyWithFactory } from '../src/host/sandbox/tools.ts';
import { createBackend } from '../src/host/sandbox/aliyun/backend.ts';
import { settingsSchema } from '../src/host/sandbox/aliyun/config.ts';
import type { E2bSandbox } from '../src/host/sandbox/aliyun/backend.ts';

function mountFixture(ctx:Context, input:Parameters<typeof settingsSchema.parse>[0], create:import('../src/host/sandbox/aliyun/backend.ts').E2bFactory) {
 const settings=settingsSchema.parse(input);
 applyWithFactory(ctx,{endpoint:settings.apiUrl,image:settings.template,apiKeyEnv:'ALIYUN_SANDBOX_API_KEY',releaseAfterTurn:true},createBackend(settings,create));
}

class Model extends LlmAdapter {
 calls=0;
 override async resolveModel(provider:string,model:string){return {provider,id:model,name:model}}
 override async *stream(_options:GenerateOptions):AsyncIterable<StreamChunk>{
  if(this.calls++===0){
   const id=brandString<ToolCallId>('call'),args=JSON.stringify({command:'printf hello'});
   yield {type:'block-start',index:0,blockType:'tool-call'};
   yield {type:'block-end',index:0,block:{type:'tool-call',id,name:'sandbox_exec',arguments:args}};
   yield {type:'finish',reason:{kind:'tool-calls'}};
  }else{
   yield {type:'block-start',index:0,blockType:'text'};
   yield {type:'block-end',index:0,block:{type:'text',text:'Done'}};
   yield {type:'finish',reason:{kind:'stop'}};
  }
 }
}
test('official DSH loop records the Alibaba backend result and releases at turn completion',async()=>{
 const ctx=new Context(),model=new Model();let kills=0,creates=0;
 const previous=process.env.ALIYUN_SANDBOX_API_KEY;process.env.ALIYUN_SANDBOX_API_KEY='fixture-secret';
 const remote:E2bSandbox={sandboxId:'fixture',commands:{async run(command,opts){assert.equal(command,'printf hello');await opts.onStdout?.('hello');return {stdout:'hello',stderr:'',exitCode:0}}},files:{async read(){return new ReadableStream()},async write(){}},async kill(){kills++;return true}};
 try{
  await mountAgentLoopTestDependencies(ctx);await ctx.plugin(SandboxPolicy,{mode:'workspace-write'});ctx.llm.registerAdapter(['fixture'],model);
  const fiber=ctx.plugin({inject:['tools','agents','sandboxPolicy'],apply(scope:Context){mountFixture(scope,{apiUrl:'https://api.cn-hangzhou.sandbox.aliyuncs.com',domain:'cn-hangzhou.sandbox.aliyuncs.com',template:'code-interpreter-v1',releaseAfterTurn:true},async()=>{creates++;return remote})}});await fiber;
  const harness=await mountAgentLoopTestHarness(ctx);
  const agent=await harness.create(brandString<SessionId>('aliyun-fixture'),{provider:'fixture',model:'fixture'});
  agent.followup(createUserMessage({content:[{type:'text',text:'Run the command'}],source:{kind:'user'}}));await agent.whenIdle();
  const result=agent.session.snapshotEvents().find(e=>e.type==='tool/result');assert(result);assert.equal(result.data.message.isError,false,JSON.stringify(result));
  assert(!JSON.stringify(result).includes('fixture-secret'));
  if(result.type==='tool/result')assert.deepEqual(result.data.meta,{stdout:'hello',stderr:'',exitCode:0,truncated:false});
  assert.equal(model.calls,2);assert.equal(creates,1);assert.equal(kills,1);
  await fiber.dispose();assert.equal(ctx.tools.definitions().some(t=>t.name==='sandbox_exec'),false);
 }finally{await ctx.fiber.dispose();if(previous===undefined)delete process.env.ALIYUN_SANDBOX_API_KEY;else process.env.ALIYUN_SANDBOX_API_KEY=previous}
});
