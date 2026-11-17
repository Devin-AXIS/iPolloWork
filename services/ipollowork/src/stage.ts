/** Account-owned Stage connection. Its server and project store remain independent. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './database.js';
import type { Settings } from './settings.js';
import type { App } from './http.js';
import type { Actor } from './auth.js';
import { ledgerEntry, lockWallet, wallet } from './domain.js';
import { ServiceError } from './errors.js';

const opaque = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const same = (a: string, b: string) => {const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
const calls = z.array(z.object({ model:z.string().min(1).max(200), input:z.number().int().safe().nonnegative(), output:z.number().int().safe().nonnegative(), cacheRead:z.number().int().safe().nonnegative().optional() }).strict()).max(4096);
const rates = z.array(z.object({ model:z.string().min(1), input:z.number().int().safe().nonnegative(), output:z.number().int().safe().nonnegative(), cacheRead:z.number().int().safe().nonnegative().optional(), cacheReadCostMicros:z.number().int().safe().nonnegative().optional(), inputCostMicros:z.number().int().safe().nonnegative().optional(), outputCostMicros:z.number().int().safe().nonnegative().optional() }).strict()).max(200).refine(items=>new Set(items.map(item=>item.model)).size===items.length,'Duplicate model rate');
export function validateStageSettings(value:Record<string,string>){if(value.enabled!==undefined&&!['true','false'].includes(value.enabled))throw new ServiceError('STAGE_INVALID_CONFIGURATION',400);if(value.origin)origin(value.origin);if(value.rates)rates.parse(JSON.parse(value.rates));}
const token = z.object({access_token:z.string().min(32).max(500),connectionId:z.string(),subject:z.string(),name:z.string().max(200),expires_in:z.number().int().positive()});
function origin(value:string):string {
  const url=new URL(value);
  if(url.href!==url.origin+'/' || !(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new ServiceError('STAGE_INVALID_ORIGIN',400);
  return url.origin;
}
export class StageService {
  private lifetime=new AbortController();
  private timer?:ReturnType<typeof setInterval>;
  private pending?:Promise<void>;
  constructor(private store:Store,private settings:Settings,private workOrigin:string,private fetcher:typeof fetch=fetch){}
  start(){this.timer=setInterval(()=>{void this.flush();},30000);this.timer.unref();void this.flush();}
  async close(){this.lifetime.abort();if(this.timer)clearInterval(this.timer);await this.pending?.catch(()=>{});}
  private flush(){return this.pending??=this.reconcile().catch(()=>{}).finally(()=>{this.pending=undefined;});}
  async reconcile(){
    const rows=await this.store.all("SELECT key FROM settings WHERE key LIKE 'stage-revoke/%' LIMIT 50");
    for(const row of rows){
      const key=String(row.key),value=await this.settings.get(key);
      try{await this.remote(origin(value.origin!),'/api/integrations/ipollowork/revoke',value.access,{},20000);}catch(error){if(!(error instanceof ServiceError&&error.code==='STAGE_LINK_REQUIRED'))continue;}
      await this.store.run('DELETE FROM settings WHERE key=?',key);
    }
  }
  private async lock(userId:string){await this.store.one('SELECT pg_advisory_xact_lock(hashtextextended(?,0))','stage-link/'+userId);}
  private async config(){const value=await this.settings.get('stage');return {enabled:value.enabled==='true',origin:origin(value.origin||'https://stage.ipollo.net'),rates:rates.parse(JSON.parse(value.rates||'[]'))};}
  private async remote(base:string,path:string,access:string|undefined,input?:unknown,timeoutMs=120000){
    const response=await this.fetcher(base+path,{method:input===undefined?'GET':'POST',headers:{...(access?{Authorization:'Bearer '+access}:{}),'Content-Type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)}),redirect:'error',signal:AbortSignal.any([this.lifetime.signal,AbortSignal.timeout(timeoutMs)])});
    const reader=response.body?.getReader();if(!reader)throw new ServiceError('STAGE_INVALID_RESPONSE',503);
    const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>12*1024*1024)throw new ServiceError('STAGE_RESPONSE_TOO_LARGE',503);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    const bytes=Buffer.concat(chunks).toString('utf8');
    let result:unknown;try{result=JSON.parse(bytes);}catch{throw new ServiceError('STAGE_INVALID_RESPONSE',503);}
    if(!response.ok)throw new ServiceError(response.status===401?'STAGE_LINK_REQUIRED':'STAGE_REQUEST_FAILED',response.status>=500?503:response.status===409?409:400,typeof (result as {error?:unknown})?.error==='string'?String((result as {error:string}).error).slice(0,500):'Stage 请求未完成，请检查任务状态后重试');
    return result;
  }
  private async linked(actor:Actor){
    const config=await this.config(),value=await this.settings.get('stage-link/'+actor.id);
    if(!config.enabled)throw new ServiceError('STAGE_NOT_CONFIGURED',503);
    if(!value.access||value.origin!==config.origin||Number(value.expires)<=Date.now())throw new ServiceError('STAGE_LINK_REQUIRED',409);
    return {config,value};
  }
  async status(actor:Actor){const config=await this.config(),value=await this.settings.get('stage-link/'+actor.id);const connected=config.enabled&&!!value.access&&value.origin===config.origin&&Number(value.expires)>Date.now();return {configured:config.enabled,connected,connectionId:connected?actor.id+':'+value.connectionId:null,stageName:connected?value.name:null};}
  async connect(actor:Actor){
    const config=await this.config();if(!config.enabled)throw new ServiceError('STAGE_NOT_CONFIGURED',503);
    const state=opaque(),verifier=opaque();
    await this.store.transaction(async()=>{
      await this.lock(actor.id);
      // One pending grant per account; a later request supersedes an older browser tab.
      const prior=await this.settings.get('stage-pending-user/'+actor.id);
      if(prior.state)await this.store.run('DELETE FROM settings WHERE key=?','stage-pending/'+prior.state);
      await this.settings.set('stage-pending/'+state,{userId:actor.id,name:actor.name,verifier,origin:config.origin,expires:String(Date.now()+10*60000)});
      await this.settings.set('stage-pending-user/'+actor.id,{state});
    });
    const url=new URL('/connect/ipollowork',config.origin);
    url.search=new URLSearchParams({client_id:this.workOrigin,redirect_uri:this.workOrigin+'/api/integrations/stage/callback',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
    return {url:url.href};
  }
  async descriptor(state:string){
    if(!/^[\w-]{43}$/.test(state))throw new ServiceError('STAGE_AUTH_EXPIRED',400);
    const value=await this.settings.get('stage-pending/'+state);
    if(!value.userId||Number(value.expires)<Date.now())throw new ServiceError('STAGE_AUTH_EXPIRED',400);
    return {name:value.name,userId:value.userId,stageOrigin:value.origin};
  }
  async callback(state:string,code:string){
    if(!/^[\w-]{43}$/.test(code))throw new ServiceError('STAGE_AUTH_EXPIRED',400);
    const description=await this.descriptor(state);
    // Consume the browser code locally before network I/O. The pending pointer fences the final write.
    const pending=await this.store.transaction(async()=>{
      await this.lock(description.userId!);
      const pending=await this.settings.get('stage-pending/'+state),pointer=await this.settings.get('stage-pending-user/'+description.userId);
      if(!pending.userId||Number(pending.expires)<Date.now()||pointer.state!==state)throw new ServiceError('STAGE_AUTH_EXPIRED',400);
      await this.store.run('DELETE FROM settings WHERE key=?','stage-pending/'+state);
      return pending;
    });
    const billingToken=opaque();
    let result:z.infer<typeof token>;
    try{result=token.parse(await this.remote(pending.origin!,'/api/integrations/ipollowork/token',undefined,{grant_type:'authorization_code',code,code_verifier:pending.verifier,redirect_uri:this.workOrigin+'/api/integrations/stage/callback',client_id:this.workOrigin,billing_token:billingToken}));}
    catch(error){
      await this.store.transaction(async()=>{await this.lock(description.userId!);const pointer=await this.settings.get('stage-pending-user/'+description.userId);if(pointer.state===state)await this.store.run('DELETE FROM settings WHERE key=?','stage-pending-user/'+description.userId);});
      throw error;
    }
    const accepted=await this.store.transaction(async()=>{
      await this.lock(description.userId!);
      const pointer=await this.settings.get('stage-pending-user/'+description.userId),config=await this.config();
      if(pointer.state!==state||Number(pending.expires)<=Date.now()||!config.enabled||pending.origin!==config.origin){
        await this.settings.set('stage-revoke/'+result.connectionId,{origin:pending.origin!,access:result.access_token});
        if(pointer.state===state)await this.store.run('DELETE FROM settings WHERE key=?','stage-pending-user/'+description.userId);
        return false;
      }
      await this.settings.set('stage-link/'+pending.userId,{origin:pending.origin!,access:result.access_token,connectionId:result.connectionId,subject:result.subject,name:result.name,expires:String(Date.now()+result.expires_in*1000),billingToken});
      await this.store.run('DELETE FROM settings WHERE key=?','stage-pending-user/'+pending.userId);
      return true;
    });
    if(!accepted)throw new ServiceError('STAGE_AUTH_EXPIRED',400);
  }
  async disconnect(actor:Actor){
    await this.store.transaction(async()=>{
      await this.lock(actor.id);
      const record=await this.settings.get('stage-link/'+actor.id),pending=await this.settings.get('stage-pending-user/'+actor.id);
      if(record.access)await this.settings.set('stage-revoke/'+record.connectionId,{origin:record.origin!,access:record.access});
      await this.store.run('DELETE FROM settings WHERE key IN (?,?,?)','stage-link/'+actor.id,'stage-pending-user/'+actor.id,'stage-pending/'+pending.state);
    });
    // Stop local use immediately. A Stage outage must not prevent disconnect; encrypted revocations survive restart.
    return {connected:false};
  }
  async request(actor:Actor,action:string,raw:unknown){
    const {config,value}=await this.linked(actor);
    if(action==='launch')return this.remote(config.origin,'/api/integrations/ipollowork/session',value.access,{});
    if(action==='catalog')return this.remote(config.origin,'/api/integrations/ipollowork/catalog',value.access,raw??{});
    const input=z.record(z.string(),z.unknown()).parse(raw);
    return this.remote(config.origin,'/api/integrations/ipollowork/'+action,value.access,input);
  }
  /** The trusted Stage server uses its per-connection secret, never browser-submitted usage. */
  private async billingOwner(userId:string,secret:string){
    const actor=await this.store.one('SELECT id,name,email,role,banned FROM "user" WHERE id=?',userId);
    const link=await this.settings.get('stage-link/'+userId),config=await this.config();
    if(!actor||actor.banned||!link.billingToken||Number(link.expires)<=Date.now()||link.origin!==config.origin||!same(secret,link.billingToken))throw new ServiceError('STAGE_BILLING_UNAUTHORIZED',401);
    return actor;
  }
  async summary(userId:string,secret:string){
    const actor=await this.billingOwner(userId,secret),config=await this.config();
    if(!config.enabled)throw new ServiceError('STAGE_NOT_CONFIGURED',503);
    const pending=!!await this.store.one("SELECT id FROM service_calls WHERE user_id=? AND service_id='ipollo-stage' AND state='running'",userId);
    return {provider:'ipollowork',accountName:actor.name,balance:Number((await wallet(this.store,userId)).balance),pending,models:config.rates.map(({model,input,output,cacheRead})=>({model,input,output,cacheRead})),unit:'points-per-million-tokens',preauthorize:false};
  }
  async begin(userId:string,secret:string,raw:unknown){
    await this.billingOwner(userId,secret);
    const input=z.object({requestId:z.uuid(),model:z.string().min(1).max(200)}).strict().parse(raw);
    const config=await this.config();if(!config.enabled||!config.rates.some(rate=>rate.model===input.model))throw new ServiceError('STAGE_PRICING_REQUIRED',409);
    return this.store.transaction(async()=>{
      await lockWallet(this.store,userId);
      const prior=await this.store.one('SELECT user_id,request_hash FROM service_calls WHERE id=?',input.requestId);
      if(prior){if(prior.user_id!==userId||prior.request_hash!==hash(input.model))throw new ServiceError('IDEMPOTENCY_CONFLICT',409);return {requestId:input.requestId,replayed:true};}
      if(Number((await wallet(this.store,userId)).balance)<=0)throw new ServiceError('INSUFFICIENT_POINTS',409);
      if(await this.store.one("SELECT id FROM service_calls WHERE user_id=? AND service_id='ipollo-stage' AND state='running'",userId))throw new ServiceError('STAGE_RUN_ACTIVE',409);
      await this.store.run("INSERT INTO execution_services(id,title,provider,base_url,key_id,header_name,header_prefix,capabilities,routes,plan_ids,enabled,created_at) VALUES('ipollo-stage','Stage','ipollo-stage',?,'stage','Authorization','Bearer ','[]','[]','[]',0,?) ON CONFLICT(id) DO NOTHING",config.origin,Date.now());
      await this.store.run("INSERT INTO service_calls(id,user_id,service_id,request_hash,state,points,response_type,response_body,created_at,updated_at,model_id) VALUES(?,?,'ipollo-stage',?,'running',0,'application/json',?,?,?,?)",input.requestId,userId,hash(input.model),JSON.stringify({rates:config.rates,billingHash:hash(secret)}),Date.now(),Date.now(),input.model);
      return {requestId:input.requestId,replayed:false};
    });
  }
  async settle(userId:string,secret:string,raw:unknown){
    const input=z.object({requestId:z.uuid(),status:z.enum(['succeeded','failed','cancelled']),calls}).strict().parse(raw);
    return this.store.transaction(async()=>{
      await lockWallet(this.store,userId);
      const row=await this.store.one('SELECT * FROM service_calls WHERE id=? AND user_id=? AND service_id=? FOR UPDATE',input.requestId,userId,'ipollo-stage');
      if(!row)throw new ServiceError('STAGE_CALL_NOT_FOUND',404);
      const fingerprint=hash(JSON.stringify(input));
      const saved=JSON.parse(String(row.response_body));
      if(!saved.billingHash||!same(hash(secret),saved.billingHash))throw new ServiceError('STAGE_BILLING_UNAUTHORIZED',401);
      if(row.state!=='running'){if(saved.fingerprint!==fingerprint)throw new ServiceError('IDEMPOTENCY_CONFLICT',409);return {points:row.points,replayed:true};}
      const pricing=rates.parse(saved.rates);let amount=0n,cost=0n,costKnown=true;
      for(const call of input.calls){const rate=pricing.find(rate=>rate.model===call.model);if(!rate)throw new ServiceError('STAGE_PRICING_REQUIRED',409);const cached=call.cacheRead??0;if(cached>call.input)throw new ServiceError('STAGE_USAGE_INVALID',400);amount+=BigInt(call.input-cached)*BigInt(rate.input)+BigInt(cached)*BigInt(rate.cacheRead??rate.input)+BigInt(call.output)*BigInt(rate.output);costKnown&&=(call.input===0||rate.inputCostMicros!==undefined)&&(call.output===0||rate.outputCostMicros!==undefined);cost+=BigInt(call.input-cached)*BigInt(rate.inputCostMicros??0)+BigInt(cached)*BigInt(rate.cacheReadCostMicros??rate.inputCostMicros??0)+BigInt(call.output)*BigInt(rate.outputCostMicros??0);}
      const points=Number((amount+999999n)/1000000n);if(!Number.isSafeInteger(points))throw new ServiceError('STAGE_USAGE_INVALID',400);
      // Post-paid actual usage: no point hold; debt blocks the next generation.
      if(points)await ledgerEntry(this.store,userId,-points,'stage/'+input.requestId,'Stage 实际 Token 用量',null,true);
      const costMicros=costKnown?Number((cost+999999n)/1000000n):null,inputTokens=input.calls.reduce((sum,call)=>sum+call.input,0),outputTokens=input.calls.reduce((sum,call)=>sum+call.output,0);
      if(![...(costMicros===null?[]:[costMicros]),inputTokens,outputTokens].every(Number.isSafeInteger))throw new ServiceError('STAGE_USAGE_INVALID',400);
      await this.store.run('UPDATE service_calls SET state=?,points=?,response_body=?,updated_at=?,cost_micros=?,billing_settled=true,input_tokens=?,output_tokens=? WHERE id=?',input.status==='succeeded'?'succeeded':'failed',points,JSON.stringify({fingerprint,billingHash:saved.billingHash,calls:input.calls,costMicros,rates:pricing,status:input.status}),Date.now(),costMicros,inputTokens,outputTokens,input.requestId);
      return {points,replayed:false};
    });
  }
  async download(actor:Actor,id:string,signal:AbortSignal){
    if(!/^[a-f0-9]{32}$/.test(id))throw new ServiceError('NOT_FOUND',404);
    const {config,value}=await this.linked(actor);
    const response=await this.fetcher(config.origin+'/api/integrations/ipollowork/download/'+id,{headers:{Authorization:'Bearer '+value.access},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])});
    if(!response.ok||!response.body){await response.body?.cancel();throw new ServiceError('STAGE_DOWNLOAD_FAILED',response.status===404?404:503);}
    return new Response(response.body,{headers:{'Content-Type':'video/mp4','Content-Disposition':`attachment; filename="Stage-${id}.mp4"`,'Cache-Control':'private,no-store'}});
  }
  mountPublic(app:App){
    app.get('/api/integrations/stage/authorization/:state',async c=>c.json(await this.descriptor(c.req.param('state'))));
    app.get('/api/integrations/stage/callback',async c=>{await this.callback(c.req.query('state')??'',c.req.query('code')??'');return c.html('<!doctype html><html lang="zh"><meta charset="utf-8"><title>Stage 已关联</title><p>Stage 账号已关联。请返回 iPolloWork，点击刷新。</p></html>');});
    app.post('/api/integrations/stage/billing/:user/:action',async c=>{const secret=c.req.header('authorization')?.replace(/^Bearer /,'')??'';return c.json(c.req.param('action')==='summary'?await this.summary(c.req.param('user'),secret):c.req.param('action')==='begin'?await this.begin(c.req.param('user'),secret,await c.req.json()):c.req.param('action')==='settle'?await this.settle(c.req.param('user'),secret,await c.req.json()):(()=>{throw new ServiceError('NOT_FOUND',404);})());});
  }
  mount(app:App){
    app.get('/api/v1/stage/download/:id',async c=>this.download(c.get('actor'),c.req.param('id'),c.req.raw.signal));
    app.get('/api/v1/stage/status',async c=>c.json(await this.status(c.get('actor'))));
    app.get('/api/v1/stage/catalog',async c=>c.json(await this.request(c.get('actor'),'catalog',{})));
    app.post('/api/v1/stage/:action',async c=>{
      const actor=c.get('actor'),action=c.req.param('action');
      if(action==='connect')return c.json(await this.connect(actor));
      if(action==='disconnect')return c.json(await this.disconnect(actor));
      if(!['launch','catalog','document','generate','export','task','source'].includes(action))throw new ServiceError('NOT_FOUND',404);
      return c.json(await this.request(actor,action,await c.req.json()));
    });
  }
}
