import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { taskDefaults } from '../src/model.ts';
import { localCards, projectTask, writeLocalTask, type StoredTask } from '../src/tasks.ts';

function fixture() {
  const rows=new Map<string,StoredTask>();
  return {get:(id:string)=>rows.get(id),entries:()=>rows.entries(),put:async(id:string,row:StoredTask)=>{rows.set(id,structuredClone(row));}};
}

test('personal tasks persist all fields and reject stale revisions and duplicate conversation links',async()=>{
  const table=fixture(),id=randomUUID();
  const task={...taskDefaults(),title:'Release',description:'Acceptance criteria',priority:'urgent' as const,startAt:100,dueAt:200,
    assigneeAgent:{id:'current',name:'Current conversation AI',ownerId:null},sessionId:'session-one'};
  assert.equal((await writeLocalTask(table,'one',{id,revision:0,task})).revision,1);
  assert.deepEqual(projectTask(localCards(table,'one').get(id)!,localCards(table,'one')),{...task,id,revision:1,blocked:false});
  await assert.rejects(writeLocalTask(table,'one',{id,revision:0,task}),/BOARD_CONFLICT/);
  await assert.rejects(writeLocalTask(table,'one',{id:randomUUID(),revision:0,task}),/BOARD_CONFLICT/);
  assert.equal((await writeLocalTask(table,'one',{id,revision:1,status:'review'})).status,'review');
});

test('personal tasks keep workspaces isolated and reject organization-only assignments',async()=>{
  const table=fixture(),id=randomUUID(),task={...taskDefaults(),title:'Private'};
  await writeLocalTask(table,'one',{id,revision:0,task});
  assert.equal(localCards(table,'two').size,0);
  await assert.rejects(writeLocalTask(table,'two',{id,revision:0,task}),/BOARD_CONFLICT/);
  await assert.rejects(writeLocalTask(table,'two',{id:randomUUID(),revision:0,status:'doing'}),/BOARD_TASK_NOT_FOUND/);
  for(const change of [{assigneeId:'human'},{participantIds:['human']},{assigneeAgent:{id:'current',name:'AI',ownerId:'other'}}]) {
    await assert.rejects(writeLocalTask(table,'one',{id:randomUUID(),revision:0,task:{...task,...change}}),/BOARD_(ASSIGNEE|AGENT)_UNAVAILABLE/);
  }
});

test('dependency graph prevents missing links, indirect cycles, premature starts and reopening completed prerequisites',async()=>{
  const table=fixture(),a=randomUUID(),b=randomUUID(),c=randomUUID(),base={...taskDefaults(),title:'Dependency'};
  await writeLocalTask(table,'one',{id:a,revision:0,task:base});
  await writeLocalTask(table,'one',{id:b,revision:0,task:{...base,predecessorIds:[a]}});
  assert.equal((await writeLocalTask(table,'one',{id:c,revision:0,task:{...base,predecessorIds:[b]}})).blocked,true);
  await assert.rejects(writeLocalTask(table,'one',{id:a,revision:1,task:{...base,predecessorIds:[c]}}),/BOARD_DEPENDENCY_CYCLE/);
  await assert.rejects(writeLocalTask(table,'one',{id:randomUUID(),revision:0,task:{...base,predecessorIds:[randomUUID()]}}),/BOARD_PREDECESSOR_NOT_FOUND/);
  await assert.rejects(writeLocalTask(table,'one',{id:b,revision:1,status:'doing'}),/BOARD_TASK_BLOCKED/);
  await writeLocalTask(table,'one',{id:a,revision:1,status:'done'});
  assert.equal(projectTask(localCards(table,'one').get(b)!,localCards(table,'one')).blocked,false);
  await writeLocalTask(table,'one',{id:b,revision:1,status:'doing'});
  await assert.rejects(writeLocalTask(table,'one',{id:a,revision:2,status:'todo'}),/BOARD_DEPENDENT_STARTED/);
  await writeLocalTask(table,'one',{id:b,revision:2,status:'done'});
  assert.equal(projectTask(localCards(table,'one').get(c)!,localCards(table,'one')).blocked,false);
});
