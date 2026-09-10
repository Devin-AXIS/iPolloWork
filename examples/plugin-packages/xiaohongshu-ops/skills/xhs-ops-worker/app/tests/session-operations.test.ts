import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from '../src/config.js'
import { OpsDatabase } from '../src/db.js'
import { OpsService } from '../src/service.js'
import { createApp } from '../src/server.js'
import type { BrowserJob } from '../src/types.js'

function fixture() {
  const db = new OpsDatabase(':memory:')
  const app = createApp(new OpsService(db))
  const addAccount = (name: string, workerThreadId: string | null) => db.createAccount({
    handle: name, displayName: name, expectedProfileId: name + '-id', profileUrl: 'https://creator.xiaohongshu.com/new/home',
    workerThreadId, browserProfileId: name === 'author' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222',
    position: '产品', audience: '用户', noteTone: '自然', commentTone: '自然', contentColumns: [], bannedTopics: [], dailyLimit: 2,
  })
  const author = addAccount('author', 'existing-worker')
  const other = addAccount('other', null)
  const headers = { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json', Origin: config.origin }
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })
  const operation = {
    accountId: author.id, sessionId: 'scheduled-session', runKey: 'schedule-one:occurrence-one', operationKey: 'comment-one',
    type: 'create_comment', targetUrl: 'https://www.xiaohongshu.com/explore/external-post', body: '这条经验很实用。',
  }
  const prepare = async (input: unknown = operation) => {
    const response = await post('/api/executor/operations', input)
    const body = await response.json() as { job: BrowserJob; error?: string }
    assert.equal(response.status, 200, body.error ?? 'Operation preparation failed')
    return body.job
  }
  const claim = (job: BrowserJob, extra: Record<string, unknown> = {}) => post(`/api/executor/jobs/${job.id}/claim`, {
    accountId: job.accountId, workerSessionId: job.workerThreadId, pluginSession: true,
    actualAccount: job.accountId === author.id ? author.handle : other.handle,
    actualProfileId: job.accountId === author.id ? author.expectedProfileId : other.expectedProfileId, ...extra,
  })
  return { db, app, author, other, headers, post, operation, prepare, claim }
}

test('scheduled sessions prepare and complete comments and replies without rebinding account workers', async () => {
  const f = fixture()
  try {
    const job = await f.prepare()
    assert.equal(job.status, 'dispatched')
    assert.equal(job.workerThreadId, 'scheduled-session')
    assert.equal(job.payload.browserProfileId, 'xiaohongshu-ops:' + f.author.browserProfileId)
    assert.equal(f.db.getAccount(f.author.id)?.workerThreadId, 'existing-worker')
    assert.equal((await f.claim(job, { actualProfileId: f.other.expectedProfileId })).status, 409)
    assert.equal((await f.claim(job, { workerSessionId: 'wrong-session' })).status, 409)
    const claim = await (await f.claim(job)).json() as { leaseToken: string }
    assert.equal((await f.claim(job)).status, 409)
    const complete = { leaseToken: claim.leaseToken, actualAccount: f.author.handle, actualProfileId: f.author.expectedProfileId, resultUrl: f.operation.targetUrl + '#comment-1' }
    assert.equal((await f.post(`/api/executor/jobs/${job.id}/complete`, { ...complete, actualProfileId: 'wrong' })).status, 409)
    assert.equal(f.db.getJob(job.id)?.status, 'running')
    assert.equal((await f.post(`/api/executor/jobs/${job.id}/complete`, { ...complete, resultUrl: 'https://example.com/forged' })).status, 409)
    assert.equal((await f.post(`/api/executor/jobs/${job.id}/complete`, complete)).status, 200)
    const record = f.db.listInteractions(100, f.author.id)[0]
    assert.equal(record?.contentItemId, null)
    assert.equal(record?.status, 'published')
    assert.equal(record?.resultUrl, complete.resultUrl)
    assert.equal(f.db.listInteractions(100, f.other.id).length, 0)
    assert.match(await (await f.app.request(`/interactions?account=${f.author.id}`)).text(), /这条经验很实用/)
    const reply = await f.prepare({ ...f.operation, accountId: f.other.id, sessionId: 'next-scheduled-session', runKey: 'schedule-two:occurrence-one', type: 'reply_comment', targetCommentText: '具体怎么使用？', targetAuthor: 'reader', body: '可以先按文章的第一步操作。' })
    assert.equal(reply.payload.targetCommentText, '具体怎么使用？')
    const replyClaim = await (await f.claim(reply)).json() as { leaseToken: string }
    assert.equal((await f.post(`/api/executor/jobs/${reply.id}/complete`, { leaseToken: replyClaim.leaseToken, actualAccount: f.other.handle, actualProfileId: f.other.expectedProfileId, resultUrl: f.operation.targetUrl + '#reply-1' })).status, 200)
    assert.equal(f.db.listInteractions(100, f.other.id)[0]?.kind, 'reply')
    assert.equal(f.db.getAccount(f.other.id)?.workerThreadId, null)
    assert.equal(f.db.getAccount(f.author.id)?.workerThreadId, 'existing-worker')
  } finally { f.db.close() }
})

