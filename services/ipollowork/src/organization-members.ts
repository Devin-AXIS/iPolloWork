/** Organization-owned batch invitations and optional signed member-change notifications. */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import type { Store, Row } from './database.js';
import type { Settings } from './settings.js';
import type { App } from './http.js';
import type { Actor } from './auth.js';
import { audit, departmentAccess, enterpriseAccess, now } from './domain.js';
import { ServiceError } from './errors.js';
import { z } from 'zod';
const endpointSchema=z.url().refine(v=>{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.search;});
function forbiddenAddress(address:string) {
 const normalized=address.toLowerCase().replace(/^::ffff:/,'');
 return !isIP(normalized)||/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|224\.|240\.|255\.|::|fc|fd|fe[89ab])/i.test(normalized);
}
export async function notificationEndpoint(value:string) {
 const url=new URL(endpointSchema.parse(value)),host=url.hostname.replace(/^\[|\]$/g,'');
 const addresses=isIP(host)?[{address:host}]:await lookup(host,{all:true});
 if(!addresses.length||addresses.some(({address})=>forbiddenAddress(address)))throw new ServiceError('NOTIFICATION_ENDPOINT_FORBIDDEN',400);
 return url;
}
/** Resolve again at connection time so DNS changes cannot redirect the POST to a private address. */
async function postNotification(url:URL, headers:Record<string,string>, body:string, signal:AbortSignal):Promise<Response> {
 return new Promise((resolve,reject)=>{
  const req=request(url,{method:'POST',headers,signal,lookup:(hostname,options,callback)=>{
   lookup(hostname,{all:true}).then(addresses=>{
    if(!addresses.length||addresses.some(({address})=>forbiddenAddress(address))){callback(new Error('Forbidden notification address'),'',4);return;}
    if(options.all)callback(null,addresses);else callback(null,addresses[0]!.address,addresses[0]!.family);
   },error=>callback(error,'',4));
  }},response=>{resolve(new Response(null,{status:response.statusCode??502}));response.destroy();});
  req.on('error',reject);req.end(body);
 });
}
const batchSchema=z.object({people:z.array(z.object({email:z.email().transform(v=>v.toLowerCase()),departmentId:z.string().nullable().default(null),role:z.enum(['member','admin']).default('member')}).strict()).min(1).max(500),days:z.number().int().min(1).max(30).default(7)}).strict();
export class OrganizationMembers {
 private timer?:ReturnType<typeof setInterval>;
 private pending?:Promise<void>;
 private stopped=false;
 private abort=new AbortController();
 constructor(private store:Store,private settings:Settings,private origin:string,private fetcher?:typeof fetch){}
 async batch(actor:Actor,id:string,raw:unknown){
  await enterpriseAccess(this.store,actor,id,true);
  const input=batchSchema.parse(raw);
  if(new Set(input.people.map(p=>p.email)).size!==input.people.length)throw new ServiceError('INVITATION_DUPLICATE',400);
  const items:{id:string;email:string;url:string}[]=[];
  await this.store.transaction(async()=>{
   for(const person of input.people){
    await departmentAccess(this.store,id,person.departmentId);
    const token=randomBytes(32).toString('base64url'),invitationId=randomUUID();
    // Do not invalidate existing invitations as a side effect of bulk creation.
    await this.store.run('INSERT INTO invitations(id,enterprise_id,token_hash,email,role,department_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)',invitationId,id,createHash('sha256').update(token).digest('hex'),person.email,person.role,person.departmentId,now()+input.days*86400000,now());
    await audit(this.store,actor,'invitation.create',invitationId);
    items.push({id:invitationId,email:person.email,url:this.origin+'/invite/'+token});
   }
  });return {items};
 }
 async config(actor:Actor,id:string){
  await enterpriseAccess(this.store,actor,id,true);
  const row=await this.store.one('SELECT endpoint,enabled FROM organization_notifications WHERE enterprise_id=?',id);
  return {endpoint:row?.endpoint??'',enabled:row?.enabled??false,configured:Boolean((await this.settings.get('organization-notification/'+id)).secret)};
 }
 async configure(actor:Actor,id:string,raw:unknown){
  await enterpriseAccess(this.store,actor,id,true);
  const input=z.object({endpoint:z.string(),enabled:z.boolean(),rotate:z.boolean().optional()}).strict().parse(raw);
  if(input.enabled||input.endpoint)await notificationEndpoint(input.endpoint);
  let secret:string|undefined;
  await this.store.transaction(async()=>{
   await this.store.run('SELECT id FROM enterprises WHERE id=? FOR UPDATE',id);
   const previous=await this.store.one('SELECT endpoint FROM organization_notifications WHERE enterprise_id=?',id);
   const stored=await this.settings.get('organization-notification/'+id);
   if(!stored.secret||input.rotate||previous?.endpoint!==input.endpoint){secret=randomBytes(32).toString('base64url');await this.settings.set('organization-notification/'+id,{secret});}
   await this.store.run('INSERT INTO organization_notifications(enterprise_id,endpoint,enabled,updated_at) VALUES(?,?,?,?) ON CONFLICT(enterprise_id) DO UPDATE SET endpoint=excluded.endpoint,enabled=excluded.enabled,updated_at=excluded.updated_at',id,input.endpoint,input.enabled,now());
   if(previous?.endpoint!==input.endpoint)await this.store.run('DELETE FROM organization_notification_deliveries WHERE enterprise_id=? AND delivered_at IS NULL',id);
   await audit(this.store,actor,'organization.notification.configure',id);
  });return {...await this.config(actor,id),...(secret?{secret}:{})};
 }
 /** Must be called inside the membership mutation transaction. */
 async event(enterpriseId:string,userId:string,type:'member.joined'|'member.updated'|'member.removed'){
  const member=await this.store.one('SELECT role,department_id FROM members WHERE enterprise_id=? AND user_id=?',enterpriseId,userId);
  const id=randomUUID(),created=now(),payload=JSON.stringify({id,type,enterpriseId,userId,role:member?.role??null,departmentId:member?.department_id??null,createdAt:created});
  await this.store.run('INSERT INTO organization_notification_deliveries(id,enterprise_id,payload,next_at,created_at) SELECT ?,enterprise_id,?,?,? FROM organization_notifications WHERE enterprise_id=? AND enabled',id,payload,created,created,enterpriseId);
 }
 async deliver(){
  const rows=await this.store.transaction(async()=>{
   const rows=await this.store.all<Row>('SELECT d.*,n.endpoint FROM organization_notification_deliveries d JOIN organization_notifications n ON n.enterprise_id=d.enterprise_id WHERE n.enabled AND d.delivered_at IS NULL AND d.next_at<=? AND (d.lease_until IS NULL OR d.lease_until<?) ORDER BY d.next_at LIMIT 10 FOR UPDATE OF d SKIP LOCKED',now(),now());
   for(const row of rows)await this.store.run('UPDATE organization_notification_deliveries SET lease_until=? WHERE id=?',now()+60000,row.id);return rows;
  });
  await Promise.all(rows.map(async row=>{
   let success=false;
   try{
    const url=await notificationEndpoint(String(row.endpoint)),secret=(await this.settings.get('organization-notification/'+row.enterprise_id)).secret;
    if(!secret)throw Error();const timestamp=String(now()),payload=String(row.payload);
    const signature=createHmac('sha256',secret).update(timestamp+'.'+payload).digest('hex');
    const headers={'Content-Type':'application/json','X-iPollo-Timestamp':timestamp,'X-iPollo-Signature':'sha256='+signature,'X-iPollo-Delivery':String(row.id)};
    const signal=AbortSignal.any([this.abort.signal,AbortSignal.timeout(15000)]);
    const response=this.fetcher?await this.fetcher(url,{method:'POST',redirect:'error',signal,headers,body:payload}):await postNotification(url,headers,payload,signal);
    success=response.ok;await response.body?.cancel();
   }catch{/* Retry without exposing endpoint credentials or member payloads in logs. */}
   const attempts=Number(row.attempts)+1;
   await this.store.run('UPDATE organization_notification_deliveries SET attempts=?,next_at=?,delivered_at=?,lease_until=NULL WHERE id=?',attempts,now()+Math.min(3600000,1000*2**Math.min(attempts,12)),success?now():null,row.id);
  }));
 }
 start(){this.timer=setInterval(()=>{if(!this.stopped&&!this.pending)this.pending=this.deliver().catch(()=>{}).finally(()=>{this.pending=undefined;});},5000);this.timer.unref();}
 async close(){this.stopped=true;if(this.timer)clearInterval(this.timer);this.abort.abort();await this.pending;}
 mount(app:App){
  app.post('/api/v1/enterprises/:id/invitations/batch',async c=>c.json(await this.batch(c.get('actor'),c.req.param('id'),await c.req.json())));
  app.get('/api/v1/enterprises/:id/notifications',async c=>c.json(await this.config(c.get('actor'),c.req.param('id'))));
  app.put('/api/v1/enterprises/:id/notifications',async c=>c.json(await this.configure(c.get('actor'),c.req.param('id'),await c.req.json())));
 }
}
