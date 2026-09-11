import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { config } from './config.js'
import { parsePlatformCsv } from './analytics.js'
import type { ContentGenerator, GeneratedNote } from './content-generator.js'
import { codexContentGenerator } from './content-generator.js'
import { OpsDatabase } from './db.js'
import { renderCardSet } from './card-renderer.js'
import { assertGeneratedContent, contentHash, findBannedPhrases, normalizeTopics } from './safety.js'
import { expandSchedule, nextCommentScanTimes, spreadCommentTimes } from './scheduling.js'
import type { BrowserJob, Campaign, DiscoveredComment, SessionOperation } from './types.js'

function now(): string {
  return new Date().toISOString()
}

function uniqueManagedComments(generated: GeneratedNote, campaign: Campaign, authorId: number): Array<{ accountId: number; body: string }> {
  const allowed = new Set(campaign.commentAccountIds.filter((id) => id !== authorId))
  const seenAccounts = new Set<number>()
  const seenBodies = new Set<string>()
  return generated.managedComments.filter((comment) => {
    const body = comment.body.trim()
    const normalized = body.toLocaleLowerCase('zh-CN')
    if (!allowed.has(comment.accountId) || seenAccounts.has(comment.accountId) || !body || seenBodies.has(normalized)) return false
    seenAccounts.add(comment.accountId)
    seenBodies.add(normalized)
    return true
  })
}

export class OpsService {
  private ticking = false

  constructor(readonly db: OpsDatabase, readonly generator: ContentGenerator = codexContentGenerator) {}

  async prepareSessionOperation(input: SessionOperation): Promise<BrowserJob> {
    const account = this.db.getAccount(input.accountId)
    if (!account?.enabled) throw new Error('账号不存在、已解除绑定或已停用')
    const suppliedAssets = input.mediaAssetIds?.length ? this.db.getAssets(input.mediaAssetIds) : []
    if (input.mediaAssetIds?.length && suppliedAssets.length !== input.mediaAssetIds.length) throw new Error('部分素材不存在，请重新选择')
    if (input.type === 'publish_note' && suppliedAssets.length) {
      if (input.mediaKind === 'video' ? suppliedAssets.length !== 1 || suppliedAssets[0]?.mimeType !== 'video/mp4' : suppliedAssets.length > 9 || suppliedAssets.some(asset => !asset.mimeType.startsWith('image/'))) throw new Error('图文需 1–9 张图片；视频帖需 1 个 MP4 文件')
    } else if (input.type === 'publish_note' && input.mediaKind === 'video') throw new Error('请先生成或导入视频素材')
    const brand = this.db.getBrand()
    const banned = findBannedPhrases([input.title, input.body, ...input.cards.flatMap(card => [card.heading, card.body])].join('\n'), [...brand.bannedPhrases, ...account.bannedTopics])
    if (banned.length) throw new Error(`内容命中账号禁用表述：${banned.join('、')}`)
    const { sessionId: _session, runKey: _run, operationKey: _operation, ...locked } = input
    const job = this.db.createSessionJob(input, {
      destinationUrl: input.type === 'publish_note' ? config.xhs.creatorUrl : input.targetUrl,
      expectedHandle: account.handle, expectedProfileId: account.expectedProfileId, expectedProfileUrl: account.profileUrl,
      browserProfileId: account.browserProfileId ? `xiaohongshu-ops:${account.browserProfileId}` : null,
      ...(input.type === 'publish_note' ? { title: input.title, body: input.body, topics: input.topics, mediaKind: input.mediaKind ?? 'image' } : { targetUrl: input.targetUrl, commentBody: input.body, targetCommentText: input.targetCommentText, targetAuthor: input.targetAuthor }),
      evidence: { sessionExecution: true, inputHash: createHash('sha256').update(JSON.stringify(locked)).digest('hex') },
    })
    if (job.status === 'queued' && job.type === 'publish_note' && job.contentItemId && this.db.markContentGenerating(job.contentItemId)) {
      const content = this.db.getContent(job.contentItemId)
      if (!content) throw new Error('找不到文章记录')
      try {
        const assets = suppliedAssets.length ? suppliedAssets : (await renderCardSet(content, brand)).map(asset => this.db.createAsset(asset))
        this.db.setContentGenerated(content.id, { title: input.title, body: input.body, topics: input.topics, cardData: input.cards, mediaAssetIds: assets.map(asset => asset.id), sourceKnowledgeIds: [], contentHash: contentHash(locked) })
        this.db.setSessionJobMedia(job.id, assets.map(asset => resolve(config.assetDir, asset.relativePath)))
      } catch (error) {
        const message = error instanceof Error ? error.message : '准备文章失败'
        this.db.failContent(content.id, message)
        this.db.database.prepare("UPDATE browser_jobs SET status = 'failed', error_code = 'preparation_failed', error = ?, updated_at = ? WHERE id = ? AND status = 'queued'").run(message, now(), job.id)
        throw error
      }
    }
    this.db.dispatchDue(new Date(), job.id)
    const prepared = this.db.getJob(job.id)
    if (!prepared) throw new Error('找不到执行记录')
    return prepared
  }

