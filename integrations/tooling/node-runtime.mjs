/** Fail early with the product's declared Node contract, before installing or launching DSH. */
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
const range=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')).engines.node

export function supportsNode(version,requirement=range){
  const current=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if(!current)return false
  const tuple=current.slice(1).map(Number)
  return requirement.split(/\s*\|\|\s*/).some(part=>{
    const rule=/^(\^|>=)(\d+)\.(\d+)\.(\d+)$/.exec(part)
    if(!rule)throw new Error('Unsupported Node runtime contract: '+part)
    const minimum=rule.slice(2).map(Number)
    const comparison=tuple[0]-minimum[0]||tuple[1]-minimum[1]||tuple[2]-minimum[2]
    return comparison>=0&&(rule[1]!== '^'||tuple[0]===minimum[0])
  })
}
export function assertNodeRuntime(version=process.versions.node){
  if(!supportsNode(version))throw new Error(`iPolloWork requires Node.js ${range}; current runtime is ${version}. Select a supported runtime before setup or launch.`)
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)assertNodeRuntime(process.argv[2]??process.versions.node)
