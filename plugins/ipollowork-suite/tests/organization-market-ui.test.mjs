import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {runInNewContext} from 'node:vm'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const bundle=await build({nodePaths:['node_modules'],entryPoints:['src/client/market.tsx'],bundle:true,platform:'node',format:'cjs',write:false,
  loader:{'.css':'empty','.module.css':'empty'},external:['react','react/jsx-runtime','@deepseek-ai/dsh-client-ui-primitives']})
const publication={id:'release',title:'Organization release',description:'Shared by the organization',packageName:'@team/plugin',publishedVersion:'1.2.3',canSubmit:false}
const catalog={enterprises:[{id:'one',name:'Team one'},{id:'two',name:'Team two'}]}

async function setup(call) {
  const dom=new JSDOM('<div id="root"></div>')
  const globals={window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true}
  const saved=Object.fromEntries(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]))
  Object.assign(globalThis,globals)
  const module={exports:{}}
  const Button=React.forwardRef(({children,variant,size,...props},ref)=>React.createElement('button',{...props,ref},children))
  const Input=React.forwardRef((props,ref)=>React.createElement('input',{...props,ref}))
  const primitives=new Proxy({Button,Input},{get:(target,name)=>target[name]??(()=>null)})
  runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,window:dom.window,document:dom.window.document,AbortController,AbortSignal,Error,
    require:name=>name==='@deepseek-ai/dsh-client-ui-primitives'?primitives:require(name)})
  const labels=new Proxy({},{get:(_target,key)=>String(key)})
  let snapshot={task:null,revision:0}
  const listeners=new Set(),installs=[]
  const installation={getSnapshot:()=>snapshot,subscribe:listener=>{listeners.add(listener);return ()=>listeners.delete(listener)},
    invalidate:()=>{snapshot={...snapshot,revision:snapshot.revision+1};for(const listener of listeners)listener()},
    startManual:async(...args)=>{installs.push(args)}}
  const root=createRoot(dom.window.document.getElementById('root'))
  await act(async()=>root.render(React.createElement(module.exports.MarketPanel,{organizationCall:call,installation,useLabels:selector=>selector(labels),
    load:async()=>({categories:[],items:[]}),openPackage(){}})))
  const click=text=>act(async()=>{const button=[...dom.window.document.querySelectorAll('button')].find(button=>button.textContent===text);assert(button,text);button.click()})
  await click('enterprise')
  return {dom,installs,click,changeAccount:()=>act(async()=>dom.window.dispatchEvent(new dom.window.Event('ipollo-account-identity-changed'))),
    async close(){await act(async()=>root.unmount());dom.window.close();for(const [key,descriptor] of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}}}
}

test('organization market loads authorized published plugins, switches organizations and reauthorizes the pinned install',async()=>{
  const calls=[];let revoked=false
  const app=await setup(async(path,options)=>{
    calls.push({path,options})
    if(path==='/enterprise')return catalog
    if(path.includes('/versions/')){if(revoked)throw new Error('RESOURCE_FORBIDDEN');return {spec:'@team/plugin@1.2.3'}}
    return {items:path.includes('/one/')?[publication,{...publication,id:'draft',title:'Unpublished draft',publishedVersion:null}]:[{...publication,title:'Second team plugin'}]}
  })
  try {
    assert.match(app.dom.window.document.body.textContent,/Organization release/)
    assert(!app.dom.window.document.body.textContent.includes('Unpublished draft'))
    await app.click('install');assert.deepEqual(app.installs,[['@team/plugin@1.2.3','','Organization release']])
    revoked=true;await app.click('install');assert.equal(app.installs.length,1)
    assert.match(app.dom.window.document.querySelector('[role="alert"]').textContent,/RESOURCE_FORBIDDEN/)
    await act(async()=>{const select=app.dom.window.document.querySelector('select[aria-label="enterprise"]');select.value='two';select.dispatchEvent(new app.dom.window.Event('change',{bubbles:true}))})
    assert.match(app.dom.window.document.body.textContent,/Second team plugin/)
    assert(!app.dom.window.document.body.textContent.includes('Organization release'))
    const reads=calls.length;await app.click('refresh');assert(calls.length>reads)
  }finally{await app.close()}
})

test('identity changes abort old list and release requests even when transport ignores cancellation',async()=>{
  for(const release of [false,true]) {
    let actor='old',finish,oldSignal
    const app=await setup((path,options)=>{
      if(path==='/enterprise')return {enterprises:actor==='old'?catalog.enterprises:[]}
      if((release&&path.includes('/versions/'))||!release){oldSignal=options.signal;return new Promise(resolve=>{finish=resolve})}
      return {items:[publication]}
    })
    try {
      if(release)await app.click('install')
      actor='new';await app.changeAccount();assert.equal(oldSignal.aborted,true)
      await act(async()=>finish(release?{spec:'@team/plugin@1.2.3'}:{items:[publication]}))
      assert(!app.dom.window.document.body.textContent.includes('Organization release'))
      assert.match(app.dom.window.document.body.textContent,/enterpriseNoMembership/)
      assert.equal(app.installs.length,0)
    }finally{await app.close()}
  }
})

test('sign-in, empty membership, no publications and network errors have distinct recoverable states',async()=>{
  for(const mode of ['signed-out','no-membership','empty','offline','disabled']) {
    let failed=mode==='offline'
    const app=await setup(mode==='disabled'?undefined:async path=>{
      if(mode==='signed-out')throw new Error('IPW_SIGN_IN_REQUIRED')
      if(failed)throw new Error('IPW_HOST_UNAVAILABLE')
      if(path==='/enterprise')return mode==='no-membership'?{enterprises:[]}:catalog
      return {items:[]}
    })
    try {
      assert.match(app.dom.window.document.body.textContent,new RegExp({'signed-out':'enterpriseSignIn','no-membership':'enterpriseNoMembership',empty:'enterpriseEmpty',offline:'IPW_HOST_UNAVAILABLE',disabled:'enterpriseUnavailable'}[mode]))
      if(failed){failed=false;await app.click('retry');assert.match(app.dom.window.document.body.textContent,/enterpriseEmpty/);assert.equal(app.dom.window.document.querySelector('[role="alert"]'),null)}
    }finally{await app.close()}
  }
})