  materializeCampaigns(at = new Date()): number {
    const from = new Date(at.getTime() - 15 * 60_000)
    const until = new Date(at.getTime() + 30 * 24 * 60 * 60_000)
    let created = 0
    for (const campaign of this.db.listCampaigns().filter((item) => item.status === 'active')) {
      const occurrences = expandSchedule(campaign.schedule, from, until)
      occurrences.forEach((scheduledAt, index) => {
        const accountId = campaign.accountIds[index % campaign.accountIds.length]
        if (!accountId) return
        const before = this.db.listContent(500).some((item) => item.campaignId === campaign.id && item.accountId === accountId && item.scheduledAt === scheduledAt)
        this.db.createPlannedContent(campaign.id, accountId, scheduledAt)
        if (!before) created += 1
      })
    }
    return created
  }

  async generateContent(contentId: string): Promise<void> {
    const content = this.db.getContent(contentId)
    if (!content) throw new Error('内容不存在')
    if (!this.db.markContentGenerating(content.id)) throw new Error('内容当前不能生成')
    const campaign = (content.campaignId ? this.db.getCampaign(content.campaignId) : null)
    const author = this.db.getAccount(content.accountId)
    if (!campaign || !author) {
      this.db.failContent(content.id, '活动或账号已不存在')
      return
    }
    const brand = this.db.getBrand()
    const knowledge = this.db.getKnowledge(campaign.knowledgeIds)
    const commenters = campaign.commentAccountIds.flatMap((id) => {
      const account = this.db.getAccount(id)
      return account && account.id !== author.id && account.enabled ? [account] : []
    })
    try {
      const generated = await this.generator.generateNote({ brand, knowledge, campaign, author, commenters })
      const topics = normalizeTopics(generated.topics)
      assertGeneratedContent({
        title: generated.title, body: generated.body, topics, sourceKnowledgeIds: generated.sourceKnowledgeIds,
        availableKnowledgeIds: knowledge.map((item) => item.id), bannedPhrases: [...brand.bannedPhrases, ...author.bannedTopics],
      })
      if (generated.cards.length !== 3) throw new Error('图文内容必须生成三张内容卡')
      const managedComments = uniqueManagedComments(generated, campaign, author.id)
      const requiredComments = Math.min(campaign.minComments, commenters.length)
      if (managedComments.length < requiredComments) throw new Error(`矩阵评论候选不足，至少需要 ${requiredComments} 条`)
      for (const comment of managedComments) {
        const banned = findBannedPhrases(comment.body, brand.bannedPhrases)
        if (banned.length) throw new Error(`评论命中禁用表述：${banned.join('、')}`)
      }
      const draft = { ...content, title: generated.title, body: generated.body, cardData: generated.cards }
      const rendered = await renderCardSet(draft, brand)
      const generatedAssets = rendered.map((asset) => this.db.createAsset(asset))
      const mediaAssetIds = [...campaign.assetIds, ...generatedAssets.map((asset) => asset.id)]
      const hash = contentHash({ title: generated.title, body: generated.body, topics, mediaAssetIds })
      this.db.setContentGenerated(content.id, {
        title: generated.title, body: generated.body, topics, cardData: generated.cards, mediaAssetIds,
        sourceKnowledgeIds: generated.sourceKnowledgeIds, contentHash: hash,
      })
      const mediaPaths = this.db.getAssets(mediaAssetIds).map((asset) => resolve(config.assetDir, asset.relativePath))
      this.db.createJob({
        type: 'publish_note', accountId: author.id, contentItemId: content.id, scheduledAt: content.scheduledAt,
        idempotencyKey: `publish:${content.id}:${hash}`,
        payload: {
          destinationUrl: config.xhs.creatorUrl, expectedHandle: author.handle,
          expectedProfileId: author.expectedProfileId, expectedProfileUrl: author.profileUrl,
          title: generated.title, body: generated.body, topics, mediaPaths,
          evidence: { contentHash: hash, managedComments },
        },
      })
      this.db.audit({ accountId: author.id, campaignId: campaign.id, contentItemId: content.id, action: 'content_generate', status: 'succeeded', detail: { contentHash: hash } })
    } catch (error) {
      const message = error instanceof Error ? error.message : '内容生成失败'
      this.db.failContent(content.id, message)
      this.db.audit({ accountId: author.id, campaignId: campaign.id, contentItemId: content.id, action: 'content_generate', status: 'failed', detail: { error: message } })
      throw error
    }
  }

