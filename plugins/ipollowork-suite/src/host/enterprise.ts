import { z } from 'zod'
import { createHash } from 'node:crypto'
import type { AccountService } from './account.ts'
import { SuiteError } from './errors.ts'
import { linkProject } from './project-context.ts'
import type { EnterpriseAssets, PackageDetail, EnterpriseModel, ModelProbe } from '../shared/enterprise.ts'
import type { Enterprise, EnterpriseCatalog, EnterpriseDetail, EnterpriseProject, SharePreview, SharedConversationDetail, ProjectWork, ProjectCollaboration, WorkDetail, ProjectUpdate } from '../shared/enterprise.ts'

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/)
const name = z.string().trim().min(1).max(120)
const row = z.record(z.string(), z.unknown())
const audience = z.object({ all: z.boolean(), departments: z.array(id).max(200), members: z.array(id).max(500) }).strict()
const description = z.string().trim().max(2000)
const modelEntry = z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200), contextWindow: z.number().int().min(1024), maxTokens: z.number().int().min(1) }).strict()
const httpUrl = z.url().max(2000).refine(value => /^https?:\/\//.test(value))
const headerName = z.string().regex(/^[A-Za-z][A-Za-z0-9-]*$/).max(100)
const headerPrefix = z.string().max(50).refine(value => !/[\r\n]/.test(value))
const key = z.string().max(8192).refine(value => !/[\r\n]/.test(value))
const assetsResponse = z.object({
  canManage: z.boolean(),
  packages: z.array(z.object({ id, title: z.string(), description: z.string(), fileCount: z.number(), bytes: z.number(), updatedAt: z.number(), audience })).max(200),
  skills: z.array(z.object({ id, title: z.string(), description: z.string(), name: z.string(), bytes: z.number(), updatedAt: z.number(), audience })).max(200),
})
const packageResponse = z.object({
  package: z.object({ id, title: z.string(), description: z.string(), audience }),
  files: z.array(z.object({ id, name: z.string(), bytes: z.number(), mime: z.string(), addedAt: z.number(), addedBy: z.string() })).max(500),
})
const modelsResponse = z.object({ items: z.array(z.object({ id, title: z.string(), baseUrl: z.string(), models: z.array(modelEntry), enabled: z.boolean(), configured: z.boolean(), headerName: z.string(), headerPrefix: z.string(), audience })).max(200) })
const probeResponse = z.object({ ok: z.boolean(), status: z.number(), latency: z.number(), reason: z.enum(['auth', 'unreachable', 'timeout', 'upstream']).optional(), models: z.array(z.string()).max(200) })
const list = z.object({ items: z.array(row).max(500) })
const nullableString = (value: unknown): string | null => value === null || value === undefined ? null : z.string().parse(value)
const string = (value: unknown): string => z.string().parse(value)
const number = (value: unknown): number => z.number().parse(value)
const organization = (r: Record<string, unknown>): Enterprise => ({ id: string(r.id), name: string(r.name), role: typeof r.role === 'string' ? r.role : 'admin', memberCount: typeof r.member_count === 'number' ? r.member_count : 0 })
function projectWork(r:Record<string,unknown>):ProjectWork {
  return {id:string(r.id),projectId:string(r.project_id),projectTitle:string(r.project_title),enterpriseId:nullableString(r.enterprise_id),enterpriseName:nullableString(r.enterprise_name),
    sourceShareId:string(r.source_share_id),ownerId:string(r.owner_id),ownerName:string(r.owner_name),title:string(r.title),
    version:number(r.version),resultTitle:nullableString(r.result_title),updatedAt:number(r.updated_at),canPublish:z.boolean().parse(r.canPublish),
    ...(r.native_session_id?{nativeSessionId:string(r.native_session_id)}:{}),...(r.native_workspace_id?{nativeWorkspaceId:string(r.native_workspace_id)}:{})}
}
function projectUpdate(r:Record<string,unknown>):ProjectUpdate {
  return {id:string(r.id),workId:string(r.work_id),version:number(r.version),title:string(r.title),authorName:string(r.author_name),createdAt:number(r.created_at)}
}
export interface EnterpriseNative {
  workspaceRegistry: { list(): { id: string; title: string; path: string; sessionIds: readonly string[] }[] }
  sessionQuery: { readSurface(sessionId: string): Promise<{ events: readonly { type: string; data: unknown }[] }> }
}

/** Uses native workspace identities and shares only an explicitly reviewed text snapshot. */
export class EnterpriseService {
  constructor(private account: AccountService, private native: EnterpriseNative, private origin: string) {}
  private cloud(path: string, data?: unknown, method?: string) { return this.account.request('/api/v1/' + path, data, method) }
  private async signedIn() {
    const state = await this.account.state()
    if (state.status !== 'signed-in') throw new SuiteError('IPW_SIGN_IN_REQUIRED', 401)
    return state.user.id
  }
  /** Join native workspaces with the caller's own cloud project records. */
  private localProjects(userId: string, enterprises: Enterprise[], projects: unknown): EnterpriseProject[] {
    const ownProjects = list.parse(projects).items.filter(p => p.owner_id === userId)
    return this.native.workspaceRegistry.list().map(p => {
      const record = ownProjects.find(item => item.native_id === p.id)
      const enterpriseId = record ? nullableString(record.enterprise_id) : null
      return { id:p.id, title:p.title, path:p.path, sessionIds:[...p.sessionIds], cloudId: record ? string(record.id) : null, enterpriseId, enterpriseName: enterprises.find(e => e.id === enterpriseId)?.name ?? null }
    })
  }
  async catalog(): Promise<EnterpriseCatalog> {
    const userId = await this.signedIn()
    const [organizations, projects, shares, workRows, projectRows] = await Promise.all([this.cloud('enterprises'), this.cloud('projects'), Promise.resolve({items:[]}), Promise.resolve({items:[]}), this.cloud('projects')])
    const enterprises = list.parse(organizations).items.map(organization)
    return {
      serviceOrigin:this.origin,userId, enterprises, work:list.parse(workRows).items.map(projectWork),
      sharedProjects:list.parse(projectRows).items.map(r=>({id:string(r.id),title:string(r.title),enterpriseId:nullableString(r.enterprise_id),enterpriseName:nullableString(r.enterprise_name)})),
      projects: this.localProjects(userId, enterprises, projects),
      shares: list.parse(shares).items.map(r => ({
        id: string(r.id), title: string(r.title), projectId: string(r.project_id), projectTitle: string(r.project_title),
        enterpriseId: nullableString(r.enterprise_id), enterpriseName: nullableString(r.enterprise_name), ownerId: string(r.owner_id), createdAt: number(r.created_at),
      })),
    }
  }
  async detail(enterpriseId: string): Promise<EnterpriseDetail> {
    const result = z.object({ enterprise: row, canManage: z.boolean(), members: z.array(row), departments: z.array(row), invitations: z.array(row) }).parse(await this.cloud('enterprises/' + enterpriseId))
    return {
      enterprise: organization(result.enterprise), canManage: result.canManage,
      members: result.members.map(r => ({ userId: string(r.user_id), name: string(r.name), email: string(r.email), role: string(r.role), departmentId: nullableString(r.department_id) })),
      departments: result.departments.map(r => ({ id: string(r.id), name: string(r.name) })),
      invitations: result.invitations.map(r => ({ id: string(r.id), email: string(r.email), role: string(r.role), expiresAt: number(r.expires_at), accepted: !!r.accepted_by, revoked: !!r.revoked_at })),
    }
  }
  async assign(input: unknown) {
    const data = z.object({ projectId: id, enterpriseId: id.nullable() }).parse(input)
    const catalog = await this.catalog()
    const project = catalog.projects.find(p => p.id === data.projectId)
    if (!project) throw new SuiteError('IPW_PROJECT_NOT_FOUND', 404)
    if (data.enterpriseId && !catalog.enterprises.some(e => e.id === data.enterpriseId)) throw new SuiteError('ENTERPRISE_FORBIDDEN', 403)
    const result=project.cloudId ? await this.cloud('projects/' + project.cloudId, { enterpriseId: data.enterpriseId, title: project.title }, 'PATCH')
      : await this.cloud('projects', { title: project.title, nativeId: project.id, enterpriseId: data.enterpriseId })
    const cloudId=project.cloudId??z.object({id}).parse(result).id
    await linkProject(project.path,this.origin,cloudId)
    return result
  }
  async preview(sessionId: string): Promise<SharePreview> {
    const local = this.native.workspaceRegistry.list().find(p => p.sessionIds.includes(sessionId))
    if (!local) throw new SuiteError('IPW_PROJECT_NOT_FOUND', 404)
    const userId = await this.signedIn()
    const [organizations, projects] = await Promise.all([this.cloud('enterprises'), this.cloud('projects')])
    const project = this.localProjects(userId, list.parse(organizations).items.map(organization), projects).find(p => p.id === local.id)
    if (!project) throw new SuiteError('IPW_PROJECT_NOT_FOUND', 404)
    const surface = await this.native.sessionQuery.readSurface(sessionId)
    const transcript = surface.events.flatMap(event => {
      if (event.type !== 'user/message' && event.type !== 'assistant/message') return []
      const data = row.parse(event.data)
      const message = event.type === 'user/message' ? data : row.parse(data.message)
      const source = row.safeParse(message.source)
      if (!source.success || source.data.kind !== (event.type === 'user/message' ? 'user' : 'model')) return []
      const content = z.array(row).parse(message.content).filter(block => block.type === 'text').map(block => string(block.text)).join('\n')
      return content ? [{ role: event.type === 'user/message' ? 'user' as const : 'assistant' as const, content }] : []
    })
    if (transcript.length > 200 || Buffer.byteLength(JSON.stringify(transcript)) > 500_000) throw new SuiteError('IPW_SHARE_TOO_LARGE', 413)
    return { project, transcript, revision: createHash('sha256').update(JSON.stringify(transcript)).digest('hex') }
  }
  async shared(shareId: string): Promise<SharedConversationDetail> {
    const result = z.object({ id, project_id:id, title: name, owner_id: id, canComment: z.boolean(), transcript: z.array(z.object({ role: z.enum(['user','assistant']), content: z.string() })), comments: z.array(row) }).parse(await this.cloud('shares/' + shareId))
    return { projectId:string(result.project_id), id: result.id, title: result.title, ownerId: result.owner_id, canComment: result.canComment, transcript: result.transcript,
      comments: result.comments.map(r => ({ id: string(r.id), name: string(r.name), content: string(r.content), createdAt: number(r.created_at) })) }
  }
  async request(method: string, path: string, input?: unknown): Promise<unknown> {
    const parts = path.split('/').filter(Boolean)
    if (parts[0] === 'projects' && parts[1] && ['space','access','changes','memory'].includes(parts[2] ?? '')) {
      const target='projects/'+id.parse(parts[1])+'/'+parts.slice(2).map(segment=>id.parse(segment)).join('/')
      return this.cloud(target,input,method)
    }
    if(method==='POST'&&parts[0]==='projects'&&parts[1]&&parts[2]==='link') {
      const data=z.object({workspaceId:id}).parse(input)
      const workspace=this.native.workspaceRegistry.list().find(p=>p.id===data.workspaceId)
      if(!workspace)throw new SuiteError('IPW_PROJECT_NOT_FOUND',404)
      await this.cloud('projects/'+id.parse(parts[1])+'/space')
      await linkProject(workspace.path,this.origin,parts[1])
      return {ok:true}
    }
    if (method === 'GET' && parts.length === 0) return this.catalog()
    if (method === 'POST' && path === '/organizations') return this.cloud('enterprises', z.object({ name }).parse(input))
    if (method === 'POST' && path === '/join') {
      const { invitation } = z.object({ invitation: z.string().trim().min(1).max(2048) }).parse(input)
      let token = invitation
      if (invitation.includes('://')) {
        const url = new URL(invitation)
        if (url.origin !== this.origin || !url.pathname.startsWith('/invite/')) throw new SuiteError('IPW_INVALID_INVITATION', 400)
        token = url.pathname.slice('/invite/'.length)
      }
      if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new SuiteError('IPW_INVALID_INVITATION', 400)
      return this.cloud('invitations/' + token + '/accept', {})
    }
    if (method === 'POST' && path === '/assign') return this.assign(input)
    if (parts[0] === 'organizations' && parts[1]) {
      const base = 'enterprises/' + id.parse(parts[1])
      if (method === 'GET' && parts.length === 2) return this.detail(parts[1])
      if (method === 'POST' && parts[2] === 'departments' && parts.length === 3) return this.cloud(base + '/departments', z.object({ name }).parse(input))
      if (method === 'POST' && parts[2] === 'invitations' && parts.length === 3) return this.cloud(base + '/invitations', z.object({ email: z.email(), role: z.enum(['admin','member']), departmentId: id.nullable() }).parse(input))
      if (method === 'DELETE' && parts[2] === 'invitations' && parts.length === 4) return this.cloud(base + '/invitations/' + id.parse(parts[3]), undefined, 'DELETE')
      if (parts[2] === 'departments' && parts.length === 4) {
        if (method === 'PATCH') return this.cloud(base + '/departments/' + id.parse(parts[3]), z.object({ name }).parse(input), 'PATCH')
        if (method === 'DELETE') return this.cloud(base + '/departments/' + id.parse(parts[3]), undefined, 'DELETE')
      }
      if (method === 'GET' && parts[2] === 'assets' && parts.length === 3) return assetsResponse.parse(await this.cloud(base + '/assets')) satisfies EnterpriseAssets
      if (method === 'PUT' && parts[2] === 'grants' && parts.length === 3)
        return this.cloud(base + '/grants', z.object({ kind: z.enum(['package', 'skill', 'service']), assetId: id, audience }).parse(input), 'PUT')
      if (parts[2] === 'packages') {
        if (method === 'POST' && parts.length === 3) return this.cloud(base + '/packages', z.object({ title: name, description: description.optional(), audience: audience.optional() }).parse(input))
        const target = parts[3] ? base + '/packages/' + id.parse(parts[3]) : ''
        if (method === 'GET' && parts.length === 4) return packageResponse.parse(await this.cloud(target)) satisfies PackageDetail
        if (method === 'PATCH' && parts.length === 4) return this.cloud(target, z.object({ title: name.optional(), description: description.optional() }).parse(input), 'PATCH')
        if (method === 'DELETE' && parts.length === 4) return this.cloud(target, undefined, 'DELETE')
        if (method === 'DELETE' && parts.length === 6 && parts[4] === 'files') return this.cloud(target + '/files/' + id.parse(parts[5]), undefined, 'DELETE')
      }
      if (parts[2] === 'skills') {
        if (method === 'POST' && parts.length === 3)
          return this.cloud(base + '/skills', z.object({ title: name, description: z.string().trim().min(1).max(1000), content: z.string().trim().min(1).max(200_000), audience: audience.optional() }).parse(input))
        if (method === 'DELETE' && parts.length === 4) return this.cloud(base + '/skills/' + id.parse(parts[3]), undefined, 'DELETE')
      }
      if (parts[2] === 'services') {
        if (method === 'GET' && parts.length === 3) return modelsResponse.parse(await this.cloud(base + '/services')).items satisfies EnterpriseModel[]
        if (method === 'PUT' && parts.length === 3) return this.cloud(base + '/services', z.object({
          id: id.optional(), title: name, baseUrl: httpUrl, key: key.optional(), headerName: headerName.optional(), headerPrefix: headerPrefix.optional(),
          models: z.array(modelEntry).max(200), enabled: z.boolean().optional(), audience: audience.optional(),
        }).strict().parse(input), 'PUT')
        if (method === 'POST' && parts.length === 4 && parts[3] === 'probe') return probeResponse.parse(await this.cloud(base + '/services/probe', z.object({
          serviceId: id.optional(), baseUrl: httpUrl, key: key.optional(), headerName: headerName.optional(), headerPrefix: headerPrefix.optional(), model: z.string().min(1).max(200).optional(),
        }).strict().parse(input))) satisfies ModelProbe
        if (method === 'DELETE' && parts.length === 4) return this.cloud(base + '/services/' + id.parse(parts[3]), undefined, 'DELETE')
      }
      if (parts[2] === 'members' && parts.length === 4) {
        if (method === 'PATCH') return this.cloud(base + '/members/' + id.parse(parts[3]), z.object({ role: z.enum(['admin','member']), departmentId: id.nullable() }).parse(input), 'PATCH')
        if (method === 'DELETE') return this.cloud(base + '/members/' + id.parse(parts[3]), undefined, 'DELETE')
      }
    }
    if (method === 'GET' && parts[0] === 'projects' && parts[1] && parts[2] === 'collaboration' && parts.length===3) {
      const result=z.object({project:z.object({id,title:name,enterpriseId:id.nullable()}),works:z.array(row),updates:z.array(row)}).parse(await this.cloud('projects/'+id.parse(parts[1])+'/collaboration'))
      return {project:result.project,works:result.works.map(projectWork),updates:result.updates.map(projectUpdate)} satisfies ProjectCollaboration
    }
    if (method === 'POST' && path === '/work') {
      throw new SuiteError('PROJECT_SPACE_REQUIRED',410)
    }
    if (parts[0] === 'work' && parts[1]) {
      const base='work/'+id.parse(parts[1])
      if(method==='GET'&&parts.length===2) {
        const result=z.object({work:row,content:z.string(),versions:z.array(row)}).parse(await this.cloud(base))
        return {work:projectWork(result.work),content:result.content,versions:result.versions.map(projectUpdate)} satisfies WorkDetail
      }
      if(method==='GET'&&parts[2]==='revisions'&&parts.length===4) return this.cloud(base+'/revisions/'+z.coerce.number().int().positive().parse(parts[3]))
      if(method==='POST'&&parts[2]==='revisions'&&parts.length===3) return this.cloud(base+'/revisions',z.object({title:name,content:z.string().trim().min(1).max(100000),expectedVersion:z.number().int().nonnegative()}).parse(input))
    }
    if (method === 'GET' && parts[0] === 'preview' && parts.length === 2) return this.preview(id.parse(parts[1]))
    if (method === 'POST' && path === '/shares') {
      throw new SuiteError('NATIVE_SHARING_REQUIRED',410)
    }
    if (parts[0] === 'shares' && parts[1]) {
      const shareId = id.parse(parts[1])
      if (method === 'GET' && parts.length === 2) return this.shared(shareId)
      if (method === 'DELETE' && parts.length === 2) return this.cloud('shares/' + shareId, undefined, 'DELETE')
      if (method === 'POST' && parts[2] === 'comments' && parts.length === 3) return this.cloud('shares/' + shareId + '/comments', z.object({ content: z.string().trim().min(1).max(10000) }).parse(input))
    }
    throw new SuiteError('IPW_NOT_FOUND', 404)
  }
}
