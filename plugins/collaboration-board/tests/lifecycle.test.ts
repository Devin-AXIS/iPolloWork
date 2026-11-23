import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {taskDefaults} from '../src/model.ts';
import {actLocalTask,listLocalTasks,writeLocalTask,type StoredTask} from '../src/tasks.ts';
import {refreshPersonalReminders,type PersonalReminder} from '../src/reminders.ts';

test('local global search and totals cover tasks beyond the first page, and lifecycle preserves recoverable records',async()=>{
  const rows=new Map<string,StoredTask>(),table={get:(id:string)=>rows.get(id),entries:()=>rows.entries(),put:async(id:string,row:StoredTask)=>{rows.set(id,structuredClone(row));}};
  for(let i=0;i<105;i++)await writeLocalTask(table,'one',{id:randomUUID(),revision:0,task:{...taskDefaults(),title:i===104?'Hidden needle':'Task '+i,status:i%2?'done':'todo'}});
  assert.equal(listLocalTasks(table,'one',{scope:'active',query:''}).tasks.length,100);
  assert.deepEqual(listLocalTasks(table,'one',{scope:'active',query:''}).totals,{total:105,done:52});
  const found=listLocalTasks(table,'one',{scope:'active',query:'needle'});assert.equal(found.tasks.length,1);
  const id=found.tasks[0]!.id;
  await actLocalTask(table,'one',{id,revision:1,action:'archive'});
  assert.equal(listLocalTasks(table,'one',{scope:'active',query:'needle'}).totals!.total,0);
  assert.equal(listLocalTasks(table,'one',{scope:'archived',query:'needle'}).totals!.total,1);
  await actLocalTask(table,'one',{id,revision:2,action:'delete'});
  assert.equal(listLocalTasks(table,'one',{scope:'trash',query:'needle'}).tasks.length,1);
  await assert.rejects(writeLocalTask(table,'one',{id,revision:3,status:'done'}),/BOARD_TASK_NOT_FOUND/);
  await assert.rejects(actLocalTask(table,'two',{id,revision:3,action:'restore'}),/BOARD_TASK_NOT_FOUND/);
  await actLocalTask(table,'one',{id,revision:3,action:'restore'});
  await actLocalTask(table,'one',{id,revision:4,action:'unarchive'});
  assert.equal(listLocalTasks(table,'one',{scope:'active',query:'needle'}).tasks[0]!.title,'Hidden needle');
  await assert.rejects(actLocalTask(table,'one',{id,revision:1,action:'delete'}),/BOARD_CONFLICT/);
});

test('deleting prerequisites is blocked; restoring a dependent needs its prerequisite and resets invalid progress',async()=>{
  const rows=new Map<string,StoredTask>(),table={get:(id:string)=>rows.get(id),entries:()=>rows.entries(),put:async(id:string,row:StoredTask)=>{rows.set(id,structuredClone(row));}};
  const a=randomUUID(),b=randomUUID(),base={...taskDefaults(),title:'Dependency'};
  await writeLocalTask(table,'one',{id:a,revision:0,task:{...base,status:'done'}});
  await writeLocalTask(table,'one',{id:b,revision:0,task:{...base,predecessorIds:[a],status:'doing'}});
  await assert.rejects(actLocalTask(table,'one',{id:a,revision:1,action:'delete'}),/BOARD_DEPENDENCY_IN_USE/);
  await actLocalTask(table,'one',{id:b,revision:1,action:'delete'});
  await actLocalTask(table,'one',{id:a,revision:1,action:'delete'});
  await assert.rejects(actLocalTask(table,'one',{id:b,revision:2,action:'restore'}),/BOARD_PREDECESSOR_NOT_FOUND/);
  await actLocalTask(table,'one',{id:a,revision:2,action:'restore'});
  await writeLocalTask(table,'one',{id:a,revision:3,status:'todo'});
  assert.equal((await actLocalTask(table,'one',{id:b,revision:2,action:'restore'})).status,'todo');
});

test('personal deadline notices survive read state, deduplicate, and hide inactive or rescheduled tasks',async()=>{
  const rows=new Map<string,StoredTask>(),table={get:(id:string)=>rows.get(id),entries:()=>rows.entries(),put:async(id:string,row:StoredTask)=>{rows.set(id,structuredClone(row));}};
  const notices=new Map<string,PersonalReminder>(),reminders={get:(id:string)=>notices.get(id),entries:()=>notices.entries(),put:async(id:string,value:PersonalReminder)=>{notices.set(id,value);}};
  const id=randomUUID(),base={...taskDefaults(),title:'Due',dueAt:100};
  await writeLocalTask(table,'one',{id,revision:0,task:base});
  const workspaces=new Map([['one','Personal project']]);
  assert.equal((await refreshPersonalReminders(reminders,table,workspaces,99)).length,0);
  const first=(await refreshPersonalReminders(reminders,table,workspaces,100))[0]!;
  assert.equal(first.kind,'due');assert.equal(first.read,false);
  await reminders.put(first.id,{...reminders.get(first.id)!,read:true});
  assert.equal((await refreshPersonalReminders(reminders,table,workspaces,200))[0]!.read,true);assert.equal(notices.size,1);
  await actLocalTask(table,'one',{id,revision:1,action:'archive'});
  assert.equal((await refreshPersonalReminders(reminders,table,workspaces,200)).length,0);
  await actLocalTask(table,'one',{id,revision:2,action:'unarchive'});
  await writeLocalTask(table,'one',{id,revision:3,task:{...base,dueAt:300}});
  assert.equal((await refreshPersonalReminders(reminders,table,workspaces,299)).length,0);
  assert.equal((await refreshPersonalReminders(reminders,table,workspaces,300))[0]!.read,false);
  await writeLocalTask(table,'one',{id,revision:4,status:'done'});
  assert.equal((await refreshPersonalReminders(reminders,table,workspaces,400)).length,0);
});
