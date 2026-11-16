import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createService } from '../src/app.js';
import { testConfig } from './database.js';
import { OrganizationMembers, notificationEndpoint } from '../src/organization-members.js';
import type { Actor } from '../src/auth.js';

test('organization invitations are atomic and scoped; notifications are signed, retried and opt-in', async () => {
 const dir=await mkdtemp(join(tmpdir(),'ipw-org-members-'));
 const service=await createService(await testConfig({DATA_DIR:dir}));
 try {
  const actors:Actor[]=[];
  for(const name of ['owner','member','outsider']) {
   const {user}=await service.auth.api.signUpEmail({body:{email:name+'@organization.test',name,password:'Valid-password-2026'}});
   actors.push({id:user.id,name,email:user.email,role:'user'});
  }
  const [owner,member,outsider]=actors as [Actor,Actor,Actor],org=randomUUID();
  await service.store.run('INSERT INTO enterprises VALUES(?,?,?,?)',org,'Customer organization',owner.id,Date.now());
  for(const actor of [owner,member])await service.store.run('INSERT INTO members(enterprise_id,user_id,role,created_at) VALUES(?,?,?,?)',org,actor.id,actor===owner?'owner':'member',Date.now());
  let delivered=0;let expectedSecret='';
  const members=new OrganizationMembers(service.store,service.settings,'https://work.example',async (_url,init)=>{
   const headers=new Headers(init?.headers),payload=String(init?.body);
   assert.equal(headers.get('X-iPollo-Signature'),'sha256='+createHmac('sha256',expectedSecret).update(headers.get('X-iPollo-Timestamp')+'.'+payload).digest('hex'));
   assert.equal(JSON.parse(payload).enterpriseId,org);delivered++;
   return new Response(null,{status:delivered===1?503:204});
  });
  const input={people:[{email:'one@example.com'},{email:'two@example.com'}]};
  for(const actor of [member,outsider]) {
   await assert.rejects(members.batch(actor,org,input),{code:'ENTERPRISE_FORBIDDEN'});
   await assert.rejects(members.configure(actor,org,{endpoint:'https://8.8.8.8/hook',enabled:true}),{code:'ENTERPRISE_FORBIDDEN'});
  }
  await assert.rejects(members.batch(owner,org,{people:[{email:'ok@example.com'},{email:'fail@example.com',departmentId:'foreign'}]}),{code:'DEPARTMENT_MISMATCH'});
  assert.equal((await service.store.all('SELECT id FROM invitations')).length,0);
  await assert.rejects(members.batch(owner,org,{people:[{email:'one@example.com'},{email:'ONE@example.com'}]}),{code:'INVITATION_DUPLICATE'});
  const invitations=await members.batch(owner,org,input);
  assert.equal(invitations.items.length,2);assert.match(invitations.items[0]!.url,/^https:\/\/work.example\/invite\//);
  await members.event(org,member.id,'member.updated');
  assert.equal((await service.store.all('SELECT id FROM organization_notification_deliveries')).length,0);
  const configured=await members.configure(owner,org,{endpoint:'https://8.8.8.8/hook',enabled:true});expectedSecret=configured.secret!;
  assert.ok(expectedSecret);assert.equal('secret' in await members.config(owner,org),false);
  assert.ok(!JSON.stringify(await service.store.all('SELECT value FROM settings')).includes(expectedSecret));
  await service.store.transaction(()=>members.event(org,member.id,'member.updated'));
  await members.deliver();assert.equal(delivered,1);
  const row=await service.store.one('SELECT * FROM organization_notification_deliveries');assert.equal(row?.delivered_at,null);assert.equal(row?.attempts,1);
  await service.store.run('UPDATE organization_notification_deliveries SET next_at=0');await members.deliver();assert.equal(delivered,2);
  assert.ok((await service.store.one('SELECT delivered_at FROM organization_notification_deliveries'))?.delivered_at);
  await members.deliver();assert.equal(delivered,2);
  await members.configure(owner,org,{endpoint:'https://8.8.8.8/hook',enabled:false});await members.event(org,member.id,'member.removed');
  assert.equal((await service.store.all('SELECT id FROM organization_notification_deliveries')).length,1);
 } finally {await service.close();await rm(dir,{recursive:true,force:true});}
});
test('notification endpoints reject internal addresses and embedded credentials',async()=>{
 for(const endpoint of ['http://example.com/hook','https://127.0.0.1/hook','https://10.1.2.3/hook','https://[::1]/hook','https://[::ffff:127.0.0.1]/hook','https://user:pass@example.com/hook'])await assert.rejects(notificationEndpoint(endpoint));
});
