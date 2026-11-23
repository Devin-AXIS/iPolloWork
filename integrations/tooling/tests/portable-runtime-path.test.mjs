import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {withShortRuntimePath} from '../../desktop/scripts/portable-runtime-path.mjs'
test('short runtime aliases preserve payload bytes and are removed even when validation fails',()=>{
  const directory=mkdtempSync(join(tmpdir(),'ipw-long-runtime-')),root=join(directory,'payload-'+'a'.repeat(100));mkdirSync(root)
  writeFileSync(join(root,'runtime.json'),'fixture');let alias
  try{
    assert.throws(()=>withShortRuntimePath(root,value=>{alias=value;assert(value.length<root.length);assert.equal(readFileSync(join(value,'runtime.json'),'utf8'),'fixture');throw new Error('validation failed')}),/validation failed/)
    assert.equal(existsSync(alias),false);assert.equal(readFileSync(join(root,'runtime.json'),'utf8'),'fixture')
  }finally{rmSync(directory,{recursive:true,force:true})}
})
