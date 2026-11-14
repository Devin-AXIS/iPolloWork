import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createService} from '../src/app.js';
import {loadConfig} from '../src/config.js';

test('project access, department changes, immutable submissions and memory revisions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ipw-project-'));
 const service=await createService(loadConfig({DATA_DIR:dir,SERVICE_ORIGIN:'http://localhost:4785'}));
 let peer=0;
 const http=async(path:string,token:string,body?:unknown,method?:string)=>{
  const response=await service.app.request('http://localhost:4785/api/v1/'+path,{method:method??(body===undefined?'GET':'POST'),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','x-ipollo-peer-ip':'192.0.2.'+(++peer%200)},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json() as Record<string,any>}; // Test fixtures read endpoint-specific JSON asserted below.
 };
 const account=async(name:string)=>{
  const response=await service.app.request('http://localhost:4785/api/auth/sign-up/email',{method:'POST',headers:{'Content-Type':'application/json','x-ipollo-peer-ip':'198.51.100.'+(++peer)},body:JSON.stringify({name,email:name+'@example.test',password:'Project-test-password-2026'})});
  const value=await response.json();assert.equal(response.status,200);return value;
 };
 try{
  const owner=await account('owner'),member=await account('member'),viewer=await account('viewer'),outsider=await account('outsider');
  const enterprise=(await http('enterprises',owner.token,{name:'Project team'})).data.id;
  const dept=(await http('enterprises/'+enterprise+'/departments',owner.token,{name:'Design'})).data.id;
  for(const person of [member,viewer])service.store.run('INSERT INTO members VALUES(?,?,?,?,?)',enterprise,person.user.id,'member',person===member?dept:null,Date.now());
  const project=(await http('projects',owner.token,{title:'Launch',enterpriseId:enterprise})).data.id;
  const path='projects/'+project;
  assert.equal((await http(path+'/access',owner.token,{mode:'selected',grants:[{kind:'department',subjectId:dept,role:'participate'},{kind:'member',subjectId:viewer.user.id,role:'view'}]},'PUT')).status,200);
  assert.equal((await http(path+'/space',outsider.token)).status,403);
  assert.equal((await http(path+'/space',member.token)).data.project.role,'participate');
  assert.equal((await http(path+'/space',viewer.token)).data.project.role,'view');
  const submission={requestId:randomUUID(),kind:'memory',title:'Customer needs',baseVersion:0,text:'Confirmed requirements'};
  assert.equal((await http(path+'/changes',viewer.token,submission)).status,403);
  const first=await http(path+'/changes',member.token,submission);assert.equal(first.status,201);
  assert.equal((await http(path+'/changes',member.token,submission)).data.id,first.data.id);
  assert.equal((await http(path+'/changes',member.token,{...submission,text:'Changed retry'})).status,409);
  assert.equal((await http(path+'/changes/'+first.data.id+'/accept',member.token,{expectedVersion:0,text:'Changed'})).status,403);
  assert.equal((await http(path+'/space',owner.token)).data.memory.text,'');
  assert.equal((await http(path+'/changes/'+first.data.id+'/accept',owner.token,{expectedVersion:0,text:'Confirmed requirements'})).status,200);
  assert.equal(JSON.parse(String(service.store.one('SELECT content FROM project_changes WHERE id=?',first.data.id)?.content)).acceptedText,'Confirmed requirements');
  assert.equal((await http(path+'/changes',member.token,submission)).data.id,first.data.id);
  const second=await http(path+'/changes',member.token,{...submission,requestId:randomUUID(),baseVersion:1});
  assert.equal((await http(path+'/changes/'+second.data.id+'/accept',owner.token,{expectedVersion:0,text:'Outdated write'})).status,409);
  assert.equal((await http(path+'/space',owner.token)).data.memory.text,'Confirmed requirements');
  const resource=(await http('resources',member.token,{title:'notes.txt',kind:'attachment',content:'hello',enterpriseId:enterprise})).data.id;
  const file={requestId:randomUUID(),kind:'files',title:'Add notes',baseVersion:0,files:[{path:'notes.txt',resourceId:resource,baseResourceId:null}]};
  const fileSubmit=await http(path+'/changes',member.token,file);assert.equal(fileSubmit.status,201);
  assert.equal((await http(path+'/changes/'+fileSubmit.data.id+'/accept',owner.token,{expectedVersion:0})).status,200);
  assert.equal((await http(path+'/space',viewer.token)).data.files[0].resourceId,resource);
  const stale=await http(path+'/changes',member.token,{...file,requestId:randomUUID(),baseVersion:0});
  assert.equal((await http(path+'/changes/'+stale.data.id+'/accept',owner.token,{expectedVersion:1})).status,409);
  assert.equal((await http(path+'/changes',member.token,{...file,requestId:randomUUID(),files:[{path:'../escape',resourceId:resource,baseResourceId:null}]})).status,400);
  service.store.run('UPDATE members SET department_id=NULL WHERE enterprise_id=? AND user_id=?',enterprise,member.user.id);
  assert.equal((await http(path+'/space',member.token)).status,403);
  assert(!(await http('projects',member.token)).data.items.some((p:{id:string})=>p.id===project));
  assert.equal((await http('shares',owner.token,{transcript:[]})).status,410);
  assert.equal((await http('shares/old/comments',owner.token,{content:'obsolete'})).status,410);
  assert.equal(service.store.one('PRAGMA integrity_check')?.integrity_check,'ok');
 }finally{service.close();await rm(dir,{recursive:true,force:true})}
});
