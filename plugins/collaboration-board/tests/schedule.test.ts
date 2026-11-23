import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { ProjectTask } from '../../../services/ipollowork/src/project-board-contract.ts';
import { taskDefaults } from '../src/model.ts';
import { canStartScheduledTask, syncSchedule, type NativeSchedule, type ScheduleTable } from '../src/schedule.ts';

type Link=NonNullable<ReturnType<ScheduleTable['get']>>;
function fixture() {
  const links=new Map<string,Link>();
  const entries=new Map<string,{id:string;prompt:string;status:string;scheduledAt:string;target:{kind:string;sessionId:string};updatedAt:string}>();
  const events:string[]=[];
  let failCreate=false,conflict=false;
  const service={
    async view({id}:{id:string}) {return entries.get(id)??{code:'schedule_not_found'};},
    async edit({id}:{id:string}) {events.push('delete');if(conflict)return {code:'schedule_conflict'};entries.delete(id);return {};},
    async create(input:{prompt:string;timing:{at?:string};target:{kind:string;sessionId:string}}) {
      events.push('create');if(failCreate)throw new Error('offline');
      const id=randomUUID(),entry={id,prompt:input.prompt,status:'active',scheduledAt:input.timing.at??new Date(Date.now()+1000).toISOString(),target:input.target,updatedAt:new Date().toISOString()};
      entries.set(id,entry);return entry;
    },
  } as unknown as NativeSchedule;
  const table:ScheduleTable={get:id=>links.get(id),put:async(id,link)=>{links.set(id,link);},delete:async id=>{links.delete(id);},entries:()=>links.entries()};
  const task:ProjectTask={...taskDefaults(),id:randomUUID(),revision:1,title:'Scheduled',startAt:Date.now()+60_000,
    assigneeAgent:{id:'current',name:'AI',ownerId:null},blocked:false};
  const target={sessionId:'session-one',account:null,startAt:task.startAt!};
  const sync=(value=task,destination:typeof target|undefined=target)=>syncSchedule(table,service,'task',value,destination,new AbortController().signal);
  return {table,entries,events,task,target,sync,service,setFail:(value:boolean)=>{failCreate=value;},setConflict:()=>{conflict=true;}};
}

test('one-shot schedules are idempotent and replace their guard when rescheduled or cancelled',async()=>{
  const f=fixture();
  await f.sync();const first=f.table.get('task')!;
  assert(first.scheduleId);
  assert(f.entries.get(first.scheduleId)!.prompt.includes(first.token));
  await f.sync();assert.deepEqual(f.events,['create']);
  const task={...f.task,startAt:f.task.startAt!+60_000};
  await f.sync(task,{...f.target,startAt:task.startAt});
  assert.deepEqual(f.events,['create','delete','create']);
  assert.notEqual(f.table.get('task')!.token,first.token);
  await syncSchedule(f.table,f.service,'task',task,undefined,new AbortController().signal);
  assert.equal(f.entries.size,0);assert.equal(f.table.get('task'),undefined);
});

test('schedule failures leave a retryable guard and never delete another reminder',async()=>{
  const f=fixture();f.setFail(true);
  await assert.rejects(f.sync(),/offline/);
  assert.equal(f.table.get('task')!.scheduleId,null);
  f.setFail(false);await f.sync();
  const link=f.table.get('task')!,entry=f.entries.get(link.scheduleId!)!;
  entry.prompt='A different owner reminder';
  await syncSchedule(f.table,f.service,'task',f.task,undefined,new AbortController().signal);
  assert.equal(f.entries.size,1);
  assert(!f.events.includes('delete'));
});

test('schedule edits fail visibly on revision conflict and require the native service',async()=>{
  const f=fixture();await f.sync();f.setConflict();
  const link=f.table.get('task');
  await assert.rejects(syncSchedule(f.table,f.service,'task',f.task,undefined,new AbortController().signal),/BOARD_SCHEDULE_CONFLICT/);
  assert.equal(f.table.get('task'),link);
  await assert.rejects(syncSchedule(f.table,undefined,'task',f.task,f.target,new AbortController().signal),/BOARD_SCHEDULE_UNAVAILABLE/);
});

test('automatic starts require a due, unpaused reminder for the exact target and token',async()=>{
  const f=fixture();await f.sync();const link=f.table.get('task')!,entry=f.entries.get(link.scheduleId!)!;
  assert.equal(await canStartScheduledTask(f.service,link),false);
  entry.scheduledAt=new Date(Date.now()-1000).toISOString();
  assert.equal(await canStartScheduledTask(f.service,link),true);
  entry.status='paused';assert.equal(await canStartScheduledTask(f.service,link),false);
  entry.status='active';entry.target.sessionId='session-other';
  assert.equal(await canStartScheduledTask(f.service,link),false);
  entry.target.sessionId=link.sessionId;
  assert.equal(await canStartScheduledTask(f.service,{...link,token:randomUUID()}),false);
  assert.equal(await canStartScheduledTask(undefined,link),false);
});
