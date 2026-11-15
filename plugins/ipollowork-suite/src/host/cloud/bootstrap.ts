/** Enforce live project authorization around the official DSH transport. */
import type { Duplex } from 'node:stream';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import type {} from '@deepseek-ai/dsh-workspace';
import { resolveConfig } from '../config.ts';
import { z } from 'zod';
import schema from '@deepseek-ai/schemastery';
import { SuiteError } from '../errors.ts';
export const name='ipollowork-cloud-bootstrap';
export const inject=['webServer','agents','sessionController','workspaceRegistry','llm'];
export const Config=schema.object({accountOrigin:schema.string().required(),workspace:schema.string(),heartbeatMs:schema.number(),authorizationTimeoutMs:schema.number()});
const settingsSchema=z.object({accountOrigin:z.url(),workspace:z.string().startsWith('/').default('/mnt/project/workspace'),heartbeatMs:z.number().int().min(1000).max(60000).default(15000),authorizationTimeoutMs:z.number().int().min(1000).max(60000).default(15000)}).strict();
export async function apply(ctx:Context,config:z.input<typeof settingsSchema>):Promise<void> {
  const input=settingsSchema.parse(config);
  const origin=resolveConfig({accountOrigin:input.accountOrigin}).accountOrigin;
  const token=process.env.IPOLLO_CLOUD_RUNTIME_TOKEN;
  if(!token)throw new SuiteError('IPW_SIGN_IN_REQUIRED',401);
  const lifetime=new AbortController();
  let stopping=false;
  const requests=new Set<Promise<boolean>>();
  const sockets=new Map<Duplex,()=>void>();
  const authorize=(activity=false):Promise<boolean>=>{
    if(stopping)return Promise.resolve(false);
    const request=checkAuthorization(activity);requests.add(request);
    void request.then(()=>requests.delete(request),()=>requests.delete(request));
    return request;
  };
  const checkAuthorization=async(activity:boolean)=>{
    const valid=await fetch(origin+'/api/v1/cloud-runtime/'+(activity?'activity':'status'),{method:activity?'POST':'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(input.authorizationTimeoutMs)])});
    await valid.body?.cancel();
    return valid.ok&&!stopping;
  };
  ctx.on('webserver/request',async(_request,response,next)=>{
    try {
      if(!await authorize(true)){response.writeHead(403);response.end('Cloud project access is no longer available');return;}
    } catch (_error) {response.writeHead(503);response.end('Cloud project authorization is unavailable');return;}
    await next();
  });
  ctx.on('webserver/upgrade',async(_request,socket,_head,_peer,next)=>{
    try { if(!await authorize(true)){socket.destroy();return;} }
    catch (_error) {socket.destroy();return;}
    let lastTouch=Date.now();
    const activity=()=>{if(Date.now()-lastTouch<input.heartbeatMs)return;lastTouch=Date.now();void authorize(true).then(allowed=>{if(!allowed)socket.destroy();},()=>socket.destroy());};
    const detach=()=>{socket.off('data',activity);socket.off('close',closed);sockets.delete(socket);};
    const closed=()=>detach();
    sockets.set(socket,detach);socket.on('data',activity);socket.once('close',closed);
    await next();
  });
  ctx.on('llm/stream',async function*(options,next){
    if(!options.provider.startsWith('ipollo-'))throw new SuiteError('IPW_CLOUD_MODEL_FORBIDDEN',403);
    yield* next();
  });
  ctx.on('agent/pre-step',async(_event,next)=>{
    if(!await authorize(true))throw new SuiteError('IPW_CLOUD_ACCESS_REVOKED',403);
    return next();
  });
  let heartbeat:Promise<void>|undefined;
  const timer=setInterval(()=>{
    if(heartbeat||!ctx.agents.list().some(agent=>ctx.agents.turnBoundaryOf(agent.session).openTurnStartSeq!==null))return;
    const stop=()=>{if(stopping)return;for(const agent of ctx.agents.list())agent.cancel({kind:'user'});};
    heartbeat=authorize(true).then(allowed=>{if(!allowed)stop();},stop).finally(()=>{heartbeat=undefined;});
  },input.heartbeatMs);
  timer.unref();
  ctx.effect(()=>async()=>{
    stopping=true;clearInterval(timer);lifetime.abort();
    for(const [socket,detach]of sockets){detach();socket.destroy();}
    await Promise.allSettled(requests);await heartbeat;
  });
  const workspace=await ctx.workspaceRegistry.create(input.workspace,'Cloud project');
  if(!workspace.sessionIds.length)await ctx.sessionController.create({workspaceId:workspace.id});
}
