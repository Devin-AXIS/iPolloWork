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
    db.database.exec('DROP INDEX accounts_browser_profile_idx; ALTER TABLE accounts DROP COLUMN browser_profile_id')
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
