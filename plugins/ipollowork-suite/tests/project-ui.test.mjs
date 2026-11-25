import { Button, Input } from './native-form-primitives.mjs';
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
const require = createRequire(import.meta.url)

async function fixture(entry) {
  const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost',pretendToBeVisual:true})
  const globals = {window:dom.window,document:dom.window.document,Node:dom.window.Node,IS_REACT_ACT_ENVIRONMENT:true}
  const saved = Object.fromEntries(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]))
  Object.assign(globalThis,globals)
  const primitives = new Proxy({Button, Input,
    Modal:({title,children})=>React.createElement('div',{role:'dialog'},title,children),
    SegmentedTabs:({items,onChange})=>React.createElement('div',{},items.map(item=>React.createElement('button',{key:item.value,onClick:()=>onChange(item.value)},item.label))),
  },{get:(target,key)=>target[key] ?? (({children})=>React.createElement('span',{},children))})
  const bundle = await build({ nodePaths: ['node_modules'],entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,
    loader:{'.css':'empty','.module.css':'text'},external:['react','react-dom','react/jsx-runtime','@deepseek-ai/dsh-client-ui-primitives']})
  const module = {exports:{}}
  runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:name=>name==='@deepseek-ai/dsh-client-ui-primitives'?primitives:require(name),
    ...globals,location:dom.window.location,Error,URL,TextEncoder,crypto,DataTransfer:class { items={add:file=>this.files.push(file)};files=[] }})
  const root = createRoot(dom.window.document.getElementById('root'))
  return {dom,root,component:module.exports,button:text=>[...dom.window.document.querySelectorAll('button')].find(node=>node.textContent===text),
    async close(){await act(async()=>root.unmount());dom.window.close();for(const [key,value] of Object.entries(saved)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]}}}
}

test('organization downloads request a save location and display the completed path', async () => {
  const ui = await fixture('src/client/organization-file-packages.tsx')
  const requests = []
  const notifications = []
  let finish
  const bridge = {
    organizationPackageSaveAs: true,
    fileActions: { save: request => { requests.push(request); return new Promise(resolve => { finish = resolve }) } },
  }
  ui.dom.window.dshDesktop = bridge
  const call = async path => path.endsWith('/assets')
    ? { packages: [{ id: 'package', title: 'Organization package' }] }
    : { files: [{ id: 'file', name: '原始文件.txt' }] }
  const props = {
    enterpriseId: 'org', detail: { canManage: false }, revision: 0, language: 'en', t: { packagesTab: 'Packages' },
    call, controller: { notify: text => notifications.push(text) },
  }
  const status = () => ui.dom.window.document.querySelector('[role="status"]')
  try {
    await act(async () => ui.root.render(React.createElement(ui.component.OrganizationFilePackages, props)))
    await act(async () => ui.button('Organization package').click())
    await act(async () => ui.button('Download').click())
    assert.equal(requests[0].mode, 'saveAs')
    assert.equal(new URL(requests[0].url).pathname, '/ipollowork-suite/enterprise/organizations/org/packages/package/files/file/download')
    assert.equal(requests[0].name, '原始文件.txt')
    assert.equal(ui.button('Downloading…').disabled, true)
    assert.equal(status(), null)
    await act(async () => finish({ status: 'cancelled' }))
    assert.deepEqual(notifications, [])
    assert.equal(status(), null)

    await act(async () => ui.button('Download').click())
    const saved = 'D:\\项目资料\\交付.txt'
    await act(async () => finish({ status: 'saved', path: saved }))
    assert.equal(status().textContent, 'Saved to ' + saved)
    assert.deepEqual(notifications, ['File downloaded'])

    delete bridge.organizationPackageSaveAs
    await act(async () => ui.root.render(React.createElement(ui.component.OrganizationFilePackages, { ...props, revision: 1 })))
    await act(async () => ui.button('Download').click())
    assert.equal(requests.at(-1).mode, 'download')
    await act(async () => finish({ status: 'cancelled' }))
  } finally { await ui.close() }
})

