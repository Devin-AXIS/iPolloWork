import { randomUUID, createHash } from 'node:crypto'
import type { OpsService } from './service.js'
import { config } from './config.js'
import type { BrowserJob, SessionOperation } from './types.js'

export const searchSorts = { general: '综合', newest: '最新', likes: '最多点赞', comments: '最多评论', collections: '最多收藏' }
export interface PostDraft {
  id: string; accountId: number; name: string; title: string; body: string; topics: string[]
  mediaKind: 'image' | 'video'; assetIds: string[]; brief: string; updatedAt: string; jobId: string | null; status: string
}
export interface PostCandidate {
  id: string; url: string; title: string; author: string; excerpt: string; publishedAt: string | null
  likes: number | null; comments: number | null; collections: number | null
  selected: boolean; comment: string; reason: string; jobId: string | null; status: string
}
export interface PostSearch {
  id: string; accountId: number; query: string; sort: keyof typeof searchSorts; limit: number
  exclude: string; instruction: string; results: PostCandidate[]; status: string; error: string; updatedAt: string
}

function text(value: unknown, name: string, max: number, required = false): string {
  if (value === undefined || value === null) { if (required) throw new Error(`${name}不能为空`); return '' }
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name}格式或长度无效`)
  if (required && !value.trim()) throw new Error(`${name}不能为空`)
  return value.trim()
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`列表最多 ${max} 项`)
  return value
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('数据格式无效')
  return Object.fromEntries(Object.entries(value))
}
function metric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('指标应为非负整数，未知时留空')
  return value
}
export function postIdentity(raw: string): string {
  const url = new URL(raw)
  if (url.origin !== new URL(config.xhs.webUrl).origin || url.username || url.password || !/^\/(explore|search_result|discovery\/item|note)\/[^/]+\/?$/.test(url.pathname)) throw new Error('请提供真实的小红书帖子链接')
  return url.pathname.split('/').filter(Boolean).at(-1)!
}
const stamp = () => new Date().toISOString()

export class StudioService {
  constructor(readonly ops: OpsService) {}
  account(id: unknown) {
    const accountId = Number(id)
    if (!Number.isSafeInteger(accountId) || accountId < 1) throw new Error('请选择账号')
    const account = this.ops.db.getAccount(accountId)
    if (!account?.enabled) throw new Error('账号不存在或已停用')
    return account
  }
  draft(id: unknown, accountId?: number): PostDraft {
    const row = this.ops.db.database.prepare('SELECT * FROM post_drafts WHERE id = ?').get(text(id, '草稿 ID', 80, true))
    if (!row || typeof row.data_json !== 'string' || accountId !== undefined && Number(row.account_id) !== accountId) throw new Error('找不到当前账号的草稿')
    this.account(row.account_id)
    const saved: PostDraft = JSON.parse(row.data_json)
    const jobId = typeof row.job_id === 'string' ? row.job_id : null
    return { ...saved, jobId, status: jobId ? this.ops.db.getJob(jobId)?.status ?? 'failed' : 'draft' }
  }
  search(id: unknown, accountId?: number): PostSearch {
    const row = this.ops.db.database.prepare('SELECT * FROM post_searches WHERE id = ?').get(text(id, '搜索 ID', 80, true))
    if (!row || typeof row.data_json !== 'string' || accountId !== undefined && Number(row.account_id) !== accountId) throw new Error('找不到当前账号的搜索')
    this.account(row.account_id)
    const saved: PostSearch = JSON.parse(row.data_json)
    const ids = saved.results.flatMap(item => item.jobId ? [item.jobId] : [])
    const jobs = ids.length ? this.ops.db.database.prepare(`SELECT id,status FROM browser_jobs WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []
    const statuses = new Map(jobs.map(job => [String(job.id), String(job.status)]))
    return { ...saved, results: saved.results.map(item => ({ ...item, status: item.jobId ? statuses.get(item.jobId) ?? 'failed' : item.status })) }
  }
  state(accountId: unknown, selection: { searchId?: unknown; draftId?: unknown } = {}) {
    const account = this.account(accountId)
    const drafts = this.ops.db.database.prepare('SELECT d.data_json,d.job_id,j.status FROM post_drafts d LEFT JOIN browser_jobs j ON j.id=d.job_id WHERE d.account_id=? ORDER BY d.updated_at DESC LIMIT 50').all(account.id).map(row => {
      const draft: PostDraft = JSON.parse(String(row.data_json))
      return { ...draft, jobId: row.job_id ? String(row.job_id) : null, status: row.status ? String(row.status) : 'draft' }
    })
    const searches = this.ops.db.database.prepare('SELECT data_json FROM post_searches WHERE account_id=? ORDER BY updated_at DESC LIMIT 10').all(account.id).map(row => {
      const search: PostSearch = JSON.parse(String(row.data_json))
      return { ...search, results: [] }
    })
    const selectedSearch = selection.searchId ? this.search(selection.searchId, account.id) : searches[0] ? this.search(searches[0].id, account.id) : null
    const selectedDraft = selection.draftId && selection.draftId !== 'new' ? this.draft(selection.draftId, account.id) : drafts[0]
    const assets = [...new Map([...this.ops.db.listAssets(100), ...this.ops.db.getAssets(selectedDraft?.assetIds ?? [])].map(asset => [asset.id, asset])).values()]
    return {
      account,
      drafts: selectedDraft && !drafts.some(item => item.id === selectedDraft.id) ? [selectedDraft, ...drafts] : drafts,
      searches: selectedSearch ? [selectedSearch, ...searches.filter(item => item.id !== selectedSearch.id)] : [],
      assets: assets.map(asset => ({ ...asset, url: `/media/${asset.id}` })),
    }
  }
  saveDraft(input: Record<string, unknown>): PostDraft {
    const account = this.account(input.accountId)
    const dedupeId = this.operationId(account.id, input.runKey)
    if (!input.id && dedupeId && this.ops.db.database.prepare('SELECT id FROM post_drafts WHERE id=?').get(dedupeId)) return this.draft(dedupeId, account.id)
    const previous = input.id ? this.draft(input.id, account.id) : null
    if (previous?.jobId) throw new Error('该草稿已进入发布流程；请另存一份再修改')
    if (input.expectedUpdatedAt !== undefined && text(input.expectedUpdatedAt, '生成版本', 40, true) !== previous?.updatedAt) {
      throw new Error('草稿已修改，本轮 AI 结果未覆盖新内容。请按当前要求重新生成。')
    }
    // Updates only replace supplied fields, so AI copy edits preserve the brief and media.
    if (previous) input = { ...previous, ...input }
    const assetIds = [...new Set(array(input.assetIds ?? [], 9).map(value => text(value, '素材 ID', 80, true)))]
    const assets = this.ops.db.getAssets(assetIds)
    if (assets.length !== assetIds.length) throw new Error('部分素材不存在')
    if (input.mediaKind !== undefined && input.mediaKind !== 'image' && input.mediaKind !== 'video') throw new Error('帖子类型无效')
    const mediaKind = input.mediaKind === 'video' ? 'video' : 'image'
    if (assets.length && (mediaKind === 'video' ? assets.length !== 1 || assets[0]?.mimeType !== 'video/mp4' : assets.some(asset => !asset.mimeType.startsWith('image/')))) throw new Error('所选素材与帖子类型不一致')
    const draft: PostDraft = {
      id: previous?.id ?? dedupeId ?? randomUUID(), accountId: account.id, name: text(input.name, '预设名称', 80) || '未命名草稿',
      title: text(input.title, '标题', 100), body: text(input.body, '描述', 10000), brief: text(input.brief, '创作要求', 4000),
      topics: array(input.topics ?? [], 10).map(value => text(value, '话题', 50, true)), assetIds, mediaKind,
      updatedAt: new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString(), jobId: null, status: 'draft',
    }
    for (const value of [draft.name, draft.title, draft.body, draft.brief, ...draft.topics]) {
      const questionCount = value.match(/\?/g)?.length ?? 0
      if (value.includes('\uFFFD') || (/\?{4,}/.test(value) && questionCount > value.length / 3)) {
        throw new Error('草稿包含疑似编码损坏的文字，未覆盖原内容。请使用插件 save-post-draft 操作以 UTF-8 保存，并重新读取核对。')
      }
    }
    this.ops.db.database.prepare('INSERT INTO post_drafts(id,account_id,data_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at')
      .run(draft.id, account.id, JSON.stringify(draft), draft.updatedAt)
    return draft
  }
  createSearch(input: Record<string, unknown>): PostSearch {
    const account = this.account(input.accountId)
    const dedupeId = this.operationId(account.id, input.runKey)
    if (dedupeId && this.ops.db.database.prepare('SELECT id FROM post_searches WHERE id=?').get(dedupeId)) return this.search(dedupeId, account.id)
    const limit = Number(input.limit ?? 5)
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('每批请选择 1–20 篇帖子')
    const sort = input.sort ?? 'general'
    if (sort !== 'general' && sort !== 'newest' && sort !== 'likes' && sort !== 'comments' && sort !== 'collections') throw new Error('排序方式无效')
    const search: PostSearch = { id: dedupeId ?? randomUUID(), accountId: account.id, query: text(input.query, '关键词', 100, true), sort, limit,
      exclude: text(input.exclude, '排除词', 500), instruction: text(input.instruction, '评论要求', 3000), results: [], status: 'pending', error: '', updatedAt: stamp() }
    this.persistSearch(search)
    return search
  }
  private operationId(accountId: number, key: unknown) {
    const runKey = text(key, '运行标识', 700)
    return runKey ? 'run_' + createHash('sha256').update(JSON.stringify([accountId, runKey])).digest('hex') : null
  }
  private persistSearch(search: PostSearch) {
    search.updatedAt = stamp()
    this.ops.db.database.prepare('INSERT INTO post_searches(id,account_id,data_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at')
      .run(search.id, search.accountId, JSON.stringify(search), search.updatedAt)
  }
  saveResults(input: Record<string, unknown>): PostSearch {
    const search = this.search(input.searchId, this.account(input.accountId).id)
    if (search.results.some(item => item.jobId)) throw new Error('搜索结果已用于评论；请创建新的搜索')
    const seen = new Set<string>()
    const candidates = array(input.results, 100)
    if (!candidates.length && search.status === 'waiting_login') throw new Error('请先完成登录并继续搜索，登录阻塞不能保存为无结果')
    const results = candidates.map(value => {
      const item = record(value)
      const url = text(item.url, '帖子链接', 2000, true)
      const id = postIdentity(url)
      if (seen.has(id)) throw new Error('搜索结果包含重复帖子')
      seen.add(id)
      const publishedAt = text(item.publishedAt, '发布时间', 40)
      if (publishedAt && !Number.isFinite(Date.parse(publishedAt))) throw new Error('发布时间无效')
      const candidate: PostCandidate = { id, url, title: text(item.title, '帖子标题', 300, true), author: text(item.author, '作者', 200), excerpt: text(item.excerpt, '帖子摘要', 4000),
        publishedAt: publishedAt || null, likes: metric(item.likes), comments: metric(item.comments), collections: metric(item.collections), selected: false, comment: '', reason: '', jobId: null, status: 'draft' }
      return candidate
    })
    search.results = results
    search.status = 'ready'
    search.error = ''
    this.persistSearch(search)
    return search
  }
  updateCandidates(input: Record<string, unknown>): PostSearch {
    const search = this.search(input.searchId, this.account(input.accountId).id)
    if (input.instruction !== undefined) search.instruction = text(input.instruction, '评论要求', 3000)
    if (input.exclude !== undefined) search.exclude = text(input.exclude, '排除词', 500)
    if (input.limit !== undefined) {
      if (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20) throw new Error('每批请选择 1–20 篇帖子')
      search.limit = input.limit
    }
    const changes = array(input.items, 100).map(record)
    const seen = new Set<string>()
    for (const change of changes) {
      const id = text(change.id, '帖子 ID', 200, true)
      const item = search.results.find(item => item.id === id)
      if (!item || seen.has(id)) throw new Error('只能修改当前列表中的不同帖子')
      seen.add(id)
      if (item.jobId) throw new Error('已进入评论流程的帖子不可修改')
      if (typeof change.selected !== 'boolean') throw new Error('请选择是否评论')
      item.selected = change.selected
      item.comment = text(change.comment, '评论', 1000)
      item.reason = text(change.reason, '筛选理由', 1000)
    }
    if (search.results.filter(item => item.selected).length > search.limit) throw new Error(`本批最多选择 ${search.limit} 篇`)
    this.persistSearch(search)
    return search
  }
  async prepareDraft(input: Record<string, unknown>, sessionId: string): Promise<BrowserJob> {
    const draft = this.draft(input.draftId, this.account(input.accountId).id)
    if (draft.jobId) return this.ops.db.resumePreparedSessionJob(draft.jobId, sessionId)
    if (!draft.assetIds.length) throw new Error('请先生成或选择素材')
    const job = await this.ops.prepareSessionOperation({ accountId: draft.accountId, sessionId, runKey: `draft:${draft.id}`, operationKey: 'publish', type: 'publish_note',
      title: text(draft.title, '标题', 100, true), body: text(draft.body, '描述', 10000, true), topics: draft.topics, cards: [], mediaAssetIds: draft.assetIds, mediaKind: draft.mediaKind, targetUrl: '', targetAuthor: '', targetCommentText: '' })
    this.ops.db.database.prepare('UPDATE post_drafts SET job_id=?,updated_at=? WHERE id=?').run(job.id, stamp(), draft.id)
    return job
  }
  async prepareBatch(input: Record<string, unknown>, sessionId: string) {
    const search = this.search(input.searchId, this.account(input.accountId).id)
    const candidates = search.results.filter(item => item.selected)
    if (!candidates.length || candidates.length > search.limit) throw new Error('请先选择要评论的帖子')
    for (const item of candidates) if (!item.comment) throw new Error(`请先填写“${item.title}”的评论`)
    const jobs: BrowserJob[] = []
    const skipped: Array<{ id: string; reason: string }> = []
    for (const item of candidates) {
      if (item.jobId) { jobs.push(this.ops.db.resumePreparedSessionJob(item.jobId, sessionId)); continue }
      const excluded = search.exclude.split(/[,，\n]/).map(word => word.trim().toLowerCase()).filter(Boolean)
      if (excluded.some(word => `${item.title}\n${item.excerpt}`.toLowerCase().includes(word))) { item.status = 'skipped'; item.reason = '命中排除词，已跳过'; skipped.push({ id: item.id, reason: item.reason }); continue }
      const existing = this.ops.db.database.prepare("SELECT id FROM browser_jobs WHERE account_id=? AND type='create_comment' AND json_extract(payload_json,'$.evidence.studioPostId')=? AND status NOT IN ('cancelled','skipped') LIMIT 1").get(search.accountId, item.id)
      if (existing) { item.status = 'skipped'; item.selected = false; item.reason = '该账号已有评论记录，已跳过'; skipped.push({ id: item.id, reason: item.reason }); continue }
      const operation: SessionOperation = { accountId: search.accountId, sessionId, runKey: `comment:${search.accountId}:${item.id}`, operationKey: 'comment', type: 'create_comment', title: '', body: item.comment, topics: [], cards: [], targetUrl: item.url, targetAuthor: '', targetCommentText: '' }
      const job = await this.ops.prepareSessionOperation(operation)
      this.ops.db.database.prepare('UPDATE browser_jobs SET payload_json=? WHERE id=?').run(JSON.stringify({ ...job.payload, evidence: { ...job.payload.evidence, studioPostId: item.id } }), job.id)
      item.jobId = job.id
      jobs.push(job)
      this.persistSearch(search)
    }
    this.persistSearch(search)
    return { jobs, skipped }
  }
  async execute(action: string, input: Record<string, unknown>, sessionId = ''): Promise<unknown> {
    switch (action) {
      case 'studio-state': return this.state(input.accountId, input)
      case 'save-post-draft': return { draft: this.saveDraft(input) }
      case 'create-post-search': return { search: this.createSearch(input) }
      case 'save-search-results': return { search: this.saveResults(input) }
      case 'update-comment-candidates': return { search: this.updateCandidates(input) }
      case 'prepare-draft-publish': if (!sessionId) throw new Error('请在主软件会话中执行'); return { job: await this.prepareDraft(input, sessionId) }
      case 'prepare-comment-batch': if (!sessionId) throw new Error('请在主软件会话中执行'); return this.prepareBatch(input, sessionId)
      case 'set-search-error': {
        const search = this.search(input.searchId, this.account(input.accountId).id)
        const error = text(input.error, '原因', 2000, true)
        if (input.code !== undefined && input.code !== 'login_required') throw new Error('搜索错误类型无效')
        search.status = input.code === 'login_required' ? 'waiting_login' : 'failed'
        search.error = error
        this.persistSearch(search)
        return { search }
      }
      case 'request-action': {
        if (input.kind === 'resume-search') {
          const search = this.search(input.searchId, this.account(input.accountId).id)
          if (!['waiting_login', 'failed'].includes(search.status) || search.results.some(item => item.jobId)) throw new Error('该搜索无需继续，请查看执行进度或重新搜索')
          search.status = 'pending'; search.error = ''
          this.persistSearch(search)
          // Resuming discovery never resumes an interrupted automatic comment batch.
          return { prompt: this.prompt({ ...input, kind: 'search' }), search }
        }
        if (input.kind !== 'draft') return { prompt: this.prompt(input) }
        // The button supplies the current form inputs. Never save or reuse the old copy first.
        const brief = text(input.brief, '创作要求', 4000, true)
        const current = Object.fromEntries(['name', 'mediaKind', 'assetIds'].filter(key => input[key] !== undefined).map(key => [key, input[key]]))
        const draft = this.saveDraft({ accountId: input.accountId, id: input.draftId,
          ...current, brief,
          title: '', body: '', topics: [] })
        return { prompt: this.prompt({ ...input, draftId: draft.id }), draft }
      }
      default: throw new Error('不支持的操作')
    }
  }
  prompt(input: Record<string, unknown>): string {
    const account = this.account(input.accountId)
    const kind = text(input.kind, '操作', 40, true)
    const browser = `浏览器打开时必须传 ${JSON.stringify({ url: account.profileUrl, ...(account.browserProfileId ? { profileId: `xiaohongshu-ops:${account.browserProfileId}` } : {}) })} 并保存返回的 tabId；后续快照与操作显式使用这个 tabId。不得退出另一个账号。\n`
    const base = `使用小红书运营台插件，先阅读 xhs-ops-worker 技能。仅操作账号 ${account.displayName}（小红书号 ${account.expectedProfileId}，accountId=${account.id}）。\n通过原生 ipollowork_extension_call（extensionId="xiaohongshu-ops", action=下述操作名, args=结构化参数）将结果写回界面。草稿编辑和素材生成不需要打开浏览器或验证登录。保存后用 studio-state 重新读取，核对内容与本次要求一致再报告完成；不要直接修改数据库或通过 PowerShell 拼接 HTTP 请求。\n${['draft', 'image', 'video', 'search'].includes(kind) ? '' : browser}`
    if (['draft', 'image', 'video', 'publish'].includes(kind)) {
      const draft = this.draft(input.draftId, account.id)
      if (kind === 'draft') {
        const source = { name: draft.name, brief: text(draft.brief, '创作要求', 4000, true), mediaKind: draft.mediaKind }
        const target = { id: draft.id, accountId: account.id, expectedUpdatedAt: draft.updatedAt }
        return base + `本次是从零重新生成标题、描述与话题，不是润色或续写。唯一创作依据：${JSON.stringify(source)}。\n`
          + '以当前创作要求中的对象为准；不要沿用会话历史、旧草稿、旧话题或已选素材中的产品与描述。不要将未提供的参数或亲身体验编造成事实。\n'
          + `调用 save-post-draft，原样传入 ${JSON.stringify(target)}，另加新生成的 title、body、topics，完整替换文案。不要传 name、brief、mediaKind 或 assetIds；图片和视频由素材按钮单独生成。若提示草稿已修改，停止回写，不得移除 expectedUpdatedAt 强行覆盖。只准备草稿，不发布。`
      }
      const data = `草稿：${JSON.stringify(draft)}。\n`
      if (kind === 'image' || kind === 'video') return base + data + `为这篇帖子生成${kind === 'image' ? '图片' : '视频'}素材。先检查${kind === 'image' ? '图片工作台 image-studio 的 status 和 generate-image' : '视频工作台 video-console 的 status、submit、jobs'}接口和已配置模型，再调用相应工作台完成生成。${kind === 'video' ? '保持同一个 requestId，等待任务完成并获取实际输出的工作区路径。' : ''}若模型不可用，报告实际原因，不伪造素材。生成完成后调用小红书 import-media（sourcePath=真实工作区文件路径），再调用 save-post-draft 将返回 asset.id 绑定到草稿的 assetIds（保留标题描述等字段；${kind === 'image' ? 'mediaKind=image，可生成多张，总数不超过9' : 'mediaKind=video，只绑定1个MP4'}）。只准备素材，不发布。`
      return base + data + '用户已点击发布帖子，授权发布这个草稿。调用 prepare-draft-publish（accountId、draftId），按返回的锁定内容与素材执行；图文和视频使用对应发布入口。先核对实际账号再 claim-job；只提交一次，看到成功记录才 complete-job。遇阻 block-job，结果不确定 uncertain-job。已有成功结果直接返回，不重复发布。'
    }
    const search = this.search(input.searchId, account.id)
    const searchUrl = new URL('/search_result', config.xhs.webUrl)
    searchUrl.searchParams.set('keyword', search.query)
    searchUrl.searchParams.set('source', 'web_explore_feed')
    const data = `搜索配置：${JSON.stringify({ ...search, results: undefined })}。使用 studio-state（accountId=${account.id}、searchId=${JSON.stringify(search.id)}）读取此搜索的候选内容。\n`
    const discover = `直接调用 ipollowork_browser_open_url，原样传入 ${JSON.stringify({ url: searchUrl.href, ...(account.browserProfileId ? { profileId: `xiaohongshu-ops:${account.browserProfileId}` } : {}) })}，保存返回 tabId，后续快照与操作显式使用此 tabId。复用该账号已保存的网页登录，不需要先打开创作后台，不退出或切换其他账号。\n`
      + `这是重新读取网页的搜索请求，不能沿用上次的登录失败结论。先等待搜索页加载并重新快照；扫码后若仍停在旧登录提示，通过页面上的搜索框重新提交同一个关键词 ${JSON.stringify(search.query)}，再等待结果。已看到帖子就直接读取，不要求重复扫码。创作后台登录不等于搜索网页已登录。\n`
      + `只有当前搜索页确实要求登录时，才请用户在本次 tabId 对应页面扫码，并调用 set-search-error（accountId=${account.id}, searchId=${JSON.stringify(search.id)}, code="login_required", error=实际提示），保留搜索记录，不调用 save-search-results 写空结果。告知扫码后回评论页点击“扫码完成，继续搜索”。验证码或其他错误用 set-search-error 回写原因，不将其报告成没有帖子。\n`
      + `从可见界面切换“${searchSorts[search.sort]}”排序，最多查看100篇候选或5个可见分页。先保存首屏候选：从浏览器快照中读取 link 的 url 和标题，保留完整查询参数；作者、点赞等取可见值。不要为了收集搜索结果逐篇强制打开详情；看不到正文时 excerpt 用空字符串，看不到指标或完整日期用null，不能用标题编造摘要。无标题的卡片可跳过。详情留到用户筛选或评论时再打开。立即调用 save-search-results（accountId、searchId、results；每项url/title/author/excerpt/likes/comments/collections/publishedAt）。只有页面明确显示无匹配结果才保存 results=[]。不使用隐藏接口，不伪造帖子。保存后通过 studio-state 确认该搜索已 ready 且结果回写。\n`
    const select = `逐条阅读帖子内容，按关键词、排除词及评论要求筛选相关帖子，最多选${search.limit}篇。为每篇写与实际内容相关的自然评论，不重复复制套话、不虚构自身体验。调用 update-comment-candidates（accountId、searchId、items，每项id/selected/comment/reason），只修改已返回列表中的ID。\n`
    const send = '用户已授权发送选中帖子的评论。调用 prepare-comment-batch（accountId、searchId），逐个执行返回的job；每次打开目标帖携带账号profileId并用返回tabId核对身份和上下文，再claim-job、发送一次、确认后complete-job。已有评论、已完成或结果不确定的操作不得再次发送。遇阻回写对应任务，不报告虚假成功。'
    if (kind === 'search') return base + data + discover + '只搜索并保存候选，不发表评论。'
    if (kind === 'polish') return base + data + '只润色已选中帖子的评论，结合原帖上下文和评论要求，保留原意。调用 update-comment-candidates 保存，保留selected。不发送评论。'
    if (kind === 'select') return base + data + select + '只筛选并写候选评论，不发送。'
    if (kind === 'comment') return base + data + send
    if (kind === 'auto-comment') return base + data + discover + select + send
    throw new Error('不支持的操作')
  }
}