  async tick(at = new Date()): Promise<{ materialized: number; generated: number }> {
    if (this.ticking) return { materialized: 0, generated: 0 }
    this.ticking = true
    try {
      const materialized = this.materializeCampaigns(at)
      const due = this.db.listContent(500).filter((content) => {
        if (content.status !== 'planned') return false
        const campaign = (content.campaignId ? this.db.getCampaign(content.campaignId) : null)
        if (!campaign || campaign.status !== 'active') return false
        return new Date(content.scheduledAt).getTime() - campaign.generateLeadMinutes * 60_000 <= at.getTime()
      })
      let generated = 0
      for (const content of due) {
        try {
          await this.generateContent(content.id)
          generated += 1
        } catch {
          // Failure is persisted per content item so the next campaign can continue.
        }
      }
      return { materialized, generated }
    } finally {
      this.ticking = false
    }
  }

  dispatch(at = new Date()): BrowserJob[] {
    return this.db.dispatchDue(at)
  }

  async completeJob(input: {
    jobId: string; leaseToken: string; actualAccount: string; actualProfileId?: string; resultUrl?: string | null; screenshotPath?: string | null; analyticsCsv?: string;
    discoveredComments?: DiscoveredComment[];
  }): Promise<BrowserJob> {
    const pending = this.db.getJob(input.jobId)
    if (pending?.payload.evidence?.sessionExecution === true) {
      const result = new URL(input.resultUrl || '')
      const allowedOrigins = [new URL(config.xhs.webUrl).origin, new URL(config.xhs.creatorUrl).origin]
      if (!allowedOrigins.includes(result.origin) || result.username || result.password) throw new Error('结果地址必须是小红书页面')
      if (pending.type !== 'publish_note' && new URL(pending.payload.targetUrl || '').pathname !== result.pathname) throw new Error('结果地址与目标帖子不一致')
    }
    const account = pending && this.db.getAccount(pending.accountId)
    const snapshot = pending?.payload.evidence?.syncAnalytics === true && account
      ? parsePlatformCsv(input.analyticsCsv ?? '', account.expectedProfileId) : null
    if (pending?.payload.evidence?.sessionExecution === true) {
      this.db.database.exec('BEGIN IMMEDIATE')
      try {
        const job = this.db.completeJob(input.jobId, input.leaseToken, input)
        if (job.type === 'publish_note' && job.contentItemId && job.resultUrl) this.db.markContentPublished(job.contentItemId, job.resultUrl)
        else this.db.updateInteractionByJob(job)
        this.db.database.exec('COMMIT')
        return job
      } catch (error) { this.db.database.exec('ROLLBACK'); throw error }
    }
    let job = this.db.completeJob(input.jobId, input.leaseToken, {
      actualAccount: input.actualAccount,
      ...(input.actualProfileId !== undefined ? { actualProfileId: input.actualProfileId } : {}),
      ...(input.resultUrl !== undefined ? { resultUrl: input.resultUrl } : {}),
      ...(input.screenshotPath !== undefined ? { screenshotPath: input.screenshotPath } : {}),
    })
    if (snapshot) this.db.savePlatformSnapshot(job.accountId, { ...snapshot, source: 'browser' })
    if (job.type === 'publish_note' && job.contentItemId && job.resultUrl) {
      const content = this.db.markContentPublished(job.contentItemId, job.resultUrl)
      const campaign = (content.campaignId ? this.db.getCampaign(content.campaignId) : null)
      if (campaign) this.createPostFollowups(job, campaign, content.publishedAt ?? now())
    } else if (job.type === 'create_comment' || job.type === 'reply_comment') {
      this.db.updateInteractionByJob(job)
    } else if (job.type === 'scan_comments' && job.contentItemId) {
      const comments = input.discoveredComments ?? []
      const content = this.db.getContent(job.contentItemId)
      const campaign = content ? (content.campaignId ? this.db.getCampaign(content.campaignId) : null) : null
      const account = this.db.getAccount(job.accountId)
      if (content && campaign && account && comments.length) {
        const replies = await this.generator.generateReplies({
          brand: this.db.getBrand(), knowledge: this.db.getKnowledge(campaign.knowledgeIds), account, comments,
        })
        this.db.ingestDiscoveredComments(job, comments, replies)
      }
      this.scheduleNextScan(job)
    }
    job = this.db.getJob(job.id) as BrowserJob
    return job
  }

