/** Download and verify the pinned official DSH source without tracking it in this repository. */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, rename, rm, symlink, lstat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join,dirname } from 'node:path'
import {checkoutPinnedSource} from './source-checkout.mjs'
import {retainAndActivateSource} from './source-cache.mjs'
import {npmCommand} from './npm-command.mjs'

export const root = fileURLToPath(new URL('../..', import.meta.url))
export const upstreamRoot = join(root, '.upstream/dsh')
export const pin = JSON.parse(await readFile(join(root, 'integrations/runtime/upstream.json'), 'utf8'))
const cache = join(root, '.upstream')
const archive = join(cache, 'source.tar.gz')
const inventory = join(cache, 'source-files.json')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

/** Run a child to completion, preserving its failure status. */
export function run(command, args, options = {}) {
  if (command === 'npm' || command === 'npm.cmd') {
    const invocation = npmCommand(args, options.env ?? process.env)
    command = invocation.command
    args = invocation.args
    options = { ...options, env: invocation.env }
  }
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && /\.cmd$/i.test(command), ...options })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`${command} failed (${signal ?? code})`)))
  })
}

/** Check every archived source file; compiler outputs are not source inputs. */
export async function verifySource() {
  const record = JSON.parse(await readFile(inventory, 'utf8'))
  if (record.revision !== pin.sourceRevision || record.archive !== pin.sourceArchiveSha256) throw new Error('DSH cache does not match the pinned release; run npm run setup')
  await verifyArchivedFiles(upstreamRoot, record.files)
  const manifest = JSON.parse(await readFile(join(upstreamRoot, 'package.json'), 'utf8'))
  if (manifest.version !== pin.npmVersion || manifest.packageManager !== pin.packageManager) throw new Error('DSH source version does not match the pin')
}

export async function verifyArchivedFiles(directory, files) {
  for (const [path, hash] of Object.entries(files)) {
    if (digest(await readFile(join(directory, path))) !== hash) throw new Error(`Official DSH source was modified: ${path}`)
  }
}

