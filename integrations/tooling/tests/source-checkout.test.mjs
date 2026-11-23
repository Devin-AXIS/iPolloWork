import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp,mkdir,writeFile,readFile,lstat,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {checkoutPinnedSource} from '../source-checkout.mjs'

test('Windows source checkout preserves pinned bytes and link blobs without symlink privileges',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ipw-pinned-checkout-')),repository=join(directory,'official'),target=join(directory,'target')
  const git=(args,input)=>execFileSync('git',['-C',repository,...args],{encoding:'utf8',input,windowsHide:true}).trim()
  try{
    await mkdir(repository);await mkdir(target);git(['init','-q']);git(['config','core.autocrlf','false'])
    await writeFile(join(repository,'README.md'),'official bytes\n');git(['add','README.md'])
    const blob=git(['hash-object','-w','--stdin'],'README.md')
    git(['update-index','--add','--cacheinfo','120000',blob,'CLAUDE.md'])
    git(['-c','user.name=Fixture','-c','user.email=fixture@example.test','-c','core.hooksPath=/dev/null','commit','-qm','Pinned source'])
    const revision=git(['rev-parse','HEAD']),tree=git(['rev-parse','HEAD^{tree}'])
    await checkoutPinnedSource({directory:target,repository,revision,tree})
    assert.equal(await readFile(join(target,'README.md'),'utf8'),'official bytes\n')
    assert.equal(await readFile(join(target,'CLAUDE.md'),'utf8'),'README.md')
    assert((await lstat(join(target,'CLAUDE.md'))).isFile())
    const rejected=join(directory,'wrong-tree');await mkdir(rejected)
    await assert.rejects(checkoutPinnedSource({directory:rejected,repository,revision,tree:'0'.repeat(40)}),/does not match/)
    await assert.rejects(readFile(join(rejected,'README.md')),{code:'ENOENT'})
  }finally{await rm(directory,{recursive:true,force:true})}
})
