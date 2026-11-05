import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpsDatabase } from '../src/db.js'

test('migrates existing account databases without changing the old login and persists new profiles', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xhs-profile-test-'))
  const file = join(directory, 'ops.sqlite')
  let db = new OpsDatabase(file)
  try {
    const old = account(db, 'legacy')
    db.database.exec('DROP INDEX accounts_browser_profile_idx; ALTER TABLE accounts DROP COLUMN browser_profile_id; ALTER TABLE accounts DROP COLUMN deleted_at')
    db.close()
    db = new OpsDatabase(file)
    assert.equal(db.getAccount(old.id)?.browserProfileId, null)
    assert.equal(db.getAccount(old.id)?.sessionStatus, 'healthy')
    const next = db.createAccount({ ...old, handle: 'isolated', expectedProfileId: 'isolated', workerThreadId: 'isolated-session', browserProfileId: '11111111-1111-4111-8111-111111111111' })
    db.close()
    db = new OpsDatabase(file)
    assert.equal(db.getAccount(next.id)?.browserProfileId, next.browserProfileId)
    assert.equal(db.getAccount(old.id)?.workerThreadId, old.workerThreadId)
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
})

function account(db: OpsDatabase, handle: string) {
  const result = db.createAccount({
    handle, displayName: handle, expectedProfileId: `profile-${handle}`, profileUrl: `https://www.xiaohongshu.com/user/profile/${handle}`,
    workerThreadId: `thread-${handle}`, position: '产品实践', audience: 'AI 用户', noteTone: '真实', commentTone: '友好',
    contentColumns: ['实践'], bannedTopics: [], dailyLimit: 2,
  })
  return db.setAccountSession(result.id, 'healthy', { verified: true })
}

test('job account binding is immutable and identity mismatch blocks the account', () => {
  const db = new OpsDatabase(':memory:')
  const first = account(db, 'brand_one')
  const second = account(db, 'brand_two')
  const job = db.createJob({
    type: 'verify_session', accountId: first.id, scheduledAt: new Date(Date.now() - 1000).toISOString(), idempotencyKey: 'verify-one',
    payload: { destinationUrl: 'https://creator.xiaohongshu.com/', expectedHandle: first.handle, expectedProfileId: first.expectedProfileId, expectedProfileUrl: first.profileUrl },
  })
  assert.equal(db.dispatchDue().length, 1)
  assert.throws(() => db.claimJob(job.id, second.id), /不一致/)
  const claimed = db.claimJob(job.id, first.id)
  assert.throws(() => db.completeJob(job.id, claimed.leaseToken, { actualAccount: second.handle }), /不一致/)
  assert.equal(db.getJob(job.id)?.status, 'blocked')
  assert.equal(db.getAccount(first.id)?.sessionStatus, 'blocked')
  db.close()
})

test('idempotency key returns the existing job', () => {
  const db = new OpsDatabase(':memory:')
  const owner = account(db, 'brand_owner')
  const input = {
    type: 'verify_session' as const, accountId: owner.id, scheduledAt: new Date().toISOString(), idempotencyKey: 'same-key',
    payload: { destinationUrl: 'https://creator.xiaohongshu.com/', expectedHandle: owner.handle, expectedProfileId: owner.expectedProfileId, expectedProfileUrl: owner.profileUrl },
  }
  assert.equal(db.createJob(input).id, db.createJob(input).id)
  assert.equal(db.listJobs().length, 1)
  db.close()
})

test('setup accounts can dispatch identity verification but cannot publish', () => {
  const db = new OpsDatabase(':memory:')
  const owner = db.createAccount({
    handle: 'pending_owner', displayName: '待验证账号', expectedProfileId: '107818063', profileUrl: 'https://creator.xiaohongshu.com/new/home',
    workerThreadId: 'thread-pending', position: '品牌日常', audience: '产品用户', noteTone: '真实', commentTone: '友好',
    contentColumns: ['品牌日常'], bannedTopics: [], dailyLimit: 2,
  })
  const scheduledAt = new Date(Date.now() - 1000).toISOString()
  const payload = { destinationUrl: 'https://creator.xiaohongshu.com/', expectedHandle: owner.handle, expectedProfileId: owner.expectedProfileId, expectedProfileUrl: owner.profileUrl }
  const verify = db.createJob({ type: 'verify_session', accountId: owner.id, scheduledAt, idempotencyKey: 'setup-verify', payload })
  const publish = db.createJob({ type: 'publish_note', accountId: owner.id, scheduledAt, idempotencyKey: 'setup-publish', payload })
  assert.deepEqual(db.dispatchDue().map((job) => job.id), [verify.id])
  assert.equal(db.getJob(verify.id)?.status, 'dispatched')
  assert.equal(db.getJob(publish.id)?.status, 'blocked')
  db.close()
})

