import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);

test('MCP actions follow ownership, require delete confirmation, and preserve conflict feedback after refreshing', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const globals = { window:dom.window, document:dom.window.document, IS_REACT_ACT_ENVIRONMENT:true };
  const saved = Object.fromEntries(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const bundle = await build({ entryPoints:['src/client/mcp-connections.tsx'], bundle:true,platform:'node',format:'cjs',write:false,
    outfile:'/tmp/mcp-ui.cjs',loader:{'.css':'empty'},external:['react','react-dom','react/jsx-runtime','@deepseek-ai/dsh-client-ui-primitives'] });
  const module = { exports:{} };
  const primitives = {
    IconEllipsisOutlineRegular:()=>null,
    Button:({children,variant,...props})=>React.createElement('button',props,children),
    Menu:({anchor,open,items,onSelect})=>React.createElement(React.Fragment,null,anchor,open&&items.map(item=>React.createElement('button',{key:item.id,onClick:()=>onSelect(item.id)},item.label))),
    Modal:({title,description,children,footer})=>React.createElement('div',{role:'dialog'},title,description,children,footer),
  };
  runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,Error,AbortController,AbortSignal,encodeURIComponent,setInterval,clearInterval,
    require:name=>name==='@deepseek-ai/dsh-client-ui-primitives'?primitives:require(name)});
  let items=[{id:'native-user',title:'User MCP',source:'configuration',state:'connected',serverName:'user',canDisconnect:true,canReconnect:true,canDelete:true,canEdit:true,revision:2},
    {id:'org',title:'Team MCP',source:'organization',state:'connected',serverName:'team',canDisconnect:true,canReconnect:true,canDelete:false,canEdit:false,revision:0}];
  const writes=[]; let conflict=false,edited=0;
  const call=async(path,options={})=>{
    if(!options.method)return{items};
    writes.push({path,input:JSON.parse(options.body)});
    if(conflict)throw new Error('IPW_MCP_SETTINGS_CONFLICT');
    if(path.endsWith('/delete'))items=items.filter(item=>item.id!=='native-user');
    return{ok:true};
  };
  Object.assign(globalThis,globals); let root;
  const click=async text=>act(async()=>{
    const button=[...dom.window.document.querySelectorAll('button')].find(node=>node.textContent===text||node.getAttribute('aria-label')===text);
    assert.ok(button,'button exists: '+text);button.click();
  });
  try{
    root=createRoot(dom.window.document.getElementById('root'));
    await act(async()=>root.render(React.createElement(module.exports.McpConnections,{locale:()=> 'zh',useLabels:()=>{},accountChanges:()=>()=>{},editConfiguration:async()=>{edited++;},call})));
    await click('管理 Team MCP');
    assert.ok([...dom.window.document.querySelectorAll('button')].some(node=>node.textContent==='重新连接'), 'older Host DTOs without canReconnect retain their reconnect entry');
    assert.equal([...dom.window.document.querySelectorAll('button')].some(node=>node.textContent==='删除 MCP'),false);
    await click('断开连接');
    assert.equal(writes.at(-1).path,'/mcp-connections/org/disconnect');
    await click('管理 User MCP');await click('编辑配置（原生配置文件）');assert.equal(edited,1);
    await click('管理 User MCP');await click('删除 MCP');
    assert.ok(dom.window.document.querySelector('[role="dialog"]'));
    await click('取消');assert.equal(writes.length,1);
    await click('管理 User MCP');await click('删除 MCP');
    conflict=true;await click('删除');
    assert.equal(dom.window.document.querySelector('[role="dialog"]'),null);
    assert.match(dom.window.document.querySelector('[role="alert"]').textContent,/配置已发生变化/);
    conflict=false;await click('管理 User MCP');await click('删除 MCP');await click('删除');
    assert.equal(dom.window.document.body.textContent.includes('User MCP'),false);
    assert.deepEqual(writes.at(-1).input,{revision:2});
  }finally{
    await act(async()=>root?.unmount());dom.window.close();
    for(const[key,descriptor]of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});
