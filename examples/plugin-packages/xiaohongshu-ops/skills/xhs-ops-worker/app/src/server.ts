import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import sharp from 'sharp'
import { config } from './config.js'
import { analyticsCsvHeader, parsePlatformCsv } from './analytics.js'
import { observeBrowserSession, prepareSessionVerification } from './verification.js'
import { OpsDatabase } from './db.js'
import { OpsService, startContentScheduler } from './service.js'
import type { AccountSessionStatus, CampaignSchedule, CampaignStatus, DiscoveredComment, KnowledgeItem, SessionOperation } from './types.js'
import { renderAccounts, renderAnalytics, renderBrand, renderError, renderInteractions, renderJobs } from './views.js'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}

function text(value: unknown, name: string, max = 10_000): string {
  if (typeof value !== 'string') throw new Error(`${name}必须是文本`)
  const result = value.trim()
  if (!result) throw new Error(`${name}不能为空`)
  if (result.length > max) throw new Error(`${name}过长`)
  return result
}

function optionalText(value: unknown, max = 10_000): string | null {
  if (value === undefined || value === null || value === '') return null
  return text(value, '字段', max)
}

function stringArray(value: unknown, name: string, maxItems = 100): string[] {
  if (!Array.isArray(value)) throw new Error(`${name}必须是数组`)
  const result = [...new Set(value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : []))]
  if (result.length > maxItems) throw new Error(`${name}数量过多`)
  return result
}

function numberArray(value: unknown, name: string, maxItems = 30): number[] {
  if (!Array.isArray(value)) throw new Error(`${name}必须是数组`)
  const result = [...new Set(value.map(Number).filter((item) => Number.isInteger(item) && item > 0))]
  if (result.length > maxItems) throw new Error(`${name}数量过多`)
  return result
}

