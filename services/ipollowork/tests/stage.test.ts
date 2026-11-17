import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createService } from '../src/app.js';
import { StageService } from '../src/stage.js';
import { ledgerEntry, wallet } from '../src/domain.js';
import { testConfig } from './database.js';
import type { Actor } from '../src/auth.js';
import { ExecutionService } from '../src/execution.js';
import { accountUsage, recentUsage } from '../src/usage.js';

test('Stage authorization is one-use and origin-bound; actual token settlement never freezes points or bills twice',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ipw-stage-'));
 const app=await createService(await testConfig({DATA_DIR:directory,SERVICE_ORIGIN:'http://localhost:4785'}));
 try{
  const {user}=await app.auth.api.signUpEmail({body:{name:'Stage owner',email:'stage-owner@example.test',password:'Strong-test-password-2026'}});
  const actor:Actor={id:user.id,name:user.name,email:user.email,role:'user'};
  let exchange:any;
  const bridge=new StageService(app.store,app.settings,'http://localhost:4785',async(url,init)=>{
   assert.equal(new URL(String(url)).origin,'https://stage.example.test');
   if(String(url).endsWith('/token')){exchange=JSON.parse(String(init?.body));return Response.json({access_token:'stage-fixture-access-'.repeat(3),connectionId:'grant',subject:'stage-user',name:'Stage user',expires_in:3600});}
   return Response.json({revoked:true});
  });
  assert.deepEqual(await bridge.status(actor),{configured:false,connected:false,connectionId:null,stageName:null});
  await assert.rejects(bridge.connect(actor),{code:'STAGE_NOT_CONFIGURED'});
  await app.settings.set('stage',{enabled:'true',origin:'https://stage.example.test',rates:JSON.stringify([{model:'official:model',input:1000000,output:2000000,inputCostMicros:100000,outputCostMicros:200000}])});
  const authorize=new URL((await bridge.connect(actor)).url),state=authorize.searchParams.get('state')!;
  assert(!authorize.href.includes(user.id));
  assert.equal((await bridge.descriptor(state)).userId,user.id);
  await bridge.callback(state,'c'.repeat(43));
  assert.equal(exchange.code,'c'.repeat(43));
  assert.equal(exchange.code_challenge,undefined);
  assert.equal((await bridge.status(actor)).connected,true);
  assert(!JSON.stringify(await bridge.status(actor)).includes(exchange.billing_token));
  assert(!JSON.stringify(await app.store.all("SELECT value FROM settings WHERE key LIKE 'stage-link/%'")).includes(exchange.billing_token));
  await assert.rejects(bridge.callback(state,'c'.repeat(43)),{code:'STAGE_AUTH_EXPIRED'});
  await app.store.transaction(()=>ledgerEntry(app.store,user.id,10,'fixture/'+user.id,'Fixture'));
  const requestId=randomUUID();
  await bridge.begin(user.id,exchange.billing_token,{requestId,model:'official:model'});
  assert.equal((await wallet(app.store,user.id)).balance,10,'generation cannot reserve or deduct points');
  await app.store.run('UPDATE service_calls SET updated_at=0 WHERE id=?',requestId);
  await new ExecutionService(app.store,app.settings).recover();
  assert.equal((await app.store.one('SELECT state FROM service_calls WHERE id=?',requestId))?.state,'running','generic execution recovery cannot discard Stage settlement receipts');
  assert.deepEqual(await bridge.begin(user.id,exchange.billing_token,{requestId,model:'official:model'}),{requestId,replayed:true});
  await assert.rejects(bridge.begin(user.id,exchange.billing_token,{requestId:randomUUID(),model:'official:model'}),{code:'STAGE_RUN_ACTIVE'});
  const result={requestId,status:'succeeded',calls:[{model:'official:model',input:3,output:4}]};
  await assert.rejects(bridge.settle(user.id,'wrong-token',result),{code:'STAGE_BILLING_UNAUTHORIZED'});
  await bridge.disconnect(actor);
  // Revoking the link stops new work, but cannot erase a charge for previously authorized usage.
  assert.deepEqual(await bridge.settle(user.id,exchange.billing_token,result),{points:11,replayed:false});
  assert.equal((await wallet(app.store,user.id)).balance,-1);
  assert.deepEqual(await bridge.settle(user.id,exchange.billing_token,result),{points:11,replayed:true});
  assert.equal((await wallet(app.store,user.id)).balance,-1);
  await assert.rejects(bridge.settle(user.id,exchange.billing_token,{...result,calls:[{model:'official:model',input:4,output:4}]}),{code:'IDEMPOTENCY_CONFLICT'});
  const receipt=await app.store.one('SELECT input_tokens,output_tokens,cost_micros,billing_settled FROM service_calls WHERE id=?',requestId);
  assert.equal(receipt?.input_tokens,3);assert.equal(receipt?.output_tokens,4);assert.equal(receipt?.billing_settled,true);
  await assert.rejects(bridge.begin(user.id,exchange.billing_token,{requestId:randomUUID(),model:'official:model'}),{code:'STAGE_BILLING_UNAUTHORIZED'});
  assert.equal((await app.store.all("SELECT key FROM settings WHERE key LIKE 'stage-revoke/%'")).length,1);
  await bridge.reconcile();
  assert.equal((await app.store.all("SELECT key FROM settings WHERE key LIKE 'stage-revoke/%'")).length,0);
  await app.store.transaction(()=>ledgerEntry(app.store,user.id,100,'refill/'+user.id,'Fixture'));
  const reconnect=new URL((await bridge.connect(actor)).url).searchParams.get('state')!;
  await bridge.callback(reconnect,'d'.repeat(43));
  const failedId=randomUUID();
  await bridge.begin(user.id,exchange.billing_token,{requestId:failedId,model:'official:model'});
  await bridge.settle(user.id,exchange.billing_token,{requestId:failedId,status:'failed',calls:[{model:'official:model',input:1,output:1}]});
  const usage=await accountUsage(app.store,user.id,480);
  assert.equal(usage.daily.used,14,'measured partial failure is still actual usage');
  assert.equal(usage.daily.reserved,0,'a settled failed generation cannot appear as frozen points');
  assert.equal((await recentUsage(app.store,user.id,480)).at(-1)?.used,14);
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});

