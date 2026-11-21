/** The analytics query owns its data and does not display a different period while loading. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);

test('analytics replaces stale data, retries errors and hides administrator data from members', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const globals = {window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true};
  const saved = Object.fromEntries(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const bundle = await build({ nodePaths: ['node_modules'],entryPoints:['src/client/enterprise-analytics.tsx'],bundle:true,platform:'node',format:'cjs',write:false,outfile:'/tmp/analytics-ui.cjs',loader:{'.css':'empty','.module.css':'empty'},external:['react','react-dom','react/jsx-runtime','@deepseek-ai/dsh-client-ui-primitives']});
  const module = {exports:{}};
  runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,Intl,Date,require:name=>name==='@deepseek-ai/dsh-client-ui-primitives'?{IconRefreshOutlineRegular:()=>null,Button:({children,variant,size,...props})=>React.createElement('button',props,children)}:require(name)});
  const labels = new Proxy({}, {get:(_target,key)=>String(key)});
  let finish;
  const requests = [];
  const call = (_path, input) => { requests.push(input); return new Promise((resolve,reject)=>{finish={resolve,reject};}); };
  const fixture = {page:1,pageSize:25,totalRows:1,projects:2,skills:3,plugins:4,skillInvocations:5,pluginInvocations:6,activityPage:1,activityTotalRows:0,activityRows:[],totals:{tasks:77,measured:0,inputTokens:0,outputTokens:0},rows:[{id:'d',name:'Department',tasks:77,succeeded:76,failed:1,measured:0,inputTokens:0,outputTokens:0,points:0}]};
  let root;
  Object.assign(globalThis,globals);
  try {
    root=createRoot(dom.window.document.getElementById('root'));
    const props={enterpriseId:'e',canManage:true,call,revision:0,t:labels,language:'en'};
    await act(async()=>root.render(React.createElement(module.exports.AnalyticsTab,props)));
    await act(async()=>finish.resolve(fixture));
    assert.match(dom.window.document.body.textContent,/77/);
    assert.match(dom.window.document.body.textContent,/analyticsUnavailable/);
    await act(async()=>{ const select=dom.window.document.querySelector('select'); select.value='7'; select.dispatchEvent(new dom.window.Event('change',{bubbles:true})); });
    assert.equal(requests.at(-1).days,7);
    assert(!dom.window.document.body.textContent.includes('77'));
    await act(async()=>finish.reject(new Error('Failed')));
    assert.match(dom.window.document.querySelector('[role="alert"]').textContent, /accountUnavailable \(IPW_ACCOUNT_UNAVAILABLE\)/);
    await act(async()=>dom.window.document.querySelector('button').click());
    await act(async()=>finish.resolve(fixture));
    assert.match(dom.window.document.body.textContent,/77/);
    await act(async()=>root.render(React.createElement(module.exports.AnalyticsTab,{...props,canManage:false})));
    assert.match(dom.window.document.body.textContent,/analyticsManager/);
    assert(!dom.window.document.querySelector('table'));
  } finally { if(root)await act(async()=>root.unmount()); dom.window.close(); for(const [key,descriptor] of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];} }
});
