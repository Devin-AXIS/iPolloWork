import { closeProjectDatabases } from './databases'
import { serve } from '@hono/node-server'
import { app } from './app'
import { migrate, pool } from './db'
import { startAutomations } from './automation'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { serveStatic } from '@hono/node-server/serve-static'

// The release uses the same API and storage, serving the built UI in one process.
if (process.argv.includes('--web')) {
  const root = fileURLToPath(new URL('../../dist/', import.meta.url))
  await access(`${root}index.html`)
  app.get('*', async (c, next) => {
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) return c.notFound()
    return next()
  })
  app.get('*', serveStatic({ root }))
  app.get('*', serveStatic({ path: `${root}index.html` }))
}

await migrate()
const stopAutomations = startAutomations()
const server = serve(
  { fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT ?? 5711) },
  (info) => console.log(`数据内核已启动：http://127.0.0.1:${info.port}`),
)
async function stop() {
  server.close()
  await stopAutomations()
  await closeProjectDatabases()
  await pool.end()
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
