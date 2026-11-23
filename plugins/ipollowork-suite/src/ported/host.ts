import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-mcp-manager'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { z } from 'zod'
import { readFile, realpath, stat, mkdir } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http'
import { join, resolve, relative, isAbsolute, extname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { bundleAuthorization } from './credentials.ts'
import { manifestSchema, type ActionContext, type BusinessRuntime, type BusinessService, type BundleState } from './contracts.ts'
import { capabilityActions } from './media.ts'
import { frameStyle } from './frame-style.ts'

function frameSetup(nonce = '', prefix = ''): string {
  const safeNonce = /^[A-Za-z0-9+/=_-]*$/.test(nonce) ? nonce : ''
  const code = `window.ipolloPortedHost=true;window.ipolloworkUi={requireRuntime:()=>window.parent.__ipolloPortedUi};const t=parent.getComputedStyle(parent.document.body);for(let i=0;i<t.length;i++){const k=t[i];if(k.startsWith('--dsw-'))document.documentElement.style.setProperty(k,t.getPropertyValue(k))}const p=${JSON.stringify(prefix)};if(p){const f=window.fetch;window.fetch=(v,o)=>f(typeof v==='string'&&v.startsWith('/')&&!v.startsWith(p+'/')?p+v:v,o);document.addEventListener('click',e=>{const a=e.target.closest('a[href^="/"]');if(a&&!a.getAttribute('href').startsWith(p+'/'))a.href=p+a.getAttribute('href')},true)}`
  return `<style>${frameStyle}</style><script nonce="${safeNonce}">${code}</script>`
}

const callSchema = z.object({ workspace: z.string().min(1), sessionId: z.string().optional(), resource: z.string(), action: z.string(), input: z.record(z.string(), z.unknown()).default({}) }).strict()
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' }
const json = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 40 * 1024 * 1024) throw new Error('Request too large'); chunks.push(chunk) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
/** Reject traversal and links escaping the business package before reading shipped content. */
export async function packageFile(root: string, path: string): Promise<string> {
  const base = await realpath(root), file = await realpath(resolve(base, path))
  const rest = relative(base, file)
  if (!rest || isAbsolute(rest) || rest === '..' || rest.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Invalid package path')
  return file
}
/** Native DSH lifecycle around business services; no old host or Agent loop is loaded. */
export async function applyBundle(ctx: Context, raw: unknown, root: string): Promise<void> {
  const manifest = manifestSchema.parse(raw), base = '/ipollo-ported/' + manifest.id
  const authorization = bundleAuthorization(ctx.credentials, manifest.id)
  const lifetime = new AbortController()
  const services = new Map<string, Promise<BusinessService>>()
  const launches = new Map<string, URL>()
  const pending = new Set<ReturnType<typeof httpRequest>>()
  const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: false })
  const actions = manifest.resources.flatMap(resource => (resource.actions ?? []).map(action => ({ ...action, resource: resource.id, validate: ajv.compile(action.inputSchema) })))
  const secretFields = new Set(manifest.authorization?.methods.flatMap(method => method.fields.filter(field => field.secret).map(field => field.id)) ?? [])
  const requestsSecret = (value: unknown): boolean => Boolean(value && typeof value === 'object' && Object.entries(value).some(([key, child]) => secretFields.has(key) || requestsSecret(child)))
  const toolActions = actions.filter(action => !requestsSecret(action.inputSchema) && !(secretFields.size && /credential|authorization|(?:add|save|update)[-_]account|account[-_](?:add|save|update)/i.test(action.id)))
  const workspace = (id: string) => {
    const value = ctx.workspaceRegistry.list().find(item => item.id === id)
    if (!value || lifetime.signal.aborted) throw new Error('Choose an existing workspace')
    return value
  }
  const serviceFor = async (id: string, resourceId: string): Promise<BusinessService> => {
    const current = workspace(id), key = id + ':' + resourceId
    let service = services.get(key)
    if (!service) {
      if (services.size >= 32) throw new Error('Too many open plugin workspaces')
      service = (async () => {
        const resource = manifest.resources.find(item => item.type === 'local-service' && item.id === resourceId)
        if (!resource || manifest.id === 'deepseek-harness') throw new Error('Use the native DSH Agent and subagent tools')
        const file = await packageFile(root, resource.path.replace(/\.ts$/, '.js'))
        const module: { default?: (runtime: BusinessRuntime) => BusinessService | Promise<BusinessService> } = await import(pathToFileURL(file).href)
        if (typeof module.default !== 'function') throw new Error('Invalid business service')
        const dataDir = process.env.IPW_PORTED_DATA_ROOT ? join(resolve(process.env.IPW_PORTED_DATA_ROOT), manifest.id) : join(homedir(), '.ipollowork/plugin-data', manifest.id)
        await mkdir(dataDir, { recursive: true })
        const runtime: BusinessRuntime = { plugin: { id: manifest.id, version: manifest.package.version }, workspace: { root: current.path }, storage: { dataDir }, authorization,
          host: { callAction: (name, input, context) => capabilityActions(ctx, current, name, input, context?.signal ?? lifetime.signal) } }
        const value = await module.default(runtime)
        if (lifetime.signal.aborted) { await value.dispose?.(); throw new Error('Plugin disabled') }
        return value
      })()
      services.set(key, service)
      void service.catch(() => services.delete(key))
    }
    return service
  }
  const invoke = async (id: string, resource: string, actionId: string, input: Record<string, unknown>, context: ActionContext) => {
    const action = actions.find(item => item.resource === resource && item.id === actionId)
    if (!action || !action.validate(input)) throw new Error('Invalid plugin action input')
    const service = await serviceFor(id, resource)
    const actionFn = service.actions[actionId]
    if (!actionFn) throw new Error('Plugin action unavailable')
    return actionFn(input, context)
  }
  ctx.effect(() => async () => {
    lifetime.abort(); for (const request of pending) request.destroy()
    await Promise.allSettled([...services.values()].map(async value => (await value).dispose?.()))
    services.clear(); launches.clear()
  }, 'ported plugin: services and requests')
  for (const resource of manifest.resources.filter(item => item.type === 'skill')) {
    const path = resource.path.endsWith('.md') ? resource.path : resource.path + '/SKILL.md'
    const file = await packageFile(root, path)
    const original = await readFile(file, 'utf8')
    const content = manifest.id === 'deepseek-harness' ? original : `Native DSH integration: this plugin's business actions are exposed by ipollo_${manifest.id.replaceAll('-', '_')}. Call action="describe" with resource="${actions[0]?.resource ?? ''}" first to read exact action input schemas. Old extension service names in the following business instructions refer to those actions, not to the removed multi-engine host. Old ipollowork_browser_* names refer to separately configured native browser/MCP tools: discover real available tools, never invent one. This DSH pin does not provide the former per-account browser profiles or automatic account observation. Explain that limitation before attempting browser-only workflows. Use native credentials and sessions. Workbench messages create unsent drafts. Publishing and paid generation still require the user's requested scope.\n\n${original}`
    ctx.effect(() => ctx.skills.register({ name: resource.id, description: resource.description ?? resource.label ?? resource.id, content,
      source: 'runtime', resourceBase: { kind: 'directory', path: resolve(file, '..') } }), 'ported plugin: ' + resource.id)
  }
  for (const resource of manifest.resources.filter(item => item.type === 'mcp')) {
    const config = z.object({ type: z.literal('remote'), url: z.url() }).passthrough().parse(JSON.parse(await readFile(await packageFile(root, resource.path), 'utf8')))
    ctx.inject(['mcpManager'], scope => { scope.effect(() => scope.mcpManager.register('ipollo-' + manifest.id, { transport: 'streamable-http', url: config.url })) })
  }
  if (toolActions.length && manifest.id !== 'deepseek-harness') ctx.effect(() => ctx.tools.register(defineTool({
    name: 'ipollo_' + manifest.id.replaceAll('-', '_'), description: manifest.description + ' Call describe first to read exact business action input schemas. Credentials are configured only through the owner workbench.',
    parameters: { resource: { type: 'string', enum: [...new Set(toolActions.map(item => item.resource))], required: true }, action: { type: 'string', enum: ['describe', ...toolActions.map(item => item.id)], required: true }, input: { type: 'object', additionalProperties: true } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    timeoutMs: 180_000,
    async execute(args, exec) {
      const session = exec.agent?.session
      const current = ctx.workspaceRegistry.list().find(item => item.path === session?.header.cwd)
      if (!current || !session) throw new Error('Start in a registered workspace')
      if (args.action === 'describe') return z.json().parse(JSON.parse(JSON.stringify({ actions: toolActions.filter(item => item.resource === args.resource).map(({ id, title, description, effect, inputSchema }) => ({ id, title, description, effect, inputSchema })) })))
      const action = toolActions.find(item => item.resource === args.resource && item.id === args.action)
      if (!action || (action.effect !== 'read' && ctx.sandboxPolicy.resolve({ session }).mode === 'read-only')) throw new Error('Action is not available in this session')
      const value = await invoke(current.id, args.resource, args.action, args.input ?? {}, { directory: current.path, sessionId: session.id, signal: AbortSignal.any([exec.signal, lifetime.signal]) })
      // Workbench URLs can contain service tokens: only the owner HTTP flow may receive them.
      if (value && typeof value === 'object' && 'url' in value) { const { url: _url, ...safe } = value; return z.json().parse(safe) }
      return z.json().parse(JSON.parse(JSON.stringify(value ?? null)))
    },
    presentCall: args => ({ card: 'generic', title: manifest.name, kind: actions.find(item => item.resource === args.resource && item.id === args.action)?.effect === 'read' ? 'read' : 'edit' }),
  })), 'ported plugin: tools')
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: base, handler: async (req, res) => {
    try {
      const admission = ctx.connection.admit(req)
      if ('rejection' in admission) { json(res, admission.rejection, { error: 'unauthorized' }); return }
      if (admission.peer.principal.kind !== 'owner') { json(res, 403, { error: 'forbidden' }); return }
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== ctx.webServer.getOrigin())) { json(res, 403, { error: 'foreign_origin' }); return }
      const url = new URL(req.url ?? '/', 'http://localhost'), path = url.pathname.slice(base.length)
      if (path === '/state' && req.method === 'GET') {
        const value: BundleState = { id: manifest.id, title: manifest.name, description: manifest.description,
          workspaces: ctx.workspaceRegistry.list().map(({ id, title }) => ({ id, title })),
          actions: actions.map(({ id, resource, title, effect, inputSchema }) => ({ id, resource, title: title ?? id, effect, inputSchema })),
          views: manifest.resources.filter(item => item.type === 'ui').map(item => ({ id: item.id, title: item.label ?? item.id })),
          methods: (manifest.authorization?.methods ?? []).filter(method => method.fields.length > 0).map(method => ({ id: method.id, label: method.label ?? method.id, fields: method.fields.map(field => ({ id: field.id, label: field.label ?? field.id, secret: field.secret ?? false, required: field.required ?? false })) })),
          connections: await authorization.listConnections(), skills: manifest.resources.filter(item => item.type === 'skill').map(item => ({ id: item.id, title: item.label ?? item.id })) }
        json(res, 200, value); return
      }
      if (path === '/credential' && req.method === 'POST') {
        const input = z.object({ method: z.string(), account: z.string().min(1).max(200), values: z.record(z.string(), z.string()) }).strict().parse(await body(req))
        const method = manifest.authorization?.methods.find(item => item.id === input.method)
        if (!method || Object.keys(input.values).some(key => !method.fields.some(field => field.id === key)) || method.fields.some(field => field.required && !input.values[field.id]?.trim())) throw new Error('Invalid credential fields')
        await authorization.saveCredential(input.method, input.account, input.values); json(res, 200, { saved: true }); return
      }
      if (path === '/call' && req.method === 'POST') {
        const input = callSchema.parse(await body(req)), current = workspace(input.workspace)
        if (input.sessionId && !current.sessionIds.some(id => id === input.sessionId)) throw new Error('Session does not belong to this workspace')
        const result = await invoke(current.id, input.resource, input.action, input.input, { directory: current.path, ...(input.sessionId ? { sessionId: input.sessionId } : {}), signal: lifetime.signal })
        if (/^(open-workbench|open-studio)$/.test(input.action) && result && typeof result === 'object' && 'url' in result && typeof result.url === 'string') {
          const launch = new URL(result.url)
          if (launch.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(launch.hostname)) throw new Error('Invalid local workbench')
          launches.set(current.id, launch)
          json(res, 200, { url: `${base}/workbench/${encodeURIComponent(current.id)}${launch.pathname}${launch.search ? '?' + new URLSearchParams([...launch.searchParams].filter(([key]) => !['token', 'session'].includes(key))) : ''}` }); return
        }
        json(res, 200, result ?? null); return
      }
      if (path === '/view' && req.method === 'GET') {
        workspace(url.searchParams.get('workspace') ?? '')
        const view = manifest.resources.find(item => item.type === 'ui' && item.id === url.searchParams.get('id'))
        if (!view) throw new Error('Unknown view')
        const file = await packageFile(root, view.path)
        let html = await readFile(file, 'utf8')
        html = html.replace(/from\s+"@ipollowork\/ui\/runtime-contract"/g, 'from "' + base + '/frame-runtime.js"')
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end(html.replace(/<head([^>]*)>/i, '<head$1>' + frameSetup())); return
      }
      if (path === '/frame-runtime.js' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('export function requireRuntime(){return window.parent.__ipolloPortedUi}'); return }
      const match = path.match(/^\/workbench\/([^/]+)(\/.*)$/)
      if (!match) { json(res, 404, { error: 'not_found' }); return }
      const id = decodeURIComponent(match[1]!); workspace(id)
      const launch = launches.get(id)
      if (!launch) throw new Error('Open the workbench first')
      const prefix = `${base}/workbench/${encodeURIComponent(id)}`
      const target = new URL(match[2]! + url.search, launch.origin)
      if (target.origin !== launch.origin) throw new Error('Invalid workbench origin')
      for (const key of ['token', 'session']) { const value = launch.searchParams.get(key); if (value) target.searchParams.set(key, value) }
      const headers = { ...req.headers, host: target.host, origin: target.origin, authorization: '' }
      delete headers.cookie; delete headers['accept-encoding']
      const token = new URLSearchParams(launch.hash.slice(1)).get('token')
      if (token) headers.authorization = 'Bearer ' + token
      await new Promise<void>((done, reject) => {
        const upstream = httpRequest(target, { method: req.method, headers }, incoming => {
          const responseHeaders: OutgoingHttpHeaders = { ...incoming.headers, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }
          delete responseHeaders['set-cookie']; delete responseHeaders['content-length']
          if (typeof incoming.headers.location === 'string') {
            const destination = new URL(incoming.headers.location, target)
            if (destination.origin === launch.origin) {
              destination.searchParams.delete('token'); destination.searchParams.delete('session')
              responseHeaders.location = prefix + destination.pathname + destination.search
            }
          }
          if (String(incoming.headers['content-type']).includes('text/html')) {
            const chunks: Buffer[] = []; let size = 0
            incoming.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 8 * 1024 * 1024) incoming.destroy(new Error('Page too large')); else chunks.push(chunk) })
            incoming.on('end', () => {
              const html = Buffer.concat(chunks).toString('utf8'), nonce = html.match(/name="ipollowork-ui-nonce" content="([A-Za-z0-9+/=_-]+)"/)?.[1] ?? randomUUID()
              responseHeaders['content-security-policy'] = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'self'`
              res.writeHead(incoming.statusCode ?? 502, responseHeaders)
              res.end(html.replace(/(src|href|action)="\/(?!\/)/g, `$1="${prefix}/`).replace(/<script(?![^>]*\bnonce=)([^>]*)>/g, `<script nonce="${nonce}"$1>`).replace(/<head([^>]*)>/i, '<head$1>' + frameSetup(nonce, prefix) + `<base href="${prefix}/">`)); done()
            })
          } else { res.writeHead(incoming.statusCode ?? 502, responseHeaders); incoming.pipe(res); incoming.on('end', done) }
          incoming.on('error', reject)
        })
        pending.add(upstream); upstream.on('close', () => pending.delete(upstream)); upstream.on('error', reject)
        upstream.setTimeout(120_000, () => upstream.destroy(new Error('Workbench timeout'))); req.pipe(upstream)
      })
    } catch { if (!res.headersSent) json(res, 400, { error: 'plugin_action_failed' }); else res.destroy() }
  } }), 'ported plugin: owner workbench')
}
