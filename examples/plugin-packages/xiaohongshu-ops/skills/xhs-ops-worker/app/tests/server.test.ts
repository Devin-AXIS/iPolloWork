import assert from 'node:assert/strict'
import test from 'node:test'
import type { ContentGenerator } from '../src/content-generator.js'
import { config } from '../src/config.js'
import { OpsDatabase } from '../src/db.js'
import { OpsService } from '../src/service.js'
import { createApp } from '../src/server.js'
import { analyticsCsvHeader, parsePlatformCsv } from '../src/analytics.js'

const generator: ContentGenerator = {
  async generateNote() { throw new Error('not used') },
  async generateReplies() { return new Map() },
}

test('new account browser profiles are saved and never invalidate a different signed-in account', async () => {
  const db = new OpsDatabase(':memory:')
  try {
    const app = createApp(new OpsService(db, generator))
    const old = db.createAccount({ handle: '已有账号', displayName: '已有账号', expectedProfileId: 'old', profileUrl: 'https://creator.xiaohongshu.com/new/home', workerThreadId: 'old-session', position: '产品', audience: '用户', noteTone: '自然', commentTone: '自然', contentColumns: [], bannedTopics: [], dailyLimit: 2 })
    db.setAccountSession(old.id, 'healthy', { verified: true })
    const browserProfileId = '11111111-1111-4111-8111-111111111111'
    const input = { ...old, handle: '新账号', displayName: '新账号', expectedProfileId: 'new', workerThreadId: null, browserProfileId }
    const create = (body: unknown) => app.request('/api/accounts', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await create({ ...input, browserProfileId: '../shared' })).status, 400)
    assert.equal((await create(input)).status, 201)
    const account = db.listAccounts().find(value => value.handle === '新账号')!
    assert.equal(account.browserProfileId, browserProfileId)
    assert.match(await (await app.request('/accounts')).text(), new RegExp(`data-browser-profile-id="${browserProfileId}"`))
    const observe = (sessionId: string, url: string, tree = '', profile = browserProfileId) => app.request('/api/executor/browser-session', {
      method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiToken}` },
      body: JSON.stringify({ sessionId, url, tree, browserProfileId: profile }),
    })
    await observe('old-session', 'https://creator.xiaohongshu.com/login')
    assert.equal(db.getAccount(old.id)?.sessionStatus, 'healthy')
    const tree = 'StaticText "创作服务平台"\nStaticText "新账号"\nStaticText "小红书账号: new"'
    assert.deepEqual(await (await observe('new-session', old.profileUrl, tree, '22222222-2222-4222-8222-222222222222')).json(), { connected: false })
    const previous = db.getAccount(old.id)
    const jobs = db.listJobs()
    assert.deepEqual(await (await observe('old-session', old.profileUrl, tree)).json(), { connected: true, accountId: account.id })
    assert.equal(db.getAccount(account.id)?.sessionStatus, 'healthy')
    assert.equal(db.getAccount(account.id)?.workerThreadId, null)
    assert.ok(db.getAccount(account.id)?.lastVerifiedAt)
    assert.deepEqual(db.getAccount(old.id), previous)
    assert.deepEqual(db.listJobs(), jobs)
    const html = await (await app.request('/accounts')).text()
    const card = html.split(`data-account-id="${account.id}"`)[1]?.split('</article>')[0] ?? ''
    assert.match(card, /已登录|登录正常/)
    assert.doesNotMatch(card, /未登录|登录后即可安排任务|可以安排任务/)
    assert.deepEqual(await (await observe('new-session', old.profileUrl, tree)).json(), { connected: true, accountId: account.id })
    assert.equal(db.getAccount(old.id)?.sessionStatus, 'healthy')
    assert.equal(db.getAccount(account.id)?.workerThreadId, 'new-session')
    await observe('another-session', old.profileUrl, tree)
    assert.equal(db.getAccount(account.id)?.sessionStatus, 'healthy')
    assert.equal(db.getAccount(account.id)?.workerThreadId, 'new-session')
    await observe('new-session', old.profileUrl, tree.replace('新账号', '已有账号').replace('new', 'old'))
    assert.equal(db.getAccount(account.id)?.sessionStatus, 'reauthorize')
    assert.equal(db.getAccount(old.id)?.sessionStatus, 'healthy')
    assert.equal((await create({ ...input, handle: '重复分区', expectedProfileId: 'duplicate' })).status, 400)
  } finally { db.close() }
})

test('login identity automatically connects without a verification job and rejects wrong pages or accounts', async () => {
  const db = new OpsDatabase(':memory:')
  try {
    const app = createApp(new OpsService(db, generator))
    const account = db.createAccount({ handle: '自动连接账号', displayName: '自动连接账号', expectedProfileId: '00123', profileUrl: 'https://creator.xiaohongshu.com/new/home', position: '产品', audience: '用户', noteTone: '自然', commentTone: '自然', contentColumns: [], bannedTopics: [], dailyLimit: 2 })
    const tree = 'StaticText "创作服务平台"\nStaticText "自动连接账号"\nStaticText "小红书账号: 00123"'
    const observe = (url: string, content = tree, authorized = true) => app.request('/api/executor/browser-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.origin, ...(authorized ? { Authorization: `Bearer ${config.apiToken}` } : {}) },
      body: JSON.stringify({ sessionId: 'login-session', url, tree: content }),
    })
    assert.equal((await observe(account.profileUrl, tree, false)).status, 401)
    assert.equal((await observe('https://example.com/new/home')).status, 409)
    assert.deepEqual(await (await observe('https://creator.xiaohongshu.com/new/note-manager')).json(), { connected: false })
    assert.deepEqual(await (await observe(account.profileUrl, tree.replace('00123', '99999'))).json(), { connected: false })
    assert.equal(db.getAccount(account.id)?.sessionStatus, 'setup')
    assert.deepEqual(await (await observe(account.profileUrl)).json(), { connected: true, accountId: account.id })
    const connected = db.getAccount(account.id)
    assert.equal(connected?.sessionStatus, 'healthy')
    assert.equal(connected?.workerThreadId, 'login-session')
    assert.ok(connected?.lastVerifiedAt)
    assert.equal(db.listJobs().length, 0)
    await observe(account.profileUrl)
    assert.equal(db.getAccount(account.id)?.updatedAt, connected?.updatedAt)
    const html = await (await app.request('/accounts')).text()
    assert.match(html, /data-account-login/)
    assert.doesNotMatch(html, /data-verify-account|保存账号并进入验证/)
    await observe('https://creator.xiaohongshu.com/login')
    assert.equal(db.getAccount(account.id)?.sessionStatus, 'reauthorize')
    await observe(account.profileUrl)
    assert.equal(db.getAccount(account.id)?.sessionStatus, 'healthy')
    await observe(account.profileUrl, tree.replace('00123', '99999'))
    assert.equal(db.getAccount(account.id)?.sessionStatus, 'reauthorize')
  } finally { db.close() }
})

test('opens account management and redirects retired task pages', async () => {
  const db = new OpsDatabase(':memory:')
  const app = createApp(new OpsService(db, generator))
  for (const path of ['/accounts', '/comments', '/analytics', '/brand', '/jobs']) {
    const response = await app.request(path)
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /小红书运营台/)
    assert.doesNotMatch(html, /href="\/tasks"|任务看板|data-open-task-panel|data-drop-column|id="campaign-form"/)
  }
  for (const path of ['/', '/tasks', '/calendar']) {
    const response = await app.request(path)
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), '/accounts')
  }
  const accountHtml = await (await app.request('/accounts')).text()
  assert.match(accountHtml, /账号接入步骤/)
  assert.match(accountHtml, /data-new-account-login/)
  assert.match(accountHtml, /name="expectedProfileId"/)
  assert.match(accountHtml, /name="position"/)
  const health = await app.request('/healthz')
  assert.equal(health.status, 200)
  const healthBody = await health.json() as { ok: boolean; codexAvailable: boolean; wakeLockEnabled: boolean }
  assert.equal(healthBody.ok, true)
  assert.equal(typeof healthBody.codexAvailable, 'boolean')
  assert.equal(typeof healthBody.wakeLockEnabled, 'boolean')
  db.close()
})

test('embedded workbench permits only configured frame ancestors and keeps mutation origin checks', async () => {
  const previous = [...config.embedOrigins]
  config.embedOrigins.push('http://localhost:*', 'http://127.0.0.1:*', 'file:')
  const db = new OpsDatabase(':memory:')
  try {
    const app = createApp(new OpsService(db, generator))
    const page = await app.request('/accounts')
    assert.equal(page.status, 200)
    assert.equal(page.headers.get('x-frame-options'), null)
    assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\* file:/)
    const denied = await app.request('/api/campaigns', { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(denied.status, 403)
  } finally {
    config.embedOrigins.splice(0, config.embedOrigins.length, ...previous)
    db.close()
  }
})

test('creates and activates a task without requiring a brand library item', async () => {
  const db = new OpsDatabase(':memory:')
  const service = new OpsService(db, generator)
  const app = createApp(service)
  const headers = { 'Content-Type': 'application/json', Origin: config.origin }
  const account = db.createAccount({
    handle: 'plain-user', displayName: '普通用户账号', expectedProfileId: '10001', profileUrl: 'https://creator.xiaohongshu.com/new/home',
    workerThreadId: 'thread-one', position: '产品技巧', audience: '普通用户', noteTone: '真实', commentTone: '友好',
    contentColumns: ['使用技巧'], bannedTopics: [], dailyLimit: 2,
  })
  db.setAccountSession(account.id, 'healthy', { verified: true })
  const created = await app.request('/api/campaigns', { method: 'POST', headers, body: JSON.stringify({
    name: '每周产品技巧', theme: '讲清楚一个使用技巧', accountIds: [account.id], commentAccountIds: [], knowledgeIds: [], assetIds: [],
    noteTones: ['真实'], commentTones: ['友好'], schedule: { kind: 'weekly', timezone: 'Asia/Shanghai', weekdays: [1, 3, 5], publishTime: '10:00' },
    minComments: 0, maxComments: 0, commentWindowStartMinutes: 30, commentWindowEndMinutes: 240, generateLeadMinutes: 1440,
  }) })
  assert.equal(created.status, 201)
  const createdBody = await created.json() as { campaign: { id: string } }
  const activated = await app.request(`/api/campaigns/${createdBody.campaign.id}/status`, { method: 'POST', headers, body: JSON.stringify({ status: 'active' }) })
  assert.equal(activated.status, 200)
  assert.equal(db.getCampaign(createdBody.campaign.id)?.status, 'active')
  db.close()
})

test('account onboarding supports editing and queues a real session verification', async () => {
  const db = new OpsDatabase(':memory:')
  const service = new OpsService(db, generator)
  const app = createApp(service)
  const headers = { 'Content-Type': 'application/json', Origin: config.origin }
  const created = await app.request('/api/accounts', {
    method: 'POST', headers, body: JSON.stringify({
      handle: 'devin&佳佳', displayName: 'devin&佳佳', expectedProfileId: '107818063', profileUrl: 'https://creator.xiaohongshu.com/new/home',
      workerThreadId: 'thread-account-one', position: '品牌日常与产品实践', audience: '关注产品体验的用户', noteTone: '真实、清楚、自然',
      commentTone: '友好、具体、不夸张', contentColumns: ['品牌日常', '产品体验'], bannedTopics: ['站外导流'], dailyLimit: 2,
    }),
  })
  assert.equal(created.status, 201)
  const createdBody = await created.json() as { account: { id: number } }
  const accountId = createdBody.account.id

  const edited = await app.request(`/api/accounts/${accountId}`, {
    method: 'PUT', headers, body: JSON.stringify({
      displayName: 'devin&佳佳', profileUrl: 'https://creator.xiaohongshu.com/new/home', workerThreadId: 'thread-account-one',
      position: '产品实践账号', audience: '关注产品体验的用户', noteTone: '真实', commentTone: '友好',
      contentColumns: ['产品体验'], bannedTopics: ['站外导流'], dailyLimit: 1,
    }),
  })
  assert.equal(edited.status, 200)
  assert.equal(db.getAccount(accountId)?.dailyLimit, 1)

  const verify = await app.request(`/api/accounts/${accountId}/verify`, { method: 'POST', headers, body: '{}' })
  assert.equal(verify.status, 202)
  assert.equal(db.listJobs().filter((job) => job.type === 'verify_session').length, 1)
  assert.equal(db.dispatchDue().length, 1)

  const page = await app.request('/accounts')
  const html = await page.text()
  assert.match(html, /自动连接/)
  assert.doesNotMatch(html, /标记已登录/)
  db.close()
})

test('rejects cross-origin writes and protects worker claim with bearer token', async () => {
  const db = new OpsDatabase(':memory:')
  const app = createApp(new OpsService(db, generator))
  const rejected = await app.request('/api/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'fact', title: 'A', body: 'B' }) })
  assert.equal(rejected.status, 403)
  const accepted = await app.request('/api/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.origin }, body: JSON.stringify({ kind: 'fact', title: 'A', body: 'B' }) })
  assert.equal(accepted.status, 201)
  const claim = await app.request('/api/executor/jobs/missing/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.origin }, body: JSON.stringify({ accountId: 1 }) })
  assert.equal(claim.status, 401)
  db.close()
})

test('analytics keeps account snapshots and article pages isolated, and rejects invalid imports atomically', async () => {
  const db = new OpsDatabase(':memory:')
  try {
    const app = createApp(new OpsService(db, generator))
    assert.match(await (await app.request('/analytics')).text(), /还没有接入账号/)
    const makeAccount = (id: string) => db.createAccount({ handle: id, displayName: id, expectedProfileId: id, profileUrl: 'https://creator.xiaohongshu.com/new/home', position: '产品', audience: '用户', noteTone: '自然', commentTone: '自然', contentColumns: [], bannedTopics: [], dailyLimit: 2 })
    const first = makeAccount('00123'), second = makeAccount('00456')
    const campaign = db.createCampaign({ name: '数据验证', theme: '测试', accountIds: [first.id, second.id], commentAccountIds: [], knowledgeIds: [], assetIds: [], noteTones: [], commentTones: [], schedule: { kind: 'single', timezone: 'Asia/Shanghai', scheduledLocal: '2026-09-09T12:00', weekdays: [], publishTime: null }, minComments: 0, maxComments: 0, commentWindowStartMinutes: 30, commentWindowEndMinutes: 60, generateLeadMinutes: 60 })
    for (let i = 0; i < 25; i++) db.createPlannedContent(campaign.id, first.id, new Date(Date.UTC(2026, 8, 9, 0, i)).toISOString())
    db.createPlannedContent(campaign.id, second.id, '2026-09-10T00:00:00Z')
    assert.equal(db.accountContent(first.id).total, 25)
    assert.equal(db.accountContent(first.id).items.length, 20)
    assert.equal(db.accountContent(first.id, 999).items.length, 5)
    assert.equal(db.accountContent(second.id).total, 1)
    const headers = { 'Content-Type': 'application/json', Origin: config.origin }
    const csv = analyticsCsvHeader + '\n账号,00123,,,1024,,0,,\n文章,00123,"带逗号,标题",https://www.xiaohongshu.com/explore/abc,,200,0,,3'
    const submit = (id: number, value: string) => app.request(`/api/accounts/${id}/analytics`, { method: 'POST', headers, body: JSON.stringify({ csv: value }) })
    assert.equal((await submit(first.id, csv)).status, 200)
    assert.equal(db.getPlatformSnapshot(first.id)?.followers, 1024)
    assert.equal(db.getPlatformSnapshot(first.id)?.articles[0]?.likes, 0)
    assert.equal(db.getPlatformSnapshot(first.id)?.articles[0]?.collections, null)
    assert.equal((await submit(second.id, csv)).status, 400)
    assert.equal(db.getPlatformSnapshot(second.id), null)
    assert.equal((await submit(first.id, csv.replace(',200,', ',-1,'))).status, 400)
    assert.equal(db.getPlatformSnapshot(first.id)?.articles[0]?.views, 200)
    assert.equal((await app.request(`/api/accounts/${first.id}/analytics`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: JSON.stringify({ csv }) })).status, 403)
    const firstPage = await (await app.request(`/analytics?account=${first.id}&page=2`)).text()
    assert.match(firstPage, /带逗号,标题/)
    assert.match(firstPage, /共 25 篇/)
    const secondPage = await (await app.request(`/analytics?account=${second.id}`)).text()
    assert.match(secondPage, /class="account-switcher"[^>]*>[\s\S]*?<strong>00456<\/strong>/)
    assert.match(secondPage, new RegExp(`href="/analytics\\?account=${second.id}" aria-current="true"`))
    assert.match(secondPage, new RegExp(`href="/comments\\?account=${second.id}"`))
    assert.doesNotMatch(secondPage, /analytics-switch|>查看<\/button>/)
    assert.doesNotMatch(secondPage, /带逗号,标题/)
    assert.match(secondPage, /尚未同步或导入平台数据/)
    assert.equal((await app.request('/analytics?account=99999')).status, 404)
    const escaped = csv.replace('带逗号,标题', '<script>alert(1)</script>')
    await submit(first.id, escaped)
    assert.doesNotMatch(await (await app.request(`/analytics?account=${first.id}`)).text(), /<script>alert\(1\)<\/script>/)
  } finally { db.close() }
})

test('interaction switching filters reader comments, managed actions and reviews before limiting results', async () => {
  const db = new OpsDatabase(':memory:')
  try {
    const app = createApp(new OpsService(db, generator))
    const makeAccount = (name: string) => db.createAccount({ handle: name, displayName: name, expectedProfileId: name, profileUrl: 'https://creator.xiaohongshu.com/new/home', position: '产品', audience: '用户', noteTone: '自然', commentTone: '自然', contentColumns: [], bannedTopics: [], dailyLimit: 2 })
    const first = makeAccount('first-owner'), second = makeAccount('second-owner')
    const campaign = db.createCampaign({ name: '互动验证', theme: '测试', accountIds: [first.id, second.id], commentAccountIds: [], knowledgeIds: [], assetIds: [], noteTones: [], commentTones: [], schedule: { kind: 'single', timezone: 'Asia/Shanghai', scheduledLocal: '2026-09-09T12:00', weekdays: [], publishTime: null }, minComments: 0, maxComments: 0, commentWindowStartMinutes: 30, commentWindowEndMinutes: 60, generateLeadMinutes: 60 })
    const firstContent = db.createPlannedContent(campaign.id, first.id, '2026-09-09T00:00:00Z')
    const secondContent = db.createPlannedContent(campaign.id, second.id, '2026-09-09T00:00:00Z')
    const firstComment = db.createInteraction({ contentItemId: firstContent.id, kind: 'organic_comment', accountId: null, remoteAuthor: 'reader', remoteCommentId: 'first-comment', body: 'FIRST_READER_COMMENT', status: 'review', riskLabels: [], scheduledAt: null, resultUrl: null })
    db.createInteraction({ contentItemId: secondContent.id, kind: 'managed_comment', accountId: first.id, remoteAuthor: null, remoteCommentId: 'first-action', body: 'FIRST_MANAGED_ACTION', status: 'published', riskLabels: [], scheduledAt: null, resultUrl: null })
    db.database.prepare("INSERT INTO review_items (id, interaction_id, account_id, source_text, suggested_text, risk_labels_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, '', '[]', 'pending', ?, ?)").run('first-review', firstComment.id, first.id, 'FIRST_PENDING_REVIEW', '2026-01-01', '2026-01-01')
    db.database.prepare("UPDATE interactions SET created_at = '2026-01-01'").run()
    for (let i = 0; i < 105; i++) {
      const comment = db.createInteraction({ contentItemId: secondContent.id, kind: 'organic_comment', accountId: null, remoteAuthor: 'reader', remoteCommentId: `second-${i}`, body: `SECOND_READER_COMMENT_${i}`, status: 'review', riskLabels: [], scheduledAt: null, resultUrl: null })
      db.database.prepare("INSERT INTO review_items (id, interaction_id, account_id, source_text, suggested_text, risk_labels_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, '', '[]', 'pending', ?, ?)").run(`second-review-${i}`, comment.id, second.id, `SECOND_PENDING_REVIEW_${i}`, comment.createdAt, comment.createdAt)
    }
    db.createInteraction({ contentItemId: firstContent.id, kind: 'reply', accountId: second.id, remoteAuthor: 'reader', remoteCommentId: 'second-action', body: 'SECOND_REPLY_ACTION', status: 'published', riskLabels: [], scheduledAt: null, resultUrl: null })
    assert.equal(db.listInteractions().length, 100)
    assert.equal(db.listReviews().length, 100)
    const defaultPage = await (await app.request('/comments')).text()
    const defaultAccount = db.listAccounts()[0]
    assert.ok(defaultAccount)
    assert.match(defaultPage, new RegExp(`href="/comments\\?account=${defaultAccount.id}" aria-current="true"`))
    const firstPage = await (await app.request(`/comments?account=${first.id}`)).text()
    for (const text of ['FIRST_READER_COMMENT', 'FIRST_MANAGED_ACTION', 'FIRST_PENDING_REVIEW']) assert.ok(firstPage.includes(text))
    assert.equal(firstPage.match(/class="account-bar"/g)?.length, 1)
    assert.ok(firstPage.indexOf('class="app-topbar"') < firstPage.indexOf('class="app-main"'))
    assert.doesNotMatch(firstPage.slice(firstPage.indexOf('class="app-main"')), /class="account-bar"|class="add-account-link"/)
    assert.doesNotMatch(firstPage, /SECOND_READER_COMMENT|SECOND_REPLY_ACTION|SECOND_PENDING_REVIEW/)
    const secondPage = await (await app.request(`/comments?account=${second.id}`)).text()
    assert.match(secondPage, /SECOND_READER_COMMENT|SECOND_REPLY_ACTION/)
    assert.match(secondPage, /SECOND_PENDING_REVIEW/)
    assert.doesNotMatch(secondPage, /FIRST_READER_COMMENT|FIRST_MANAGED_ACTION|FIRST_PENDING_REVIEW/)
    assert.match(secondPage, new RegExp(`href="/comments\\?account=${second.id}" aria-current="true"`))
    assert.match(secondPage, new RegExp(`href="/analytics\\?account=${second.id}"`))
    assert.match(secondPage, /<summary class="account-switcher" aria-label="切换账号">/)
    for (const panel of ['publishing', 'comments', 'analytics']) assert.equal((await app.request(`/${panel}?account=missing`)).status, 404)
    db.deleteAccount(second.id)
    for (const panel of ['publishing', 'comments', 'analytics']) assert.equal((await app.request(`/${panel}?account=${second.id}`)).status, 404)
    db.deleteAccount(first.id)
    assert.doesNotMatch(await (await app.request('/comments')).text(), /FIRST_READER_COMMENT|SECOND_READER_COMMENT|FIRST_PENDING_REVIEW|SECOND_PENDING_REVIEW|class="account-picker"/)
  } finally { db.close() }
})

test('platform CSV handles quoted fields and rejects broken or unsafe data', () => {
  const prefix = analyticsCsvHeader + '\n'
  assert.throws(() => parsePlatformCsv(prefix + '文章,1,"未闭合', '1'), /引号/)
  assert.throws(() => parsePlatformCsv(prefix + '文章,1,文章,javascript:alert(1),,1,1,1,1', '1'), /必须来自小红书/)
  assert.throws(() => parsePlatformCsv(prefix + '账号,1,,,1e3,,,,', '1'), /非负整数/)
  const parsed = parsePlatformCsv('\uFEFF' + prefix + '文章,1,"第一行\n第二行""引号",https://www.xiaohongshu.com/explore/a,,0,,0,', '1')
  assert.equal(parsed.articles[0]?.title, '第一行\n第二行"引号')
  assert.equal(parsed.articles[0]?.views, 0)
  const unlinked = parsePlatformCsv(prefix + '文章,1,页面未提供链接,,,16,1,0,2', '1')
  assert.equal(unlinked.articles[0]?.url, '')
  assert.equal(unlinked.articles[0]?.views, 16)
})

test('current-session verification works across accounts and sessions and requires observed profile identity', async () => {
  const db = new OpsDatabase(':memory:')
  try {
    const app = createApp(new OpsService(db, generator))
    const headers = { 'Content-Type': 'application/json', Origin: config.origin }
    const workerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiToken}` }
    const account = db.createAccount({ handle: '验证账号', displayName: '验证账号', expectedProfileId: '00123', profileUrl: 'https://creator.xiaohongshu.com/new/home', position: '产品', audience: '用户', noteTone: '自然', commentTone: '自然', contentColumns: [], bannedTopics: [], dailyLimit: 2 })
    const second = db.createAccount({ handle: '另一个账号', displayName: '另一个账号', expectedProfileId: '00456', profileUrl: 'https://creator.xiaohongshu.com/new/home', position: '产品', audience: '用户', noteTone: '自然', commentTone: '自然', contentColumns: [], bannedTopics: [], dailyLimit: 2 })
    const post = (path: string, data: unknown, worker = false) => app.request(path, { method: 'POST', headers: worker ? workerHeaders : headers, body: JSON.stringify(data) })
    const prepare = () => post(`/api/accounts/${account.id}/verify`, { sessionId: 'session-validation' })
    const response = await prepare()
    assert.equal(response.status, 202)
    const first = await response.json() as { job: { id: string; status: string }; prompt: string }
    assert.equal(first.job.status, 'dispatched')
    assert.match(first.prompt, /observed-profile-id/)
    assert.equal(db.getAccount(account.id)?.workerThreadId, null)
    assert.equal(db.getJob(first.job.id)?.workerThreadId, 'session-validation')
    const duplicate = await (await prepare()).json() as { job: { id: string } }
    assert.equal(duplicate.job.id, first.job.id)
    assert.equal((await post(`/api/accounts/${second.id}/verify`, { sessionId: 'session-validation' })).status, 202)
    const another = await post(`/api/accounts/${account.id}/verify`, { sessionId: 'another-session' })
    assert.equal(another.status, 202)
    assert.notEqual((await another.json()).job.id, first.job.id)
    const claim = await (await post(`/api/executor/jobs/${first.job.id}/claim`, { accountId: account.id }, true)).json() as { leaseToken: string }
    const running = await (await prepare()).json() as { prompt: string | null }
    assert.equal(running.prompt, null)
    const mismatch = await post(`/api/executor/jobs/${first.job.id}/complete`, { leaseToken: claim.leaseToken, actualAccount: account.handle, actualProfileId: 'wrong-id' }, true)
    assert.equal(mismatch.status, 409)
    assert.equal(db.getAccount(account.id)?.sessionStatus, 'blocked')
    const retry = await (await prepare()).json() as { job: { id: string } }
    assert.notEqual(retry.job.id, first.job.id)
    const secondClaim = await (await post(`/api/executor/jobs/${retry.job.id}/claim`, { accountId: account.id }, true)).json() as { leaseToken: string }
    const verified = await post(`/api/executor/jobs/${retry.job.id}/complete`, { leaseToken: secondClaim.leaseToken, actualAccount: account.handle, actualProfileId: account.expectedProfileId }, true)
    assert.equal(verified.status, 200)
    assert.equal(db.getAccount(account.id)?.sessionStatus, 'healthy')
    assert.ok(db.getAccount(account.id)?.lastVerifiedAt)
    assert.equal((await post(`/api/accounts/${second.id}/session`, { status: 'healthy' })).status, 400)
    assert.equal(db.getAccount(second.id)?.sessionStatus, 'setup')
  } finally { db.close() }
})

