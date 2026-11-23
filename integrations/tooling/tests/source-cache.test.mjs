import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {retainAndActivateSource} from '../source-cache.mjs'

for(const publish of [true,false])test(`cache activation ${publish?'retains old source and inventory':'restores both after inventory publication fails'}`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'ipollo-source-swap-'))
  const paths={current:join(root,'dsh'),staged:join(root,'staged'),backup:join(root,'retained'),inventory:join(root,'source-files.json'),pendingInventory:join(root,'pending.json')}
  try{
    for(const path of [paths.current,paths.staged,paths.backup])await mkdir(path)
    await writeFile(join(paths.current,'source.txt'),'old source');await writeFile(join(paths.staged,'source.txt'),'new source')
    await writeFile(paths.inventory,'old inventory')
    if(publish){
      await writeFile(paths.pendingInventory,'new inventory');await retainAndActivateSource(paths)
      assert.equal(await readFile(join(paths.current,'source.txt'),'utf8'),'new source')
      assert.equal(await readFile(paths.inventory,'utf8'),'new inventory')
      assert.equal(await readFile(join(paths.backup,'dsh/source.txt'),'utf8'),'old source')
      assert.equal(await readFile(join(paths.backup,'source-files.json'),'utf8'),'old inventory')
    }else{
      await assert.rejects(retainAndActivateSource(paths),{code:'ENOENT'})
      assert.equal(await readFile(join(paths.current,'source.txt'),'utf8'),'old source')
      assert.equal(await readFile(paths.inventory,'utf8'),'old inventory')
      assert.equal(await readFile(join(paths.staged,'source.txt'),'utf8'),'new source')
    }
  }finally{await rm(root,{recursive:true,force:true})}
})
