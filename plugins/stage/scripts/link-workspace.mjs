/** Link this source checkout to the matching DSH packages built in its repository. */
import { globSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { satisfies } from '../../ipollowork-suite/node_modules/semver/index.js'

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: { root: { type: 'string', default: resolve(directory, '../../.upstream/dsh') } } })
const root = realpathSync(values.root)
const manifest = path => JSON.parse(readFileSync(path, 'utf8'))
if (manifest(join(root, 'package.json')).name !== '@deepseek-ai/dsh-root') throw new Error('Select the iPolloWork DSH repository with --root')
const packages = new Map()
for (const path of globSync(['packages/*/*/package.json', 'vendor/*/package.json', 'native/system/packages/*/package.json'], { cwd: root })) {
  const info = manifest(join(root, path))
  packages.set(info.name, { directory: dirname(join(root, path)), version: info.version })
}
const own = manifest(join(directory, 'package.json'))
const dependencies = { ...own.dependencies, ...own.devDependencies, ...own.peerDependencies }
const links = Object.entries(dependencies).filter(([name]) => name.startsWith('@deepseek-ai/')).map(([name, range]) => {
  const target = packages.get(name)
  if (!target || !satisfies(target.version, range, { includePrerelease: true })) throw new Error(`Matching workspace package required: ${name}@${range}`)
  return { target: realpathSync(target.directory), path: join(directory, 'node_modules', name) }
})
for (const link of links) {
  try {
    if (lstatSync(link.path).isSymbolicLink() && realpathSync(link.path) === link.target) continue
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  mkdirSync(dirname(link.path), { recursive: true })
  rmSync(link.path, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 })
  for (let attempt = 0; ; attempt++) {
    try {
      symlinkSync(link.target, link.path, process.platform === 'win32' ? 'junction' : 'dir')
      break
    } catch (error) {
      if (process.platform !== 'win32' || error.code !== 'EBUSY' || attempt === 4) throw error
      await delay(50 * (attempt + 1))
    }
  }
}
console.log(`Linked ${links.length} matching DSH workspace packages.`)