test('session replacement migrates unbound sync jobs and browser sync requires validated data and identity', async () => {
  const db = new OpsDatabase(':memory:')
  try {
    const app = createApp(new OpsService(db, generator))
    const account = db.createAccount({ handle: '同步账号', displayName: '同步账号', expectedProfileId: '123', profileUrl: 'https://creator.xiaohongshu.com/new/home', position: '产品', audience: '用户', noteTone: '自然', commentTone: '自然', contentColumns: [], bannedTopics: [], dailyLimit: 2 })
    const headers = { 'Content-Type': 'application/json', Origin: config.origin }
    const auth = { ...headers, Authorization: `Bearer ${config.apiToken}` }
    const post = (path: string, body: unknown, worker = false) => app.request(path, { method: 'POST', headers: worker ? auth : headers, body: JSON.stringify(body) })
    const started = await (await post(`/api/accounts/${account.id}/verify`, { sessionId: 'draft-id', syncAnalytics: true })).json() as { job: { id: string }; prompt: string }
    assert.match(started.prompt, /analyticsCsv/)
    const bind = { previousSessionId: 'draft-id', sessionId: 'actual-id' }
    assert.equal((await post('/api/executor/rebind-session', bind)).status, 401)
    assert.equal((await post('/api/executor/rebind-session', bind, true)).status, 200)
    assert.equal(db.getAccount(account.id)?.workerThreadId, null)
    assert.equal(db.getJob(started.job.id)?.workerThreadId, 'actual-id')
    assert.equal((await post(`/api/executor/jobs/${started.job.id}/claim`, { accountId: account.id, workerSessionId: 'draft-id' }, true)).status, 409)
    const claim = await (await post(`/api/executor/jobs/${started.job.id}/claim`, { accountId: account.id, workerSessionId: 'actual-id', verificationOnly: true }, true)).json() as { leaseToken: string }
    const complete = { leaseToken: claim.leaseToken, actualAccount: account.handle, actualProfileId: '123' }
    assert.equal((await post(`/api/executor/jobs/${started.job.id}/complete`, complete, true)).status, 409)
    assert.equal(db.getPlatformSnapshot(account.id), null)
    const csv = analyticsCsvHeader + '\n账号,123,,,100,,0,2,\n文章,123,真实文章,https://www.xiaohongshu.com/explore/one,,321,1,0,2'
    assert.equal((await post(`/api/executor/jobs/${started.job.id}/complete`, { ...complete, analyticsCsv: csv }, true)).status, 200)
    assert.equal(db.getPlatformSnapshot(account.id)?.source, 'browser')
    assert.equal(db.getPlatformSnapshot(account.id)?.articles[0]?.views, 321)
    assert.equal(db.getPlatformSnapshot(account.id)?.articles[0]?.collections, 0)
    const page = await (await app.request('/analytics')).text()
    assert.match(page, /浏览器可见页面/)
    assert.match(page, /同步数据/)
    assert.equal((await post(`/api/executor/jobs/${started.job.id}/complete`, { ...complete, analyticsCsv: csv }, true)).status, 409)
  } finally { db.close() }
})

