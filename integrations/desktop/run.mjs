/** Launch the product shell using the verified official dependency cache. */
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { prepareSource, linkWorkspace, pnpm, run, root, upstreamRoot } from '../tooling/upstream.mjs'
await prepareSource()
if (!existsSync(join(upstreamRoot, 'node_modules/pnpm/bin/pnpm.cjs'))) await pnpm(['install', '--frozen-lockfile'], upstreamRoot, { ...process.env, LEFTHOOK: '0' })
await linkWorkspace()
const [script, ...args] = process.argv.slice(2)
if (!script || !/^[a-z0-9-]+\.(?:ts|mjs)$/.test(script)) throw new Error('Select an iPolloWork desktop script filename')
await run(process.execPath, ['--import', 'tsx/esm', join(root, 'integrations/desktop/scripts', script), ...args], {
  env: { ...process.env, PATH: `${join(upstreamRoot, 'node_modules/.bin')}${delimiter}${process.env.PATH ?? ''}`, npm_execpath: join(upstreamRoot, 'node_modules/pnpm/bin/pnpm.cjs') },
})
