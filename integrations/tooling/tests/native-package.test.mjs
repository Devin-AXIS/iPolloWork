import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,symlink,lstat,rm} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {packNativeArchive} from '../native-package.mjs'

const npm=process.env.npm_execpath??join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')
test('native archives retain business files and exclude dependency junctions without changing the source',{skip:!existsSync(npm)},async()=>{
  const root=await mkdtemp(join(tmpdir(),'ipollo-pack-test-')),source=join(root,'source'),output=join(root,'archives'),dependencies=join(root,'dependencies')
  try{
    for(const dir of [source,output,dependencies,join(source,'business')])await mkdir(dir,{recursive:true})
    await writeFile(join(source,'package.json'),JSON.stringify({name:'ipollo-native-pack-fixture',version:'0.0.1',files:['business']}))
    await writeFile(join(source,'business/state.json'),'packaged source fixture')
    await writeFile(join(dependencies,'private-build-only.txt'),'not a delivery file')
    const link=join(source,'business/node_modules');await symlink(dependencies,link,process.platform==='win32'?'junction':'dir')
    const packed=await packNativeArchive(source,output,npm),archive=join(output,packed.filename)
    assert.equal(execFileSync('tar',['-xOzf',archive,'package/business/state.json'],{encoding:'utf8'}),'packaged source fixture')
    assert(!execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).includes('node_modules'))
    assert.equal((await lstat(link)).isSymbolicLink(),true)
    assert.equal(await readFile(join(dependencies,'private-build-only.txt'),'utf8'),'not a delivery file')
  }finally{await rm(root,{recursive:true,force:true})}
})
