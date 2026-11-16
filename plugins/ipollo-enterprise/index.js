import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { EnterpriseConnector, EnterpriseError, DEFAULT_ACCOUNT_ORIGIN } from './enterprise.js'

export const name = 'ipollo-enterprise-connector'
export const inject = ['webServer', 'connection', 'credentials', 'workspaceRegistry']
const PREFIX = '/ipollo-enterprise/api'

function reply(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body) })
  response.end(body)
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 16 * 1024) throw new EnterpriseError('body_too_large', 413)
    chunks.push(chunk)
  }
  let value
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new EnterpriseError('invalid_input') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EnterpriseError('invalid_input')
  return value
}

/** Mount one owner-authenticated plugin route; DSH owns transport and credentials. */
export function apply(ctx) {
  const lifetime = new AbortController()
  const connector = new EnterpriseConnector(ctx.credentials, fetch, lifetime.signal)
  ctx.effect(() => () => lifetime.abort(), 'ipollo-enterprise: request lifetime')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/ipollo-enterprise',
    handler: async (request, response) => {
      try {
        const rejection = ctx.connection.requestRejection({ headers: request.headers })
        if (rejection !== undefined) { reply(response, rejection, { error: 'unauthorized' }); return }
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const endpoint = url.pathname.slice(PREFIX.length)
        if (!url.pathname.startsWith(PREFIX + '/')) { reply(response, 404, { error: 'not_found' }); return }
        if (request.method === 'GET') {
          const id = url.searchParams.get('id')
          if (endpoint === '/state') reply(response, 200, { connections: await connector.list(), accountOrigin: DEFAULT_ACCOUNT_ORIGIN })
          else if (endpoint === '/membership') reply(response, 200, { connection: await connector.refresh(id) })
          else if (endpoint === '/members' || endpoint === '/departments') reply(response, 200, await connector.directory(id, endpoint.slice(1), url.searchParams.get('cursor')))
          else reply(response, 404, { error: 'not_found' })
          return
        }
        if (request.method !== 'POST') { reply(response, 405, { error: 'method_not_allowed' }); return }
        const input = await readBody(request)
        if (endpoint === '/discover') reply(response, 200, { enterprise: await connector.discover(input.origin) })
        else if (endpoint === '/join') reply(response, 200, { connection: await connector.join(input) })
        else if (endpoint === '/disconnect') { await connector.disconnect(input.id); reply(response, 200, { ok: true }) }
        else if (endpoint === '/workspace') {
          const enterprise = await connector.refresh(input.id)
          const path = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'enterprise-workspaces', enterprise.enterpriseId, enterprise.memberId)
          await mkdir(path, { recursive: true, mode: 0o700 })
          const existing = await ctx.workspaceRegistry.resolveByPath(path)
          const workspace = existing ?? await ctx.workspaceRegistry.create(path, enterprise.name)
          reply(response, 200, { workspaceId: workspace.id })
        } else reply(response, 404, { error: 'not_found' })
      } catch (error) {
        reply(response, error instanceof EnterpriseError ? error.status : 500,
          { error: error instanceof EnterpriseError ? error.code : 'enterprise_unavailable' })
      }
    },
  }), 'ipollo-enterprise: HTTP route')
}