test('operation identity survives retries, locks payloads, and blocks overlapping or uncertain writes', async () => {
  const f = fixture()
  try {
    const first = await f.prepare()
    const retry = await f.prepare({ ...f.operation, sessionId: 'retry-session' })
    assert.equal(retry.id, first.id)
    assert.equal(retry.workerThreadId, 'retry-session')
    assert.equal(f.db.listInteractions().length, 1)
    assert.equal((await f.post('/api/executor/operations', { ...f.operation, body: 'changed' })).status, 409)
    assert.equal((await f.post('/api/executor/operations', { ...f.operation, accountId: f.other.id })).status, 409)
    assert.equal((await f.claim(first)).status, 409)
    const claimed = await (await f.claim(retry)).json() as { leaseToken: string }
    const next = await f.prepare({ ...f.operation, operationKey: 'comment-two' })
    assert.equal((await f.claim(next)).status, 409)
    assert.equal((await f.post(`/api/executor/jobs/${retry.id}/uncertain`, { leaseToken: claimed.leaseToken, code: 'result_uncertain', message: '已点击提交，尚未确认结果' })).status, 200)
    assert.equal((await f.prepare({ ...f.operation, sessionId: 'third-session' })).status, 'needs_reconcile')
    assert.equal((await f.claim(next)).status, 409)
    assert.equal(f.db.listInteractions().find(item => item.remoteCommentId === `job:${retry.id}`)?.status, 'failed')
    f.db.deleteAccount(f.other.id)
    assert.equal((await f.post('/api/executor/operations', { ...f.operation, accountId: f.other.id, runKey: 'deleted' })).status, 409)
  } finally { f.db.close() }
})

test('a scheduled post creates real article records and four images and completes atomically', async () => {
  const f = fixture()
  try {
    const input = { ...f.operation, type: 'publish_note', title: '一次实用体验', body: '记录一次实际使用过程。', topics: ['体验'], cards: [1, 2, 3].map(i => ({ heading: `步骤 ${i}`, body: '按自己的实际需求选择。' })) }
    const job = await f.prepare(input)
    assert.equal(job.payload.mediaPaths?.length, 4)
    assert.ok(job.contentItemId)
    assert.equal(f.db.getContent(job.contentItemId)?.campaignId, null)
    assert.equal((await f.prepare(input)).id, job.id)
    assert.equal(f.db.accountContent(f.author.id).total, 1)
    const lease = await (await f.claim(job)).json() as { leaseToken: string }
    const complete = { leaseToken: lease.leaseToken, actualAccount: f.author.handle, actualProfileId: f.author.expectedProfileId, resultUrl: 'https://www.xiaohongshu.com/explore/published-post' }
    f.db.database.exec("CREATE TRIGGER fail_article_update BEFORE UPDATE OF published_at ON content_items BEGIN SELECT RAISE(ABORT, 'test interrupted write'); END")
    assert.equal((await f.post(`/api/executor/jobs/${job.id}/complete`, complete)).status, 409)
    assert.equal(f.db.getJob(job.id)?.status, 'running')
    f.db.database.exec('DROP TRIGGER fail_article_update')
    assert.equal((await f.post(`/api/executor/jobs/${job.id}/complete`, complete)).status, 200)
    assert.equal(f.db.getContent(job.contentItemId)?.status, 'published')
    assert.equal((await f.prepare(input)).status, 'succeeded')
    assert.equal((await f.claim(job)).status, 409)
    assert.match(await (await f.app.request(`/analytics?account=${f.author.id}`)).text(), /一次实用体验/)
    assert.equal(f.db.getAccount(f.author.id)?.workerThreadId, 'existing-worker')
  } finally { f.db.close() }
})