test('superseded and disconnected browser tabs cannot restore a stale Stage grant',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ipw-stage-superseded-'));
 const app=await createService(await testConfig({DATA_DIR:directory,SERVICE_ORIGIN:'http://localhost:4785'}));
 try{
  const {user}=await app.auth.api.signUpEmail({body:{name:'Owner',email:'stage-superseded@example.test',password:'Strong-test-password-2026'}}),actor:Actor={id:user.id,name:user.name,email:user.email,role:'user'};
  await app.settings.set('stage',{enabled:'true',origin:'https://stage.example.test',rates:'[]'});
  let exchanges=0;const stage=new StageService(app.store,app.settings,'http://localhost:4785',async()=>{exchanges++;return Response.json({});});
  const one=new URL((await stage.connect(actor)).url).searchParams.get('state')!;
  const two=new URL((await stage.connect(actor)).url).searchParams.get('state')!;
  await assert.rejects(stage.callback(one,'x'.repeat(43)),{code:'STAGE_AUTH_EXPIRED'});
  await stage.disconnect(actor);
  await assert.rejects(stage.callback(two,'x'.repeat(43)),{code:'STAGE_AUTH_EXPIRED'});
  assert.equal(exchanges,0);assert.equal((await stage.status(actor)).connected,false);
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});

test('Stage routes require the native account session even when the integration is disabled',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ipw-stage-route-'));
 const app=await createService(await testConfig({DATA_DIR:directory,SERVICE_ORIGIN:'http://localhost:4785'}));
 try{assert.equal((await app.app.request('http://localhost:4785/api/v1/stage/status')).status,401);assert.equal((await app.app.request('http://localhost:4785/api/v1/stage/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);}finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
