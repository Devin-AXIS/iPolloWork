import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {EventEmitter} from 'node:events'
import {buildSync} from 'esbuild'

test('Electron XHS worker explicitly starts as Node, with a separate process and no desktop IPC', async () => {
  const require=createRequire(import.meta.url)
  const url=new URL('../../xiaohongshu-ops/business/service/workbench.mjs',import.meta.url)
  const code=buildSync({entryPoints:[fileURLToPath(url)],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,define:{'import.meta.url':JSON.stringify(url.href)}}).outputFiles[0].text
  const calls=[]
  const child=Object.assign(new EventEmitter(),{pid:1234,exitCode:null,stderr:new EventEmitter(),kill(){}})
  const compiled={exports:{}}
  new Function('require','module','exports',code)(id=>id==='node:child_process'?{spawn:(...args)=>{calls.push(args);return child}}:require(id),compiled,compiled.exports)
  const priorElectron=Object.getOwnPropertyDescriptor(process.versions,'electron'),priorFetch=globalThis.fetch
  let reads=0
  try {
    Object.defineProperty(process.versions,'electron',{value:'desktop-test',configurable:true})
    globalThis.fetch=async()=>({ok:true,json:async()=>({service:'xiaohongshu-ops',embedded:++reads>1})})
    const service=compiled.exports.default({storage:{dataDir:fileURLToPath(new URL('../',import.meta.url))},plugin:{version:'test'}})
    assert.match((await service.actions['open-workbench']()).url,/\/accounts$/)
    assert.equal(calls.length,1)
    assert.equal(calls[0][2].env.ELECTRON_RUN_AS_NODE,'1')
    assert.deepEqual(calls[0][2].stdio,['ignore','ignore','pipe'])
    assert.equal(calls[0][2].windowsHide,true)
    service.dispose()
    if(process.platform==='win32') assert.deepEqual(calls[1][1],['/pid','1234','/t','/f'])
  } finally {globalThis.fetch=priorFetch;if(priorElectron)Object.defineProperty(process.versions,'electron',priorElectron);else delete process.versions.electron}
})
