import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {EventEmitter} from 'node:events'
import {buildSync} from 'esbuild'

test('Electron XHS worker explicitly starts as Node, with a separate process and no desktop IPC', async () => {
  const require=createRequire(import.meta.url)
  const url=new URL('../../xiaohongshu-ops/business/service/workbench.mjs',import.meta.url)
  const fixture=await mkdtemp(join(tmpdir(),'ipollo-xhs-process-'))
  const fixtureModule=pathToFileURL(join(fixture,'business/service/workbench.mjs'))
  const calls=[]
  const child=Object.assign(new EventEmitter(),{pid:1234,exitCode:null,stderr:new EventEmitter(),kill(){}})
  const priorElectron=Object.getOwnPropertyDescriptor(process.versions,'electron'),priorFetch=globalThis.fetch
  let reads=0,service
  try {
    // This test owns a packaged worker fixture; dependency installation is a separate operation.
    await mkdir(join(fixture,'business/runtime/dist'),{recursive:true})
    await writeFile(join(fixture,'business/runtime/dist/server.mjs'),'// Captured by the spawn fixture, never executed.\n')
    const code=buildSync({entryPoints:[fileURLToPath(url)],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,define:{'import.meta.url':JSON.stringify(fixtureModule.href)}}).outputFiles[0].text
    const compiled={exports:{}}
    new Function('require','module','exports',code)(id=>id==='node:child_process'?{spawn:(...args)=>{calls.push(args);return child}}:require(id),compiled,compiled.exports)
    Object.defineProperty(process.versions,'electron',{value:'desktop-test',configurable:true})
    globalThis.fetch=async()=>({ok:true,json:async()=>({service:'xiaohongshu-ops',embedded:++reads>1})})
    service=compiled.exports.default({storage:{dataDir:join(fixture,'storage')},plugin:{version:'test'}})
    assert.match((await service.actions['open-workbench']()).url,/\/accounts$/)
    assert.equal(calls.length,1)
    assert.equal(calls[0][2].env.ELECTRON_RUN_AS_NODE,'1')
    assert.deepEqual(calls[0][2].stdio,['ignore','ignore','pipe'])
    assert.equal(calls[0][2].windowsHide,true)
    service.dispose()
    service=undefined
    if(process.platform==='win32') assert.deepEqual(calls[1][1],['/pid','1234','/t','/f'])
  } finally {service?.dispose();globalThis.fetch=priorFetch;if(priorElectron)Object.defineProperty(process.versions,'electron',priorElectron);else delete process.versions.electron;await rm(fixture,{recursive:true,force:true})}
})
