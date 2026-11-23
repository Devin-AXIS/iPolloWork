/** Materialize the exact official Git tree on Windows without requiring symlink privileges. */
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const execute=promisify(execFile)

export async function checkoutPinnedSource({directory,repository,revision,tree}) {
  if(!/^[a-f0-9]{40}$/.test(revision)||!/^[a-f0-9]{40}$/.test(tree))throw new Error('An exact upstream commit and tree are required')
  const git=async args=>(await execute('git',['-C',directory,...args],{windowsHide:true,maxBuffer:1024*1024})).stdout.trim()
  await git(['init','-q'])
  await git(['config','core.autocrlf','false'])
  await git(['config','core.symlinks','false'])
  await git(['config','core.longpaths','true'])
  await git(['-c','core.hooksPath=/dev/null','fetch','--depth=1',repository,revision])
  if(await git(['rev-parse','FETCH_HEAD'])!==revision||await git(['rev-parse','FETCH_HEAD^{tree}'])!==tree)throw new Error('Official DSH commit or tree does not match the pin')
  await git(['-c','core.hooksPath=/dev/null','checkout','--detach','-f','FETCH_HEAD'])
}
