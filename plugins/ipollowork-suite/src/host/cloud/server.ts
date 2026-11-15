/** Server-only sandbox allocation and official DSH profile launch; no Agent implementation. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import { Sandbox, type SandboxOpts } from 'e2b';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import schema from '@deepseek-ai/schemastery';
import { readJson } from '../account.ts';
import { SuiteError } from '../errors.ts';

export const settingsSchema=z.object({
  accountOrigin:z.url(), apiUrl:z.url(), domain:z.string().min(1), template:z.string().min(1),
  apiKeyEnv:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default('ALIYUN_SANDBOX_API_KEY'), gatewayKeyEnv:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default('IPOLLO_CLOUD_GATEWAY_KEY'),
  bucket:z.string().min(3),storageEndpoint:z.url(),roleArn:z.string().min(1),
  dshCommand:z.string().regex(/^\/[A-Za-z0-9_./-]+$/).default('/opt/ipollowork/bin/dsh'),
  profileSeedPath:z.string().regex(/^\/[A-Za-z0-9_./-]+$/).default('/opt/ipollowork/profile-seed'),
  suitePatchPath:z.string().regex(/^\/[A-Za-z0-9_./-]+$/).default('/opt/ipollowork/suite/cordis.patch.yml'),
  port:z.number().int().min(1024).max(65535).default(3080), startupTimeoutMs:z.number().int().min(1000).max(180000).default(90000),
  checkIntervalMs:z.number().int().min(1000).max(60000).default(15000), idleTimeoutMs:z.number().int().min(1000).max(3600000).default(120000),
}).strict().superRefine((value,ctx)=>{
  for(const key of ['accountOrigin','apiUrl','storageEndpoint'] as const){
    const url=new URL(value[key]);
    const local=url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if((url.protocol!=='https:'&&!local)||url.username||url.password||url.search||url.hash||url.pathname!=='/')ctx.addIssue({code:'custom',path:[key],message:'Use an HTTPS origin or loopback HTTP'});
  }
  if(!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value.domain))ctx.addIssue({code:'custom',path:['domain'],message:'Invalid sandbox domain'});
});
type Settings=z.output<typeof settingsSchema>;
const grantSchema=z.object({projectId:z.uuid(),userId:z.string(),ttlSeconds:z.number().int().positive(),volumeKey:z.string().regex(/^ipollo-project-[a-f0-9]{40}$/),runtimeToken:z.string(),managerToken:z.string()});
type Grant=z.infer<typeof grantSchema>;
export interface CloudSandbox {
  commands:{run(command:string,options:{timeoutMs?:number;background?:boolean;envs?:Record<string,string>}):Promise<{stdout:string;exitCode?:number}>};
  files:{read(path:string):Promise<string>;write(path:string,value:string):Promise<unknown>};
  getHost(port:number):string;
  setTimeout(timeoutMs:number):Promise<void>;
  kill():Promise<boolean>;
}
type SandboxFactory=(template:string,options:SandboxOpts)=>Promise<CloudSandbox>;
const createSandbox:SandboxFactory=async(template,options)=>{
  const sandbox=await Sandbox.create(template,options);
  return {commands:{run:async(command,opts)=>{
    if(opts.background){await sandbox.commands.run(command,{...opts,background:true});return {stdout:''};}
    return sandbox.commands.run(command,{...opts,background:false});
  }},files:{read:path=>sandbox.files.read(path),write:(path,value)=>sandbox.files.write(path,value)},getHost:port=>sandbox.getHost(port),setTimeout:timeoutMs=>sandbox.setTimeout(timeoutMs),kill:()=>sandbox.kill()};
};
type Running={sandbox:CloudSandbox; grant:Grant; url:string; expiresAt:number; timer:ReturnType<typeof setTimeout>};
export const name='ipollowork-cloud-server';
export const inject=['webServer'];
export const Config=schema.object({accountOrigin:schema.string().required(),apiUrl:schema.string().required(),domain:schema.string().required(),template:schema.string().required(),apiKeyEnv:schema.string(),gatewayKeyEnv:schema.string(),bucket:schema.string().required(),storageEndpoint:schema.string().required(),roleArn:schema.string().required(),dshCommand:schema.string(),suitePatchPath:schema.string(),profileSeedPath:schema.string(),port:schema.number(),startupTimeoutMs:schema.number(),checkIntervalMs:schema.number(),idleTimeoutMs:schema.number()});
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
/** Keeps allocations private to this server plugin and stops admission before draining startup. */
export class CloudServer {
  private pending=new Map<string,Promise<{url:string}>>();
  private running=new Map<string,Running>();
  private stopping=false;
  private admissions=new Set<Promise<{url:string}>>();
  private abort=new AbortController();
  private maintenance=new Set<Promise<void>>();
  private releases=new Map<string,Promise<void>>();
  constructor(private settings:Settings,private apiKey:string,private fetcher:typeof fetch=fetch,private create:SandboxFactory=createSandbox) {}
  private async api(token:string,path:string,body?:unknown) {
    const response=await this.fetcher(this.settings.accountOrigin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(15000)])});
    const result=await readJson(response,32768);
    if(!response.ok){const code=z.object({code:z.string()}).safeParse(result);throw new SuiteError(code.success?code.data.code:'IPW_CLOUD_AUTHORIZATION_FAILED',response.status);}
    return result;
  }
  open(ticket:string):Promise<{url:string}> {
    if(this.stopping)return Promise.reject(new SuiteError('IPW_CLOUD_DISABLED',503));
    const admitted=this.openProject(ticket);this.admissions.add(admitted);
    void admitted.then(()=>this.admissions.delete(admitted),()=>this.admissions.delete(admitted));
    return admitted;
  }
  private async openProject(ticket:string):Promise<{url:string}> {
    if(this.stopping)throw new SuiteError('IPW_CLOUD_DISABLED',503);
    // The ticket is signed and project permissions are checked by the account service.
    const check=z.object({projectId:z.uuid(),userId:z.string()}).parse(await this.api(ticket,'/api/v1/cloud-runtime/inspect',{}));
    if(this.stopping)throw new SuiteError('IPW_CLOUD_DISABLED',503);
    const key=check.userId+'\0'+check.projectId;
    const current=this.running.get(key);
    if(current && current.expiresAt>Date.now()+30000){
      try {await this.api(current.grant.managerToken,'/api/v1/cloud-runtime/status');}
      catch(error){await this.stop(key);throw error;}
      return {url:current.url};
    }
    if(current){await this.stop(key);}
    const existing=this.pending.get(key);if(existing)return existing;
    const task=this.start(key,ticket);this.pending.set(key,task);
    try{return await task;}finally{if(this.pending.get(key)===task)this.pending.delete(key);}
  }
  private async start(key:string,ticket:string):Promise<{url:string}> {
    const grant=grantSchema.parse(await this.api(ticket,'/api/v1/cloud-runtime/claim',{instanceId:randomUUID()}));
    let sandbox:CloudSandbox|undefined;
    try {
      sandbox=await this.create(this.settings.template,{apiKey:this.apiKey,apiUrl:this.settings.apiUrl,domain:this.settings.domain,timeoutMs:grant.ttlSeconds*1000,requestTimeoutMs:30000,secure:true,metadata:{'fc.sandbox.auth.role':this.settings.roleArn,'fc.sandbox.storage.oss':JSON.stringify({mountPoints:[{bucketName:this.settings.bucket,endpoint:this.settings.storageEndpoint,bucketPath:'/ipollowork/'+grant.volumeKey+'/',mountDir:'/mnt/project',readOnly:false},{bucketName:this.settings.bucket,endpoint:this.settings.storageEndpoint,bucketPath:'/ipollowork-runtime/'+createHash('sha256').update(grant.userId+'\0'+grant.projectId).digest('hex')+'/',mountDir:'/mnt/state',readOnly:false}]})}});
      if(this.stopping)throw new SuiteError('IPW_CLOUD_DISABLED',503);
      const mounts=await sandbox.commands.run('mountpoint -q /mnt/project && mountpoint -q /mnt/state && mkdir -p /mnt/state/dsh /mnt/project/workspace',{timeoutMs:30000});
      if(mounts.exitCode!==0)throw new SuiteError('IPW_CLOUD_STORAGE_UNAVAILABLE',503);
      const seed=await sandbox.commands.run('if [ ! -f /mnt/state/dsh/.ipollo-profile-seeded ]; then cp -a '+quote(this.settings.profileSeedPath+'/.')+' /mnt/state/dsh/ && touch /mnt/state/dsh/.ipollo-profile-seeded; fi',{timeoutMs:30000});
      if(seed.exitCode!==0)throw new SuiteError('IPW_CLOUD_START_FAILED',503);
      const host=sandbox.getHost(this.settings.port);
      if(!/^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?$/.test(host))throw new SuiteError('IPW_CLOUD_START_FAILED',503);
      const publicOrigin='https://'+host;
      const patch=[{id:'webserver',config:{host:'127.0.0.1',port:this.settings.port}},{id:'workspace-controller',config:{documentsDirectory:'/mnt/project/workspace'}},{id:'connection',config:{trustedHosts:[host]}},{id:'ipollowork-suite',config:{accountOrigin:this.settings.accountOrigin,cloudRuntimeTokenEnv:'IPOLLO_CLOUD_RUNTIME_TOKEN'}},{id:'ipollowork-cloud-projects',disabled:true},{insert:[{id:'ipollo-cloud-bootstrap',name:'@ipollo/dsh-suite/cloud-bootstrap',config:{accountOrigin:this.settings.accountOrigin}}]}];
      // Bind one concrete sandbox address, as required by the official DSH web server.
      const launched=await sandbox.commands.run("hostname -I | awk '{print $1}'",{timeoutMs:10000});
      const address=launched.stdout.trim();if(launched.exitCode!==0||isIP(address)===0)throw new SuiteError('IPW_CLOUD_START_FAILED',503);
      patch[0]={id:'webserver',config:{host:address,port:this.settings.port}};
      await sandbox.files.write('/tmp/ipollowork-cloud.json',JSON.stringify(patch));
      const home='/mnt/state/dsh';
      const command='cd /mnt/project/workspace && DSH_HOME='+quote(home)+' '+quote(this.settings.dshCommand)+' --profile web --patch '+quote(this.settings.suitePatchPath)+' --patch /tmp/ipollowork-cloud.json --public-url '+quote(publicOrigin)+' --no-open > /tmp/ipollowork-dsh.log 2>&1';
      await sandbox.commands.run(command,{background:true,envs:{IPOLLO_CLOUD_RUNTIME_TOKEN:grant.runtimeToken}});
      const deadline=Date.now()+this.settings.startupTimeoutMs;
      let url:string|undefined;
      while(Date.now()<deadline&&!this.stopping){
        const log=await sandbox.files.read('/tmp/ipollowork-dsh.log');
        if(/failed to import|failed to load|ERR_MODULE_NOT_FOUND|PluginError/i.test(log))throw new SuiteError('IPW_CLOUD_START_FAILED',503);
        const match=log.match(/dsh web:\s+(https?:\/\/[^\s\x1b]+)/);
        if(match){const parsed=new URL(match[1]!);if(parsed.origin!==publicOrigin||!parsed.searchParams.get('token'))throw new SuiteError('IPW_CLOUD_START_FAILED',503);url=parsed.href;break;}
        await new Promise<void>(resolve=>setTimeout(resolve,250));
      }
      if(!url)throw new SuiteError('IPW_CLOUD_START_FAILED',503);
      await this.api(grant.managerToken,'/api/v1/cloud-runtime/status');
      const record:Running={sandbox,grant,url,expiresAt:Date.now()+grant.ttlSeconds*1000,timer:setTimeout(()=>this.schedule(key),this.settings.checkIntervalMs)};
      record.timer.unref();this.running.set(key,record);
      return {url};
    } catch(error) {
      if(sandbox){
        try{await sandbox.kill();await this.api(grant.managerToken,'/api/v1/cloud-runtime/release',{});}
        catch(_cleanupError){/* The durable lease and provider TTL retain ownership of uncertain cleanup. */}
      }
      // Keep the lease until TTL when allocation or deletion cannot be confirmed.
      throw error instanceof SuiteError?error:new SuiteError('IPW_CLOUD_START_FAILED',503);
    }
  }
  private schedule(key:string):void {
    if(this.stopping)return;
    const operation=this.maintain(key);
    this.maintenance.add(operation);
    void operation.catch(()=>{}).finally(()=>this.maintenance.delete(operation));
  }
  private async maintain(key:string):Promise<void> {
    const record=this.running.get(key);if(!record||this.stopping)return;
    try {
      const state=z.object({lastActiveAt:z.number()}).parse(await this.api(record.grant.managerToken,'/api/v1/cloud-runtime/status'));
      if(Date.now()-state.lastActiveAt>=this.settings.idleTimeoutMs){await this.stop(key);return;}
      await record.sandbox.setTimeout(record.grant.ttlSeconds*1000);
      await this.api(record.grant.managerToken,'/api/v1/cloud-runtime/renew',{});
      record.expiresAt=Date.now()+record.grant.ttlSeconds*1000;
      if(this.stopping)return;
      record.timer=setTimeout(()=>this.schedule(key),this.settings.checkIntervalMs);record.timer.unref();
    } catch(_error) {await this.stop(key);}
  }
  private async stop(key:string):Promise<void> {
    const pending=this.releases.get(key);if(pending)return pending;
    const operation=this.release(key);this.releases.set(key,operation);
    try{await operation;}finally{this.releases.delete(key);}
  }
  private async release(key:string) {
    const record=this.running.get(key);if(!record)return;
    clearTimeout(record.timer);
    await record.sandbox.kill();
    this.running.delete(key);
    await this.api(record.grant.managerToken,'/api/v1/cloud-runtime/release',{});
  }
  async dispose():Promise<void> {
    this.stopping=true;
    for(const record of this.running.values())clearTimeout(record.timer);
    await Promise.allSettled(this.admissions);
    await Promise.allSettled(this.maintenance);
    const results=await Promise.allSettled([...this.running.keys()].map(key=>this.stop(key)));
    this.abort.abort();
    if(results.some(result=>result.status==='rejected'))throw new SuiteError('IPW_CLOUD_RELEASE_FAILED',503);
  }
}
export function apply(ctx:Context,input:z.input<typeof settingsSchema>):void {
  const settings=settingsSchema.parse(input),apiKey=process.env[settings.apiKeyEnv],gatewayKey=process.env[settings.gatewayKeyEnv];
  if(!apiKey||!gatewayKey||gatewayKey.length<32)throw new SuiteError('IPW_CLOUD_CONFIG_REQUIRED',503);
  const server=new CloudServer(settings,apiKey);
  ctx.effect(()=>()=>server.dispose());
  ctx.effect(()=>ctx.webServer.register({kind:'prefix',path:'/ipollowork-cloud-server',auth:'anonymous',handler:async(req,res)=>{
    try{
      const supplied=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+gatewayKey);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){res.writeHead(401);res.end();return;}
      if(req.url!=='/ipollowork-cloud-server/open'||req.method!=='POST'){res.writeHead(404);res.end();return;}
      let raw='';for await(const chunk of req){raw+=String(chunk);if(Buffer.byteLength(raw)>8192)throw new SuiteError('IPW_REQUEST_TOO_LARGE',413);}
      const {ticket}=z.object({ticket:z.string().max(4096)}).strict().parse(JSON.parse(raw));
      const result=await server.open(ticket);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));
    }catch(error){res.writeHead(error instanceof SuiteError?error.status:503,{'Content-Type':'application/json'});res.end(JSON.stringify({code:error instanceof SuiteError?error.code:'IPW_CLOUD_START_FAILED'}));}
  }}));
}
