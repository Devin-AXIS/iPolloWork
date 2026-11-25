/** Launch the product shell using the verified official dependency cache. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import { prepareSource, linkWorkspace, pnpm, run, root, upstreamRoot } from '../tooling/upstream.mjs'
import {assertNodeRuntime} from '../tooling/node-runtime.mjs'
assertNodeRuntime()
await prepareSource()
if (!existsSync(join(upstreamRoot, 'node_modules/pnpm/bin/pnpm.cjs'))) await pnpm(['install', '--frozen-lockfile'], upstreamRoot, { ...process.env, LEFTHOOK: '0' })
const [script, ...args] = process.argv.slice(2)
if (!script || !/^[a-z0-9-]+\.(?:ts|mjs)$/.test(script)) throw new Error('Select an iPolloWork desktop script filename')
let workspace = root
try { await linkWorkspace() }
catch (error) {
  if (script !== 'package-target.ts' || !/^Refusing to replace (?:a real product path|dependencies)/u.test(error.message)) throw error
  const { stageDesktopSources } = await import('./scripts/prepare-local-desktop.mjs')
  const builds = join(root, '.ipollowork-dev', 'package-source')
  await mkdir(builds, { recursive: true })
  workspace = await mkdtemp(join(builds, 'build-'))
  await stageDesktopSources(workspace)
  console.log(`Desktop packaging workspace: ${workspace}`)
}
const configPath = process.env.IPOLLOWORK_RELEASE_CONFIG
await run(process.execPath, ['--import', 'tsx/esm', join(workspace, 'integrations/desktop/scripts', script), ...args], {
  cwd: workspace,
  env: {
    ...process.env,
    ...(configPath ? { IPOLLOWORK_RELEASE_CONFIG: resolve(configPath) } : {}),
    IPOLLOWORK_DESKTOP_SETTINGS_ROOT: join(root, 'integrations/desktop'),
    PATH: `${join(upstreamRoot, 'node_modules/.bin')}${delimiter}${process.env.PATH ?? ''}`,
    npm_execpath: join(upstreamRoot, 'node_modules/pnpm/bin/pnpm.cjs'),
  },
})