  private createPostFollowups(job: BrowserJob, campaign: Campaign, publishedAt: string): void {
    if (!job.contentItemId || !job.resultUrl) return
    const candidatesRaw = job.payload.evidence?.managedComments
    const candidates = Array.isArray(candidatesRaw)
      ? candidatesRaw.flatMap((item) => item && typeof item === 'object' && Number.isInteger((item as Record<string, unknown>).accountId) && typeof (item as Record<string, unknown>).body === 'string'
        ? [{ accountId: Number((item as Record<string, unknown>).accountId), body: String((item as Record<string, unknown>).body) }] : []) : []
    const eligible = candidates.filter((item) => item.accountId !== job.accountId && this.db.getAccount(item.accountId)?.enabled)
    const times = spreadCommentTimes({
      publishedAt, minComments: campaign.minComments, maxComments: campaign.maxComments,
      availableAccounts: eligible.length, windowStartMinutes: campaign.commentWindowStartMinutes,
      windowEndMinutes: campaign.commentWindowEndMinutes,
    })
    const deadlineAt = new Date(new Date(publishedAt).getTime() + campaign.commentWindowEndMinutes * 60_000).toISOString()
    times.forEach((scheduledAt, index) => {
      const candidate = eligible[index]
      if (!candidate) return
      const account = this.db.getAccount(candidate.accountId)
      if (!account) return
      this.db.createInteraction({
        contentItemId: job.contentItemId as string, kind: 'managed_comment', accountId: account.id, remoteAuthor: null,
        remoteCommentId: `managed:${account.id}`, body: candidate.body, status: 'planned', riskLabels: [],
        scheduledAt, resultUrl: null,
      })
      this.db.createJob({
        type: 'create_comment', accountId: account.id, contentItemId: job.contentItemId, parentJobId: job.id,
        scheduledAt, idempotencyKey: `managed-comment:${job.contentItemId}:${account.id}`,
        payload: {
          destinationUrl: config.xhs.webUrl, expectedHandle: account.handle,
          expectedProfileId: account.expectedProfileId, expectedProfileUrl: account.profileUrl,
          targetUrl: job.resultUrl as string, commentBody: candidate.body, evidence: { deadlineAt },
        },
      })
    })
    const firstScan = nextCommentScanTimes(publishedAt)[0]
    if (firstScan) {
      const author = this.db.getAccount(job.accountId)
      if (author) this.db.createJob({
        type: 'scan_comments', accountId: author.id, contentItemId: job.contentItemId, parentJobId: job.id,
        scheduledAt: firstScan, idempotencyKey: `scan:${job.contentItemId}:${firstScan}`,
        payload: {
          destinationUrl: config.xhs.webUrl, expectedHandle: author.handle,
          expectedProfileId: author.expectedProfileId, expectedProfileUrl: author.profileUrl,
          targetUrl: job.resultUrl, scanLimit: 20,
          evidence: { scanUntil: new Date(new Date(publishedAt).getTime() + 72 * 60 * 60_000).toISOString() },
        },
      })
    }
  }

  private scheduleNextScan(job: BrowserJob): void {
    if (!job.contentItemId || !job.payload.targetUrl) return
    const scanUntil = typeof job.payload.evidence?.scanUntil === 'string' ? job.payload.evidence.scanUntil : null
    const next = new Date(Date.now() + 30 * 60_000)
    if (!scanUntil || next.getTime() > new Date(scanUntil).getTime()) return
    const account = this.db.getAccount(job.accountId)
    if (!account) return
    this.db.createJob({
      type: 'scan_comments', accountId: account.id, contentItemId: job.contentItemId, parentJobId: job.id,
      scheduledAt: next.toISOString(), idempotencyKey: `scan:${job.contentItemId}:${next.toISOString()}`,
      payload: {
        destinationUrl: config.xhs.webUrl, expectedHandle: account.handle,
        expectedProfileId: account.expectedProfileId, expectedProfileUrl: account.profileUrl,
        targetUrl: job.payload.targetUrl, scanLimit: 20, evidence: { scanUntil },
      },
    })
  }
}

export function startContentScheduler(service: OpsService): () => void {
  const timer = setInterval(() => void service.tick(), 60_000)
  timer.unref()
  void service.tick()
  return () => clearInterval(timer)
}
