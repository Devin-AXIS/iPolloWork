/** Download and verify the pinned official DSH source without tracking it in this repository. */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, rename, rm, symlink, lstat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export const root = fileURLToPath(new URL('../..', import.meta.url))
export const upstreamRoot = join(root, '.upstream/dsh')
export const pin = JSON.parse(await readFile(join(root, 'integrations/runtime/upstream.json'), 'utf8'))
const cache = join(root, '.upstream')
const archive = join(cache, 'source.tar.gz')
const inventory = join(cache, 'source-files.json')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

/** Run a child to completion, preserving its failure status. */
export function run(command, args, options = {}) {
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
  for (const [path, hash] of Object.entries(record.files)) {
    if (digest(await readFile(join(upstreamRoot, path))) !== hash) throw new Error(`Official DSH source was modified: ${path}`)
  }
  const manifest = JSON.parse(await readFile(join(upstreamRoot, 'package.json'), 'utf8'))
  if (manifest.version !== pin.npmVersion || manifest.packageManager !== pin.packageManager) throw new Error('DSH source version does not match the pin')
}

/** Fetch a hash-pinned archive and materialize immutable official source in the local cache. */
export async function prepareSource() {
  await mkdir(cache, { recursive: true })
  let bytes = existsSync(archive) ? await readFile(archive) : undefined
  if (!bytes || digest(bytes) !== pin.sourceArchiveSha256) {
    const url = `${pin.upstreamRepository.replace('https://github.com/', 'https://codeload.github.com/').replace(/\.git$/, '')}/tar.gz/${pin.sourceRevision}`
    const response = await fetch(url, { signal: AbortSignal.timeout(300_000) })
    if (!response.ok) throw new Error(`Could not download official DSH: HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
    if (digest(bytes) !== pin.sourceArchiveSha256) throw new Error('Official DSH archive checksum mismatch')
    await writeFile(archive, bytes)
  }
  if (!existsSync(inventory)) {
    const staging = join(cache, `extract-${process.pid}`)
    await mkdir(staging)
    try {
      await run('tar', ['-xzf', archive, '--strip-components=1', '-C', staging])
      const { readdir } = await import('node:fs/promises')
      const files = {}
      async function visit(directory, prefix = '') {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = prefix + entry.name
          if (entry.isDirectory()) await visit(join(directory, entry.name), path + '/')
          else if (entry.isFile()) files[path] = digest(await readFile(join(directory, entry.name)))
        }
      }
      await visit(staging)
      if (existsSync(upstreamRoot)) {
        // Existing caches are adopted only when their original source bytes match the pinned archive.
        for (const [path, hash] of Object.entries(files)) if (digest(await readFile(join(upstreamRoot, path))) !== hash) throw new Error(`DSH cache differs from archive: ${path}`)
      } else await rename(staging, upstreamRoot)
      await writeFile(inventory, JSON.stringify({ revision: pin.sourceRevision, archive: pin.sourceArchiveSha256, files }) + '\n')
    } finally { await rm(staging, { recursive: true, force: true }) }
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
  for (const name of links) {
    const target = join(root, name)
    try {
      const stat = await lstat(target)
      if (!stat.isSymbolicLink()) throw new Error(`Refusing to replace a real product path: ${name}`)
      await rm(target)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    await symlink(join(upstreamRoot, name), target, process.platform === 'win32' ? (name.includes('.') && name !== 'node_modules' ? 'file' : 'junction') : undefined)
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
  await rm(cli, { recursive: true, force: true })
  await symlink(join(upstreamRoot, 'apps/cli'), cli, process.platform === 'win32' ? 'junction' : undefined)
  const publisher = join(upstreamRoot, 'apps/desktop/node_modules/@deepseek-ai/dsh-desktop-publisher')
  try { await rm(publisher, { recursive: true, force: true }) } catch (error) { if (error.code !== 'ENOENT') throw error }
  await symlink(join(root, 'integrations/publisher'), publisher, process.platform === 'win32' ? 'junction' : undefined)
}

/** Use the exact package-manager version declared by the official source. */
export async function pnpm(args, cwd = upstreamRoot, env = process.env) {
  const local = join(upstreamRoot, 'node_modules/pnpm/bin/pnpm.cjs')
  if (existsSync(local)) return run(process.execPath, [local, '--config.verify-deps-before-run=false', ...args], { cwd, env })
  return run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['exec', '--yes', `--package=${pin.packageManager}`, '--', 'pnpm', '--config.verify-deps-before-run=false', ...args], { cwd, env })
}
