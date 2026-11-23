/** Check owned packages against the exact SDK being packaged, rather than accepting mixed release lines. */
import {globSync,readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const repository=fileURLToPath(new URL('../..',import.meta.url))
const manifest=filename=>JSON.parse(readFileSync(filename,'utf8'))

function packageErrors(pkg,filename,pin,versions,errors){
  if(pkg.engines?.dsh&&pkg.engines.dsh!==pin.npmVersion)errors.push(`${filename}: engines.dsh must be the reviewed ${pin.npmVersion}`)
  for(const section of ['dependencies','devDependencies','peerDependencies','optionalDependencies'])for(const [name,version]of Object.entries(pkg[section]??{})){
    if(name.startsWith('@deepseek-ai/')&&versions.has(name)&&!/^(?:workspace|file|link):/.test(version)&&version!==versions.get(name))errors.push(`${filename}: ${name} must match official ${versions.get(name)} (found ${version})`)
  }
}

export function officialSdkVersions(source){
  const versions=new Map()
  for(const name of globSync(['apps/*/package.json','packages/*/*/package.json','vendor/*/package.json','native/system/packages/*/package.json'],{cwd:source})){
    const pkg=manifest(join(source,name));versions.set(pkg.name,pkg.version)
  }
  return versions
}

export function verifyRuntimeContract(root=repository){
  const pin=manifest(join(root,'integrations/runtime/upstream.json')),source=join(root,'.upstream/dsh'),official=manifest(join(source,'package.json'))
  const product=manifest(join(root,'package.json'))
  if(product.engines.node!==official.engines.node)throw new Error('Product Node engines must match the pinned official runtime')
  const versions=officialSdkVersions(source)
  const errors=[]
  const host=manifest(join(root,'integrations/desktop-host/package.json'))
  if(host.version!==pin.npmVersion)errors.push(`integrations/desktop-host/package.json: host version must match ${pin.npmVersion}`)
  const suite=manifest(join(root,'plugins/ipollowork-suite/package.json'))
  if(host.dependencies?.[suite.name]!==suite.version)errors.push('Private desktop Host must depend on the current shipped Suite version')
  for(const filename of globSync(['integrations/*/package.json','services/*/package.json','plugins/*/package.json','plugins/ipollowork-suite/vendor/*/package.json'],{cwd:root})){
    const pkg=manifest(join(root,filename))
    if(pkg.name?.startsWith('@deepseek-ai/')&&versions.has(pkg.name)&&pkg.version!==versions.get(pkg.name))errors.push(`${filename}: owned SDK package version must match official ${versions.get(pkg.name)}`)
    packageErrors(pkg,filename,pin,versions,errors)
  }
  if(errors.length)throw new Error('Mixed DSH SDK dependencies:\n'+errors.join('\n'))
  return {version:pin.npmVersion,node:official.engines.node}
}

/** Shipping archives must match the reviewed SDK too; source-only checks cannot detect stale payloads. */
export function verifyBundledRuntimeContract(root=repository){
  const pin=manifest(join(root,'integrations/runtime/upstream.json')),versions=officialSdkVersions(join(root,'.upstream/dsh'))
  const catalog=join(root,'plugins/ipollowork-suite/catalog'),releases=manifest(join(catalog,'bundled-releases.json')),errors=[]
  const studios=manifest(join(root,'integrations/runtime/studios.json'))
  if(studios.dshVersion!==pin.npmVersion)errors.push('Studio source adaptation must be reviewed for the current DSH pin')
  if(createHash('sha256').update(readFileSync(join(root,'integrations/runtime',studios.patchFile))).digest('hex')!==studios.patchSha256)errors.push('Studio source adaptation checksum mismatch')
  for(const pkg of studios.packages)if(!releases.plugins.some(release=>release.name===pkg.name&&release.version===pkg.version))errors.push(`${pkg.name}: shipping archive does not match the reviewed Studio adaptation`)
  for(const release of releases.plugins){
    if(!/^[a-zA-Z0-9._-]+\.tgz$/.test(release.file))throw new Error('Unsafe bundled archive filename')
    const archive=join(catalog,'packages',release.file)
    if(createHash('sha256').update(readFileSync(archive)).digest('hex')!==release.sha256)throw new Error(`Bundled archive checksum mismatch: ${release.file}`)
    const pkg=JSON.parse(execFileSync('tar',['-xOzf',release.file,'package/package.json'],{cwd:join(catalog,'packages'),encoding:'utf8',maxBuffer:4*1024*1024}))
    if(pkg.name!==release.name||pkg.version!==release.version)errors.push(`${release.file}: archive identity does not match the catalog`)
    if(!pkg.engines?.dsh)errors.push(`${release.file}: missing reviewed DSH compatibility`)
    packageErrors(pkg,release.file,pin,versions,errors)
  }
  for(const pkg of manifest(join(catalog,'index.json')).plugins)for(const release of pkg.versions??[]){
    if(release.engines?.dsh!==pin.npmVersion)errors.push(`${pkg.name}@${release.version}: market DSH compatibility must match ${pin.npmVersion}`)
  }
  if(errors.length)throw new Error('Stale bundled DSH SDK dependencies:\n'+errors.join('\n'))
  return {version:pin.npmVersion,archives:releases.plugins.length}
}
