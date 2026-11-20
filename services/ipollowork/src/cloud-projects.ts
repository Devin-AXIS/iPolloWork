/** Cloud project metadata and authorization; the optional DSH plugin owns execution. */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from './auth.js';
import type { Store } from './database.js';
import type { Settings } from './settings.js';
import type { Config } from './config.js';
import type { App } from './http.js';
import { projectAccess, projectRole, now } from './domain.js';
import { ServiceError } from './errors.js';

const origin = z.url().refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' &&
    (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
});
const policySchema = z.object({ enabled: z.enum(['true','false']).default('false'), gatewayOrigin: origin.optional(), gatewayKey: z.string().min(32).optional(), ttlSeconds: z.coerce.number().int().min(300).max(3600).default(1800), grantTtlSeconds:z.coerce.number().int().min(3600).max(604800).default(86400), leaseGraceSeconds:z.coerce.number().int().min(60).max(600).default(180) });
const grantSchema = z.object({ kind: z.enum(['launch','runtime','manager']), userId: z.string().min(1), projectId: z.string().uuid(), instanceId: z.string().uuid().optional(), ttlSeconds:z.number().int().min(300).max(3600), expiresAt: z.number().int(), nonce: z.string().uuid() }).strict();
type Grant = z.infer<typeof grantSchema>;

