/** Run Windows interpreter checks through a short junction; never change the payload or its files. */
import {mkdtempSync,symlinkSync,unlinkSync,rmdirSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

export function withShortRuntimePath(root,operation){
  const source=realpathSync(root),temporary=mkdtempSync(join(tmpdir(),'ipw-runtime-')),alias=join(temporary,'r')
  let linked=false
  try{
    symlinkSync(source,alias,process.platform==='win32'?'junction':'dir');linked=true
    return operation(alias)
  }finally{
    if(linked)unlinkSync(alias)
    rmdirSync(temporary)
  }
}
