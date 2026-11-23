import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:['../collaboration-board/src/host.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['@deepseek-ai/dsh-tools']});

async function fixture({schedule=false}={}) {
  const tables=new Map(),disposals=[];
  let route,tool,readOnly=false,scheduled,creates=0,now=Date.now(),maintenance;
  const session={id:'session-one',header:{cwd:'C:/qa'}};
  const root={session},child={session:{id:'session-child',header:session.header}};
  const services={
    tools:{register:value=>{tool=value;return ()=>{};},executable:()=>false},
    sandboxPolicy:{resolve:()=>({mode:readOnly?'read-only':'workspace-write'})},
    subagents:{rootOf:agent=>agent===child?root:agent,getProvider:()=>undefined},
    ...(schedule?{schedule:{
      create:async input=>{creates++;scheduled={...input,id:'native-one',status:'active',scheduledAt:input.timing.at??new Date(now+input.timing.after_seconds*1000).toISOString(),updatedAt:new Date().toISOString()};return scheduled;},
      view:async()=>scheduled??{code:'schedule_not_found'},edit:async()=>{scheduled=undefined;return {};},
    }}:{}),
  };
  const effect=install=>{const dispose=install();if(dispose)disposals.push(dispose);};
  const ctx={...services,effect,inject:(names,install)=>{if(names.every(name=>name in services))install(ctx);},
    storageDomain:{open:async spec=>({table:name=>{
      const key=spec.name+'/'+name;
      if(!tables.has(key))tables.set(key,new Map());const rows=tables.get(key);
      return {get:key=>rows.get(key),put:async(key,value)=>{rows.set(key,structuredClone(value));},delete:async key=>{rows.delete(key);},entries:()=>rows.entries()};
    },close:async()=>{}})},
    workspaceRegistry:{get:id=>id==='one'?{sessionIds:['session-one']}:id==='two'?{sessionIds:[]}:undefined,
      list:()=>[{id:'one',path:'C:/qa',sessionIds:['session-one']}],archivedSessionIds:[]},
    connection:{admit:req=>req.headers.authorization==='bad'?{rejection:401}:{peer:{principal:{kind:req.headers.authorization==='viewer'?'viewer':'owner'}}}},
    webServer:{register:value=>{route=value;return ()=>{};}},
  };
  const module={exports:{}};
  runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:name=>name==='@deepseek-ai/dsh-tools'?{defineTool:input=>input}:require(name),
    URL,Buffer,Date:class extends Date {static now(){return now;}},AbortController,AbortSignal,
    setInterval:callback=>{maintenance=callback;return {unref(){}}},clearInterval(){}});
  await module.exports.apply(ctx);
  async function request(query,body,headers={}) {
    const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);
    req.url='/ipollo-project-board?'+query;req.headers={'content-type':'application/json',...headers};req.method=body===undefined?'GET':'PATCH';
    let status,data;
    await route.handler(req,{headersSent:false,writeHead:code=>{status=code;},end:value=>{data=JSON.parse(value);}});
    return {status,data};
  }
  const draft=(changes={})=>({title:'QA',description:'Actual host handler',status:'todo',priority:'normal',startAt:null,dueAt:null,
    assigneeId:null,assigneeAgent:null,participantIds:[],participantAgents:[],predecessorIds:[],sessionId:null,...changes});
  const write=(task=draft(),id=randomUUID(),revision=0)=>request('workspace=one&resource=tasks&session=session-one',{id,revision,task});
  const execute=(args,agent=root)=>tool.execute(args,{agent,signal:new AbortController().signal});
  return {request,write,draft,execute,child,root,tables,scheduled:()=>scheduled,creates:()=>creates,setReadOnly:()=>{readOnly=true;},
    advance:ms=>{now+=ms;},
    tick:()=>maintenance(),
    close:async()=>{for(const dispose of disposals.reverse())await dispose();}};
}

test('native board routes enforce admission, workspace/session isolation, schemas and concurrent revisions',async()=>{
  const f=await fixture();
  try {
    for(const [headers,status] of [[{authorization:'bad'},401],[{authorization:'viewer'},403],[{'sec-fetch-site':'cross-site'},403]])
      assert.equal((await f.request('workspace=one&resource=tasks',undefined,headers)).status,status);
    assert.equal((await f.request('workspace=missing&resource=tasks')).status,404);
    assert.equal((await f.write(f.draft({sessionId:'session-other'}))).status,404);
    assert.equal((await f.write(f.draft({startAt:200,dueAt:100}))).status,400);
    assert.equal((await f.write(f.draft({title:' '}))).status,400);
    const saved=await f.write();assert.equal(saved.status,200);const task=saved.data.task;
    const responses=await Promise.all(['doing','review'].map(status=>f.request('workspace=one&resource=tasks',{id:task.id,revision:1,status})));
    assert.deepEqual(responses.map(result=>result.status).sort(),[200,409]);
    assert.equal((await f.request('workspace=two&resource=tasks&task='+task.id)).status,404);
    assert.equal((await f.request('workspace=one&resource=tasks')).data.tasks.length,1);
  } finally {await f.close();}
});

