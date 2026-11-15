/** Build official dependencies first, then compile the product shell and suite. */
import { prepareSource, verifySource, linkWorkspace, pnpm, run, root } from './upstream.mjs'
import { join } from 'node:path'
await prepareSource()
await linkWorkspace()
await pnpm(['run', 'build:artifacts', '--profile', 'official'])
await pnpm(['run', 'build:check'])
await pnpm(['exec', 'tsc', '-b', 'integrations/desktop', 'integrations/desktop-host'], root)
await pnpm(['exec', 'tsdown', '--config-loader', 'native', '--config', 'integrations/desktop/tsdown.config.ts'], root)
await pnpm(['exec', 'tsdown', '--config-loader', 'native', '--config', 'integrations/desktop-host/tsdown.config.ts'], root)
await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: join(root, 'plugins/ipollowork-suite') })
await verifySource()
await run(process.execPath, ['integrations/tooling/desktop-composition.mjs'], { cwd: root })
