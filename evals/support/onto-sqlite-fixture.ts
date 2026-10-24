// Isolated real host installer, plugin runtime, SQLite, and production UI.
// Only the previous release number is a fixture; no user workspace is opened.
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installPluginPackage, updatePluginPackage } from '../../apps/server/src/plugin-package-lifecycle'
import { disposeAllPluginServices, pluginServiceDataDirectory } from '../../apps/server/src/plugin-service-runtime'
import { startServer } from '../../apps/server/src/server'
import type { ServerConfig } from '../../apps/server/src/types'

const root = await mkdtemp(join(tmpdir(), 'ipollowork-onto-proof-'))
process.env.IPOLLOWORK_RUNTIME_DB = join(root, 'runtime.sqlite')
const config: ServerConfig = {
  host: '127.0.0.1', port: 5398, token: 'onto-proof', hostToken: 'onto-proof-host',
  configPath: join(root, 'server.json'), approval: { mode: 'auto', timeoutMs: 0 },
  corsOrigins: ['http://localhost:5188'], workspaces: [{ id: 'onto-proof', name: 'Onto proof', path: root,
    preset: 'starter', workspaceType: 'local', engineId: 'opencode' }], authorizedRoots: [root], readOnly: false,
  startedAt: Date.now(), tokenSource: 'generated', hostTokenSource: 'generated', logFormat: 'pretty', logRequests: false,
}
const current = resolve('examples/plugin-packages/ipollo-onto/dist/package')
const previous = join(root, 'previous-release')
await cp(current, previous, { recursive: true })
const manifest = JSON.parse(await readFile(join(previous, 'ipollowork.plugin.json'), 'utf8'))
manifest.package.version = '0.1.4'
await writeFile(join(previous, 'ipollowork.plugin.json'), JSON.stringify(manifest))
await installPluginPackage({ serverConfig: config, packageRoot: previous })
const host = await startServer(config)
const proof = Bun.serve({ hostname: '127.0.0.1', port: 5399, async fetch(request) {
  const path = new URL(request.url).pathname
  const headers = { 'Access-Control-Allow-Origin': 'http://localhost:5188', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
  if (request.method === 'OPTIONS') return new Response(null, { headers })
  if (path === '/restart' && request.method === 'POST') await disposeAllPluginServices(config)
  if (path === '/update' && request.method === 'POST') {
    await disposeAllPluginServices(config)
    await updatePluginPackage({ serverConfig: config, packageRoot: current })
  }
  return Response.json({ root, data: pluginServiceDataDirectory(config, 'onto-proof', 'ipollo-onto') }, { headers })
}})
console.log(JSON.stringify({ root, host: 'http://127.0.0.1:5398', proof: 'http://127.0.0.1:5399' }))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  proof.stop(true); await disposeAllPluginServices(config); await host.stop(); process.exit(0)
})