test('AI task tool reads from child conversations and permits writes only from an authorized root',async()=>{
  const f=await fixture();
  try {
    const task=(await f.write()).data.task;
    assert.equal((await f.execute({action:'get',taskId:task.id},f.child)).task.title,'QA');
    await assert.rejects(f.execute({action:'start',taskId:task.id,revision:1},f.child),/BOARD_WRITE_FORBIDDEN/);
    assert.equal((await f.execute({action:'start',taskId:task.id,revision:1})).task.status,'doing');
    await assert.rejects(f.execute({action:'complete',taskId:task.id,revision:1}),/BOARD_CONFLICT/);
    f.setReadOnly();await assert.rejects(f.execute({action:'complete',taskId:task.id,revision:2}),/BOARD_WRITE_FORBIDDEN/);
    assert.equal((await f.execute({action:'get',taskId:task.id})).task.status,'doing');
  } finally {await f.close();}
});

test('automatic AI starts reject early, blocked and replayed deliveries and claim task status before execution',async()=>{
  const f=await fixture({schedule:true});
  try {
    const predecessor=(await f.write()).data.task;
    const input=f.draft({startAt:Date.now()+60_000,assigneeAgent:{id:'current',name:'AI',ownerId:null},predecessorIds:[predecessor.id]});
    const saved=await f.write(input),task=saved.data.task;
    assert.equal(saved.data.scheduled,true);
    const links=f.tables.get('ipollo_project_board_schedule/starts'),link=links.get('one/'+task.id);
    const args={action:'scheduled_start',taskId:task.id,token:link.token};
    assert.equal((await f.execute({...args,token:randomUUID()})).started,false);
    assert.equal((await f.execute(args)).started,false);
    f.advance(120_000);
    assert.equal((await f.execute(args)).reason,'waiting_for_predecessors');
    await f.execute({action:'complete',taskId:predecessor.id,revision:1});
    const started=await f.execute(args);assert.equal(started.started,true);assert.equal(started.task.status,'doing');
    assert.equal((await f.execute(args)).started,false);
    assert.equal((await f.execute({action:'complete',taskId:task.id,revision:started.task.revision})).task.status,'done');
  } finally {await f.close();}
});

test('missing schedule service reports partial failure while preserving the saved task',async()=>{
  const f=await fixture();
  try {
    const saved=await f.write(f.draft({startAt:Date.now()+60_000,assigneeAgent:{id:'current',name:'AI',ownerId:null}}));
    assert.equal(saved.status,200);assert.equal(saved.data.scheduleFailed,true);
    assert.equal((await f.request('workspace=one&resource=tasks&task='+saved.data.task.id)).data.task.title,'QA');
  } finally {await f.close();}
});

test('a delivered blocked start resumes once predecessors finish, preserves pauses, and does not replay a queued prompt',async()=>{
  const f=await fixture({schedule:true});
  try{
    const predecessor=(await f.write()).data.task;
    const task=(await f.write(f.draft({startAt:Date.now()+60_000,assigneeAgent:{id:'current',name:'AI',ownerId:null},predecessorIds:[predecessor.id]}))).data.task;
    const links=f.tables.get('ipollo_project_board_schedule/starts');
    const first=links.get('one/'+task.id);
    f.advance(120_000);f.scheduled().status='ended';
    await f.tick();assert.equal(f.creates(),1); // Delivered/queued alone is not permission to rearm.
    assert.equal((await f.execute({action:'scheduled_start',taskId:task.id,token:first.token})).reason,'waiting_for_predecessors');
    await f.execute({action:'complete',taskId:predecessor.id,revision:1});
    f.scheduled().status='paused';await f.tick();assert.equal(f.creates(),1);
    f.scheduled().status='ended';await f.tick();assert.equal(f.creates(),2);
    const resumed=links.get('one/'+task.id);assert.notEqual(resumed.token,first.token);
    await f.tick();assert.equal(f.creates(),2);
    f.advance(2000);
    assert.equal((await f.execute({action:'scheduled_start',taskId:task.id,token:first.token})).started,false);
    assert.equal((await f.execute({action:'scheduled_start',taskId:task.id,token:resumed.token})).started,true);
    assert.equal((await f.execute({action:'scheduled_start',taskId:task.id,token:resumed.token})).started,false);
  }finally{await f.close();}
});

test('personal due reminders use the unified inbox with durable read state and authorized detail actions',async()=>{
  const f=await fixture();
  try{
    const task=(await f.write(f.draft({dueAt:Date.now()-1000}))).data.task;
    await f.tick();
    const inbox=await f.request('resource=inbox');assert.equal(inbox.status,200);
    const notice=inbox.data.notices[0];assert.equal(notice.kind,'due');assert.equal(notice.taskId,task.id);
    await f.tick();assert.equal((await f.request('resource=inbox')).data.notices.length,1);
    await f.request('resource=inbox&notice='+notice.id,{});
    assert.equal((await f.request('resource=inbox')).data.notices[0].read,true);
    assert.equal((await f.request('resource=inbox&notice='+notice.id)).data.task.editable,true);
    assert.equal((await f.request('resource=inbox&notice='+notice.id+'&action=status',{revision:1,status:'done'})).status,200);
    assert.equal((await f.request('resource=inbox')).data.notices.length,0);
  }finally{await f.close();}
});
