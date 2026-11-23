import assert from 'node:assert/strict'
import test from 'node:test'
import type { ContentGenerator } from '../src/content-generator.js'
import { OpsDatabase } from '../src/db.js'
import { OpsService } from '../src/service.js'
import { utcToLocalInput } from '../src/scheduling.js'

const generator: ContentGenerator = {
  async generateNote(input) {
    return {
      title: '一次真实的产品实践', body: '这条内容只使用资料库中的事实。', topics: ['AI工具', '产品实践'],
      cards: [{ heading: '为什么做', body: '来自真实需求。' }, { heading: '怎么使用', body: '按实际流程说明。' }, { heading: '注意事项', body: '不做未经支持的承诺。' }],
      sourceKnowledgeIds: input.knowledge.map((item) => item.id),
      managedComments: input.commenters.map((account) => ({ accountId: account.id, body: `从${account.position}角度补充一个真实使用建议。` })),
    }
  },
  async generateReplies(input) { return new Map(input.comments.map((comment) => [comment.remoteCommentId, '可以按页面中的实际步骤操作。'])) },
}

function addAccount(db: OpsDatabase, handle: string) {
  const value = db.createAccount({
    handle, displayName: handle, expectedProfileId: `p-${handle}`, profileUrl: `https://www.xiaohongshu.com/user/profile/${handle}`,
    workerThreadId: `t-${handle}`, position: handle === 'author' ? '产品账号' : '技术账号', audience: 'AI 用户', noteTone: '真实',
    commentTone: '有帮助', contentColumns: ['实践'], bannedTopics: [], dailyLimit: 2,
  })
  return db.setAccountSession(value.id, 'healthy', { verified: true })
}

test('published note creates managed comment and scan jobs only after verified completion', async () => {
  const db = new OpsDatabase(':memory:')
  const author = addAccount(db, 'author')
  const commenter = addAccount(db, 'commenter')
  const knowledge = db.createKnowledge({ kind: 'fact', title: '事实', body: '产品支持本地内容管理。' })
  const scheduled = new Date(Date.now() + 60_000)
  const campaign = db.createCampaign({
    name: '测试活动', theme: '产品实践', accountIds: [author.id], commentAccountIds: [commenter.id], knowledgeIds: [knowledge.id], assetIds: [],
    noteTones: ['真实'], commentTones: ['有帮助'], schedule: { kind: 'single', timezone: 'Asia/Shanghai', scheduledLocal: utcToLocalInput(scheduled.toISOString()), weekdays: [], publishTime: null },
    minComments: 1, maxComments: 1, commentWindowStartMinutes: 30, commentWindowEndMinutes: 60, generateLeadMinutes: 1440,
  })
  db.setCampaignStatus(campaign.id, 'active')
  const service = new OpsService(db, generator)
  service.materializeCampaigns(new Date())
  const content = db.listContent()[0]
  assert.ok(content)
  await service.generateContent(content.id)
  const publish = db.listJobs().find((job) => job.type === 'publish_note')
  assert.ok(publish)
  assert.equal(db.listInteractions().length, 0)
  const dispatchAt = new Date(new Date(publish.scheduledAt).getTime() + 10_000)
  assert.equal(service.dispatch(dispatchAt).length, 1)
  const claim = db.claimJob(publish.id, author.id)
  await service.completeJob({ jobId: publish.id, leaseToken: claim.leaseToken, actualAccount: author.handle, resultUrl: 'https://www.xiaohongshu.com/explore/note-1' })
  assert.equal(db.getContent(content.id)?.status, 'published')
  assert.equal(db.listInteractions().filter((item) => item.kind === 'managed_comment').length, 1)
  assert.ok(db.listJobs().some((job) => job.type === 'create_comment'))
  assert.ok(db.listJobs().some((job) => job.type === 'scan_comments'))

  const scan = db.listJobs().find((job) => job.type === 'scan_comments')
  assert.ok(scan)
  db.ingestDiscoveredComments(scan, [
    { remoteCommentId: 'managed-visible', remoteAuthor: commenter.handle, body: '矩阵评论', targetUrl: 'https://example.test/note#managed' },
    { remoteCommentId: 'reader-visible', remoteAuthor: 'real_reader', body: '适合刚开始的团队吗？', targetUrl: 'https://example.test/note#reader' },
  ], new Map([
    ['managed-visible', '不应生成'],
    ['reader-visible', '可以先从两个测试账号开始。'],
  ]))
  assert.deepEqual(db.listInteractions().filter((item) => item.kind === 'organic_comment').map((item) => item.remoteAuthor), ['real_reader'])
  const reply = db.listJobs().find((job) => job.type === 'reply_comment')
  assert.ok(reply)
  assert.equal(service.dispatch(new Date(Date.now() + 1000)).some((job) => job.id === reply.id), true)
  const replyClaim = db.claimJob(reply.id, author.id)
  await service.completeJob({ jobId: reply.id, leaseToken: replyClaim.leaseToken, actualAccount: author.handle, resultUrl: 'https://example.test/note#reader' })
  assert.equal(db.listInteractions().find((item) => item.kind === 'organic_comment')?.status, 'published')
  db.close()
})