/** Project permissions and a durable single-writer lease, independent of the Agent engine. */
export class CloudProjects {
  constructor(private store: Store, private settings: Settings, private config: Config, private fetcher: typeof fetch = fetch) {}
  async policy() { return policySchema.parse(await this.settings.get('cloud')); }
  async available() { const policy = await this.policy(); return { enabled: policy.enabled === 'true' && !!policy.gatewayOrigin && !!policy.gatewayKey }; }
  async requireAvailable() { if (!(await this.available()).enabled) throw new ServiceError('CLOUD_DISABLED',503,'云端执行未启用'); }
  private sign(value: Omit<Grant,'nonce'>): string {
    const payload = Buffer.from(JSON.stringify({...value, nonce:randomUUID()})).toString('base64url');
    return 'ipwc.' + payload + '.' + createHmac('sha256',this.config.secret).update(payload).digest('base64url');
  }
  async authenticate(token: string): Promise<{ actor: Actor; grant: Grant }> {
    const [,payload,mac,...extra] = token.split('.');
    if (!token.startsWith('ipwc.') || !payload || !mac || extra.length) throw new ServiceError('CLOUD_GRANT_INVALID',401);
    const expected = createHmac('sha256',this.config.secret).update(payload).digest();
    const actual = Buffer.from(mac,'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual,expected)) throw new ServiceError('CLOUD_GRANT_INVALID',401);
    let decoded:unknown;
    try { decoded=JSON.parse(Buffer.from(payload,'base64url').toString()); } catch { throw new ServiceError('CLOUD_GRANT_INVALID',401); }
    const parsed = grantSchema.safeParse(decoded);
    if (!parsed.success || parsed.data.expiresAt <= now()) throw new ServiceError('CLOUD_GRANT_EXPIRED',401);
    const grant = parsed.data;
    const user = await this.store.one<{id:string;name:string;email:string;banned:boolean|null}>('SELECT id,name,email,banned FROM "user" WHERE id=?',grant.userId);
    if (!user || user.banned) throw new ServiceError('CLOUD_GRANT_INVALID',401);
    const actor:Actor = {...user, role:'user'};
    const project = await projectAccess(this.store,actor,grant.projectId);
    if (project.execution_mode !== 'cloud' || await projectRole(this.store,actor,project) === 'view') throw new ServiceError('PROJECT_PARTICIPATION_REQUIRED',403);
    await this.requireAvailable();
    if (grant.kind !== 'launch' && !(await this.store.one('SELECT project_id FROM cloud_runtime_leases WHERE project_id=? AND instance_id=? AND user_id=? AND expires_at>?',grant.projectId,grant.instanceId??null,grant.userId,now()))) throw new ServiceError('CLOUD_GRANT_EXPIRED',401);
    return {actor,grant};
  }
  async open(actor:Actor,projectId:string) {
    await this.requireAvailable();
    const project=await projectAccess(this.store,actor,projectId);
    if (project.execution_mode !== 'cloud') throw new ServiceError('PROJECT_NOT_CLOUD',409);
    if (await projectRole(this.store,actor,project)==='view') throw new ServiceError('PROJECT_PARTICIPATION_REQUIRED',403);
    const policy=await this.policy();
    const ticket=this.sign({kind:'launch',userId:actor.id,projectId,ttlSeconds:policy.ttlSeconds,expiresAt:now()+120000});
    let response:Response;
    try { response=await this.fetcher(policy.gatewayOrigin+'/ipollowork-cloud-server/open',{method:'POST',headers:{Authorization:'Bearer '+policy.gatewayKey,'Content-Type':'application/json'},body:JSON.stringify({ticket}),signal:AbortSignal.timeout(120000),redirect:'error'}); }
    catch (_error) { throw new ServiceError('CLOUD_START_FAILED',503,'云端环境暂时无法启动，请重试'); }
    const reader=response.body?.getReader();
    if(!reader)throw new ServiceError('CLOUD_START_FAILED',503);
    let data:unknown;
    try {
      const chunks:Uint8Array[]=[];let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();throw new ServiceError('CLOUD_START_FAILED',503);}chunks.push(value);}
      data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (_error) {throw new ServiceError('CLOUD_START_FAILED',503);} finally {reader.releaseLock();}
    if (!response.ok) throw new ServiceError(['CLOUD_PROJECT_BUSY','IPW_CLOUD_PROJECT_BUSY'].includes(z.object({code:z.string()}).safeParse(data).data?.code??'')?'CLOUD_PROJECT_BUSY':'CLOUD_START_FAILED',response.status===409?409:503,'云端项目正在使用或暂时无法启动');
    const result=z.object({url:z.url()}).parse(data);
    const url=new URL(result.url);
    if (url.protocol!=='https:' || url.username || url.password) throw new ServiceError('CLOUD_START_FAILED',503);
    await this.requireAvailable();
    const current=await projectAccess(this.store,actor,projectId);
    if(await projectRole(this.store,actor,current)==='view')throw new ServiceError('PROJECT_PARTICIPATION_REQUIRED',403);
    return result;
  }
  async claim(actor:Actor,grant:Grant,instanceId:string) {
    if(grant.kind!=='launch')throw new ServiceError('CLOUD_GRANT_SCOPE',403);
    const policy=await this.policy(), expiresAt=now()+(policy.ttlSeconds+policy.leaseGraceSeconds)*1000;
    const lease=await this.store.one(`INSERT INTO cloud_runtime_leases(project_id,user_id,instance_id,last_active_at,expires_at) VALUES(?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET user_id=excluded.user_id,instance_id=excluded.instance_id,last_active_at=excluded.last_active_at,expires_at=excluded.expires_at
      WHERE cloud_runtime_leases.expires_at<=? RETURNING project_id`,grant.projectId,actor.id,instanceId,now(),expiresAt,now());
    if(!lease)throw new ServiceError('CLOUD_PROJECT_BUSY',409);
    const base={userId:actor.id,projectId:grant.projectId,instanceId,ttlSeconds:policy.ttlSeconds,expiresAt:now()+policy.grantTtlSeconds*1000};
    return {projectId:grant.projectId,userId:actor.id,ttlSeconds:policy.ttlSeconds,volumeKey:'ipollo-project-'+createHash('sha256').update(grant.projectId).digest('hex').slice(0,40),runtimeToken:this.sign({...base,kind:'runtime'}),managerToken:this.sign({...base,kind:'manager'})};
  }
  async status(grant:Grant) {
    const value=await this.store.one('SELECT last_active_at FROM cloud_runtime_leases WHERE project_id=? AND instance_id=?',grant.projectId,grant.instanceId??null);
    return {ok:true,lastActiveAt:Number(value?.last_active_at??0)};
  }
  async touch(grant:Grant) {
    if(grant.kind!=='runtime')throw new ServiceError('CLOUD_GRANT_SCOPE',403);
    await this.store.run('UPDATE cloud_runtime_leases SET last_active_at=? WHERE project_id=? AND instance_id=?',now(),grant.projectId,grant.instanceId??null);
  }
  async renew(grant:Grant) {
    if(grant.kind!=='manager')throw new ServiceError('CLOUD_GRANT_SCOPE',403);
    const policy=await this.policy();
    await this.store.run('UPDATE cloud_runtime_leases SET expires_at=? WHERE project_id=? AND instance_id=?',now()+(grant.ttlSeconds+policy.leaseGraceSeconds)*1000,grant.projectId,grant.instanceId??null);
  }
  async release(grant:Grant) {
    if(grant.kind!=='manager')throw new ServiceError('CLOUD_GRANT_SCOPE',403);
    await this.store.run('DELETE FROM cloud_runtime_leases WHERE project_id=? AND instance_id=?',grant.projectId,grant.instanceId??null);
  }
  runtime(grant:Grant) {
    const claimName='ipollo-project-'+createHash('sha256').update(grant.projectId).digest('hex').slice(0,40);
    return {projectId:grant.projectId,volume:{name:'project',mountPath:'/workspace',pvc:{claimName,createIfNotExists:true,deleteOnSandboxTermination:false,storage:'1073741824',accessModes:['ReadWriteOnce']}}};
  }
}