test('sync ignores old worker bindings and active jobs while deduplicating only the same session and mode', async () => {
  const db = new OpsDatabase(':memory:')
  try {
    const app = createApp(new OpsService(db, generator))
    const base = { profileUrl: config.xhs.creatorUrl, position: '产品', audience: '用户', noteTone: '自然', commentTone: '自然', contentColumns: [], bannedTopics: [], dailyLimit: 2 }
    const account = db.createAccount({ ...base, handle: '同步账号', displayName: '同步账号', expectedProfileId: '123', workerThreadId: 'old-session', browserProfileId: '11111111-1111-4111-8111-111111111111' })
    const other = db.createAccount({ ...base, handle: '另一个账号', displayName: '另一个账号', expectedProfileId: '456', workerThreadId: 'current-session' })
    db.setAccountSession(account.id, 'healthy', { verified: true })
    db.setAccountSession(other.id, 'healthy', { verified: true })
    const accountsBefore = db.listAccounts()
    const headers = { 'Content-Type': 'application/json', Origin: config.origin }
    const post = (path: string, body: unknown, worker = false) => app.request(path, { method: 'POST', headers: worker ? { ...headers, Authorization: `Bearer ${config.apiToken}` } : headers, body: JSON.stringify(body) })
    const prepare = (sessionId: string, syncAnalytics = true) => post(`/api/accounts/${account.id}/verify`, { sessionId, syncAnalytics })
    const old = await (await prepare('old-session')).json()
    assert.equal((await post(`/api/executor/jobs/${old.job.id}/claim`, { accountId: account.id, workerSessionId: 'old-session', verificationOnly: true }, true)).status, 200)
    const oldJob = db.getJob(old.job.id)
    const identity = await (await prepare('current-session', false)).json()
    const response = await prepare('current-session')
    assert.equal(response.status, 202)
    const sync = await response.json()
    assert.notEqual(sync.job.id, old.job.id)
    assert.notEqual(sync.job.id, identity.job.id)
    assert.equal(sync.job.workerThreadId, 'current-session')
    assert.equal(sync.job.payload.browserProfileId, 'xiaohongshu-ops:' + account.browserProfileId)
    assert.equal((await (await prepare('current-session')).json()).job.id, sync.job.id)
    assert.deepEqual(db.listAccounts(), accountsBefore)
    assert.deepEqual(db.getJob(old.job.id), oldJob)
    assert.equal((await post(`/api/executor/jobs/${sync.job.id}/claim`, { accountId: account.id, workerSessionId: 'old-session', verificationOnly: true }, true)).status, 409)
    const claimed = await post(`/api/executor/jobs/${sync.job.id}/claim`, { accountId: account.id, workerSessionId: 'current-session', verificationOnly: true }, true)
    assert.equal(claimed.status, 200)
    const { leaseToken } = await claimed.json()
    assert.equal((await (await prepare('current-session')).json()).prompt, null)
    const analyticsCsv = analyticsCsvHeader + '\n账号,123,,,100,,0,2,'
    assert.equal((await post(`/api/executor/jobs/${sync.job.id}/complete`, { leaseToken, actualAccount: account.handle, actualProfileId: '123', analyticsCsv }, true)).status, 200)
    assert.equal(db.getPlatformSnapshot(account.id)?.source, 'browser')
    assert.equal(db.getAccount(account.id)?.workerThreadId, 'old-session')
    assert.equal(db.getPlatformSnapshot(other.id), null)
    assert.deepEqual(db.getJob(old.job.id), oldJob)
    const next = await prepare('current-session')
    assert.equal(next.status, 202)
    assert.notEqual((await next.json()).job.id, sync.job.id)
  } finally { db.close() }
})

