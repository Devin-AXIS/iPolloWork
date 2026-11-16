/** Start the pinned, compiled official launcher and preserve the user's named profile. */
import { existsSync } from 'node:fs'
import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const root = fileURLToPath(new URL('../..', import.meta.url))
const cli = join(root, '.upstream/dsh/apps/cli/lib/bin.js')
if (!existsSync(cli)) throw new Error('Run npm run setup:build and npm run build first')
const require = createRequire(join(root, 'plugins/ipollowork-suite/package.json'))
const yaml = require('js-yaml')
const { resolveProfileDir } = await import(require.resolve('@deepseek-ai/dsh-app-boot'))
const args = process.argv.slice(2)
const profile = args.includes('--profile') ? args[args.indexOf('--profile') + 1] : 'web'
if (!profile || !/^[A-Za-z0-9_-]+$/.test(profile)) throw new Error('Invalid profile name')
const run = (args, quiet = false) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, ...args], { cwd: root, stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit' })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Official launcher exited ${code}`)))
})
await run(['--profile', profile, '--dump-config'], true)
const dir = resolveProfileDir(profile)
const path = join(dir, 'pnpm-workspace.yaml')
const original = await readFile(path, 'utf8')
const workspace = yaml.load(original) ?? {}
// Exact reviewed Studio runtime builds only; preserve operator overrides and other settings.
const builds = { 'esbuild@0.25.12': true, 'sharp@0.34.5': true, 'onnxruntime-node@1.21.0': false, 'onnxruntime-node@1.27.0': false, 'protobufjs@7.6.6': false }
workspace.allowBuilds = { ...builds, ...workspace.allowBuilds }
const next = yaml.dump(workspace)
if (next !== original) {
  const temporary = path + '.' + process.pid + '.tmp'
  try { await writeFile(temporary, next, { flag: 'wx' }); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
}
const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
const suite = 'link:' + join(root, 'plugins/ipollowork-suite')
if (manifest.dependencies?.['@ipollo/dsh-suite'] !== suite || !manifest.dsh?.profile?.bundles?.includes('@ipollo/dsh-suite'))
  await run(['plugin', '--profile', profile, 'add', suite])
await run(args.length ? ['--profile', profile, ...args.filter((arg, index) => arg !== '--profile' && args[index - 1] !== '--profile')] : ['web'])
