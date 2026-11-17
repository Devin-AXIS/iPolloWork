import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-skill'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import createService from '../service/data-annotation.ts'
export const name = 'ipollo-data-annotation'
export const inject = ['webServer', 'connection', 'connection.authentication', 'workspaceRegistry', 'tools', 'skills']
const prefix = '/ipollo-data-annotation'
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
     promise = createService({ plugin: { id: 'data-annotation', version: '0.1.0' } })
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
 }, 'data-annotation: dispose services and requests')
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
     const opened = await service.actions['open-workbench']({}, { directory: workspace.path })
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
   target.searchParams.set('token', launch.searchParams.get('token')!); target.searchParams.set('session', launch.searchParams.get('session')!)
   const headers = { ...req.headers, host: target.host, origin: target.origin, authorization: '' }
   delete headers.cookie
   await new Promise<void>((done, reject) => {
     const upstream = httpRequest(target, { method: req.method, headers }, incoming => {
       const headers = { ...incoming.headers, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }
       delete headers['set-cookie']
       delete headers['content-length']; res.writeHead(incoming.statusCode ?? 502, headers)
       if (String(incoming.headers['content-type']).includes('application/json')) {
         const chunks: Buffer[] = []; let size = 0
         incoming.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 24 * 1024 * 1024) incoming.destroy(new Error('Response too large')); else chunks.push(chunk) })
         incoming.on('end', () => {
          try {
           const value: unknown = JSON.parse(Buffer.concat(chunks).toString())
           const clean = (item: unknown): unknown => {
             if (Array.isArray(item)) return item.map(clean)
             if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, v]) => [key, key === 'mediaUrl' && typeof v === 'string' ? (() => { const media = new URL(v, launch.origin); media.searchParams.delete('token'); media.searchParams.delete('session'); return `.${media.pathname}?${media.searchParams}` })() : clean(v)]))
             return item
           }
           res.end(JSON.stringify(clean(value))); done()
          } catch (error) { reject(error) }
         })
       } else { incoming.pipe(res); incoming.on('end', done) }
       incoming.on('error', reject)
     })
     pending.add(upstream)
     upstream.on('close', () => pending.delete(upstream))
     upstream.on('error', reject)
     upstream.setTimeout(120000, () => upstream.destroy(new Error('Workbench request timed out')))
     req.pipe(upstream)
   })
  } catch { if (!res.headersSent) reply(res, 400, { error: 'workbench_unavailable' }); else res.destroy() }
 } }), 'data-annotation: authenticated workbench')
 const skill = await readFile(new URL('../skills/labelu-data-annotation/SKILL.md', import.meta.url), 'utf8')
 ctx.effect(() => ctx.skills.register({ name: 'labelu-data-annotation', description: 'Data annotation training', content: skill, source: 'runtime', resourceBase: { kind: 'directory', path: fileURLToPath(new URL('../skills/labelu-data-annotation', import.meta.url)) } }))
 ctx.effect(() => ctx.tools.register(defineTool({
  name: 'ipollo_annotation', description: 'Read saved annotation projects in the current workspace. Editing is only available in the user workbench.',
  parameters: { action: { type: 'string', enum: ['list-projects', 'get-project'], required: true }, input: { type: 'object', additionalProperties: true } },
  output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
  async execute(args, exec) {
    const workspace = ctx.workspaceRegistry.list().find(row => row.path === exec.agent?.session.header.cwd)
    if (!workspace) throw new Error('Start in a registered DSH workspace')
    const { promise } = serviceFor(workspace.id)
    const service = await promise
    return JSON.parse(JSON.stringify(await service.actions[args.action](args.input ?? {}, { directory: workspace.path })))
  },
  presentCall: args => ({ card: 'generic', title: '数据标注实训云', kind: 'read' }),
 })))
}
