import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
const require=createRequire(import.meta.url);

// Render the production controller; replace presentation only to inspect its data and actions.
const presentation={
  views:`import React from 'react';
    export function Board({tasks,move,open}) {return <div>{tasks.map(card=><div key={card.id} data-task={card.id} data-status={card.status}><button onClick={()=>open(card)}>{card.title}</button><button onClick={()=>move(card,'done')}>finish</button></div>)}</div>}
    export const TaskList=Board, Calendar=Board, Timeline=Board;`,
  editor:`export const aiInstruction=()=>'';export const TaskEditor=props=>{globalThis.editorActions=props;return null;};`,
  ui:`import React from 'react'; export const viewIcons={board:()=>null,list:()=>null,calendar:()=>null,timeline:()=>null};export const SearchBox=({value,change,label})=><input aria-label={label} value={value} onInput={e=>change(e.currentTarget.value)}/>;`,
  inbox:`export const projectInbox=()=>({});export const InboxBadge=()=>null,InboxPanel=()=>null,noticeMessage=()=>'';`,
};
const bundle=await build({nodePaths:['node_modules'],entryPoints:['../collaboration-board/src/client.tsx'],bundle:true,platform:'node',format:'cjs',write:false,
  loader:{'.css':'empty'},external:['react','react/jsx-runtime','@deepseek-ai/dsh-client-ui-primitives'],
  plugins:[{name:'presentation',setup(build){
    build.onResolve({filter:/^\.\/(views|editor|ui|inbox)\.tsx$/},args=>args.importer.endsWith('collaboration-board/src/client.tsx')||args.importer.endsWith('collaboration-board\\src\\client.tsx')
      ? {path:args.path.slice(2,-4),namespace:'presentation'}:undefined);
    build.onLoad({filter:/.*/,namespace:'presentation'},args=>({contents:presentation[args.path],loader:'jsx',resolveDir:process.cwd()}));
  }}]});
const task=(n,title='Task '+n)=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,revision:1,title,description:'',status:'todo',priority:'normal',
  startAt:null,dueAt:null,assigneeId:null,assigneeAgent:null,participantIds:[],participantAgents:[],predecessorIds:[],sessionId:null,blocked:false});
const response=value=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>value});

