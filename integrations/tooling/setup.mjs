/** Prepare the official dependency cache and the product's development links. */
import { prepareSource, verifySource, linkWorkspace, pnpm, run, root, upstreamRoot } from './upstream.mjs'
import { join } from 'node:path'
await prepareSource()
if (!process.argv.includes('--source-only')) await pnpm(['install', '--frozen-lockfile'], upstreamRoot, { ...process.env, LEFTHOOK: '0' })
await linkWorkspace()
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