test('failed jobs only retry after the bound account is healthy', () => {
  const db = new OpsDatabase(':memory:')
  const owner = account(db, 'brand_retry')
  const job = db.createJob({
    type: 'verify_session', accountId: owner.id, scheduledAt: new Date(Date.now() - 1000).toISOString(), idempotencyKey: 'retry-one',
    payload: { destinationUrl: 'https://creator.xiaohongshu.com/', expectedHandle: owner.handle, expectedProfileId: owner.expectedProfileId, expectedProfileUrl: owner.profileUrl },
  })
  db.dispatchDue()
  const claimed = db.claimJob(job.id, owner.id)
  db.stopJob(job.id, claimed.leaseToken, 'failed', { code: 'page_changed', message: '页面结构变化' })
  db.setAccountSession(owner.id, 'blocked', { error: '人工检查中' })
  assert.throws(() => db.retryJob(job.id), /恢复/)
  db.setAccountSession(owner.id, 'healthy', { verified: true })
  assert.equal(db.retryJob(job.id).status, 'queued')
  assert.equal(db.getJob(job.id)?.accountId, owner.id)
  db.close()
})

test('daily quota dispatches only the allowed number of publish jobs', () => {
  const db = new OpsDatabase(':memory:')
  const owner = account(db, 'brand_quota')
  db.updateAccount(owner.id, {
    displayName: owner.displayName, profileUrl: owner.profileUrl, avatarUrl: owner.avatarUrl,
    workerThreadId: owner.workerThreadId, position: owner.position, audience: owner.audience, noteTone: owner.noteTone,
    commentTone: owner.commentTone, contentColumns: owner.contentColumns, bannedTopics: owner.bannedTopics, dailyLimit: 1, enabled: true,
  })
  const scheduledAt = new Date(Date.now() - 1000).toISOString()
  const payload = { destinationUrl: 'https://creator.xiaohongshu.com/', expectedHandle: owner.handle, expectedProfileId: owner.expectedProfileId, expectedProfileUrl: owner.profileUrl }
  const first = db.createJob({ type: 'publish_note', accountId: owner.id, scheduledAt, idempotencyKey: 'quota-1', payload })
  const second = db.createJob({ type: 'publish_note', accountId: owner.id, scheduledAt, idempotencyKey: 'quota-2', payload })
  assert.equal(db.dispatchDue().length, 1)
  assert.deepEqual([db.getJob(first.id)?.status, db.getJob(second.id)?.status].sort(), ['dispatched', 'skipped'])
  db.close()
})

test('unknown results cannot be blindly retried and one account block is isolated', () => {
  const db = new OpsDatabase(':memory:')
  const first = account(db, 'brand_isolated_one')
  const second = account(db, 'brand_isolated_two')
  const scheduledAt = new Date(Date.now() - 1000).toISOString()
  const create = (owner: ReturnType<typeof account>, key: string) => db.createJob({
    type: 'verify_session', accountId: owner.id, scheduledAt, idempotencyKey: key,
    payload: { destinationUrl: 'https://creator.xiaohongshu.com/', expectedHandle: owner.handle, expectedProfileId: owner.expectedProfileId, expectedProfileUrl: owner.profileUrl },
  })
  const uncertain = create(first, 'isolated-1')
  const healthy = create(second, 'isolated-2')
  assert.equal(db.dispatchDue().length, 2)
  const claimed = db.claimJob(uncertain.id, first.id)
  db.stopJob(uncertain.id, claimed.leaseToken, 'needs_reconcile', { code: 'result_uncertain', message: '结果未知' })
  assert.throws(() => db.retryJob(uncertain.id), /只有/)
  assert.equal(db.getAccount(second.id)?.sessionStatus, 'healthy')
  assert.equal(db.getJob(healthy.id)?.status, 'dispatched')
  db.close()
})


