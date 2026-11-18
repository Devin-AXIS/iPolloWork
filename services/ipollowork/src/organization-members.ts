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
import { InvitationRosterError, organizationInvitationRoster } from './organization-invitation-csv.js';
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
const invitationPerson = z.object({
 email:z.email().transform(v=>v.toLowerCase()).nullable().default(null),
 name:z.string().trim().min(1).max(120).optional(),
 employeeNumber:z.string().trim().min(1).max(64).optional(),
 departmentId:z.string().nullable().default(null),
 departmentName:z.string().trim().min(1).max(120).nullable().optional(),
 role:z.enum(['member','admin']).default('member'),
}).strict().refine(person=>person.email || (person.name && person.employeeNumber && person.role === 'member'),
 '无邮箱时需要填写名称和工号，管理员邀请需要绑定邮箱');
const peopleSchema = z.array(invitationPerson).min(1).max(500);
const invitationDays = z.number().int().min(1).max(30).default(7);
const csvBatchSchema = z.object({
 csv:z.string(),
 days:z.number().int().min(1).max(30).nullable().optional(),
}).strict();
const codeBatchSchema = csvBatchSchema.extend({ createMissingDepartments: z.boolean().optional() });
const batchSchema=z.union([
 z.object({people:peopleSchema,days:invitationDays}).strict(),
 csvBatchSchema,
]);
type IssuedCode = {id:string;name?:string;employeeNumber?:string;code:string;serviceAddress:string};
type LegacyInvitation = IssuedCode & {email:string|null;url:string};
export class OrganizationMembers {
 private timer?:ReturnType<typeof setInterval>;
 private pending?:Promise<void>;
 private stopped=false;
 private abort=new AbortController();
 constructor(private store:Store,private settings:Settings,private origin:string,private fetcher?:typeof fetch){}
 async batch(actor:Actor,id:string,raw:unknown):Promise<{items:LegacyInvitation[]}>;
 async batch(actor:Actor,id:string,raw:unknown,codeOnly:true):Promise<{items:IssuedCode[]}>;
 async batch(actor:Actor,id:string,raw:unknown,codeOnly=false){
  await enterpriseAccess(this.store,actor,id,true);
  const input=(codeOnly ? codeBatchSchema : batchSchema).parse(raw);
  const days = codeOnly ? input.days : (input.days ?? 7);
  const createdAt = now();
  const expiresAt = days == null ? null : createdAt + days * 86400000;
  const createMissingDepartments = 'createMissingDepartments' in input && input.createMissingDepartments;
  let roster: { person: z.infer<typeof invitationPerson>; line?: number }[];
  if ('people' in input) {
    roster = input.people.map(person => ({ person }));
  } else {
    if (Buffer.byteLength(input.csv) > 256 * 1024)
      throw new InvitationRosterError('INVITATION_CSV_TOO_LARGE', 413, 'CSV 文件不能超过 256 KB，请拆分文件后重试');
    roster = organizationInvitationRoster(input.csv, codeOnly).map(({ person, line }) => {
      const parsed = invitationPerson.safeParse(person);
      if (!parsed.success) {
        const field = parsed.error.issues[0]?.path[0];
        const message = field === 'name' ? '名称不能超过 120 个字符'
          : field === 'employeeNumber' ? '工号不能超过 64 个字符'
          : field === 'departmentName' ? '部门名称不能超过 120 个字符'
          : field === 'email' ? '邮箱格式有误' : '管理员邀请需要绑定邮箱';
        throw new InvitationRosterError('INVITATION_CSV_INVALID', 400, message, line);
      }
      return { person: parsed.data, line };
    });
  }
  const emails = new Set<string>(), employeeNumbers = new Set<string>();
  for (const { person, line } of roster) {
    const employeeNumber = person.employeeNumber?.toLowerCase();
    if (person.email && emails.has(person.email))
      throw new InvitationRosterError('INVITATION_DUPLICATE', 400, '名单中存在重复的邮箱', line);
    if (employeeNumber && employeeNumbers.has(employeeNumber))
      throw new InvitationRosterError('INVITATION_DUPLICATE', 400, '名单中存在重复的工号', line);
    if (person.email) emails.add(person.email);
    if (employeeNumber) employeeNumbers.add(employeeNumber);
  }
  const items:LegacyInvitation[]=[];
  await this.store.transaction(async()=>{
   await this.store.one('SELECT id FROM enterprises WHERE id=? FOR NO KEY UPDATE',id);
   await enterpriseAccess(this.store,actor,id,true);
   for(const { person, line } of roster){
    let department = person.departmentId;
    if (person.departmentName) {
      let found = await this.store.one('SELECT id FROM departments WHERE enterprise_id=? AND name=?', id, person.departmentName);
      if (!found && createMissingDepartments) {
        const inserted = await this.store.one(
          'INSERT INTO departments(id,enterprise_id,name) VALUES(?,?,?) ON CONFLICT(enterprise_id,name) DO NOTHING RETURNING id',
          randomUUID(), id, person.departmentName,
        );
        if (inserted) await audit(this.store, actor, 'department.create', String(inserted.id), id);
        found = inserted ?? await this.store.one('SELECT id FROM departments WHERE enterprise_id=? AND name=?', id, person.departmentName);
      }
      if (!found || (department && department !== found.id))
        throw new InvitationRosterError('DEPARTMENT_MISMATCH', 400,
          '找不到部门「' + person.departmentName + '」。' + (codeOnly ? '请检查部门名称或勾选自动创建缺少的部门' : '请检查部门名称'),
          line,
        );
      department = String(found.id);
    }
    await departmentAccess(this.store,id,department);
    if (person.employeeNumber && await this.store.one(`SELECT 1 FROM members WHERE enterprise_id=? AND lower(employee_number)=lower(?)
      UNION ALL SELECT 1 FROM invitations WHERE enterprise_id=? AND lower(employee_number)=lower(?) AND accepted_by IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)`,
      id,person.employeeNumber,id,person.employeeNumber,createdAt))
      throw new InvitationRosterError('INVITATION_EMPLOYEE_NUMBER_IN_USE',409,'工号已分配或已有有效邀请码，请核对工号或使用现有邀请码', line);
    const token=(codeOnly ? 'ipw_' : '')+randomBytes(32).toString('base64url'),invitationId=randomUUID();
    // Do not invalidate existing invitations as a side effect of bulk creation.
    await this.store.run('INSERT INTO invitations(id,enterprise_id,token_hash,email,role,department_id,expires_at,created_at,invitee_name,employee_number) VALUES(?,?,?,?,?,?,?,?,?,?)',
      invitationId,id,createHash('sha256').update(token).digest('hex'),person.email,person.role,department,expiresAt,createdAt,person.name??null,person.employeeNumber??null);
    await audit(this.store,actor,'invitation.create',invitationId,id);
    items.push({id:invitationId,email:person.email,...(person.name?{name:person.name}:{}),...(person.employeeNumber?{employeeNumber:person.employeeNumber}:{}),
      url:this.origin+'/invite/'+token,code:token,serviceAddress:this.origin});
   }
  });
  return {items:codeOnly ? items.map(({id,name,employeeNumber,code,serviceAddress})=>({id,name,employeeNumber,code,serviceAddress})) : items};
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
   await audit(this.store,actor,'organization.notification.configure',id,id);
  });return {...await this.config(actor,id),...(secret?{secret}:{})};
 }
 /** Must be called inside the membership mutation transaction. */
 async event(enterpriseId:string,userId:string,type:'member.joined'|'member.updated'|'member.removed',previous?:Row){
  const member=await this.store.one('SELECT role,department_id,status FROM members WHERE enterprise_id=? AND user_id=?',enterpriseId,userId);
  const id=randomUUID(),created=now(),payload=JSON.stringify({id,type,enterpriseId,userId,role:member?.role??null,departmentId:member?.department_id??null,status:member?.status??null,createdAt:created});
  await this.store.run('INSERT INTO organization_notification_deliveries(id,enterprise_id,payload,next_at,created_at) SELECT ?,enterprise_id,?,?,? FROM organization_notifications WHERE enterprise_id=? AND enabled',id,payload,created,created,enterpriseId);
  const notice = (kind: string, value: string | null) => this.store.run(
    'INSERT INTO organization_member_notices(id,enterprise_id,user_id,kind,value,created_at) VALUES(?,?,?,?,?,?)',
    randomUUID(),enterpriseId,userId,kind,value,created,
  );
  if (type === 'member.removed') await notice('removed',null);
  if (type === 'member.updated' && previous && member) {
    if (member.status !== previous.status) await notice('status',String(member.status));
    if (member.role !== previous.role) await notice('role',String(member.role));
    if (member.department_id !== previous.department_id) {
      const department = member.department_id ? await this.store.one('SELECT name FROM departments WHERE id=? AND enterprise_id=?',member.department_id,enterpriseId) : undefined;
      await notice('department',department ? String(department.name) : null);
    }
  }
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
  app.post('/api/v1/enterprises/:id/join-codes/batch',async c=>c.json(await this.batch(c.get('actor'),c.req.param('id'),await c.req.json(),true)));
  app.get('/api/v1/enterprises/:id/notifications',async c=>c.json(await this.config(c.get('actor'),c.req.param('id'))));
  app.put('/api/v1/enterprises/:id/notifications',async c=>c.json(await this.configure(c.get('actor'),c.req.param('id'),await c.req.json())));
  app.get('/api/v1/me/organization-notices', async c => {
    const userId = c.get('actor').id;
    const include = c.req.query('include');
    const items = await this.store.all(
      `SELECT n.id,n.kind,n.value,n.created_at,n.read_at,n.enterprise_id,n.target_tab,n.target_id,e.name FROM organization_member_notices n
        JOIN enterprises e ON e.id=n.enterprise_id WHERE n.user_id=? AND
        (? OR n.kind IN ('role','department','removed') OR (? AND n.kind='status'))
        ORDER BY n.created_at DESC,n.id LIMIT 100`,
      userId, include === 'all', include === 'status',
    );
    if (include !== 'all') return c.json({ items });
    const count = await this.store.one<{ count: string }>(
      'SELECT COUNT(*) AS count FROM organization_member_notices WHERE user_id=? AND read_at IS NULL', userId,
    );
    return c.json({ items, unreadCount: Number(count?.count ?? 0) });
  });
  app.put('/api/v1/me/organization-notices', async c => {
    const input = z.union([z.object({ ids: z.array(z.uuid()).max(100) }).strict(), z.object({ all: z.literal(true) }).strict()]).parse(await c.req.json());
    const userId = c.get('actor').id;
    if ('all' in input) await this.store.run('UPDATE organization_member_notices SET read_at=? WHERE user_id=? AND read_at IS NULL', now(), userId);
    else await this.store.run(
      'UPDATE organization_member_notices SET read_at=? WHERE user_id=? AND id IN (SELECT json_array_elements_text(?::json)) AND read_at IS NULL',
      now(), userId, JSON.stringify(input.ids),
    );
    return c.json({ ok:true });
  });
 }
}