async function setup(read) {
  const dom=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true});
  const globals={window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true};
  const saved=Object.fromEntries(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Object.assign(globalThis,globals);
  let poll,prompts=0;
  dom.window.setInterval=(fn,ms)=>{if(ms===15_000)poll=fn;return ms;};
  dom.window.clearInterval=()=>{};
  const requests=[];
  const module={exports:{}};
  const native=new Proxy({}, {get:(_target,name)=>name==='Button'?({children,variant,...props})=>React.createElement('button',props,children):()=>null});
  const environment={module,exports:module.exports,Date,Intl,Error,DOMException,AbortController,AbortSignal,URLSearchParams,
    window:dom.window,document:dom.window.document,
    fetch:async(path,options)=>{
      const url=new URL(path,'http://test');
      if(['tasks','delegate'].includes(url.searchParams.get('resource'))) {requests.push({url,options});return response(await read(url,options));}
      return response(url.searchParams.get('resource')==='agents'?{agents:[]} : url.searchParams.get('resource')==='members'?{roster:null}:{notes:{}});
    },require:name=>name==='@deepseek-ai/dsh-client-ui-primitives'?native:require(name)};
  runInNewContext(bundle.outputFiles[0].text,environment);
  const observable=value=>({getSnapshot:()=>value,subscribe:()=>()=>{}});
  let View;
  module.exports.apply({inject(){},effect(){},slots:{inject:(_name,install)=>install(),register:(options,component)=>{if(options.name==='conversation.view')View=component;return ()=>{};}},
    locale:observable({active:'zh-CN'}),uiWorkspace:{},sessions:{list:observable({phase:'ready',byId:{}}),using:async(_id,_options,operation)=>operation({binding:{session:{prompt:async()=>{prompts++;return {ok:true};}}}})},
    workspaces:{list:observable({phase:'ready',items:[{workspaceId:'workspace',title:'QA',sessionIds:['session-one']}],archivedSessionIds:[]})}});
  const root=createRoot(dom.window.document.getElementById('root'));
  await act(async()=>root.render(React.createElement(View,{sessionId:'session-one',openView(){}})));
  return {dom,requests,poll:()=>act(async()=>poll()),editor:()=>environment.editorActions,prompts:()=>prompts,
    click:label=>act(async()=>{const button=[...dom.window.document.querySelectorAll('button')].find(button=>button.textContent===label);assert(button,label);button.click();}),
    changeAccount:()=>act(async()=>dom.window.dispatchEvent(new dom.window.Event('ipollo-account-identity-changed'))),
    async close(){await act(async()=>root.unmount());dom.window.close();for(const [key,descriptor] of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}};
}

test('board refreshes every loaded page, reflects additions/removals and reports poll failures',async()=>{
  let tasks=Array.from({length:101},(_,i)=>task(i+1)),fail=false;
  const app=await setup(async url=>{
    if(fail)throw new Error('offline');
    const after=url.searchParams.get('after');
    const remaining=tasks.filter(task=>!after||task.id>after);
    return {tasks:remaining.slice(0,100),next:remaining.length>100?remaining[99].id:null,remote:false};
  });
  try {
    assert.equal(app.dom.window.document.querySelectorAll('[data-task]').length,100);
    assert.match(app.dom.window.document.body.textContent,/仅显示已加载/);
    await app.click('加载更多');
    assert.equal(app.dom.window.document.querySelectorAll('[data-task]').length,101);
    tasks=[...tasks.slice(0,-1),{...tasks.at(-1),status:'done',title:'Updated second page'},task(102)];
    await app.poll();
    assert.equal(app.dom.window.document.querySelector(`[data-task="${task(101).id}"]`).dataset.status,'done');
    assert.equal(app.dom.window.document.querySelectorAll('[data-task]').length,102);
    tasks=tasks.slice(0,99);
    await app.poll();
    assert.equal(app.dom.window.document.querySelectorAll('[data-task]').length,99);
    fail=true;
    await app.poll();
    assert(app.dom.window.document.querySelector('[role="alert"]'));
    assert.equal(app.dom.window.document.querySelectorAll('[data-task]').length,99);
    fail=false;await app.poll();
    assert.equal(app.dom.window.document.querySelector('[role="alert"]'),null);
  } finally {await app.close();}
});

test('account changes discard in-flight pagination and writes even when transport ignores abort',async()=>{
  for(const mutation of [false,true]) {
    let account='old',finish;
    const app=await setup((url,options)=>{
      if(url.searchParams.has('after')||options.method==='PATCH')return new Promise(resolve=>{finish=resolve;});
      return {tasks:[task(account==='old'?1:2,account)],next:account==='old'?task(1).id:null,remote:false};
    });
    try {
      await app.click(mutation?'finish':'加载更多');
      const old=app.requests.at(-1);
      account='new';await app.changeAccount();
      assert.equal(old.options.signal.aborted,true);
      await act(async()=>finish(mutation?{task:task(1,'late old write')}:{tasks:[task(3,'late old page')],next:null,remote:false}));
      assert.equal(app.dom.window.document.querySelectorAll('[data-task]').length,1);
      assert.equal(app.dom.window.document.querySelector('[data-task]').dataset.task,task(2).id);
      assert.equal(app.dom.window.document.querySelector('[role="alert"]'),null);
      assert.equal([...app.dom.window.document.querySelectorAll('button')].find(button=>button.textContent==='新增任务').disabled,false);
    } finally {await app.close();}
  }
});

test('saving and refreshing a task preserves its authorized AI handoff until the account changes',async()=>{
  const saved=task(1);
  const app=await setup((url,options)=>url.searchParams.get('resource')==='delegate'
    ? {task:saved,ai:{delegates:[],external:[],unavailable:false,humanLead:false}}
    : options.method==='PATCH'?{task:saved}:{tasks:[saved],next:null,remote:false});
  try {
    await app.click('新增任务');const editor=app.editor();
    await act(async()=>editor.save({id:saved.id,revision:1,status:'doing'}));
    const save=app.requests.find(request=>request.options.method==='PATCH');
    assert.equal(save.options.signal.aborted,false);
    await act(async()=>editor.delegate(saved.id));
    assert.equal(app.prompts(),1);
    await app.changeAccount();assert.equal(save.options.signal.aborted,true);
  } finally {await app.close();}
});

test('global task search and progress use server totals instead of the currently loaded page',async()=>{
  const app=await setup(url=>url.searchParams.get('query')==='needle'
    ? {tasks:[task(105,'needle outside first page')],next:null,remote:false,version:2,totals:{total:1,done:0}}
    : {tasks:Array.from({length:100},(_,i)=>task(i+1)),next:task(100).id,remote:false,version:2,totals:{total:105,done:52}});
  try{
    assert.equal(app.dom.window.document.querySelector('progress').max,105);
    assert.equal(app.dom.window.document.querySelector('progress').value,52);
    await act(async()=>{const input=app.dom.window.document.querySelector('input[aria-label="搜索任务"]');input.value='needle';input.dispatchEvent(new app.dom.window.Event('input',{bubbles:true}));});
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,300));});
    assert.equal(app.requests.at(-1).url.searchParams.get('query'),'needle');
    assert.match(app.dom.window.document.body.textContent,/needle outside first page/);
    assert.equal(app.dom.window.document.querySelector('progress').max,1);
  }finally{await app.close();}
});

