import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSource } from '../src/client/service-source.tsx';
import type { ServiceState } from '../src/client/service-source.tsx';

test('cloud connection rows never offer a local key when no authorized channel is available',()=>{
 const state:ServiceState={cloudOnly:true,catalog:{items:[],points:0},choices:{deepseek:{source:'own'}}};
 assert.deepEqual(resolveSource(state,'deepseek',true),{source:{kind:'official',service:undefined},official:undefined});
 assert.equal(resolveSource({...state,cloudOnly:false},'deepseek',true).source.kind,'own');
});