/** Cloud grants never authorize general account administration or another project. */
export function cloudGrantAllows(grant:Grant,path:string,method:string):boolean {
  if(grant.kind==='launch') return method==='POST' && ['/api/v1/cloud-runtime/claim','/api/v1/cloud-runtime/inspect'].includes(path);
  if(grant.kind==='manager') return (method==='GET' && path==='/api/v1/cloud-runtime/status') || (method==='POST' && ['/api/v1/cloud-runtime/release','/api/v1/cloud-runtime/renew'].includes(path));
  if(method==='GET' && [ '/api/v1/cloud-runtime/status','/api/v1/services','/api/v1/me/summary','/api/v1/me/orgs','/api/v1/projects',`/api/v1/projects/${grant.projectId}/runtime`].includes(path))return true;
    if(method==='GET' && path==='/api/v1/me/enterprise-mcp')return true;
    if(['GET','POST','DELETE'].includes(method) && /^\/api\/v1\/me\/enterprise-mcp\/[A-Za-z0-9_-]+\/connect$/.test(path))return true;
    if(method==='POST' && path==='/api/v1/cloud-runtime/activity')return true;
  return method==='POST' && /^\/api\/v1\/services\/[^/]+\/invoke$/.test(path);
}
export function mountCloudProjects(app:App,cloud:CloudProjects) {
  app.get('/api/v1/cloud-projects/availability',async c=>c.json(await cloud.available()));
  app.post('/api/v1/projects/:id/cloud/open',async c=>c.json(await cloud.open(c.get('actor'),z.uuid().parse(c.req.param('id')))));
  app.use('/api/v1/cloud-runtime/*',async(c,next)=>{if(!c.get('cloudGrant'))throw new ServiceError('CLOUD_GRANT_SCOPE',403);await next();});
  app.post('/api/v1/cloud-runtime/inspect',c=>c.json({projectId:c.get('cloudGrant')!.projectId,userId:c.get('actor').id}));
  app.post('/api/v1/cloud-runtime/claim',async c=>c.json(await cloud.claim(c.get('actor'),c.get('cloudGrant')!,z.object({instanceId:z.uuid()}).parse(await c.req.json()).instanceId)));
  app.get('/api/v1/cloud-runtime/status',async c=>c.json(await cloud.status(c.get('cloudGrant')!)));
  app.post('/api/v1/cloud-runtime/activity',async c=>{await cloud.touch(c.get('cloudGrant')!);return c.json({ok:true});});
  app.post('/api/v1/cloud-runtime/renew',async c=>{await cloud.renew(c.get('cloudGrant')!);return c.json({ok:true});});
  app.post('/api/v1/cloud-runtime/release',async c=>{await cloud.release(c.get('cloudGrant')!);return c.json({ok:true});});
  app.get('/api/v1/projects/:id/runtime',c=>{
    const grant=c.get('cloudGrant');
    if(!grant || grant.projectId!==c.req.param('id'))throw new ServiceError('CLOUD_GRANT_SCOPE',403);
    return c.json(cloud.runtime(grant));
  });
}
export type CloudGrant = Grant;
