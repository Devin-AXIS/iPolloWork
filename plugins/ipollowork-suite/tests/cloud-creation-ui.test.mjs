import { Button, Input } from './native-form-primitives.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import React,{act} from 'react';
import { JSDOM } from 'jsdom';
const require=createRequire(import.meta.url);

test('cloud mode appears only while available and does not invoke local directory creation',async()=>{
 const bundle=await build({ nodePaths: ['node_modules'],entryPoints:['src/client/project-creation.tsx'],bundle:true,platform:'node',format:'cjs',write:false,loader:{'.css':'empty','.module.css':'empty'},external:['react','react-dom','react/jsx-runtime','@deepseek-ai/dsh-client-ui-primitives']});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};
 Object.defineProperties(globalThis,{window:{value:dom.window,configurable:true},document:{value:dom.window.document,configurable:true},navigator:{value:dom.window.navigator,configurable:true},IS_REACT_ACT_ENVIRONMENT:{value:true,configurable:true}});
 let enabled=true,localCreates=0;
 const module={exports:{}};
 runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,window:dom.window,crypto,AbortController,URL,fetch:async()=>({ok:true,json:async()=>({enabled})}),require:name=>name==='@deepseek-ai/dsh-client-ui-primitives'?{Button,Input,Modal:({children})=>React.createElement('div',{role:'dialog'},children)}:require(name)});
 const labels=new Proxy({title:'组织空间',personal:'个人'},{get:(value,key)=>Reflect.get(value,key)??key});
 const props={open:true,useEnterpriseLabels:select=>select(labels),useEnterpriseState:select=>select({signedIn:true,loading:false,error:'',catalog:{enterprises:[]}}),refreshEnterprises:async()=>{},createProject:async()=>{localCreates++;},onCancel:()=>{}};
 const {createRoot}=await import('react-dom/client');
 const root=createRoot(dom.window.document.getElementById('root'));
 try{
  await act(async()=>{root.render(React.createElement(module.exports.ProjectCreationDialog,props));await new Promise(resolve=>setTimeout(resolve,0));});
  let mode=[...dom.window.document.querySelectorAll('select')].find(select=>[...select.options].some(option=>option.value==='cloud'));
  assert(mode);
  await act(async()=>{mode.value='cloud';mode.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert(dom.window.document.body.textContent.includes('项目名称'));
  assert(!dom.window.document.body.textContent.includes('projectDirectory'));
  assert.equal(localCreates,0);
  enabled=false;
  await act(async()=>{dom.window.dispatchEvent(new dom.window.Event('focus'));await new Promise(resolve=>setTimeout(resolve,0));});
  assert(![...dom.window.document.querySelectorAll('option')].some(option=>option.value==='cloud'));
  assert(dom.window.document.body.textContent.includes('projectDirectory'));
 }finally{await act(async()=>root.unmount());dom.window.close();for(const[key,value]of Object.entries(old))Object.defineProperty(globalThis,key,{value,configurable:true});}
});
