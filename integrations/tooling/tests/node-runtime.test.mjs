import test from 'node:test'
import assert from 'node:assert/strict'
import {supportsNode,assertNodeRuntime} from '../node-runtime.mjs'
test('unsupported Node lines and pre-release runtimes fail before DSH startup',()=>{
  for(const version of ['22.22.1','24.15.0','24.22.2','25.10.0','26.13.0','24.22.3-rc.1']){
    assert.equal(supportsNode(version),false,version);assert.throws(()=>assertNodeRuntime(version),/requires Node.js/)
  }
  for(const version of ['24.22.3','v24.23.0','26.13.1','26.14.0','27.0.0'])assert.equal(supportsNode(version),true,version)
})