test('board offers current and archived tasks with individual archive and unarchive actions',async()=>{
  const tasks=[task(1),{...task(2),archived:true}],writes=[];
  const app=await setup((url,options)=>{
    if(options.method==='PATCH'){
      const input=JSON.parse(options.body);writes.push(input);
      const saved=tasks.find(task=>task.id===input.id);
      saved.archived=input.action==='archive';saved.revision++;
      return {task:saved};
    }
    const scope=url.searchParams.get('scope');const items=tasks.filter(task=>Boolean(task.archived)===(scope==='archived'));
    return {tasks:items,next:null,remote:false,version:2,totals:{total:items.length,done:0}};
  });
  try{
    const {document,Event}=app.dom.window;
    const scope=document.querySelector('select[aria-label="任务范围"]');
    assert.equal(scope.value,'active');
    assert.deepEqual([...scope.options].map(option=>option.textContent),['当前任务','已归档']);
    assert.doesNotMatch(document.body.textContent,/批量操作|回收站/);
    const visibleTasks=()=>[...document.querySelectorAll('[data-task]')].map(card=>card.dataset.task);
    const changeScope=value=>act(async()=>{scope.value=value;scope.dispatchEvent(new Event('change',{bubbles:true}));});
    assert.deepEqual(visibleTasks(),[tasks[0].id]);

    await app.click('Task 1');
    const editor=app.editor();
    await act(async()=>{await editor.setArchived(true);editor.close();});
    assert.deepEqual(visibleTasks(),[]);

    await changeScope('archived');
    assert.deepEqual(visibleTasks(),tasks.map(task=>task.id));
    await app.click('Task 1');
    const archivedEditor=app.editor();
    assert.equal(archivedEditor.writable,false);
    await act(async()=>{await archivedEditor.setArchived(false);archivedEditor.close();});
    assert.deepEqual(visibleTasks(),[tasks[1].id]);
    await changeScope('active');
    assert.deepEqual(visibleTasks(),[tasks[0].id]);
    assert.deepEqual(writes,[
      {id:tasks[0].id,revision:1,action:'archive'},
      {id:tasks[0].id,revision:2,action:'unarchive'},
    ]);
  }finally{await app.close();}
});