test('session replacement keeps legacy worker migration and includes syncs for other accounts', async () => {
  const db = new OpsDatabase(':memory:')
  try {
    const app = createApp(new OpsService(db, generator))
    const base = { profileUrl: config.xhs.creatorUrl, position: '产品', audience: '用户', noteTone: '自然', commentTone: '自然', contentColumns: [], bannedTopics: [], dailyLimit: 2 }
    const bound = db.createAccount({ ...base, handle: '绑定账号', displayName: '绑定账号', expectedProfileId: '123', workerThreadId: 'draft-session' })
    const other = db.createAccount({ ...base, handle: '同步账号', displayName: '同步账号', expectedProfileId: '456', workerThreadId: 'other-session' })
    const response = await app.request(`/api/accounts/${other.id}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.origin }, body: JSON.stringify({ sessionId: 'draft-session', syncAnalytics: true }) })
    assert.equal(response.status, 202)
    const { job } = await response.json()
    db.rebindWorkerSession('draft-session', 'actual-session')
    assert.equal(db.getAccount(bound.id)?.workerThreadId, 'actual-session')
    assert.equal(db.getAccount(other.id)?.workerThreadId, 'other-session')
    assert.equal(db.getJob(job.id)?.workerThreadId, 'actual-session')
  } finally { db.close() }
})

test('verification targets the selected browser profile and upgrades pending jobs without changing another account', async () => {
  const db = new OpsDatabase(':memory:')
  try {
    const app = createApp(new OpsService(db, generator))
    const base = { profileUrl: 'https://creator.xiaohongshu.com/new/home', position: '产品', audience: '用户', noteTone: '自然', commentTone: '自然', contentColumns: [], bannedTopics: [], dailyLimit: 2 }
    const first = db.createAccount({ ...base, handle: '旧账号', displayName: '旧账号', expectedProfileId: '111', workerThreadId: 'session-a' })
    const second = db.createAccount({ ...base, handle: '独立账号', displayName: '独立账号', expectedProfileId: '222', workerThreadId: 'session-b', browserProfileId: '11111111-1111-4111-8111-111111111111' })
    db.setAccountSession(first.id, 'healthy', { verified: true })
    const unchanged = db.getAccount(first.id)
    const legacy = db.createJob({ type: 'verify_session', accountId: second.id, scheduledAt: new Date().toISOString(), idempotencyKey: 'pending-sync', payload: { destinationUrl: config.xhs.creatorUrl, expectedHandle: second.handle, expectedProfileId: second.expectedProfileId, expectedProfileUrl: second.profileUrl, evidence: { syncAnalytics: true } } })
    db.dispatchDue()
    const response = await app.request(`/api/accounts/${second.id}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.origin }, body: JSON.stringify({ sessionId: 'session-b', syncAnalytics: true }) })
    assert.equal(response.status, 202)
    const result = await response.json()
    assert.equal(result.job.id, legacy.id)
    assert.equal(result.job.payload.browserProfileId, 'xiaohongshu-ops:' + second.browserProfileId)
    assert.equal(db.getJob(legacy.id)?.payload.browserProfileId, result.job.payload.browserProfileId)
    assert.deepEqual(result.browserTarget, { url: config.xhs.creatorUrl, browserProfileId: second.browserProfileId })
    assert.ok(result.prompt.includes(JSON.stringify({ url: config.xhs.creatorUrl, profileId: result.job.payload.browserProfileId })))
    assert.match(result.prompt, /必须显式传入此 tabId/)
    assert.match(result.prompt, /不要让用户退出其他已登录账号/)
    assert.deepEqual(db.getAccount(first.id), unchanged)
    const oldResponse = await app.request(`/api/accounts/${first.id}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.origin }, body: JSON.stringify({ sessionId: 'session-a' }) })
    const old = await oldResponse.json()
    assert.deepEqual(old.browserTarget, { url: config.xhs.creatorUrl })
    assert.equal(old.job.payload.browserProfileId, null)
  } finally { db.close() }
})


test('verified platform avatars persist and deletion requires a local origin', async () => {
  const db = new OpsDatabase(':memory:')
  try {
    const app = createApp(new OpsService(db, generator))
    const owner = db.createAccount({ handle: '头像账号', displayName: '头像账号', expectedProfileId: 'avatar-profile', profileUrl: 'https://creator.xiaohongshu.com/new/home', position: '产品', audience: '用户', noteTone: '自然', commentTone: '友好', contentColumns: [], bannedTopics: [], dailyLimit: 2 })
    const avatarUrl = 'https://sns-avatar-qc.xhscdn.com/avatar/observed-profile?imageView2/2/w/80/format/jpg'
    const tree = 'StaticText "创作服务平台"\nStaticText "头像账号"\nStaticText "小红书账号: avatar-profile"'
    const observe = (avatar = avatarUrl, content = tree, browserProfileId: string | null = null) => app.request('/api/executor/browser-session', { method: 'POST', headers: { Origin: config.origin, Authorization: 'Bearer ' + config.apiToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'avatar-session', url: owner.profileUrl, tree: content, avatarUrl: avatar, browserProfileId }) })
    await observe(avatarUrl, tree.replace('avatar-profile', 'another-profile'))
    assert.equal(db.getAccount(owner.id)?.avatarUrl, null)
    for (const value of ['https://evil.example/avatar/profile', 'javascript:alert(1)', 'https://xhscdn.com.evil.example/avatar/profile', 'https://user:pass@sns-avatar-qc.xhscdn.com/avatar/profile']) assert.equal((await observe(value)).status, 409)
    const differentBrowser = await observe(avatarUrl, tree, '11111111-1111-4111-8111-111111111111')
    assert.equal((await differentBrowser.json()).connected, false)
    assert.equal(db.getAccount(owner.id)?.avatarUrl, avatarUrl)
    assert.equal(db.getAccount(owner.id)?.workerThreadId, null)
    assert.equal((await observe()).status, 200)
    const saved = db.getAccount(owner.id)
    assert.equal(saved?.avatarUrl, avatarUrl)
    await observe()
    assert.equal(db.getAccount(owner.id)?.updatedAt, saved?.updatedAt)
    const page = await app.request('/accounts')
    assert.match(page.headers.get('content-security-policy') || '', /https:\/\/\*\.xhscdn\.com/)
    const html = await page.text()
    assert.ok(html.includes('data-account-avatar src="' + avatarUrl + '"'))
    const remove = (origin: string) => app.request('/api/accounts/' + owner.id, { method: 'DELETE', headers: { Origin: origin } })
    assert.equal((await remove('https://evil.example')).status, 403)
    assert.ok(db.getAccount(owner.id))
    assert.equal((await remove(config.origin)).status, 200)
    assert.equal(db.getAccount(owner.id), null)
    await observe()
    assert.equal(db.listAccounts().length, 0)
    assert.equal((await remove(config.origin)).status, 200)
  } finally { db.close() }
})