function integer(value: unknown, name: string, min: number, max: number): number {
  const result = Number(value)
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`${name}必须在 ${min}-${max} 之间`)
  return result
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name}必须是布尔值`)
  return value
}

function xiaohongshuUrl(value: unknown): string {
  const result = text(value, '创作台地址', 500)
  if (!result.startsWith('https://www.xiaohongshu.com/') && !result.startsWith('https://creator.xiaohongshu.com/')) throw new Error('创作台地址必须来自小红书')
  return result
}

function hasApiToken(value: string | undefined): boolean {
  if (!value?.startsWith('Bearer ')) return false
  const supplied = Buffer.from(value.slice(7))
  const expected = Buffer.from(config.apiToken)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function validateSchedule(value: unknown): CampaignSchedule {
  if (!value || typeof value !== 'object') throw new Error('排期配置无效')
  const schedule = value as Record<string, unknown>
  const kind = schedule.kind === 'weekly' ? 'weekly' : 'single'
  const timezone = schedule.timezone === 'Asia/Singapore' ? 'Asia/Singapore' : 'Asia/Shanghai'
  const scheduledLocal = optionalText(schedule.scheduledLocal, 30)
  const publishTime = optionalText(schedule.publishTime, 10)
  const weekdays = Array.isArray(schedule.weekdays)
    ? [...new Set(schedule.weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))] : []
  if (kind === 'single' && (!scheduledLocal || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduledLocal))) throw new Error('单次活动必须选择发布时间')
  if (kind === 'weekly' && (!weekdays.length || !publishTime || !/^\d{2}:\d{2}$/.test(publishTime))) throw new Error('循环活动必须选择星期和时间')
  return { kind, timezone, scheduledLocal: kind === 'single' ? scheduledLocal : null, weekdays: kind === 'weekly' ? weekdays : [], publishTime: kind === 'weekly' ? publishTime : null }
}

function state(service: OpsService): string {
  const db = service.db
  return JSON.stringify({ counts: db.counts(), accounts: db.listAccounts().map((item) => [item.id, item.sessionStatus, item.updatedAt]), campaigns: db.listCampaigns().map((item) => [item.id, item.status, item.updatedAt]), jobs: db.listJobs(100).map((item) => [item.id, item.status, item.updatedAt]) })
}

export function createApp(service: OpsService): Hono {
  const app = new Hono()

  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https://*.xhscdn.com', 'https://*.xiaohongshu.com'], styleSrc: ["'self'"], scriptSrc: ["'self'"],
      connectSrc: ["'self'"], frameAncestors: config.embedOrigins.length ? config.embedOrigins : ["'none'"], formAction: ["'self'"],
    },
    referrerPolicy: 'no-referrer',
    xFrameOptions: config.embedOrigins.length ? false : 'SAMEORIGIN',
  }))
  app.use('*', bodyLimit({ maxSize: 20 * 1024 * 1024, onError: (c) => c.json({ error: '请求内容超过 20 MB' }, 413) }))
  app.use('*', async (c, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) return next()
    if (hasApiToken(c.req.header('Authorization'))) return next()
    const origin = c.req.header('Origin')
    const referer = c.req.header('Referer')
    if (origin !== config.origin && !referer?.startsWith(`${config.origin}/`)) return c.json({ error: '跨来源请求已拒绝' }, 403)
    return next()
  })
  app.use('/assets/*', serveStatic({ root: resolve(config.projectRoot, 'public'), rewriteRequestPath: (path) => path.replace(/^\/assets/, '') }))
  app.use('/icons/*', serveStatic({ root: resolve(config.projectRoot, 'node_modules/@tabler/icons-webfont/dist'), rewriteRequestPath: (path) => path.replace(/^\/icons/, '') }))

  app.get('/healthz', (c) => c.json({
    ok: true, service: 'xiaohongshu-ops', origin: config.origin, timezone: config.timezone,
    codexAvailable: existsSync(config.codex.executable), wakeLockEnabled: config.wakeLockEnabled,
    embedded: config.embedOrigins.length > 0,
    uptimeSeconds: Math.round(process.uptime()), counts: service.db.counts(),
  }))
  app.get('/api/state', (c) => { c.header('Cache-Control', 'no-store'); return c.json({ state: state(service) }) })

  // Previously opened workbench tabs may still point to the retired task routes.
  app.get('/', (c) => c.redirect('/accounts'))
  app.get('/tasks', (c) => c.redirect('/accounts'))
  app.get('/calendar', (c) => c.redirect('/accounts'))
  app.get('/accounts', (c) => c.html(renderAccounts(service.db.listAccounts())))
  app.get('/analytics', (c) => {
    const accounts = service.db.listAccounts()
    const accountId = c.req.query('account')
    const account = accountId === undefined ? accounts[0] : accounts.find(item => String(item.id) === accountId)
    if (accountId !== undefined && !account) return c.html(renderError('账号不存在', '请返回数据页选择已接入的账号。', 404), 404)
    const requestedPage = Number(c.req.query('page') || 1)
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    c.header('Cache-Control', 'no-store')
    return c.html(renderAnalytics({ accounts, account, content: account ? service.db.accountContent(account.id, page) : null, platform: account ? service.db.getPlatformSnapshot(account.id) : null }))
  })
  app.get('/analytics/template.csv', (c) => {
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', 'attachment; filename="xiaohongshu-data.csv"')
    return c.body('\uFEFF' + analyticsCsvHeader + '\r\n')
  })
  app.post('/api/accounts/:id/analytics', async (c) => {
    try {
      const account = service.db.getAccount(integer(c.req.param('id'), '账号 ID', 1, Number.MAX_SAFE_INTEGER))
      if (!account) return c.json({ error: '账号不存在' }, 404)
      const body = await c.req.json<Record<string, unknown>>()
      const snapshot = parsePlatformCsv(text(body.csv, 'CSV', 500_000), account.expectedProfileId)
      service.db.savePlatformSnapshot(account.id, snapshot)
      return c.json({ ok: true, importedAt: snapshot.importedAt, articles: snapshot.articles.length })
    } catch (error) { return c.json({ error: errorMessage(error) }, 400) }
  })
  app.get('/brand', (c) => c.html(renderBrand({ brand: service.db.getBrand(), knowledge: service.db.listKnowledge(), assets: service.db.listAssets() })))
  app.get('/interactions', (c) => {
    const accounts = service.db.listAccounts()
    const accountId = c.req.query('account')
    const account = accountId === undefined ? accounts[0] : accounts.find(item => String(item.id) === accountId)
    if (accountId !== undefined && !account) return c.html(renderError('账号不存在', '请返回互动页选择已接入的账号。', 404), 404)
    c.header('Cache-Control', 'no-store')
    return c.html(renderInteractions({
      accounts, account,
      interactions: account ? service.db.listInteractions(100, account.id) : [],
      reviews: account ? service.db.listReviews(100, account.id) : [],
    }))
  })
  app.get('/jobs', (c) => c.html(renderJobs({ jobs: service.db.listJobs(), accounts: service.db.listAccounts(), audit: service.db.listAudit() })))

  app.get('/media/:id', (c) => {
    const asset = service.db.getAssets([c.req.param('id')])[0]
    if (!asset) return c.notFound()
    const path = resolve(config.assetDir, asset.relativePath)
    if (!path.startsWith(`${config.assetDir}/`) || !existsSync(path)) return c.notFound()
    return new Response(readFileSync(path), { headers: { 'Content-Type': asset.mimeType, 'Cache-Control': 'private, max-age=300' } })
  })

  app.put('/api/brand', async (c) => {
    try {
      const input = await c.req.json<Record<string, unknown>>()
      const visual = input.visual && typeof input.visual === 'object' ? input.visual as Record<string, unknown> : {}
      const color = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
      const brand = service.db.updateBrand({
        name: text(input.name, '品牌名称', 100), description: typeof input.description === 'string' ? input.description.trim().slice(0, 20_000) : '',
        allowedClaims: stringArray(input.allowedClaims, '允许表述'), bannedPhrases: stringArray(input.bannedPhrases, '禁用表述'),
        rulesVersion: text(input.rulesVersion, '规则版本', 50),
        visual: { background: color(visual.background, '#f2f4ef'), foreground: color(visual.foreground, '#171a18'), accent: color(visual.accent, '#1769e0') },
      })
      return c.json({ brand })
    } catch (error) { return c.json({ error: errorMessage(error) }, 400) }
  })

  app.post('/api/knowledge', async (c) => {
    try {
      const input = await c.req.json<Record<string, unknown>>()
      const kinds = new Set<KnowledgeItem['kind']>(['fact', 'product', 'campaign', 'policy'])
      const kind = typeof input.kind === 'string' && kinds.has(input.kind as KnowledgeItem['kind']) ? input.kind as KnowledgeItem['kind'] : 'fact'
      return c.json({ item: service.db.createKnowledge({ kind, title: text(input.title, '资料标题', 200), body: text(input.body, '资料正文', 30_000) }) }, 201)
    } catch (error) { return c.json({ error: errorMessage(error) }, 400) }
  })
  app.delete('/api/knowledge/:id', (c) => c.json({ ok: service.db.deleteKnowledge(c.req.param('id')) }))

  app.post('/api/assets', async (c) => {
    try {
      const body = await c.req.parseBody()
      const file = body.file
      if (!(file instanceof File)) throw new Error('请选择图片文件')
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('只支持 PNG、JPEG 或 WebP')
      if (file.size > 15 * 1024 * 1024) throw new Error('图片不能超过 15 MB')
      const bytes = Buffer.from(await file.arrayBuffer())
      const metadata = await sharp(bytes).metadata()
      if (!metadata.width || !metadata.height) throw new Error('无法读取图片尺寸')
      const extension = extname(file.name).toLowerCase() || (file.type === 'image/png' ? '.png' : file.type === 'image/webp' ? '.webp' : '.jpg')
      const hash = createHash('sha256').update(bytes).digest('hex')
      const relativePath = `uploads/${hash.slice(0, 20)}${extension}`
      const path = resolve(config.assetDir, relativePath)
      mkdirSync(resolve(config.assetDir, 'uploads'), { recursive: true, mode: 0o700 })
      await sharp(bytes).rotate().toFile(path)
      const asset = service.db.createAsset({ kind: 'upload', filename: basename(file.name).slice(0, 200), mimeType: file.type, relativePath, sha256: hash, width: metadata.width, height: metadata.height })
      return c.json({ asset }, 201)
    } catch (error) { return c.json({ error: errorMessage(error) }, 400) }
  })

  app.delete('/api/accounts/:id', (c) => {
    try {
      service.db.deleteAccount(integer(c.req.param('id'), '账号 ID', 1, Number.MAX_SAFE_INTEGER))
      return c.json({ ok: true })
    } catch (error) { return c.json({ error: errorMessage(error) }, 409) }
  })
  app.post('/api/accounts', async (c) => {
    try {
      const input = await c.req.json<Record<string, unknown>>()
      const handle = text(input.handle, '账号标识', 100).replace(/^@/, '')
      const profileUrl = xiaohongshuUrl(input.profileUrl)
      const browserProfileId = optionalText(input.browserProfileId, 36)
      if (browserProfileId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(browserProfileId)) throw new Error('登录会话无效，请重新接入账号')
      const account = service.db.createAccount({
        handle, displayName: text(input.displayName, '显示名称', 100), expectedProfileId: text(input.expectedProfileId, '公开主页 ID', 200), profileUrl, browserProfileId,
        workerThreadId: optionalText(input.workerThreadId, 200), position: text(input.position, '矩阵定位', 300), audience: text(input.audience, '目标受众', 300),
        noteTone: text(input.noteTone, '笔记语气', 300), commentTone: text(input.commentTone, '评论语气', 300),
        contentColumns: stringArray(input.contentColumns, '内容栏目', 30), bannedTopics: stringArray(input.bannedTopics, '禁用主题', 50),
        dailyLimit: integer(input.dailyLimit, '每日上限', 1, 20),
      })
      return c.json({ account }, 201)
    } catch (error) { return c.json({ error: errorMessage(error) }, 400) }
  })
  app.put('/api/accounts/:id', async (c) => {
    try {
      const id = integer(c.req.param('id'), '账号 ID', 1, Number.MAX_SAFE_INTEGER)
      const current = service.db.getAccount(id)
      if (!current) throw new Error('账号不存在')
      const input = await c.req.json<Record<string, unknown>>()
      const account = service.db.updateAccount(id, {
        displayName: text(input.displayName, '显示名称', 100), profileUrl: xiaohongshuUrl(input.profileUrl), avatarUrl: current.avatarUrl,
        workerThreadId: optionalText(input.workerThreadId, 200), position: text(input.position, '账号定位', 300), audience: text(input.audience, '目标受众', 300),
        noteTone: text(input.noteTone, '笔记语气', 300), commentTone: text(input.commentTone, '评论语气', 300),
        contentColumns: stringArray(input.contentColumns, '内容栏目', 30), bannedTopics: stringArray(input.bannedTopics, '禁用主题', 50),
        dailyLimit: integer(input.dailyLimit, '每日上限', 1, 20), enabled: current.enabled,
      })
      return c.json({ account })
    } catch (error) { return c.json({ error: errorMessage(error) }, 400) }
  })
  app.post('/api/accounts/:id/enabled', async (c) => {
    try {
      const input = await c.req.json<Record<string, unknown>>()
      const account = service.db.setAccountEnabled(integer(c.req.param('id'), '账号 ID', 1, Number.MAX_SAFE_INTEGER), boolean(input.enabled, '启用状态'))
      return c.json({ account })
    } catch (error) { return c.json({ error: errorMessage(error) }, 400) }
  })
  app.post('/api/accounts/:id/verify', async (c) => {
    try {
      const id = integer(c.req.param('id'), '账号 ID', 1, Number.MAX_SAFE_INTEGER)
      const input = await c.req.json<Record<string, unknown>>()
      if (input.sessionId !== undefined) return c.json(prepareSessionVerification(service.db, id, text(input.sessionId, '会话 ID', 200), input.syncAnalytics === true), 202)
      const account = service.db.getAccount(id)
      if (!account) throw new Error('账号不存在')
      if (!account.enabled) throw new Error('账号已暂停，请先启用')
      if (!account.workerThreadId) throw new Error('账号还没有绑定独立 Codex 任务')
      const scheduledAt = new Date().toISOString()
      const minuteBucket = scheduledAt.slice(0, 16)
      const job = service.db.createJob({
        type: 'verify_session', accountId: account.id, scheduledAt, idempotencyKey: `verify:${account.id}:${minuteBucket}`,
        payload: {
          destinationUrl: config.xhs.creatorUrl, expectedHandle: account.handle,
          expectedProfileId: account.expectedProfileId, expectedProfileUrl: account.profileUrl,
        },
      })
      service.db.setAccountSession(account.id, 'setup', { error: null })
      return c.json({ job }, 202)
    } catch (error) { return c.json({ error: errorMessage(error) }, 400) }
  })
  app.post('/api/accounts/:id/session', async (c) => {
    try {
      const input = await c.req.json<Record<string, unknown>>()
      const allowed = new Set<AccountSessionStatus>(['setup', 'healthy', 'blocked', 'reauthorize', 'offline'])
      if (typeof input.status !== 'string' || !allowed.has(input.status as AccountSessionStatus)) throw new Error('账号状态无效')
      const status = input.status as AccountSessionStatus
      if (status === 'healthy') throw new Error('请通过只读验证任务核对身份，不能手工标记已连接')
      return c.json({ account: service.db.setAccountSession(integer(c.req.param('id'), '账号 ID', 1, Number.MAX_SAFE_INTEGER), status, { error: optionalText(input.error, 2000) }) })
    } catch (error) { return c.json({ error: errorMessage(error) }, 400) }
  })
  app.post('/api/executor/rebind-session', async (c) => {
    if (!hasApiToken(c.req.header('Authorization'))) return c.json({ error: '需要执行器授权' }, 401)
    try {
      const input = await c.req.json<Record<string, unknown>>()
      service.db.rebindWorkerSession(text(input.previousSessionId, '原会话 ID', 200), text(input.sessionId, '新会话 ID', 200))
      return c.json({ ok: true })
    } catch (error) { return c.json({ error: errorMessage(error) }, 409) }
  })
  app.post('/api/executor/browser-session', async (c) => {
    if (!hasApiToken(c.req.header('Authorization'))) return c.json({ error: '需要执行器授权' }, 401)
    try {
      const input = await c.req.json<Record<string, unknown>>()
      return c.json(observeBrowserSession(service.db, text(input.sessionId, '会话 ID', 200), text(input.url, '页面地址', 2000), text(input.tree, '页面内容', 100_000), optionalText(input.browserProfileId, 36), optionalText(input.avatarUrl, 2048)))
    } catch (error) { return c.json({ error: errorMessage(error) }, 409) }
  })

  app.post('/api/campaigns', async (c) => {
    try {
      const input = await c.req.json<Record<string, unknown>>()
      const accountIds = numberArray(input.accountIds, '发布账号')
      const commentAccountIds = numberArray(input.commentAccountIds, '评论账号')
      const minComments = integer(input.minComments, '最少评论', 0, 20)
      const maxComments = integer(input.maxComments, '最多评论', 0, 20)
      if (!accountIds.length) throw new Error('至少选择一个发布账号')
      if (maxComments < minComments) throw new Error('最多评论不能少于最少评论')
      const start = integer(input.commentWindowStartMinutes, '最早评论时间', 5, 10_080)
      const end = integer(input.commentWindowEndMinutes, '最晚评论时间', 10, 10_080)
      if (end <= start) throw new Error('最晚评论时间必须晚于最早评论时间')
      const campaign = service.db.createCampaign({
        name: text(input.name, '活动名称', 200), theme: text(input.theme, '内容主题', 5_000), accountIds, commentAccountIds,
        knowledgeIds: stringArray(input.knowledgeIds, '引用资料'), assetIds: stringArray(input.assetIds, '活动素材'),
        noteTones: stringArray(input.noteTones, '笔记语气', 20), commentTones: stringArray(input.commentTones, '评论语气', 20),
        schedule: validateSchedule(input.schedule), minComments, maxComments, commentWindowStartMinutes: start,
        commentWindowEndMinutes: end, generateLeadMinutes: integer(input.generateLeadMinutes, '提前生成时间', 10, 43_200),
      })
      return c.json({ campaign }, 201)
    } catch (error) { return c.json({ error: errorMessage(error) }, 400) }
  })
  app.post('/api/campaigns/:id/status', async (c) => {
    try {
      const input = await c.req.json<Record<string, unknown>>()
      const allowed = new Set<CampaignStatus>(['draft', 'active', 'paused', 'completed'])
      if (typeof input.status !== 'string' || !allowed.has(input.status as CampaignStatus)) throw new Error('活动状态无效')
      const campaign = service.db.setCampaignStatus(c.req.param('id'), input.status as CampaignStatus)
      if (campaign.status === 'active') {
        service.materializeCampaigns()
        void service.tick()
      }
      return c.json({ campaign })
    } catch (error) { return c.json({ error: errorMessage(error) }, 400) }
  })
  app.post('/api/content/:id/generate', async (c) => {
    try { await service.generateContent(c.req.param('id')); return c.json({ content: service.db.getContent(c.req.param('id')) }) }
    catch (error) { return c.json({ error: errorMessage(error) }, 400) }
  })

  const requireWorkerToken: MiddlewareHandler = async (c, next) => {
    if (!hasApiToken(c.req.header('Authorization'))) return c.json({ error: '执行接口需要本机 worker token' }, 401)
    await next()
  }
  app.use('/api/executor/dispatch', requireWorkerToken)
  app.use('/api/executor/accounts', requireWorkerToken)
  app.use('/api/executor/operations', requireWorkerToken)
  app.use('/api/executor/jobs/:id', requireWorkerToken)
  app.post('/api/executor/dispatch', (c) => c.json({ jobs: service.dispatch().map((job) => ({ id: job.id, type: job.type, accountId: job.accountId, workerThreadId: job.workerThreadId, scheduledAt: job.scheduledAt })) }))
  app.get('/api/executor/accounts', (c) => c.json({ accounts: service.db.listAccounts().map(account => ({
    id: account.id, displayName: account.displayName, handle: account.handle, expectedProfileId: account.expectedProfileId,
    profileUrl: account.profileUrl, browserProfileId: account.browserProfileId ? `xiaohongshu-ops:${account.browserProfileId}` : null,
    enabled: account.enabled, sessionStatus: account.sessionStatus, position: account.position, audience: account.audience,
    noteTone: account.noteTone, commentTone: account.commentTone, contentColumns: account.contentColumns,
    bannedTopics: account.bannedTopics, dailyLimit: account.dailyLimit,
  })) }))
  app.post('/api/executor/operations', async (c) => {
    try {
      const input = await c.req.json<Record<string, unknown>>()
      if (input.type !== 'publish_note' && input.type !== 'create_comment' && input.type !== 'reply_comment') throw new Error('不支持的执行类型')
      const type = input.type
      const targetUrl = type === 'publish_note' ? '' : text(input.targetUrl, '目标帖子地址', 2000)
      if (targetUrl) {
        const url = new URL(targetUrl)
        if (url.origin !== new URL(config.xhs.webUrl).origin || url.username || url.password || url.pathname === '/') throw new Error('目标必须是小红书帖子地址')
      }
      if (type === 'publish_note' && (!Array.isArray(input.cards) || input.cards.length !== 3)) throw new Error('发布图文需要三张内容卡，封面会自动生成')
      const cards = type === 'publish_note' && Array.isArray(input.cards) ? input.cards.map(card => {
        if (!card || typeof card !== 'object' || !('heading' in card) || !('body' in card)) throw new Error('图文卡片格式无效')
        return { heading: text(card.heading, '卡片标题', 100), body: text(card.body, '卡片正文', 600) }
      }) : []
      const operation: SessionOperation = {
        accountId: integer(input.accountId, '账号 ID', 1, Number.MAX_SAFE_INTEGER),
        sessionId: text(input.sessionId, '执行会话', 200), runKey: text(input.runKey, '本次运行标识', 500),
        operationKey: text(input.operationKey, '操作标识', 200), type,
        title: type === 'publish_note' ? text(input.title, '标题', 100) : '',
        body: text(input.body, '正文', type === 'publish_note' ? 10000 : 1000),
        topics: type === 'publish_note' ? stringArray(input.topics ?? [], '话题', 10).map(topic => text(topic, '话题', 50)) : [],
        cards, targetUrl,
        targetCommentText: type === 'reply_comment' ? text(input.targetCommentText, '目标评论原文', 2000) : '',
        targetAuthor: type === 'reply_comment' ? text(input.targetAuthor, '目标评论作者', 200) : '',
      }
      return c.json({ job: await service.prepareSessionOperation(operation) })
    } catch (error) { return c.json({ error: errorMessage(error) }, 409) }
  })
  app.get('/api/executor/jobs/:id', (c) => {
    const job = service.db.getJob(c.req.param('id'))
    return job ? c.json({ job }) : c.json({ error: '任务不存在' }, 404)
  })

  app.use('/api/executor/jobs/:id/claim', requireWorkerToken)
  app.use('/api/executor/jobs/:id/complete', requireWorkerToken)
  app.use('/api/executor/jobs/:id/block', requireWorkerToken)
  app.use('/api/executor/jobs/:id/fail', requireWorkerToken)
  app.use('/api/executor/jobs/:id/uncertain', requireWorkerToken)

  app.post('/api/executor/jobs/:id/claim', async (c) => {
    try {
      const input = await c.req.json<Record<string, unknown>>()
      const accountId = integer(input.accountId, '账号 ID', 1, Number.MAX_SAFE_INTEGER)
      if (input.verificationOnly === true && service.db.getJob(c.req.param('id'))?.type !== 'verify_session') throw new Error('此入口只允许只读验证和数据同步任务')
      const job = service.db.getJob(c.req.param('id'))
      const sessionExecution = job?.payload.evidence?.sessionExecution === true
      if (input.pluginSession === true && !sessionExecution && job?.type !== 'verify_session') throw new Error('此入口只允许当前会话准备的操作或账号验证')
      if (input.workerSessionId !== undefined && (sessionExecution ? job?.workerThreadId : service.db.getAccount(accountId)?.workerThreadId) !== input.workerSessionId) throw new Error('当前会话与账号绑定不一致，请回到绑定会话执行')
      const result = service.db.claimJob(c.req.param('id'), accountId, sessionExecution ? {
        sessionId: text(input.workerSessionId, '执行会话', 200),
        actualAccount: text(input.actualAccount, '观察到的账号', 100),
        actualProfileId: text(input.actualProfileId, '观察到的小红书号', 200),
      } : undefined)
      return c.json(result)
    } catch (error) { return c.json({ error: errorMessage(error) }, 409) }
  })
  app.post('/api/executor/jobs/:id/complete', async (c) => {
    try {
      const input = await c.req.json<Record<string, unknown>>()
      const discoveredComments = Array.isArray(input.discoveredComments) ? input.discoveredComments.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const value = item as Record<string, unknown>
        if (typeof value.remoteCommentId !== 'string' || typeof value.remoteAuthor !== 'string' || typeof value.body !== 'string' || typeof value.targetUrl !== 'string') return []
        return [{ remoteCommentId: value.remoteCommentId, remoteAuthor: value.remoteAuthor, body: value.body, targetUrl: value.targetUrl } satisfies DiscoveredComment]
      }) : []
      const job = await service.completeJob({
        jobId: c.req.param('id'), leaseToken: text(input.leaseToken, '租约', 200), actualAccount: text(input.actualAccount, '实际账号', 100),
        ...(typeof input.actualProfileId === 'string' ? { actualProfileId: text(input.actualProfileId, '实际小红书号', 200) } : {}),
        ...(typeof input.analyticsCsv === 'string' ? { analyticsCsv: text(input.analyticsCsv, '同步数据', 500_000) } : {}),
        ...(input.resultUrl === null || typeof input.resultUrl === 'string' ? { resultUrl: input.resultUrl as string | null } : {}),
        ...(input.screenshotPath === null || typeof input.screenshotPath === 'string' ? { screenshotPath: input.screenshotPath as string | null } : {}),
        discoveredComments,
      })
      return c.json({ job })
    } catch (error) { return c.json({ error: errorMessage(error) }, 409) }
  })
  for (const [route, status] of [['block', 'blocked'], ['fail', 'failed'], ['uncertain', 'needs_reconcile']] as const) {
    app.post(`/api/executor/jobs/:id/${route}`, async (c) => {
      try {
        const input = await c.req.json<Record<string, unknown>>()
        return c.json({ job: service.db.stopJob(c.req.param('id'), text(input.leaseToken, '租约', 200), status, {
          code: text(input.code, '错误代码', 100), message: text(input.message, '错误信息', 2_000),
          ...(input.screenshotPath === null || typeof input.screenshotPath === 'string' ? { screenshotPath: input.screenshotPath as string | null } : {}),
        }) })
      } catch (error) { return c.json({ error: errorMessage(error) }, 409) }
    })
  }
  app.post('/api/executor/jobs/:id/reconcile', async (c) => {
    try {
      const input = await c.req.json<Record<string, unknown>>()
      if (!['found', 'not_found', 'uncertain'].includes(String(input.resolution))) throw new Error('核对结果无效')
      const job = service.db.reconcileJob(c.req.param('id'), input.resolution as 'found' | 'not_found' | 'uncertain', {
        ...(typeof input.resultUrl === 'string' ? { resultUrl: input.resultUrl } : {}),
        ...(typeof input.actualAccount === 'string' ? { actualAccount: input.actualAccount } : {}),
      })
      return c.json({ job })
    } catch (error) { return c.json({ error: errorMessage(error) }, 409) }
  })
  app.post('/api/jobs/:id/retry', (c) => {
    try {
      return c.json({ job: service.db.retryJob(c.req.param('id')) })
    } catch (error) { return c.json({ error: errorMessage(error) }, 409) }
  })
  app.post('/api/reviews/:id', async (c) => {
    try {
      const input = await c.req.json<Record<string, unknown>>()
      if (!['approved', 'rejected'].includes(String(input.status))) throw new Error('审核状态无效')
      return c.json({ review: service.db.resolveReview(c.req.param('id'), input.status as 'approved' | 'rejected', typeof input.suggestedText === 'string' ? input.suggestedText : '') })
    } catch (error) { return c.json({ error: errorMessage(error) }, 400) }
  })

  app.notFound((c) => c.html(renderError('页面不存在', '没有找到这个地址。', 404), 404))
  app.onError((error, c) => c.html(renderError('服务发生错误', errorMessage(error), 500), 500))
  return app
}

export function startServer(): { close: () => Promise<void>; service: OpsService } {
  const db = new OpsDatabase(config.databasePath)
  const service = new OpsService(db)
  const app = createApp(service)
  const stopScheduler = startContentScheduler(service)
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port })
  return {
    service,
    close: async () => new Promise<void>((resolvePromise, reject) => {
      stopScheduler()
      server.close((error) => { db.close(); if (error) reject(error); else resolvePromise() })
    }),
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  startServer()
  console.log(`小红书运营台已启动：${config.origin}`)
}
