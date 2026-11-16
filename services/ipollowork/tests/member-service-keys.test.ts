import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createService } from '../src/app.js';
import { testConfig } from './database.js';
import { ExecutionService } from '../src/execution.js';
import type { Actor } from '../src/auth.js';

test('member keys stay isolated and encrypted; organization context and grants are required', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-member-keys-'));
  const app = await createService(await testConfig({ DATA_DIR: dir, SERVICE_ORIGIN: 'http://localhost:4785' }));
  try {
    const people: Actor[] = [];
    for (const name of ['owner', 'alice', 'bob']) {
      const { user } = await app.auth.api.signUpEmail({ body: { email: name + '@member.test', name, password: 'Valid-password-2026' } });
      people.push({ id: user.id, name, email: user.email, role: 'user', emailVerified: true });
      await app.store.run('UPDATE "user" SET "emailVerified"=true WHERE id=?', user.id);
    }
    const [owner, alice, bob] = people as [Actor, Actor, Actor];
    const org = randomUUID();
    await app.store.run('INSERT INTO enterprises VALUES(?,?,?,?)', org, 'Organization', owner.id, Date.now());
    for (const actor of people) await app.store.run('INSERT INTO members(enterprise_id,user_id,role,department_id,created_at) VALUES(?,?,?,NULL,?)', org, actor.id, actor === owner ? 'owner' : 'member', Date.now());
    const login = await app.auth.api.signInEmail({ body: { email: owner.email, password: 'Valid-password-2026' } });
    const createProject = async (enterpriseId: string | null) => {
      const response = await app.app.request('http://localhost:4785/api/v1/projects', { method: 'POST', headers: { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Test', enterpriseId }) });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json() as { id: string }).id;
    };
    const orgProject = await createProject(org), personalProject = await createProject(null);
    let used = '';
    const executor = new ExecutionService(app.store, app.settings, async (_url, init) => {
      used = new Headers(init?.headers).get('authorization') ?? '';
      return Response.json({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    });
    const { id } = await executor.enterpriseSave(owner, org, { title: 'Gateway', baseUrl: 'https://gateway.example/v1', credentialMode: 'member', models: [{ id: 'chat', name: 'Chat', contextWindow: 4096, maxTokens: 1024 }] });
    assert.equal((await executor.enterpriseList(alice, org))[0]!.configured, false);
    await executor.memberKey(alice, org, id, { key: 'alice-secret' });
    await executor.memberKey(bob, org, id, { key: 'bob-secret' });
    assert.equal((await executor.enterpriseList(owner, org))[0]!.configured, false);
    assert.equal((await executor.enterpriseList(alice, org))[0]!.configured, true);
    assert(!JSON.stringify(await executor.catalog(alice)).includes('alice-secret'));
    assert(!JSON.stringify(await app.store.all('SELECT value FROM settings WHERE key LIKE ?', 'member-service-key/%')).includes('alice-secret'));
    const request = () => ({ requestId: randomUUID(), method: 'POST', path: '/chat/completions', body: Buffer.from(JSON.stringify({ model: 'chat', messages: [] })).toString('base64') });
    await assert.rejects(executor.invoke(alice, id, request()), { code: 'SERVICE_ORGANIZATION_CONTEXT_REQUIRED' });
    await assert.rejects(executor.invoke(owner, id, request(), personalProject));
    await executor.memberKey(owner, org, id, { key: 'owner-secret' });
    await (await executor.invoke(owner, id, request(), orgProject)).text();
    assert.equal(used, 'Bearer owner-secret');
    await assert.rejects(executor.enterpriseProbe(owner, org, { serviceId: id, baseUrl: 'https://other.example/v1' }), { code: 'SERVICE_ENDPOINT_MISMATCH' });
    await executor.memberKey(owner, org, id, { key: '' });
    await assert.rejects(executor.invoke(owner, id, request(), orgProject), { code: 'SERVICE_UNCONFIGURED' });
    const removed = await app.app.request(`http://localhost:4785/api/v1/enterprises/${org}/members/${alice.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + login.token } });
    assert.equal(removed.status, 200);
    assert.equal(await app.store.one('SELECT key FROM settings WHERE key=?', `member-service-key/${id}/${alice.id}`), undefined);
    await assert.rejects(executor.memberKey(alice, org, id, { key: 'again' }));
    assert.equal((await executor.enterpriseList(bob, org))[0]!.configured, true);
    await executor.enterpriseSave(owner, org, { id, title: 'Changed endpoint', baseUrl: 'https://new.example/v1', models: [{ id: 'chat', name: 'Chat', contextWindow: 4096, maxTokens: 1024 }] });
    assert.equal((await executor.enterpriseList(bob, org))[0]!.configured, false);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
test('member integration calls use only administrator-allowlisted cross-origin routes', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ipw-route-')),app=await createService(await testConfig({DATA_DIR:dir}));
 try{
 const {user}=await app.auth.api.signUpEmail({body:{name:'Route',email:'route@test.example',password:'Valid-password-2026'}}),actor:Actor={id:user.id,name:user.name,email:user.email,role:'user'},org=randomUUID();
 await app.store.run('INSERT INTO enterprises VALUES(?,?,?,?)',org,'Org',actor.id,Date.now());await app.store.run("INSERT INTO members(enterprise_id,user_id,role,created_at) VALUES(?,?,'owner',?)",org,actor.id,Date.now());
 const project=randomUUID();await app.store.run("INSERT INTO projects(id,owner_id,enterprise_id,title,created_at) VALUES(?,?,?,'P',?)",project,actor.id,org,Date.now());
 let target='',authorization='';
 const executor=new ExecutionService(app.store,app.settings,async(url,init)=>{target=String(url);authorization=new Headers(init?.headers).get('Authorization')!;return Response.json({result:{}},{headers:{'mcp-session-id':'abc'}});});
 const {id}=await executor.enterpriseSave(actor,org,{title:'Route',baseUrl:'https://one.example/v1',credentialMode:'member',models:[],routes:[{method:'POST',path:'/mcp',points:0,origin:'https://mcp.example'}]});
 await executor.memberKey(actor,org,id,{key:'private-route-key'});
 const request={requestId:randomUUID(),path:'/mcp',method:'POST',destination:'https://mcp.example',body:Buffer.from('{}').toString('base64')};
 await (await executor.invoke(actor,id,request,project)).text();assert.equal(target,'https://mcp.example/mcp');assert.equal(authorization,'Bearer private-route-key');
 await assert.rejects(executor.invoke(actor,id,{...request,requestId:randomUUID(),destination:'https://evil.example'},project),{code:'SERVICE_OPERATION_UNAVAILABLE'});
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
