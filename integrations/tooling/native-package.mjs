/** Pack delivery files without letting npm traverse build-time dependency junctions. */
import {mkdtemp,cp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,basename} from 'node:path'
import {execFileSync} from 'node:child_process'

export async function packNativeArchive(directory,output,npm){
  if(!npm)throw new Error('Supply the current npm CLI when packing native plugins')
  const staging=await mkdtemp(join(tmpdir(),'ipollo-plugin-pack-'))
  try{
    await cp(directory,staging,{recursive:true,filter:path=>!['node_modules','.git'].includes(basename(path))})
    const packed = JSON.parse(execFileSync(process.execPath,[npm,'pack','--ignore-scripts','--json','--pack-destination',output],{cwd:staging,encoding:'utf8',maxBuffer:8_000_000,timeout:120_000}))[0]
    if (packed.name === '@ipollo/dsh-xiaohongshu-ops') {
      const binary = `sharp-${process.platform}-${process.arch}`
      const required = `business/runtime/vendor/@img/${binary}/lib/${binary}.node`
      if (!packed.files.some(file => file.path === required)) throw new Error(`Xiaohongshu plugin archive is missing ${required}`)
      if (packed.files.some(file => file.path.startsWith('business/skills/xhs-ops-worker/app/data/'))) {
        throw new Error('Xiaohongshu plugin archive contains local account or test data')
      }
    }
    return packed
  }finally{await rm(staging,{recursive:true,force:true})}
}