test('project refresh updates overview and files, and access edits contain only named members',async()=>{
  const ui = await fixture('src/client/collaboration.tsx'), calls=[],writes=[]
  let outputs=1,interval
  ui.dom.window.setInterval = callback=>{interval=callback;return 1}
  ui.dom.window.clearInterval=()=>{}
  const space={project:{id:'project',enterpriseId:'team',title:'Team project',role:'maintain',accessMode:'enterprise'},memory:{text:'',version:1},fileVersion:0,files:[],changes:[]}
  const call=async(path,data,method)=>{
    calls.push(path)
    if(method==='PATCH'){writes.push(data);return {ok:true}}
    if(path.endsWith('/space'))return space
    if(path.endsWith('/overview'))return {people:[{id:'me',name:'Tester',outputs,contributions:0,updated_at:0}],memoryVersion:1,outputs:{count:outputs}}
    if(path==='/organizations/team/member-directory')return {items:[{userId:'member',name:'Member',email:'member@example.test',
      departmentId:'eng',role:'member',projectRole:'participate'}],more:false}
    if(path.endsWith('/artifacts'))return {items:[],policy:{outputs:true}}
    if(path.endsWith('/storage'))return {used:0,limit:100000}
    return {items:[]}
  }
  const t=new Proxy({loading:'Loading',refresh:'Refresh',back:'Back',close:'Close',createJoinCode:'Generate invitation'}, {get:(target,key)=>target[key] ?? String(key)})
  const view={language:'en',revision:0,t,call,controller:{load:async()=>{},back:()=>{},notify:()=>{}},catalog:{sharedProjects:[],projects:[]},actions:{openProject:()=>{}}}
  try {
    await act(async()=>ui.root.render(React.createElement(ui.component.ProjectView,{id:'project',view})))
    assert.match(ui.dom.window.document.body.textContent,/Outputs 1/)
    outputs=3
    await act(async()=>ui.button('Refresh').click())
    assert.match(ui.dom.window.document.body.textContent,/Outputs 3/)
    outputs=4
    await act(async()=>interval())
    assert.match(ui.dom.window.document.body.textContent,/Outputs 4/)
    await act(async()=>ui.button('Files').click())
    const before=calls.filter(path=>path.endsWith('/artifacts')).length
    await act(async()=>interval())
    assert.equal(calls.filter(path=>path.endsWith('/artifacts')).length,before+1)
    await act(async()=>ui.button('Access').click())
    const dialog=ui.dom.window.document.querySelector('[role="dialog"]')
    assert(!dialog.textContent.includes('Generate invitation'))
    assert(!dialog.textContent.includes('Engineering'))
    assert.equal(dialog.querySelectorAll('select').length,1)
    assert.equal(dialog.querySelector('select').value,'participate')
    assert.equal(ui.button('Save').disabled,true)
    await act(async()=>{
      const picker=dialog.querySelector('select')
      picker.value='maintain'
      picker.dispatchEvent(new ui.dom.window.Event('change',{bubbles:true}))
    })
    await act(async()=>ui.button('Save').click())
    assert.deepEqual(JSON.parse(JSON.stringify(writes)),[[{subjectId:'member',role:'maintain'}]])
  } finally {await ui.close()}
})

test('file picker supports cancel, removal, required feedback, disabled selection and controlled reset',async()=>{
  const ui=await fixture('src/client/file-picker.tsx'),selected=[]
  let disabled=false,files
  const render=()=>React.createElement('form',{},React.createElement(ui.component.FilePicker,{label:'Upload',language:'en',required:true,multiple:true,disabled,files,onSelect:next=>selected.push(next)}))
  try {
    await act(async()=>ui.root.render(render()))
    const input=ui.dom.window.document.querySelector('input')
    const list=[]
    Object.defineProperty(input,'files',{configurable:true,get:()=>list,set:next=>list.splice(0,list.length,...next)})
    await act(async()=>input.dispatchEvent(new ui.dom.window.Event('invalid',{cancelable:true})))
    assert.match(ui.dom.window.document.body.textContent,/Choose a file to continue/)
    assert.equal(ui.dom.window.document.activeElement,ui.button('Choose files'))
    list.push(new ui.dom.window.File(['content'],'long project name with spaces.md'))
    await act(async()=>input.dispatchEvent(new ui.dom.window.Event('change',{bubbles:true})))
    assert.match(ui.dom.window.document.body.textContent,/long project name with spaces.md/)
    assert.equal(selected.length,1)
    await act(async()=>input.dispatchEvent(new ui.dom.window.Event('change',{bubbles:true})))
    assert.equal(selected.length,2)
    list.splice(0)
    await act(async()=>input.dispatchEvent(new ui.dom.window.Event('change',{bubbles:true})))
    assert.equal(selected.length,2) // Cancelling the picker leaves the displayed selection intact.
    await act(async()=>ui.button('Remove').click())
    assert.equal(selected.at(-1).length,0)
    const dropped = [new ui.dom.window.File(['a'],'one.md'), new ui.dom.window.File(['b'],'two.md')]
    const drop = () => {
      const event = new ui.dom.window.Event('drop',{bubbles:true,cancelable:true})
      Object.defineProperty(event,'dataTransfer',{value:{files:dropped}})
      input.parentElement.dispatchEvent(event)
    }
    await act(async()=>drop())
    assert.deepEqual(Array.from(selected.at(-1),file=>file.name),['one.md','two.md'])
    assert.equal(input.files.length,2)
    disabled=true
    await act(async()=>ui.root.render(render()))
    assert.equal(ui.button('Choose again').disabled,true)
    const before=selected.length
    await act(async()=>drop())
    assert.equal(selected.length,before)
    disabled=false;files=[]
    await act(async()=>ui.root.render(render()))
    assert(!ui.dom.window.document.body.textContent.includes('long project name'))
  }finally{await ui.close()}
})

test('switching record paths never renders the previous resource while the new request is pending', async () => {
  const ui = await fixture('src/client/enterprise-ui.tsx');
  let resolveMcp;
  const call = path => path === '/skill' ? Promise.resolve('Previous Skill') : new Promise(resolve => { resolveMcp = resolve });
  function Record({path}) {
    const {data} = ui.component.useRecord(path, call, 0);
    return React.createElement('p', null, data ?? 'Loading');
  }
  try {
    await act(async()=>ui.root.render(React.createElement(Record,{path:'/skill'})));
    assert.match(ui.dom.window.document.body.textContent,/Previous Skill/);
    await act(async()=>ui.root.render(React.createElement(Record,{path:'/mcp'})));
    assert.equal(ui.dom.window.document.body.textContent,'Loading');
    await act(async()=>resolveMcp('Current MCP'));
    assert.equal(ui.dom.window.document.body.textContent,'Current MCP');
  } finally { await ui.close(); }
});
