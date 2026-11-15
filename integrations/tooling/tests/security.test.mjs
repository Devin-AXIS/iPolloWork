import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

test('owned installation manifests and desktop packing pin patched transitive dependencies',()=>{
 for(const path of ['integrations/runtime/package.json','plugins/ipollowork-suite/package.json','plugins/ipollowork-suite/deploy/cloud/runtime.package.json']) {
  const manifest=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(manifest.overrides['undici@^8.0.0'],'8.12.4',path);
  assert.equal(manifest.overrides['@modelcontextprotocol/client'],'2.4.0',path);
  assert.equal(manifest.overrides.fflate,'0.8.3',path);
 }
 const desktop=readFileSync('integrations/desktop/scripts/runtime-patch-policy.ts','utf8');
 for(const version of ['8.12.4','2.4.0','0.8.3'])assert(desktop.includes(version));
 for(const path of ['integrations/runtime/package-lock.json','plugins/ipollowork-suite/package-lock.json']) {
  const lock=JSON.parse(readFileSync(path,'utf8'));
  for(const [name,value]of Object.entries(lock.packages)) {
   if(name.endsWith('/undici')&&value.version.startsWith('8.'))assert.equal(value.version,'8.12.4');
   if(name.endsWith('/@modelcontextprotocol/client'))assert.equal(value.version,'2.4.0');
   if(name.endsWith('/fflate'))assert.equal(value.version,'0.8.3');
  }
 }
})
