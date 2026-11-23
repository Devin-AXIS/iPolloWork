/** Apply the reviewed Studio SDK adaptation to a clean checkout of its immutable source revision. */
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {assertNodeRuntime} from './node-runtime.mjs'

assertNodeRuntime()
const root=fileURLToPath(new URL('../..',import.meta.url)),source=process.argv[2]&&resolve(process.argv[2])
if(!source)throw new Error('Usage: npm run prepare:studios -- <clean Studio source checkout>')
const record=JSON.parse(readFileSync(join(root,'integrations/runtime/studios.json'),'utf8'))
const pin=JSON.parse(readFileSync(join(root,'integrations/runtime/upstream.json'),'utf8'))
if(record.dshVersion!==pin.npmVersion)throw new Error('Studio adaptation has not been reviewed for this DSH pin')
const patch=join(root,'integrations/runtime',record.patchFile)
if(createHash('sha256').update(readFileSync(patch)).digest('hex')!==record.patchSha256)throw new Error('Studio adaptation checksum mismatch')
const git=args=>execFileSync('git',args,{cwd:source,encoding:'utf8'})
if(git(['rev-parse','HEAD']).trim()!==record.sourceRevision)throw new Error('Studio source does not match the reviewed revision')
if(git(['status','--porcelain']).trim())throw new Error('Use a clean Studio checkout; existing work will not be overwritten')
git(['apply','--check',patch]);git(['apply',patch])
console.log('Applied verified Studio SDK adaptation. Run npm ci, npm run check and npm run pack:plugins in that checkout, then import the checked archives with prepare-studio-releases.mjs.')
