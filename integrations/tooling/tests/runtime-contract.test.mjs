import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {verifyRuntimeContract} from '../runtime-contract.mjs'

test('runtime contract rejects a stale private Host, service protocol or plugin SDK before packaging',()=>{
  const root=mkdtempSync(join(tmpdir(),'ipollo-sdk-contract-'))
  const put=(file,value)=>{const path=join(root,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(value))}
  try{
    put('package.json',{engines:{node:'^24.22.3 || >=26.13.1'}})
    put('integrations/runtime/upstream.json',{npmVersion:'0.2.3-alpha.2'})
    put('.upstream/dsh/package.json',{engines:{node:'^24.22.3 || >=26.13.1'}})
    put('.upstream/dsh/apps/cli/package.json',{name:'@deepseek-ai/dsh',version:'0.2.3-alpha.2'})
    put('plugins/ipollowork-suite/package.json',{name:'@ipollo/dsh-suite',version:'0.1.51'})
    put('.upstream/dsh/packages/experimental/liveshare-protocol/package.json',{name:'@deepseek-ai/dsh-experimental-liveshare-protocol',version:'0.2.3-alpha.2'})
    put('integrations/desktop-host/package.json',{name:'@ipollo/desktop-host',version:'0.2.2-rc.3'})
    assert.throws(()=>verifyRuntimeContract(root),/host version must match/)
    put('integrations/desktop-host/package.json',{name:'@ipollo/desktop-host',version:'0.2.3-alpha.2',dependencies:{'@deepseek-ai/dsh':'0.2.3-alpha.2','@ipollo/dsh-suite':'0.1.46'}})
    assert.throws(()=>verifyRuntimeContract(root),/current shipped Suite/)
    put('integrations/desktop-host/package.json',{name:'@ipollo/desktop-host',version:'0.2.3-alpha.2',dependencies:{'@deepseek-ai/dsh':'0.2.3-alpha.2','@ipollo/dsh-suite':'0.1.51'}})
    put('services/ipollowork/package.json',{devDependencies:{'@deepseek-ai/dsh-experimental-liveshare-protocol':'^0.2.2-rc.2'}})
    assert.throws(()=>verifyRuntimeContract(root),/liveshare-protocol must match official/)
    put('services/ipollowork/package.json',{devDependencies:{'@deepseek-ai/dsh-experimental-liveshare-protocol':'0.2.3-alpha.2'}})
    put('plugins/example/package.json',{engines:{dsh:'0.2.2-rc.3'}})
    assert.throws(()=>verifyRuntimeContract(root),/engines.dsh must be the reviewed/)
    put('plugins/example/package.json',{engines:{dsh:'0.2.3-alpha.2'}})
    assert.equal(verifyRuntimeContract(root).version,'0.2.3-alpha.2')
  }finally{rmSync(root,{recursive:true,force:true})}
})
