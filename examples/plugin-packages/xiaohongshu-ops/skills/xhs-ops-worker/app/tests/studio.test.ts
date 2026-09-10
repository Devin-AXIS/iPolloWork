import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { config } from '../src/config.js'
import { OpsDatabase } from '../src/db.js'
import { OpsService } from '../src/service.js'
import { StudioService } from '../src/studio.js'
import { storeMedia } from '../src/assets.js'
import { createApp } from '../src/server.js'

function fixture() {
  const db = new OpsDatabase(':memory:')
  const ops = new OpsService(db)
  const studio = new StudioService(ops)
  const app = createApp(ops)
  const add = (name: string) => db.createAccount({ handle: name, displayName: name, expectedProfileId: name + '-id', profileUrl: config.xhs.creatorUrl,
    browserProfileId: name === 'author' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222', workerThreadId: null,
    position: '产品经验', audience: '用户', noteTone: '自然', commentTone: '自然', contentColumns: [], bannedTopics: [], dailyLimit: 20 })
  const author = add('author'), other = add('other')
  const search = studio.createSearch({ accountId: author.id, query: '桌面收纳', limit: 2, exclude: '抽奖', instruction: '结合实际内容交流' })
  const results = [
    { url: new URL(config.xhs.webUrl).origin + '/explore/desk-one?xsec_token=visible', title: '收纳盒比较', excerpt: '分享两种盒子的尺寸', likes: 3 },
    { url: new URL(config.xhs.webUrl).origin + '/discovery/item/desk-two', title: '收纳抽奖', excerpt: '抽奖', likes: 9 },
    { url: new URL(config.xhs.webUrl).origin + '/explore/desk-three', title: '小桌面布置', excerpt: '小户型桌面布置', likes: null },
  ]
  studio.saveResults({ accountId: author.id, searchId: search.id, results })
  const post = (action: string, input: unknown, headers = { Origin: config.origin }) => app.request('/api/studio/' + action, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  return { db, ops, studio, app, author, other, search, results, post }
}

test('native draft writes preserve Unicode and omitted fields without a session, and reject lossy overwrites atomically', async () => {
  const f = fixture()
  try {
    const original = f.studio.saveDraft({ accountId: f.author.id, name: '新品体验', brief: '做一个小米 n90 的体验图', title: '原始标题', body: '原始描述', topics: ['体验'] })
    const input = { accountId: f.author.id, id: original.id, title: '桌面上的新灵感｜中文 ✅', body: '第一行：你好，小红书！\n第二行 📸\nWhy???', topics: ['中文话题'] }
    const response = await f.app.request('/api/executor/studio/save-post-draft', { method: 'POST', headers: { Authorization: 'Bearer ' + config.apiToken, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(input) })
    assert.equal(response.status, 200)
    const { draft } = await response.json()
    assert.equal(draft.title, input.title)
    assert.equal(draft.body, input.body)
    assert.equal(draft.name, original.name)
    assert.equal(draft.brief, original.brief)
    assert.deepEqual(draft.topics, input.topics)
    for (const body of ['???????N90,???????????!', '文字\uFFFD损坏']) {
      assert.throws(() => f.studio.saveDraft({ accountId: f.author.id, id: original.id, body }), /未覆盖原内容/)
      assert.equal(f.studio.draft(original.id).body, input.body)
    }
    await assert.rejects(f.studio.execute('prepare-draft-publish', { accountId: f.author.id, draftId: original.id }), /会话/)
    assert.equal(f.db.listJobs().length, 0)
  } finally { f.db.close() }
})

test('drafts persist presets, isolate accounts, lock after publishing and resume only unclaimed operations', async () => {
  const f = fixture()
  try {
    const asset = f.db.createAsset({ kind: 'upload', filename: 'generated.png', mimeType: 'image/png', relativePath: 'uploads/generated.png', sha256: 'fixture', width: 10, height: 10 })
    const draft = f.studio.saveDraft({ accountId: f.author.id, name: '产品预设', title: '桌面整理', body: '试试按使用频率放置物品。', topics: ['桌面'], mediaKind: 'image', assetIds: [asset.id], runKey: 'schedule:run-one:post-1' })
    assert.equal(f.studio.saveDraft({ accountId: f.author.id, runKey: 'schedule:run-one:post-1' }).id, draft.id)
    assert.throws(() => f.studio.saveDraft({ ...draft, accountId: f.other.id }), /当前账号/)
    assert.equal(f.studio.state(f.other.id).drafts.length, 0)
    const job = await f.studio.prepareDraft({ accountId: f.author.id, draftId: draft.id }, 'session-one')
    assert.equal(job.payload.mediaKind, 'image')
    assert.deepEqual(job.payload.mediaPaths, [join(config.assetDir, asset.relativePath)])
    assert.equal(job.payload.browserProfileId, 'xiaohongshu-ops:' + f.author.browserProfileId)
    assert.throws(() => f.studio.saveDraft({ ...draft }), /锁定|另存/)
    const resumed = await f.studio.prepareDraft({ accountId: f.author.id, draftId: draft.id }, 'session-two')
    assert.equal(resumed.id, job.id)
    assert.equal(resumed.workerThreadId, 'session-two')
    f.db.claimJob(job.id, f.author.id, { sessionId: 'session-two', actualAccount: f.author.handle, actualProfileId: f.author.expectedProfileId })
    assert.equal((await f.studio.prepareDraft({ accountId: f.author.id, draftId: draft.id }, 'session-three')).workerThreadId, 'session-two')
    assert.equal(f.db.listContent(100).length, 1)
    assert.equal(f.db.getAccount(f.author.id)?.workerThreadId, null)
  } finally { f.db.close() }
})

test('search rejects forged links and duplicate IDs, validates changes atomically, and keeps runs stable', () => {
  const f = fixture()
  try {
    const stable = f.studio.createSearch({ accountId: f.author.id, query: '桌面', runKey: 'schedule:run-one:search-1' })
    assert.equal(f.studio.createSearch({ accountId: f.author.id, query: 'different', runKey: 'schedule:run-one:search-1' }).id, stable.id)
    assert.throws(() => f.studio.saveResults({ accountId: f.author.id, searchId: f.search.id, results: [{ title: '伪造', url: 'https://example.com/explore/id' }] }), /真实/)
    assert.throws(() => f.studio.saveResults({ accountId: f.author.id, searchId: f.search.id, results: [f.results[0], { ...f.results[0], url: new URL(config.xhs.webUrl).origin + '/explore/desk-one?different=1' }] }), /重复/)
    assert.throws(() => f.studio.updateCandidates({ accountId: f.author.id, searchId: f.search.id, items: [{ id: 'desk-one', selected: true, comment: '合法' }, { id: 'forged-id', selected: true, comment: '错误' }] }), /当前列表/)
    assert.equal(f.studio.search(f.search.id).results[0]?.comment, '')
    assert.throws(() => f.studio.updateCandidates({ accountId: f.other.id, searchId: f.search.id, items: [] }), /当前账号/)
    assert.throws(() => f.studio.updateCandidates({ accountId: f.author.id, searchId: f.search.id, items: ['desk-one', 'desk-two', 'desk-three'].map(id => ({ id, selected: true, comment: '交流' })) }), /最多/)
    assert.equal(f.studio.search(f.search.id).results.filter(item => item.selected).length, 0)
    f.db.deleteAccount(f.author.id)
    assert.throws(() => f.studio.search(f.search.id), /账号不存在/)
  } finally { f.db.close() }
})

test('batch comments skip excluded and previously handled posts, are idempotent, and verify the selected identity', async () => {
  const f = fixture()
  try {
    f.studio.updateCandidates({ accountId: f.author.id, searchId: f.search.id, items: ['desk-one', 'desk-two'].map(id => ({ id, selected: true, comment: '请问盒子的尺寸是多少？' })) })
    const batch = await f.studio.prepareBatch({ accountId: f.author.id, searchId: f.search.id }, 'session-one')
    assert.equal(batch.jobs.length, 1)
    assert.equal(batch.skipped[0]?.id, 'desk-two')
    assert.equal(f.studio.search(f.search.id).results[1]?.status, 'skipped')
    const job = batch.jobs[0]!
    assert.throws(() => f.db.claimJob(job.id, f.author.id, { sessionId: 'session-one', actualAccount: f.other.handle, actualProfileId: f.other.expectedProfileId }), /身份/)
    const retry = await f.studio.prepareBatch({ accountId: f.author.id, searchId: f.search.id }, 'session-two')
    assert.equal(retry.jobs[0]?.id, job.id)
    const lease = f.db.claimJob(job.id, f.author.id, { sessionId: 'session-two', actualAccount: f.author.handle, actualProfileId: f.author.expectedProfileId })
    const response = await f.app.request(`/api/executor/jobs/${job.id}/complete`, { method: 'POST', headers: { Authorization: 'Bearer ' + config.apiToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ leaseToken: lease.leaseToken, actualAccount: f.author.handle, actualProfileId: f.author.expectedProfileId, resultUrl: job.payload.targetUrl + '#comment-1' }) })
    assert.equal(response.status, 200)
    assert.equal(f.studio.search(f.search.id).results[0]?.status, 'succeeded')
    const another = f.studio.createSearch({ accountId: f.author.id, query: '桌面' })
    f.studio.saveResults({ accountId: f.author.id, searchId: another.id, results: [f.results[0]] })
    f.studio.updateCandidates({ accountId: f.author.id, searchId: another.id, items: [{ id: 'desk-one', selected: true, comment: '不应重复发送' }] })
    const duplicate = await f.studio.prepareBatch({ accountId: f.author.id, searchId: another.id }, 'session-three')
    assert.equal(duplicate.jobs.length, 0)
    assert.match(duplicate.skipped[0]?.reason ?? '', /已有评论/)
    assert.equal(f.db.listInteractions(100, f.author.id).length, 1)
  } finally { f.db.close() }
})

test('media import normalizes images, deduplicates concurrent uploads, streams video ranges, and rejects mismatched post types', async () => {
  const f = fixture()
  const directory = mkdtempSync(join(tmpdir(), 'xhs-studio-test-'))
  const original = config.assetDir
  Object.assign(config, { assetDir: directory })
  try {
    const bytes = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#1769e0' } }).jpeg().toBuffer()
    const file = new File([new Uint8Array(bytes)], 'sample.jpg', { type: 'image/jpeg' })
    const [first, again] = await Promise.all([storeMedia(f.db, file), storeMedia(f.db, file)])
    assert.equal(first.id, again.id)
    assert.equal(first.mimeType, 'image/png')
    assert.equal((await sharp(readFileSync(join(directory, first.relativePath))).metadata()).format, 'png')
    const png = await f.app.request('/media/' + first.id)
    assert.equal(png.status, 200)
    assert.equal(png.headers.get('Content-Type'), 'image/png')
    const mp4 = new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0])], 'test.mp4', { type: 'video/mp4' })
    const video = await storeMedia(f.db, mp4)
    const part = await f.app.request('/media/' + video.id, { headers: { Range: 'bytes=4-7' } })
    assert.equal(part.status, 206)
    assert.equal(await part.text(), 'ftyp')
    assert.equal((await f.app.request('/media/' + video.id, { headers: { Range: 'bytes=100-' } })).status, 416)
    assert.throws(() => f.studio.saveDraft({ accountId: f.author.id, mediaKind: 'image', assetIds: [video.id] }), /不一致/)
    const draft = f.studio.saveDraft({ accountId: f.author.id, title: '视频帖', body: '展示整理过程', mediaKind: 'video', assetIds: [video.id] })
    const job = await f.studio.prepareDraft({ accountId: f.author.id, draftId: draft.id }, 'video-session')
    assert.equal(job.payload.mediaKind, 'video')
    assert.deepEqual(job.payload.mediaPaths, [join(directory, video.relativePath)])
    await assert.rejects(storeMedia(f.db, new File(['not-video'], 'fake.mp4', { type: 'video/mp4' })), /MP4/)
    await assert.rejects(storeMedia(f.db, new File(['script'], 'fake.svg', { type: 'image/svg+xml' })), /支持/)
  } finally { Object.assign(config, { assetDir: original }); f.db.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('studio UI and host APIs preserve account scope and separate drafting from authorized execution', async () => {
  const f = fixture()
  try {
    const input = { accountId: f.author.id, name: '<script>draft</script>', title: '桌面整理', body: '说明', mediaKind: 'image', assetIds: [] }
    assert.equal((await f.post('save-post-draft', input, { Origin: 'https://evil.example' })).status, 403)
    assert.equal((await f.app.request('/api/executor/studio/save-post-draft', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).status, 401)
    const draft = f.studio.saveDraft(input)
    assert.equal((await f.post('prepare-draft-publish', { accountId: f.author.id, draftId: draft.id })).status, 400)
    for (const kind of ['draft', 'image', 'video']) {
      const prompt = f.studio.prompt({ accountId: f.author.id, draftId: draft.id, kind })
      assert.match(prompt, /只准备/)
      assert.match(prompt, /save-post-draft/)
      assert.match(prompt, /结构化参数/)
      assert.doesNotMatch(prompt, /浏览器打开时必须传/)
      assert.match(prompt, /studio-state/)
    }
    const auto = f.studio.prompt({ accountId: f.author.id, searchId: f.search.id, kind: 'auto-comment' })
    assert.match(auto, /prepare-comment-batch/)
    assert.match(auto, /最多选2篇/)
    const html = await (await f.app.request(`/publishing?account=${f.author.id}&draft=${draft.id}`)).text()
    assert.match(html, /&lt;script&gt;draft&lt;\/script&gt;/)
    assert.match(html, /图片工作台生成/)
    assert.match(html, /视频工作台生成/)
    assert.doesNotMatch(html, /href="\/interactions/)
    const legacy = await f.app.request('/interactions?account=' + f.author.id)
    assert.equal(legacy.headers.get('Location'), '/comments?account=' + f.author.id)
    assert.equal(f.db.listJobs().length, 0)
  } finally { f.db.close() }
})