test('unbind preserves history, cancels pending work, isolates other accounts and permits a fresh binding', () => {
  const db = new OpsDatabase(':memory:')
  try {
    const first = account(db, 'unbind-one')
    const second = account(db, 'unbind-two')
    const campaign = db.createCampaign({ name: 'shared', theme: 'theme', accountIds: [first.id, second.id], commentAccountIds: [first.id, second.id], knowledgeIds: [], assetIds: [], noteTones: [], commentTones: [], schedule: { kind: 'weekly', timezone: 'Asia/Shanghai', weekdays: [1], publishTime: '10:00', scheduledLocal: null }, minComments: 0, maxComments: 0, commentWindowStartMinutes: 30, commentWindowEndMinutes: 240, generateLeadMinutes: 1440 })
    db.setCampaignStatus(campaign.id, 'active')
    const past = db.createPlannedContent(campaign.id, first.id, '2026-09-01T02:00:00Z')
    db.markContentPublished(past.id, 'https://www.xiaohongshu.com/explore/history')
    const pending = db.createPlannedContent(campaign.id, first.id, '2026-09-30T02:00:00Z')
    const jobInput: Parameters<OpsDatabase['createJob']>[0] = { type: 'verify_session', accountId: first.id, scheduledAt: new Date().toISOString(), payload: { destinationUrl: first.profileUrl, expectedHandle: first.handle, expectedProfileId: first.expectedProfileId, expectedProfileUrl: first.profileUrl }, idempotencyKey: 'unbind-job' }
    const job = db.createJob(jobInput)
    const otherJob = db.createJob({ ...jobInput, accountId: second.id, idempotencyKey: 'other-job' })
    db.deleteAccount(first.id)
    db.deleteAccount(first.id)
    assert.equal(db.getAccount(first.id), null)
    assert.deepEqual(db.listAccounts().map(value => value.id), [second.id])
    assert.deepEqual(db.getAccount(second.id), second)
    assert.equal(db.getJob(job.id)?.status, 'cancelled')
    assert.deepEqual(db.getJob(otherJob.id), otherJob)
    assert.equal(db.getContent(pending.id)?.status, 'cancelled')
    assert.equal(db.getContent(past.id)?.status, 'published')
    assert.deepEqual(db.getCampaign(campaign.id)?.accountIds, [second.id])
    assert.deepEqual(db.getCampaign(campaign.id)?.commentAccountIds, [second.id])
    assert.equal(db.getCampaign(campaign.id)?.status, 'active')
    assert.throws(() => db.setAccountEnabled(first.id, true), /不存在/)
    assert.throws(() => db.updateAccount(first.id, first), /不存在/)
    assert.throws(() => db.setAccountSession(first.id, 'healthy', { verified: true }), /不存在/)
    assert.equal(db.database.prepare('SELECT worker_thread_id FROM accounts WHERE id = ?').get(first.id)?.worker_thread_id, null)
    assert.throws(() => db.createJob({ ...jobInput, idempotencyKey: 'late-job' }), /解除绑定/)
    assert.throws(() => db.retryJob(job.id), /可以重试/)
    const restored = db.createAccount({ ...first, workerThreadId: null, browserProfileId: '11111111-1111-4111-8111-111111111111' })
    assert.equal(restored.id, first.id)
    assert.equal(restored.sessionStatus, 'setup')
    assert.equal(restored.lastVerifiedAt, null)
    assert.equal(restored.workerThreadId, null)
    assert.equal(db.getJob(job.id)?.status, 'cancelled')
    assert.throws(() => db.createJob({ ...jobInput, contentItemId: pending.id, idempotencyKey: 'late-generation' }), /内容已取消/)
    assert.deepEqual(db.database.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { db.close() }
})

test('unbind refuses a live executor lease without partially changing account state', () => {
  const db = new OpsDatabase(':memory:')
  try {
    const owner = account(db, 'executing')
    const job = db.createJob({ type: 'verify_session', accountId: owner.id, scheduledAt: new Date().toISOString(), idempotencyKey: 'executing-job', payload: { destinationUrl: owner.profileUrl, expectedHandle: owner.handle, expectedProfileId: owner.expectedProfileId, expectedProfileUrl: owner.profileUrl } })
    db.dispatchDue()
    const lease = db.claimJob(job.id, owner.id)
    assert.throws(() => db.deleteAccount(owner.id), /正在执行/)
    assert.deepEqual(db.getAccount(owner.id), owner)
    assert.equal(db.getJob(job.id)?.status, 'running')
    db.database.prepare('UPDATE browser_jobs SET lease_until = ? WHERE id = ?').run('2000-01-01T00:00:00Z', job.id)
    db.deleteAccount(owner.id)
    assert.equal(db.getJob(job.id)?.status, 'cancelled')
    assert.throws(() => db.completeJob(job.id, lease.leaseToken, { actualAccount: owner.handle, actualProfileId: owner.expectedProfileId }), /执行中/)
  } finally { db.close() }
})