/** Fetch a hash-pinned archive and materialize immutable official source in the local cache. */
export async function prepareSource({upgrade=false}={}) {
  await mkdir(cache, { recursive: true })
  const previous=existsSync(inventory)?JSON.parse(await readFile(inventory,'utf8')):undefined
  const stale=previous&&(previous.revision!==pin.sourceRevision||previous.archive!==pin.sourceArchiveSha256)
  if(stale&&!upgrade)throw new Error('DSH pin changed. Close the development desktop, then run npm run setup:build -- --upgrade-upstream to retain and replace the previous cache.')
  if(stale)await verifyArchivedFiles(upstreamRoot,previous.files)
  let bytes = existsSync(archive) ? await readFile(archive) : undefined
  if (!bytes || digest(bytes) !== pin.sourceArchiveSha256) {
    const url = `${pin.upstreamRepository.replace('https://github.com/', 'https://codeload.github.com/').replace(/\.git$/, '')}/tar.gz/${pin.sourceRevision}`
    const response = await fetch(url, { signal: AbortSignal.timeout(300_000) })
    if (!response.ok) throw new Error(`Could not download official DSH: HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
    if (digest(bytes) !== pin.sourceArchiveSha256) throw new Error('Official DSH archive checksum mismatch')
    if(stale&&existsSync(archive))await rename(archive,join(cache,'source-previous-'+Date.now()+'.tar.gz'))
    await writeFile(archive, bytes)
  }
  if (!existsSync(inventory)||stale) {
    const staging = join(cache, `extract-${process.pid}`)
    const pendingInventory=join(cache,`source-files-${process.pid}.pending.json`)
    await mkdir(staging)
    try {
      if(process.platform==='win32')await checkoutPinnedSource({directory:staging,repository:pin.upstreamRepository,revision:pin.sourceRevision,tree:pin.sourceTree})
      else await run('tar', ['-xzf', archive, '--strip-components=1', '-C', staging])
      const { readdir } = await import('node:fs/promises')
      const files = {}
      async function visit(directory, prefix = '') {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if(entry.name==='.git')continue
          const path = prefix + entry.name
          if (entry.isDirectory()) await visit(join(directory, entry.name), path + '/')
          else if (entry.isFile()) files[path] = digest(await readFile(join(directory, entry.name)))
        }
      }
      await visit(staging)
      const staged=JSON.parse(await readFile(join(staging,'package.json'),'utf8'))
      if(staged.version!==pin.npmVersion||staged.packageManager!==pin.packageManager)throw new Error('Staged DSH source does not match the pin')
      await writeFile(pendingInventory,JSON.stringify({revision:pin.sourceRevision,archive:pin.sourceArchiveSha256,files})+'\n')
      if(stale){
        if(!/^[a-f0-9]{40}$/.test(previous.revision))throw new Error('Invalid previous DSH cache revision')
        const backup=join(cache,'retained-'+previous.revision.slice(0,12)+'-'+Date.now())
        await mkdir(backup)
        await retainAndActivateSource({current:upstreamRoot,staged:staging,backup,inventory,pendingInventory})
        console.log('Retained previous DSH cache: '+backup)
      }else if (existsSync(upstreamRoot)) {
        // Existing caches are adopted only when their original source bytes match the pinned archive.
        for (const [path, hash] of Object.entries(files)) if (digest(await readFile(join(upstreamRoot, path))) !== hash) throw new Error(`DSH cache differs from archive: ${path}`)
      } else await rename(staging, upstreamRoot)
      if(!stale)await rename(pendingInventory,inventory)
    } finally { await rm(pendingInventory,{force:true});await rm(staging, { recursive: true, force: true }) }
  }
  if (!existsSync(join(upstreamRoot, '.git'))) {
    await run('git', ['init', '-q', upstreamRoot])
    await run('git', ['-C', upstreamRoot, '-c', 'core.hooksPath=/dev/null', 'fetch', '--depth=1', pin.upstreamRepository, pin.sourceRevision])
    await run('git', ['-C', upstreamRoot, 'reset', '--mixed', 'FETCH_HEAD'])
  }
  await verifySource()
}

/** Create ignored resolution links; official source remains exclusively inside the cache. */
export async function linkWorkspace() {
  const links = ['apps', 'packages', 'vendor', 'native', 'scripts', 'node_modules', 'tsconfig.base.json', 'tsconfig.base.client.json', 'tsconfig.node.base.json', 'vitest.shared.ts']
  const managedFile=join(cache,'workspace-file-links.json')
  let managed={}
  try{managed=JSON.parse(await readFile(managedFile,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
  for (const name of links) {
    const target = join(root, name)
    const copy=process.platform==='win32'&&name.includes('.')&&name!=='node_modules'
    const source=join(upstreamRoot,name)
    const bytes=copy?await readFile(source):undefined
    try {
      const stat = await lstat(target)
      if (!stat.isSymbolicLink()&&!(copy&&stat.isFile()&&digest(await readFile(target))===(managed[name]??digest(bytes)))) throw new Error(`Refusing to replace a real product path: ${name}`)
      await rm(target)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    if(copy){await writeFile(target,bytes);managed[name]=digest(bytes);await writeFile(managedFile,JSON.stringify(managed)+'\n')}
    else await symlink(source, target, process.platform === 'win32' ? 'junction' : undefined)
  }
  for (const name of ['desktop', 'desktop-host']) {
    const target = join(root, 'integrations', name, 'node_modules')
    try {
      const stat = await lstat(target)
      if (!stat.isSymbolicLink()) throw new Error(`Refusing to replace dependencies in ${name}`)
      await rm(target)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    await symlink(join(upstreamRoot, 'apps', name, 'node_modules'), target, process.platform === 'win32' ? 'junction' : undefined)
  }
  const yamlSource = join(upstreamRoot, 'packages/boot/plugin-manager/node_modules/yaml')
  if (existsSync(yamlSource)) {
    const productModules = join(root, 'integrations', 'node_modules')
    const target = join(productModules, 'yaml')
    await mkdir(productModules, { recursive: true })
    try {
      if (!(await lstat(target)).isSymbolicLink()) throw new Error('Refusing to replace the product YAML dependency')
      await rm(target)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    await symlink(await realpath(yamlSource), target, process.platform === 'win32' ? 'junction' : undefined)
  }
  const cli = join(upstreamRoot, 'apps/desktop-host/node_modules/@deepseek-ai/dsh')
  await mkdir(dirname(cli),{recursive:true})
  await rm(cli, { recursive: true, force: true })
  await symlink(join(upstreamRoot, 'apps/cli'), cli, process.platform === 'win32' ? 'junction' : undefined)
  const publisher = join(upstreamRoot, 'apps/desktop/node_modules/@deepseek-ai/dsh-desktop-publisher')
  await mkdir(dirname(publisher),{recursive:true})
  try { await rm(publisher, { recursive: true, force: true }) } catch (error) { if (error.code !== 'ENOENT') throw error }
  await symlink(join(root, 'integrations/publisher'), publisher, process.platform === 'win32' ? 'junction' : undefined)
}

/** Use the exact package-manager version declared by the official source. */
export async function pnpm(args, cwd = upstreamRoot, env = process.env) {
  const local = join(upstreamRoot, 'node_modules/pnpm/bin/pnpm.cjs')
  if (existsSync(local)) return run(process.execPath, [local, '--config.verify-deps-before-run=false', ...args], { cwd, env })
  return run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['exec', '--yes', `--package=${pin.packageManager}`, '--', 'pnpm', '--config.verify-deps-before-run=false', ...args], { cwd, env })
}
