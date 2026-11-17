import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareEvidence } from '../service/evidence.ts';
import { importChromeFlow, newSession } from '../service/model.ts';
import { createRecorderService } from '../service/recorder.ts';

test('quality assessment identifies missing target and outcome without inventing evidence', () => {
 const s = newSession();s.steps=[{id:'x',at:s.createdAt,action:'click',target:{role:'unknown'}}];
 const e=prepareEvidence(s);assert.equal(e.ready,false);assert.deepEqual(e.gaps.map(g=>g.code),['goal_missing','target_missing','completion_missing']);assert.equal(e.checks.length,0);
});
test('evidence paging reports all steps and never contains captured input values', async () => {
 const root=await mkdtemp(join(tmpdir(),'recorder-evidence-'));
 const service=await createRecorderService({workspace:{root},storage:{dataDir:join(root,'data')},plugin:{id:'test',version:'0.2.0'}});
 try {
  const result=await service.actions['import-chrome']!({flow:{title:'Evidence',steps:Array.from({length:70},()=>({type:'click',selectors:[['aria/Save']]}))}}) as {session:{id:string}};
  const first=await service.actions.prepare!({sessionId:result.session.id}) as {nextOffset:number;revision:string};assert.equal(first.nextOffset,50);
  const last=await service.actions.events!({sessionId:result.session.id,offset:50}) as {steps:unknown[];nextOffset:unknown};assert.equal(last.steps.length,20);assert.equal(last.nextOffset,null);
  await assert.rejects(service.actions.events!({sessionId:result.session.id,offset:-1}),/offset/);
 } finally {await service.dispose();await rm(root,{recursive:true,force:true});}
});
test('AI export survives reopening, refuses stale evidence and includes pending evals', async () => {
 const root=await mkdtemp(join(tmpdir(),'recorder-draft-'));
 const runtime={workspace:{root},storage:{dataDir:join(root,'data')},plugin:{id:'test',version:'0.2.0'}};
 let service=await createRecorderService(runtime);
 try {
  const imported=await service.actions['import-chrome']!({flow:{title:'Export',steps:[{type:'navigate',url:'https://example.com?token=SECRET'}]}}) as {session:{id:string}};
  const id=imported.session.id;
  const evidence=await service.actions.prepare!({sessionId:id}) as {revision:string};
  const saved=await service.actions.review!({sessionId:id,goal:'导出月份报表',expectedRevision:evidence.revision}) as {session:Parameters<typeof prepareEvidence>[0]};
  await assert.rejects(service.actions.compile!({sessionId:id,expectedRevision:evidence.revision}),/changed/);
  const compiled=await service.actions.compile!({sessionId:id,expectedRevision:prepareEvidence(saved.session).revision}) as {skill:string;version:string;archivePath:string};assert.match(compiled.skill,/导出月份报表/);
  await service.dispose();service=await createRecorderService(runtime);
  const status=await service.actions.status!({sessionId:id}) as {compiled:{skill:string;version:string}};assert.equal(status.compiled.skill,compiled.skill);
  const same=await service.actions.status!({sessionId:id,compiledPath:compiled.archivePath}) as {compiled:unknown};assert.equal(same.compiled,null);
  await service.actions.review!({sessionId:id,goal:'另一个目标'});
  assert.equal((await service.actions.status!({sessionId:id}) as {compiled:unknown}).compiled,null);
 } finally {await service.dispose();await rm(root,{recursive:true,force:true});}
});
