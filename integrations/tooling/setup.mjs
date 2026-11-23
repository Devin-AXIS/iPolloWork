/** Prepare the official dependency cache and the product's development links. */
import { prepareSource, verifySource, linkWorkspace, pnpm, run, root, upstreamRoot } from './upstream.mjs'
import { join } from 'node:path'
import { installGitHooks } from './git-workflow.mjs'
import {assertNodeRuntime} from './node-runtime.mjs'
assertNodeRuntime()
installGitHooks()
await prepareSource({upgrade:process.argv.includes('--upgrade-upstream')})
if (!process.argv.includes('--source-only')) await pnpm(['install', '--frozen-lockfile'], upstreamRoot, { ...process.env, LEFTHOOK: '0' })
// Legacy checkouts can contain user-generated files under apps/packages.
// Their desktop launcher builds an isolated source stage instead of replacing those directories.
if (!process.argv.includes('--staged')) await linkWorkspace()
if (!process.argv.includes('--source-only')) await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts'], { cwd: join(root, 'integrations/publisher') })
if (process.argv.includes('--build')) {
  await pnpm(['run', 'build:artifacts', '--profile', 'official'])
  await pnpm(['run', 'build:check'])
}
if (process.argv.includes('--plugins')) {
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts', '--workspaces=false'], { cwd: join(root, 'plugins/ipollowork-suite') })
  await run(process.execPath, ['scripts/link-workspace.mjs', '--root', upstreamRoot], { cwd: join(root, 'plugins/ipollowork-suite') })
}
await verifySource()
console.log('Official DSH dependency ready; source files remain outside Git')
