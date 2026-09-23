import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../service/store.mjs';
import { Operations } from '../service/operations.mjs';

const context = { trusted: true, sessionId: 'test-session' };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'channels-test-'));
  const store = new Store(join(root, 'data'));
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const ops = new Operations({ store, dataDir: join(root, 'data'), workspaceRoot: root });
  const { account } = ops.saveAccount({ name: '本地测试账号' });
  const identity = { actualChannelId: 'test-channel', profileId: `wechat-channels-ops:${account.browserProfileId}` };
  await writeFile(join(root, 'video.mp4'), Buffer.concat([Buffer.from([0,0,0,24]), Buffer.from('ftypisom'), Buffer.alloc(64)]));
  const asset = await ops.media.import('video.mp4');
  const { draft } = ops.saveDraft({ accountId: account.id, title: '测试作品', description: '测试正文', assetId: asset.id });
  const verify = (ctx = context) => ops.action('verify-account', { accountId: account.id, ...identity, actualName: '真实页面测试名', evidence: '测试夹具模拟页面身份', sourceUrl: 'https://channels.weixin.qq.com/' }, ctx);
  const prepare = (key = 'test-publish') => ops.prepareJob({ accountId: account.id, type: 'publish', draftId: draft.id, operationKey: key });
  return { root, ops, store, account, asset, draft, identity, verify, prepare };
}
test('local account never implies authenticated identity; executor required', async t => {
  const f = await fixture(t); assert.equal(f.account.status, 'unverified');
  await assert.rejects(f.ops.action('verify-account', { accountId: f.account.id }), /主软件/);
  await f.verify(); f.ops.saveAccount({ id: f.account.id, name: '更新标签' });
  assert.equal(f.store.get('account', f.account.id).verifiedSessionId, context.sessionId);
  assert.throws(() => f.ops.saveAccount({ id: f.account.id, name: '改号', channelId: 'other' }), /不能修改/);
});
test('QR connection creates an isolated account and only visible home identity completes it', async t => {
  const f = await fixture(t);
  const target = await f.ops.action('connect-account');
  assert.equal(target.url, 'https://channels.weixin.qq.com/login.html');
  assert.equal(target.account.status, 'connecting');
  assert.match(target.browserProfileId, /^[0-9a-f-]{36}$/);
  const observe = (input, ctx = context) => f.ops.action('observe-browser-session', {
    browserProfileId: target.browserProfileId, url: 'https://channels.weixin.qq.com/platform/',
    tree: 'heading "扫码添加的账号"\nStaticText "视频号ID:"\nStaticText "sph-visible-id"', ...input,
  }, ctx);
  await assert.rejects(observe({}, {}), /主软件/);
  assert.deepEqual(await observe({ url: 'https://channels.weixin.qq.com/login.html' }), { connected: false, accountId: target.account.id });
  assert.deepEqual(await observe({ browserProfileId: crypto.randomUUID() }), { connected: false });
  assert.deepEqual(await observe({ tree: 'StaticText "首页"' }), { connected: false, accountId: target.account.id });
  assert.deepEqual(await observe({}), { connected: true, accountId: target.account.id });
  const saved = f.store.get('account', target.account.id);
  assert.equal(saved.name, '扫码添加的账号'); assert.equal(saved.channelId, 'sph-visible-id');
  assert.equal(saved.status, 'verified'); assert.equal(saved.verifiedSessionId, context.sessionId);
});
test('draft persistence, revision stability, scheduled drafting idempotency and ownership', async t => {
  const f = await fixture(t), other = f.ops.saveAccount({ name: '另一个账号' }).account;
  const same = f.ops.saveDraft({ ...f.draft, id: f.draft.id }).draft; assert.equal(same.revision, 1);
  const changed = f.ops.saveDraft({ ...f.draft, id: f.draft.id, description: '新文案' }).draft; assert.equal(changed.revision, 2);
  assert.throws(() => f.ops.saveDraft({ ...f.draft, accountId: other.id }), /不属于/);
  const scheduled = f.ops.saveDraft({ accountId: f.account.id, title: '日程', runKey: 'run:1' });
  assert.equal(f.ops.saveDraft({ accountId: f.account.id, title: '日程重试', runKey: 'run:1' }).draft.id, scheduled.draft.id);
  assert.equal(f.store.get('draft', f.draft.id).description, '新文案');
});
test('workspace traversal and forged media bytes rejected', async t => {
  const f = await fixture(t);
  await assert.rejects(f.ops.media.import('../outside.mp4'));
  await writeFile(join(f.root, 'fake.mp4'), 'this is not a video');
  await assert.rejects(f.ops.media.import('fake.mp4'), /不匹配/);
  const image = Buffer.from('89504e470d0a1a0a0000000000000000', 'hex');
  await writeFile(join(f.root, 'cover.png'), image);
  const cover = await f.ops.media.import('cover.png'); assert.equal(cover.kind, 'image');
  assert.throws(() => f.ops.saveDraft({ accountId: f.account.id, title: '错误素材', assetId: cover.id }), /视频/);
});
test('same draft revision cannot be double queued even using a different operation key', async t => {
  const f = await fixture(t);
  const first = await f.prepare(); const second = await f.prepare('another-key');
  assert.equal(first.job.id, second.job.id); assert.equal(second.reused, true);
  f.ops.saveDraft({ ...f.draft, description: '修改后的文案' });
  await assert.rejects(f.prepare(), /已绑定其他内容/);
  assert.equal(first.job.payload.description, '测试正文');
});
test('claim enforces identity, profile and session; concurrent claims cannot win twice', async t => {
  const f = await fixture(t), { job } = await f.prepare();
  await assert.rejects(f.ops.action('claim-job', { jobId: job.id, ...f.identity }, context), /不匹配/);
  await f.verify();
  await assert.rejects(f.ops.action('claim-job', { jobId: job.id, ...f.identity, profileId: 'wrong' }, context), /不匹配/);
  const results = await Promise.allSettled([1,2].map(() => f.ops.action('claim-job', { jobId: job.id, ...f.identity }, context)));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const success = results.find(item => item.status === 'fulfilled').value;
  assert.equal(success.mediaPaths.length, 1);
  await assert.rejects(f.ops.action('mark-submitting', { jobId: job.id, ...f.identity }, { trusted: true, sessionId: 'other' }), /不属于/);
});
test('one browser per account; uncertain submission blocks further work until reconciliation', async t => {
  const f = await fixture(t); await f.verify(); const { job } = await f.prepare();
  await f.ops.action('claim-job', { jobId: job.id, ...f.identity }, context);
  await assert.rejects(f.ops.action('report-job', { jobId: job.id, ...f.identity, status: 'published', evidence: '错误提前成功', resultUrl: 'https://channels.weixin.qq.com/' }, context), /不匹配/);
  await f.ops.action('mark-submitting', { jobId: job.id, ...f.identity }, context);
  await f.ops.action('report-job', { jobId: job.id, status: 'uncertain', evidence: '点击后页面断开' }, context);
  await assert.rejects(f.ops.prepareJob({ accountId: f.account.id, type: 'sync-videos', operationKey: 'sync1' }), /待核对/);
  await f.ops.action('reconcile-job', { jobId: job.id, ...f.identity, status: 'published', evidence: '夹具模拟已发布列表', resultUrl: 'https://channels.weixin.qq.com/platform/post/list' }, context);
  assert.equal(f.store.get('job', job.id).status, 'published');
  assert.equal((await f.prepare('new-key')).job.id, job.id);
});
test('restart turns submitting into uncertain without re-execution', async t => {
  const f = await fixture(t); await f.verify(); const { job } = await f.prepare();
  await f.ops.action('claim-job', { jobId: job.id, ...f.identity }, context);
  await f.ops.action('mark-submitting', { jobId: job.id, ...f.identity }, context);
  new Operations({ store: f.store, dataDir: join(f.root, 'data'), workspaceRoot: f.root });
  assert.equal(f.store.get('job', job.id).status, 'uncertain');
});
test('submitted and reviewing do not become published; unsafe result URLs rejected', async t => {
  const f = await fixture(t); await f.verify(); const { job } = await f.prepare();
  await f.ops.action('claim-job', { jobId: job.id, ...f.identity }, context);
  await f.ops.action('mark-submitting', { jobId: job.id, ...f.identity }, context);
  await assert.rejects(f.ops.action('report-job', { jobId: job.id, ...f.identity, status: 'published', evidence: '夹具', resultUrl: 'https://evil.example/' }, context), /官方/);
  await f.ops.action('report-job', { jobId: job.id, ...f.identity, status: 'reviewing', evidence: '平台显示审核中' }, context);
  assert.equal(f.store.get('job', job.id).status, 'reviewing');
});
test('observed metrics preserve unknown versus zero, comments tie to own video, invalid batch rolls back', async t => {
  const f = await fixture(t); await f.verify();
  const { job } = await f.ops.prepareJob({ accountId: f.account.id, type: 'sync-videos', operationKey: 'sync1' });
  await f.ops.action('claim-job', { jobId: job.id, ...f.identity }, context);
  const report = { jobId: job.id, ...f.identity, status: 'succeeded', evidence: '模拟读取作品' };
  await assert.rejects(f.ops.action('report-job', { ...report, videos: [{ remoteId: '1', title: '一', status: '已发布', metrics: { likes: 0 } }, { remoteId: '2', title: '二', status: '已发布', metrics: { plays: -1 } }] }, context), /非负/);
  assert.equal(f.store.count('video'), 0);
  await f.ops.action('report-job', { ...report, videos: [{ remoteId: '1', title: '一', status: '已发布', metrics: { likes: 0, plays: null } }] }, context);
  const video = f.ops.state().videos[0]; assert.equal(video.metrics.likes, 0); assert.equal(video.metrics.plays, null);
  const commentsJob = (await f.ops.prepareJob({ accountId: f.account.id, type: 'sync-comments', videoId: video.id, operationKey: 'comments1' })).job;
  await f.ops.action('claim-job', { jobId: commentsJob.id, ...f.identity }, context);
  await f.ops.action('report-job', { jobId: commentsJob.id, ...f.identity, status: 'succeeded', evidence: '模拟读取评论', comments: [{ remoteId: 'c1', author: '观众', body: '谢谢分享' }] }, context);
  const comment = f.ops.state().comments[0]; assert.equal(comment.videoId, video.id);
  const replyJob = (await f.ops.prepareJob({ accountId: f.account.id, type: 'reply', commentId: comment.id, body: '谢谢关注', operationKey: 'reply1' })).job;
  assert.equal(replyJob.payload.originalText, '谢谢分享');
});
test('prepared tasks can be cancelled, but started tasks cannot', async t => {
  const f = await fixture(t); const { job } = await f.prepare();
  await f.ops.action('cancel-job', { jobId: job.id });
  assert.equal(f.store.get('job', job.id).status, 'cancelled');
  await f.verify(); const next = (await f.prepare()).job;
  assert.notEqual(next.id, job.id);
  await f.ops.action('claim-job', { jobId: next.id, ...f.identity }, context);
  await assert.rejects(f.ops.action('cancel-job', { jobId: next.id }), /只能取消/);
});
