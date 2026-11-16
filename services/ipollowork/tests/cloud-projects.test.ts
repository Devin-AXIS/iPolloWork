/** Cloud metadata remains in PostgreSQL while execution lives in an optional plugin. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createService } from '../src/app.js';
import { CloudProjects,cloudGrantAllows } from '../src/cloud-projects.js';
import { testConfig } from './database.js';

test('cloud creation is idempotent; grants isolate projects, expire, and allow only one writer',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ipw-cloud-'));
 const config=await testConfig({DATA_DIR:dir,SERVICE_ORIGIN:'http://localhost:4785'});
 const service=await createService(config);
 const request=async(path:string,token?:string,body?:unknown)=>{
  const response=await service.app.request(config.origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json() as Record<string,any>}; // Heterogeneous test HTTP replies are inspected by assertions below.
 };
 try{
  const signup=await request('/api/auth/sign-up/email',undefined,{email:'cloud@example.test',name:'Cloud',password:'Test-password-2026!'});
  assert.equal(signup.status,200);
  const token=String(signup.data.token),userId=String(signup.data.user.id);
  assert.equal((await request('/api/v1/projects',token,{title:'disabled',executionMode:'cloud'})).status,503);
  assert.equal((await request('/api/v1/projects',token,{title:'local'})).status,201);
  await service.settings.set('cloud',{enabled:'true',gatewayOrigin:'https://cloud.example.test',gatewayKey:'x'.repeat(32)});
  let ticket='';
  const cloud=new CloudProjects(service.store,service.settings,config,async(_url,options)=>{ticket=JSON.parse(String(options?.body)).ticket;return Response.json({url:'https://project.example.test/?token=private'});});
  const organization=await request('/api/v1/enterprises',token,{name:'Flow enterprise'});
  assert.equal(organization.status,201);
  const orgId=organization.data.id;
  const enterpriseProject=await request('/api/v1/projects',token,{title:'Enterprise local',enterpriseId:orgId,executionMode:'local'});
  assert.equal(enterpriseProject.status,201);
  const key=randomUUID();
  const created=await request('/api/v1/projects',token,{title:'cloud',executionMode:'cloud',enterpriseId:orgId,creationKey:key});
  assert.equal(created.status,201);
  assert.equal((await request('/api/v1/projects',token,{title:'cloud',executionMode:'cloud',enterpriseId:orgId,creationKey:key})).data.id,created.data.id);
  assert.equal((await request('/api/v1/projects',token,{title:'changed',executionMode:'cloud',enterpriseId:orgId,creationKey:key})).status,409);
  const projectId=String(created.data.id);
  const actor={id:userId,name:'Cloud',email:'cloud@example.test',role:'user'};
  await cloud.open(actor,projectId);
  const authorized=await cloud.authenticate(ticket);
  const claim=await cloud.claim(actor,authorized.grant,randomUUID());
  await assert.rejects(cloud.claim(actor,authorized.grant,randomUUID()),{code:'CLOUD_PROJECT_BUSY'});
  const runtime=await cloud.authenticate(claim.runtimeToken);
  assert.equal(cloudGrantAllows(runtime.grant,`/api/v1/projects/${projectId}/runtime`,'GET'),true);
  assert.equal(cloudGrantAllows(runtime.grant,'/api/v1/admin/settings','POST'),false);
  assert.equal(cloudGrantAllows(runtime.grant,`/api/v1/projects/${randomUUID()}/runtime`,'GET'),false);
  const mount=await request(`/api/v1/projects/${projectId}/runtime`,claim.runtimeToken);
  assert.equal(mount.status,200);
  assert.equal(mount.data.volume.pvc.claimName,claim.volumeKey);
  assert.equal((await request('/api/v1/cloud-runtime/inspect',token,{})).status,403);
  assert.equal((await request('/api/v1/cloud-runtime/status',claim.runtimeToken)).status,200);
  assert.equal((await request('/api/v1/cloud-runtime/renew',claim.runtimeToken,{})).status,403);
  assert.equal((await request('/api/v1/cloud-runtime/activity',claim.managerToken,{})).status,403);
  await service.store.run('UPDATE cloud_runtime_leases SET last_active_at=1,expires_at=? WHERE project_id=?',Date.now()+30000,projectId);
  assert.equal((await request('/api/v1/cloud-runtime/activity',claim.runtimeToken,{})).status,200);
  await service.settings.set('cloud',{ttlSeconds:'300'});
  assert.equal((await request('/api/v1/cloud-runtime/renew',claim.managerToken,{})).status,200);
  const lease=await service.store.one('SELECT last_active_at,expires_at FROM cloud_runtime_leases WHERE project_id=?',projectId);
  assert(Number(lease?.last_active_at)>1);assert(Number(lease?.expires_at)>Date.now()+1800000);
  assert.equal((await request('/api/v1/projects',claim.runtimeToken)).data.items.length,1);
  const createdApp=await request('/api/data/v1/apps',claim.runtimeToken,{name:'Project notes',kind:'site'});
  assert.equal(createdApp.status,201);assert.equal(createdApp.data.app.owner.id,orgId);
  const spoof=await request('/api/data/v1/apps',claim.runtimeToken,{name:'Spoofed',kind:'site',enterpriseId:'another-enterprise'});
  assert.equal(spoof.status,403);

  const appId=createdApp.data.app.id;
  assert.equal((await request('/api/data/v1/apps/'+appId+'/run',claim.runtimeToken,{insert:'notes',values:{title:'Cloud saved'}})).status,200);
  assert.equal((await request('/api/data/v1/apps/'+appId+'/run',claim.runtimeToken,{find:'notes'})).data.items[0].title,'Cloud saved');
  assert.equal((await request('/api/v1/me/orgs',claim.runtimeToken)).data.items.length,1);
  const personal=await request('/api/data/v1/apps',token,{name:'Private notes',kind:'site'});
  assert.equal((await request('/api/data/v1/apps/'+personal.data.app.id+'/run',claim.runtimeToken,{info:true})).status,404);
  assert.equal((await request('/api/data/v1/apps',claim.runtimeToken)).data.items.length,1);
  assert.equal((await request('/api/data/v1/apps',claim.managerToken)).status,403);
  const tampered=claim.runtimeToken.slice(0,-8)+'AAAAAAAA';
  assert.equal((await request('/api/v1/cloud-runtime/status',tampered)).status,401);
  await service.settings.set('cloud',{enabled:'false'});
  assert.equal((await request('/api/v1/cloud-runtime/status',claim.runtimeToken)).status,503);
  await service.settings.set('cloud',{enabled:'true'});
  const manager=await cloud.authenticate(claim.managerToken);await cloud.release(manager.grant);
  await assert.rejects(cloud.authenticate(claim.runtimeToken),{code:'CLOUD_GRANT_EXPIRED'});
 }finally{await service.close();await rm(dir,{recursive:true,force:true});}
});