test('operation APIs reject unauthorized calls and invalid targets or reply context', async () => {
  const f = fixture()
  try {
    for (const path of ['/api/executor/accounts', '/api/executor/jobs/unknown']) assert.equal((await f.app.request(path)).status, 401)
    assert.equal((await f.app.request('/api/executor/operations', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(f.operation) })).status, 401)
    for (const input of [
      { ...f.operation, targetUrl: 'https://www.xiaohongshu.com.attacker.test/explore/one' },
      { ...f.operation, targetUrl: 'https://credentials@www.xiaohongshu.com/explore/one' },
      { ...f.operation, type: 'reply_comment' },
      { ...f.operation, type: 'publish_note', title: 'Missing cards' },
    ]) assert.equal((await f.post('/api/executor/operations', input)).status, 409)
    assert.equal(f.db.listJobs().length, 0)
  } finally { f.db.close() }
})

test('nullable session ownership migration preserves existing content, interactions and foreign keys', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xhs-session-migration-'))
  const file = join(directory, 'ops.sqlite')
  let db = new OpsDatabase(file)
  try {
    // Recreate the two previous table definitions, then reopen through the production migration.
    for (const [table, column] of [['content_items', 'campaign_id'], ['interactions', 'content_item_id']]) {
      assert.ok(table && column)
      const row = db.database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
      assert.equal(typeof row?.sql, 'string')
      const sql = String(row?.sql).replace(`CREATE TABLE ${table}`, `CREATE TABLE ${table}_legacy`).replace(`${column} TEXT REFERENCES`, `${column} TEXT NOT NULL REFERENCES`)
      db.database.exec(`PRAGMA foreign_keys = OFF; ${sql}; DROP TABLE ${table}; ALTER TABLE ${table}_legacy RENAME TO ${table}; PRAGMA foreign_keys = ON;`)
    }
    const author = db.createAccount({ handle: 'legacy', displayName: 'legacy', expectedProfileId: 'legacy-id', profileUrl: 'https://creator.xiaohongshu.com/new/home', workerThreadId: 'legacy-worker', position: '产品', audience: '用户', noteTone: '自然', commentTone: '自然', contentColumns: [], bannedTopics: [], dailyLimit: 2 })
    const campaign = db.createCampaign({ name: '已有活动', theme: '测试', accountIds: [author.id], commentAccountIds: [], knowledgeIds: [], assetIds: [], noteTones: [], commentTones: [], schedule: { kind: 'single', timezone: 'Asia/Shanghai', scheduledLocal: '2026-09-10T12:00', weekdays: [], publishTime: null }, minComments: 0, maxComments: 0, commentWindowStartMinutes: 30, commentWindowEndMinutes: 60, generateLeadMinutes: 60 })
    const content = db.createPlannedContent(campaign.id, author.id, '2026-09-10T04:00:00Z')
    db.createInteraction({ contentItemId: content.id, kind: 'organic_comment', accountId: null, remoteAuthor: 'reader', remoteCommentId: 'legacy-comment', body: '已有评论', status: 'published', riskLabels: [], scheduledAt: null, resultUrl: null })
    db.close()
    db = new OpsDatabase(file)
    assert.equal(db.getContent(content.id)?.campaignId, campaign.id)
    assert.equal(db.listInteractions(100, author.id)[0]?.body, '已有评论')
    assert.equal(db.getAccount(author.id)?.workerThreadId, 'legacy-worker')
    assert.equal(db.createPlannedContent(null, author.id, '2026-09-11T04:00:00Z').campaignId, null)
    assert.deepEqual(db.database.prepare('PRAGMA foreign_key_check').all(), [])
    db.close()
    db = new OpsDatabase(file)
    assert.equal(db.listContent().length, 2)
  } finally { if (db.database.isOpen) db.close(); rmSync(directory, { recursive: true, force: true }) }
})
