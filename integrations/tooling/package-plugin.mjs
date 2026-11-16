/** Build the single suite artifact consumed by both delivery channels. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { root, run, verifySource } from './upstream.mjs'
await verifySource()
const suite = join(root, 'plugins/ipollowork-suite')
const output = join(root, 'dist')
await mkdir(output, { recursive: true })
await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'check'], { cwd: suite })
await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--pack-destination', output], { cwd: suite })
const { version } = JSON.parse(await readFile(join(suite, 'package.json'), 'utf8'))
const file = `ipollo-dsh-suite-${version}.tgz`
const bytes = await readFile(join(output, file))
await writeFile(join(output, 'plugin-release.json'), JSON.stringify({
  name: '@ipollo/dsh-suite', version, file, sha256: createHash('sha256').update(bytes).digest('hex'),
  officialRuntime: JSON.parse(await readFile(join(root, 'integrations/runtime/upstream.json'), 'utf8')).sourceRevision,
}, null, 2) + '\n')
console.log(`Plugin ready: dist/${file}`)
