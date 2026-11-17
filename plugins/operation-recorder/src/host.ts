import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import createService from '../service/recorder.ts'
export const name = 'ipollo-operation-recorder'
export const inject = ['webServer', 'connection', 'connection.authentication', 'workspaceRegistry', 'tools', 'skills', 'sandboxPolicy']
const prefix = '/ipollo-operation-recorder'
interface Host extends Context { connection: { admit(request: IncomingMessage): { rejection: number } | { peer: { principal: { kind: string } } } } }
function reply(res: ServerResponse, status: number, value: unknown) {
 res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value))
}
export async function apply(ctx: Host) {
 let disposed = false
 const services = new Map<string, Promise<Awaited<ReturnType<typeof createService>>>>()
 const launches = new Map<string, URL>()
 const pending = new Set<ReturnType<typeof httpRequest>>()
 const serviceFor = (id: string) => {
   const workspace = ctx.workspaceRegistry.list().find(row => row.id === id)
   if (!workspace) throw new Error('Choose an existing DSH workspace')
   let promise = services.get(id)
   if (!promise) {
     promise = createService({ storage: { dataDir: join(workspace.path, '.ipollowork/plugins/operation-recorder') }, workspace: { root: workspace.path }, plugin: { id: 'operation-recorder', version: '0.2.0' } })
     services.set(id, promise)
     void promise.catch(() => services.delete(id))
   }
   return { promise, workspace }
 }
 ctx.effect(() => async () => {
   disposed = true
   for (const request of pending) request.destroy()
   await Promise.allSettled([...services.values()].map(async value => (await value).dispose()))
   services.clear(); launches.clear()
 }, 'operation-recorder: dispose services and requests')
 ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: prefix, handler: async (req, res) => {
  try {
   const admission = ctx.connection.admit(req)
   if ('rejection' in admission) { reply(res, admission.rejection, { error: 'unauthorized' }); return }
   if (admission.peer.principal.kind !== 'owner') { reply(res, 403, { error: 'forbidden' }); return }
   const url = new URL(req.url ?? '/', 'http://localhost')
   const path = url.pathname.slice(prefix.length)
   if (path === '/workspaces' && req.method === 'GET') {
     reply(res, 200, { workspaces: ctx.workspaceRegistry.list().map(({ id, title }) => ({ id, title })) }); return
   }
   if (path === '/open' && req.method === 'POST') {
     const id = url.searchParams.get('workspace') ?? ''
     const { promise, workspace } = serviceFor(id)
     const service = await promise
     const opened = await service.actions['open-workbench']!({}) as { url: string }
     if (disposed) throw new Error('Plugin disabled')
     launches.set(id, new URL(opened.url))
     reply(res, 200, { url: `${prefix}/workbench/${encodeURIComponent(id)}/` }); return
   }
   const match = path.match(/^\/workbench\/([^/]+)(\/.*)$/)
   const launch = match && launches.get(decodeURIComponent(match[1]!))
   if (!launch || !match) { reply(res, 404, { error: 'workbench_not_open' }); return }
   if (match[2]!.startsWith('//') || /(?:^|\/)\.\.?(?:\/|$)/.test(decodeURIComponent(match[2]!))) throw new Error('Invalid path')
   const target = new URL(match[2]! + url.search, launch.origin)
   if (target.origin !== launch.origin) throw new Error('Invalid origin')

   const headers = { ...req.headers, host: target.host, origin: target.origin, authorization: 'Bearer ' + new URLSearchParams(launch.hash.slice(1)).get('token') }
   delete headers.cookie
   await new Promise<void>((done, reject) => {
     const upstream = httpRequest(target, { method: req.method, headers }, incoming => {
       const headers = { ...incoming.headers, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }
       delete headers['set-cookie']
       res.writeHead(incoming.statusCode ?? 502, headers)
       incoming.pipe(res); incoming.on('end', done); incoming.on('error', reject)
     })
     pending.add(upstream)
     upstream.on('close', () => pending.delete(upstream))
     upstream.on('error', reject)
     upstream.setTimeout(120000, () => upstream.destroy(new Error('Workbench request timed out')))
     req.pipe(upstream)
   })
  } catch { if (!res.headersSent) reply(res, 400, { error: 'workbench_unavailable' }); else res.destroy() }
 } }), 'operation-recorder: authenticated workbench')
 const skill = await readFile(new URL('../skills/record-operations/SKILL.md', import.meta.url), 'utf8')
 ctx.effect(() => ctx.skills.register({ name: 'record-operations', description: 'Operation recorder', content: skill, source: 'runtime', resourceBase: { kind: 'directory', path: fileURLToPath(new URL('../skills/record-operations', import.meta.url)) } }))
 ctx.effect(() => ctx.tools.register(defineTool({
  name: 'ipollo_recorder', description: 'Read, review, import or compile operation recordings in the current workspace. Starting desktop capture and requesting permissions require the user workbench.',
  parameters: { action: { type: 'string', enum: ['status', 'prepare', 'events', 'review', 'import-chrome', 'compile'], required: true }, input: { type: 'object', additionalProperties: true } },
  output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
  async execute(args, exec) {
    const workspace = ctx.workspaceRegistry.list().find(row => row.path === exec.agent?.session.header.cwd)
    if (!workspace) throw new Error('Start in a registered DSH workspace')
    const { promise } = serviceFor(workspace.id)
    const service = await promise
    if (!['status', 'prepare', 'events'].includes(args.action) && ctx.sandboxPolicy.resolve({ session: exec.agent!.session }).mode === 'read-only') throw new Error('Read-only session')
    if (args.action === 'review' && args.input?.approved === true) throw new Error('Human review approval is available only in the user workbench');
    if (args.action === 'compile' && !args.input?.expectedRevision) throw new Error('Call prepare first and supply expectedRevision');
    const result = await service.actions[args.action]!(args.input ?? {})
    if (args.action === 'compile' && result && typeof result === 'object') { const { archiveBase64: _archive, ...metadata } = result as Record<string, unknown>; return JSON.parse(JSON.stringify(metadata)) }
    if (args.action === 'status' && result && typeof result === 'object') { const { compiled: _compiled, ...metadata } = result as Record<string, unknown>; return JSON.parse(JSON.stringify(metadata)) }
    return JSON.parse(JSON.stringify(result))
  },
  presentCall: args => ({ card: 'generic', title: '操作录制', kind: ['status', 'prepare', 'events'].includes(args.action) ? 'read' : 'edit' }),
 })))
}
