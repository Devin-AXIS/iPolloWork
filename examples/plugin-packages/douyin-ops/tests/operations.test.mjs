import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../service/store.mjs';
import { Operations } from '../service/operations.mjs';
import { ApiError } from '../service/api.mjs';

const settings = { clientKey: 'test-client', clientSecret: 'fixture-secret', redirectUri: 'https://example.com/callback', scopes: 'user_info,video.create.bind,video.list,video.data,item.comment' };
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(20)]);
async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'douyin-ops-test-'));
  const dataDir = resolve(root, 'data'), workspaceRoot = resolve(root, 'workspace');
  await mkdir(workspaceRoot);
  const store = new Store(dataDir), calls = [];
  let identity = 'open-account-a';
  const api = {
    async exchangeCode() { return { open_id: identity, access_token: `secret-access-${identity}`, refresh_token: `secret-refresh-${identity}`, expires_in: 3600, refresh_expires_in: 7200, scope: settings.scopes }; },
    async userInfo({ openId }) { return { open_id: openId, nickname: openId }; },
    async refreshToken(input) { calls.push(['refresh', input]); return { open_id: 'open-account-a', access_token: 'renewed-token', expires_in: 3600 }; },
    async uploadVideo(input) { calls.push(['upload', input]); return { video: { video_id: 'uploaded-1' } }; },
    async createVideo(input) { calls.push(['publish', input]); return { item_id: 'published-1' }; },
    async replyComment(input) { calls.push(['reply', input]); return { comment_id: 'reply-1' }; },
    async listVideos(input) { calls.push(['videos', input]); return { list: [], cursor: 0, has_more: false }; },
    async clientToken() { calls.push(['client-token']); return { access_token: 'app-only-token', expires_in: 7200 }; },
    async searchVideos(input) { calls.push(['search', input]); return { video_list: [{ title: 'result' }], cursor: 20, has_more: true, search_id: 'search-id' }; },
  };
  const ops = new Operations({ store, dataDir, workspaceRoot, api });
  ops.saveSettings(settings);
  async function connect(openId = 'open-account-a') {
    identity = openId;
    const { url } = await ops.startAuthorization();
    const callback = new URL(settings.redirectUri);
    callback.search = new URLSearchParams({ state: new URL(url).searchParams.get('state'), code: 'one-use-code' }).toString();
    return { ...(await ops.finishAuthorization({ callbackUrl: callback.href })), callback: callback.href };
  }
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  return { root, dataDir, workspaceRoot, store, ops, api, calls, connect };
}

test('OAuth uses HTTPS registered callback, validates state and consumes it once; state omits secrets', async t => {
  const f = await fixture(t);
  assert.throws(() => f.ops.saveSettings({ ...settings, redirectUri: 'http://127.0.0.1/callback' }), /HTTPS/);
  assert.throws(() => f.ops.saveSettings({ ...settings, redirectUri: 'https://example.com/callback?foo=bar' }), /查询参数/);
  const { account, callback } = await f.connect();
  assert.equal(account.openId, 'open-account-a');
  await assert.rejects(f.ops.finishAuthorization({ callbackUrl: callback }), /已过期|不属于/);
  const visible = JSON.stringify(f.ops.state());
  assert.doesNotMatch(visible, /fixture-secret|secret-access|secret-refresh/);
  assert.equal(f.store.secret(`account:${account.id}`).accessToken, 'secret-access-open-account-a');
  for (const name of ['douyin-ops.db', 'douyin-ops.db-wal']) {
    const contents = await readFile(resolve(f.dataDir, name)).catch(() => Buffer.alloc(0));
    assert.equal(contents.includes(Buffer.from('fixture-secret')), false);
    assert.equal(contents.includes(Buffer.from('secret-access-open-account-a')), false);
  }
});

test('OAuth refuses a callback for another origin and unexpected returned account identity', async t => {
  const f = await fixture(t), { url } = await f.ops.startAuthorization();
  const params = new URLSearchParams({ state: new URL(url).searchParams.get('state'), code: 'code' });
  await assert.rejects(f.ops.finishAuthorization({ callbackUrl: `https://evil.example/callback?${params}` }), /不一致/);
  f.api.userInfo = async () => ({ open_id: 'wrong-account', nickname: 'wrong' });
  await assert.rejects(f.ops.finishAuthorization({ callbackUrl: `${settings.redirectUri}?${params}` }), /身份.*不一致/);
  assert.equal(f.ops.state().accounts.length, 0);
});

test('one application cannot silently replace another while accounts are connected', async t => {
  const f = await fixture(t); await f.connect();
  assert.throws(() => f.ops.saveSettings({ ...settings, clientKey: 'another-app' }), /原 Client Key/);
});

test('an OAuth exchange cannot connect to an application changed while authorization is in flight', async t => {
  const f = await fixture(t);
  f.api.userInfo = async ({ openId }) => {
    f.ops.saveSettings({ ...settings, clientKey: 'replacement-client' });
    return { open_id: openId, nickname: 'test' };
  };
  await assert.rejects(f.connect(), /应用配置已改变/);
  assert.equal(f.ops.state().accounts.length, 0);
});

test('refresh is single flight and never extends the refresh token deadline or switches identity', async t => {
  const f = await fixture(t), { account } = await f.connect();
  f.store.put('account', { ...account, expiresAt: 0 });
  const responses = await Promise.all([f.ops.credentials(account.id), f.ops.credentials(account.id)]);
  assert.equal(f.calls.filter(call => call[0] === 'refresh').length, 1);
  assert.equal(responses[0].accessToken, 'renewed-token');
  assert.equal(f.ops.account(account.id).refreshExpiresAt, account.refreshExpiresAt);
  f.store.put('account', { ...account, expiresAt: 0 });
  f.api.refreshToken = async () => ({ access_token: 'bad', open_id: 'another-account', expires_in: 3600 });
  await assert.rejects(f.ops.credentials(account.id), /不同账号/);
});

test('missing scope fails before network I/O; renewed scope is checked again', async t => {
  const f = await fixture(t), { account } = await f.connect();
  f.store.put('account', { ...account, scopes: ['user_info'] });
  await assert.rejects(f.ops.apiAction('list-videos', { accountId: account.id }), /video.list/);
  const draft = f.ops.saveDraft({ accountId: account.id, title: '受限草稿', text: '内容' }).draft;
  await assert.rejects(f.ops.apiAction('publish-draft', { accountId: account.id, draftId: draft.id, operationKey: 'blocked-publish' }), /video.create.bind/);
  await assert.rejects(f.ops.apiAction('reply-comment', { accountId: account.id, itemId: 'item', commentId: 'comment', content: '回复', operationKey: 'blocked-reply' }), /item.comment/);
  assert.equal(f.calls.length, 0);
  f.store.put('account', { ...account, expiresAt: 0 });
  f.api.refreshToken = async () => ({ access_token: 'limited', scope: 'user_info', expires_in: 3600 });
  await assert.rejects(f.ops.readApi('list-videos', { accountId: account.id }), /video.list/);
});

test('public state derives route capabilities from each account granted scopes', async t => {
  const f = await fixture(t);
  const emptyState = f.ops.state();
  assert.equal(emptyState.capabilities.publish.status, 'account_required');
  assert.match(emptyState.capabilities.publish.reason, /绑定并选择抖音账号/);

  const { account } = await f.connect();
  f.store.put('account', { ...account, scopes: ['user_info', 'item.comment'] });
  let state = f.ops.state(), selected = state.accounts[0];
  assert.equal(selected.capabilities.publish.available, false);
  assert.equal(selected.capabilities.publish.status, 'scope_required');
  assert.deepEqual(selected.capabilities.publish.missingScopes, ['video.create.bind']);
  assert.equal(selected.capabilities.listVideos.available, false);
  assert.equal(selected.capabilities.videoData.available, false);
  assert.equal(selected.capabilities.comments.available, true);
  assert.equal(state.capabilities.searchVideos.status, 'runtime_check');
  assert.match(state.capabilities.searchVideos.reason, /官方 API 验证/);

  f.store.put('account', { ...account, scopes: ['user_info', 'video.create.bind'], refreshExpiresAt: 0 });
  state = f.ops.state(); selected = state.accounts[0];
  assert.equal(selected.capabilities.publish.status, 'reauthorization_required');
  assert.equal(selected.capabilities.publish.available, false);
  assert.doesNotMatch(JSON.stringify(state), /fixture-secret|secret-access|secret-refresh/);
});

test('draft updates preserve account ownership and scheduled run keys deduplicate', async t => {
  const f = await fixture(t), a = (await f.connect()).account, b = (await f.connect('open-account-b')).account;
  const input = { accountId: a.id, title: '草稿', text: '内容', runKey: 'schedule:2026-09-10:post-1' };
  const first = f.ops.saveDraft(input).draft;
  assert.equal(f.ops.saveDraft({ ...input, text: 'retry' }).draft.id, first.id);
  assert.equal(f.ops.saveDraft({ ...input, runKey: 'schedule:2026-09-11:post-1' }).draft.id === first.id, false);
  assert.throws(() => f.ops.saveDraft({ ...input, id: first.id, accountId: b.id }), /不属于当前账号/);
  assert.equal(f.ops.saveDraft({ ...input, id: first.id, text: '已保存的更新' }).draft.text, '已保存的更新');
});

test('imports only real MP4 files in workspace, including symlink containment', async t => {
  const f = await fixture(t);
  await writeFile(resolve(f.root, 'outside.mp4'), mp4);
  await assert.rejects(f.ops.importMedia({ sourcePath: '../outside.mp4' }), /当前工作区/);
  await symlink(f.root, resolve(f.workspaceRoot, 'outside'), 'junction');
  await assert.rejects(f.ops.importMedia({ sourcePath: 'outside/outside.mp4' }), /当前工作区/);
  await writeFile(resolve(f.workspaceRoot, 'invalid.mp4'), 'This is not an MP4 file');
  await assert.rejects(f.ops.importMedia({ sourcePath: 'invalid.mp4' }), /有效的 MP4/);
  await writeFile(resolve(f.workspaceRoot, 'video.mp4'), mp4);
  const { asset } = await f.ops.importMedia({ sourcePath: 'video.mp4' });
  assert.equal(asset.name, 'video.mp4');
  assert.equal(asset.size, mp4.length);
});

test('concurrent publish calls upload and submit once; same draft stays locked after receipt', async t => {
  const f = await fixture(t), { account } = await f.connect();
  await writeFile(resolve(f.workspaceRoot, 'video.mp4'), mp4);
  const { asset } = await f.ops.importMedia({ sourcePath: 'video.mp4' });
  const { draft } = f.ops.saveDraft({ accountId: account.id, title: '标题', text: '发布文案', assetId: asset.id });
  const input = { accountId: account.id, draftId: draft.id, operationKey: 'stable-publish-key' };
  await Promise.all([f.ops.publishDraft(input), f.ops.publishDraft(input)]);
  assert.equal(f.calls.filter(call => call[0] === 'publish').length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'upload').length, 1);
  const replay = await f.ops.publishDraft({ ...input, operationKey: 'changed-key' });
  assert.equal(replay.job.status, 'succeeded');
  assert.equal(replay.job.result.item_id, 'published-1');
  assert.throws(() => f.ops.saveDraft({ id: draft.id, accountId: account.id, text: '换掉内容' }), /锁定/);
});

test('reply timeout blocks other writes, remains idempotent and requires manual evidence to reconcile', async t => {
  const f = await fixture(t), { account } = await f.connect();
  f.api.replyComment = async () => { throw Object.assign(new Error('timeout'), { uncertain: true }); };
  const input = { accountId: account.id, itemId: '@opaque/item+=', commentId: '@opaque/comment+=', content: '回复', operationKey: 'reply-1' };
  const { job } = await f.ops.replyComment(input);
  assert.equal(job.status, 'uncertain');
  assert.equal((await f.ops.replyComment(input)).job.id, job.id);
  await assert.rejects(f.ops.replyComment({ ...input, operationKey: 'reply-2' }), /待核对/);
  await assert.rejects(f.ops.replyComment({ ...input, content: '不同内容' }), /不能更换/);
  assert.throws(() => f.ops.resolveJob({ jobId: job.id, outcome: 'failed', evidence: '' }), /结果说明/);
  assert.equal(f.ops.resolveJob({ jobId: job.id, outcome: 'failed', evidence: '已在授权账号的目标作品评论中核对，没有本次回复。' }).job.status, 'failed');
});

test('publish rejects a draft edited during asynchronous token refresh before uploading', async t => {
  const f = await fixture(t), { account } = await f.connect();
  await writeFile(resolve(f.workspaceRoot, 'video.mp4'), mp4);
  const { asset } = await f.ops.importMedia({ sourcePath: 'video.mp4' });
  const { draft } = f.ops.saveDraft({ accountId: account.id, title: 'Original', text: 'Approved text', assetId: asset.id });
  f.store.put('account', { ...account, expiresAt: 0 });
  f.api.refreshToken = async () => {
    f.ops.saveDraft({ ...draft, text: 'Changed text' });
    return { access_token: 'refreshed', open_id: account.openId, expires_in: 3600 };
  };
  await assert.rejects(f.ops.publishDraft({ accountId: account.id, draftId: draft.id, operationKey: 'publish-edited' }), /草稿.*被修改/);
  assert.equal(f.calls.filter(call => call[0] === 'upload').length, 0);
  assert.equal(f.ops.state().jobs.length, 0);
});

test('crashed in-progress jobs are marked uncertain on restart', async t => {
  const f = await fixture(t), { account } = await f.connect();
  const { job } = f.ops.beginJob(account.id, 'reply', 'crash-operation', { commentId: 'one' });
  new Operations({ store: f.store, dataDir: f.dataDir, workspaceRoot: f.workspaceRoot, api: f.api });
  assert.equal(f.store.get('job', job.id).status, 'uncertain');
});

test('interrupted browser reads can be reclaimed after restart and invalidate the old claim', async t => {
  const f = await fixture(t), { account, identity } = await browserAccount(f);
  const { job } = await f.ops.action('search-videos', { accountId: account.id, keyword: '萌宠', count: 2 });
  const old = await f.ops.action('claim-browser-job', { jobId: job.id, ...identity });
  const restarted = new Operations({ store: f.store, dataDir: f.dataDir, workspaceRoot: f.workspaceRoot, api: f.api });
  assert.equal(f.store.get('job', job.id).status, 'pending');
  const next = await restarted.action('claim-browser-job', { jobId: job.id, ...identity });
  await assert.rejects(restarted.action('finish-browser-job', { jobId: job.id, ...identity, executionToken: old.executionToken, outcome: 'succeeded', evidence: '旧执行器', items: [] }), /凭证/);
  await restarted.action('finish-browser-job', { jobId: job.id, ...identity, executionToken: next.executionToken, outcome: 'succeeded', evidence: '重新读取，页面确认无结果', items: [] });
  assert.equal(f.store.get('job', job.id).status, 'succeeded');
});

test('official search uses cached app token and preserves device/search identifiers', async t => {
  const f = await fixture(t);
  const args = { keyword: '日常生活', deviceId: '9007199254740993' };
  const first = await f.ops.action('search-videos', args);
  assert.equal(first.list[0].title, 'result');
  await f.ops.action('search-videos', { ...args, searchId: first.search_id, cursor: first.cursor });
  assert.equal(f.calls.filter(call => call[0] === 'client-token').length, 1);
  const calls = f.calls.filter(call => call[0] === 'search');
  assert.equal(calls[1][1].deviceId, args.deviceId);
  assert.equal(calls[1][1].searchId, 'search-id');
  assert.equal(calls[1][1].clientToken, 'app-only-token');
  assert.doesNotMatch(JSON.stringify(f.ops.state()), /app-only-token/);
});

async function browserAccount(f) {
  const { account } = await f.ops.action('connect-browser');
  const identity = { accountId: account.id, actualProfileId: `douyin-ops:${account.browserProfileId}`, actualAccount: 'creator123', nickname: '普通用户', profileUrl: 'https://www.douyin.com/user/real-user', evidence: '从当前登录用户“我”入口读取：抖音号 creator123' };
  await f.ops.action('verify-browser-account', identity);
  return { account, identity };
}

test('ordinary accounts connect without OAuth, isolate profiles and cannot switch verified identity', async t => {
  const f = await fixture(t); f.store.remove('settings', 'application');
  const first = await f.ops.action('connect-browser'), retry = await f.ops.action('connect-browser');
  assert.equal(first.account.id, retry.account.id);
  const { account, identity } = await browserAccount(f);
  const second = await f.ops.action('connect-browser');
  assert.notEqual(second.account.browserProfileId, account.browserProfileId);
  await assert.rejects(f.ops.action('verify-browser-account', { ...identity, actualProfileId: 'wrong' }), /环境/);
  await assert.rejects(f.ops.action('verify-browser-account', { ...identity, actualAccount: 'other', evidence: 'other' }), /其他账号/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.ops.account(account.id).openId, undefined);
});

test('browser search persists real results, then a third-party comment is claimed once and target-checked', async t => {
  const f = await fixture(t), { account, identity } = await browserAccount(f);
  const { job } = await f.ops.action('search-videos', { accountId: account.id, keyword: '收纳', count: 5 });
  assert.equal(job.transport, 'browser'); assert.equal(job.status, 'pending');
  const claim = await f.ops.action('claim-browser-job', { jobId: job.id, ...identity });
  await assert.rejects(f.ops.action('claim-browser-job', { jobId: job.id, ...identity }), /已领取/);
  const receipt = { jobId: job.id, ...identity, executionToken: claim.executionToken, outcome: 'succeeded', evidence: '搜索页面显示一条匹配作品', items: [{ title: '桌面收纳', link: 'https://www.douyin.com/video/123456', nickname: '其他作者' }] };
  await f.ops.action('finish-browser-job', receipt);
  assert.equal(f.store.get('job', job.id).result.list[0].link, receipt.items[0].link);
  assert.doesNotMatch(JSON.stringify(f.ops.state()), new RegExp(claim.executionToken));
  const input = { accountId: account.id, targetUrl: receipt.items[0].link, content: '分区收纳的思路很清楚。', operationKey: 'comment-on-search-1' };
  const comment = await f.ops.action('comment-video', input);
  assert.equal((await f.ops.action('comment-video', input)).job.id, comment.job.id);
  await assert.rejects(f.ops.action('comment-video', { ...input, content: '改掉原文' }), /不能更换/);
  const execution = await f.ops.action('claim-browser-job', { jobId: comment.job.id, ...identity });
  const finish = { jobId: comment.job.id, ...identity, executionToken: execution.executionToken, outcome: 'succeeded', resultUrl: input.targetUrl, evidence: '发送后页面出现当前用户的新评论，内容与任务一致。' };
  await assert.rejects(f.ops.action('finish-browser-job', { ...finish, resultUrl: 'https://www.douyin.com/video/999' }), /目标作品/);
  await f.ops.action('finish-browser-job', finish);
  assert.equal(f.calls.length, 0);
});

test('API permissions are preferred, explicit denial falls back, timeouts and quotas do not', async t => {
  const f = await fixture(t), { account } = await f.connect();
  await f.ops.action('list-videos', { accountId: account.id });
  assert.equal(f.calls.filter(call => call[0] === 'videos').length, 1);
  f.api.listVideos = async () => { throw new ApiError('无权限', { code: 28001018 }); };
  const read = await f.ops.action('list-videos', { accountId: account.id });
  assert.equal(read.job.transport, 'browser');
  const readClaim = await f.ops.action('claim-browser-job', { jobId: read.job.id, actualProfileId: `douyin-ops:${account.browserProfileId}` });
  await f.ops.action('finish-browser-job', { jobId: read.job.id, actualProfileId: readClaim.profileId, executionToken: readClaim.executionToken, outcome: 'succeeded', evidence: '自己的作品页面确认没有作品', items: [] });
  f.api.listVideos = async () => { throw new ApiError('配额耗尽', { code: 28003017 }); };
  await assert.rejects(f.ops.action('list-videos', { accountId: account.id }), /配额/);
  f.api.replyComment = async () => { throw new ApiError('timeout', { code: 'TIMEOUT', uncertain: true }); };
  const result = await f.ops.action('reply-comment', { accountId: account.id, itemId: 'own-video', commentId: 'c', content: '谢谢', operationKey: 'timeout' });
  assert.equal(result.job.status, 'uncertain'); assert.equal(result.browserTask, undefined);
});

test('browser publishing locks draft and queued browser writes block API writes', async t => {
  const f = await fixture(t), { account } = await f.connect();
  f.store.put('account', { ...account, scopes: ['user_info'] });
  await writeFile(resolve(f.workspaceRoot, 'video.mp4'), mp4);
  const { asset } = await f.ops.importMedia({ sourcePath: 'video.mp4' });
  const { draft } = f.ops.saveDraft({ accountId: account.id, title: '视频', text: '已确认文案', assetId: asset.id });
  const input = { accountId: account.id, draftId: draft.id, operationKey: 'web-publish' };
  const result = await f.ops.action('publish-draft', input);
  assert.equal(result.job.status, 'pending');
  assert.equal((await f.ops.action('publish-draft', input)).job.id, result.job.id);
  assert.throws(() => f.ops.saveDraft({ ...draft, text: 'changed' }), /锁定/);
  assert.throws(() => f.ops.beginJob(account.id, 'reply', 'another', {}), /正在执行/);
});

test('browser links route data without pretending to be API IDs, and read counts are enforced', async t => {
  const f = await fixture(t), { account } = await f.connect();
  const link = 'https://www.douyin.com/video/1234567890';
  const data = await f.ops.action('video-data', { accountId: account.id, itemIds: [link] });
  assert.equal(data.job.targetUrl, link);
  assert.equal(data.job.transport, 'browser');
  assert.deepEqual(f.calls, []);
  const comments = await f.ops.action('list-comments', { accountId: account.id, itemId: link, count: 1 });
  const claim = await f.ops.action('claim-browser-job', { jobId: comments.job.id, actualProfileId: `douyin-ops:${account.browserProfileId}` });
  const finish = { jobId: comments.job.id, executionToken: claim.executionToken, actualProfileId: claim.profileId, outcome: 'succeeded', evidence: '模拟实际评论列表' };
  await assert.rejects(f.ops.action('finish-browser-job', { ...finish, items: [{ title: '第一条' }, { title: '第二条' }] }), /数量/);
  await f.ops.action('finish-browser-job', { ...finish, items: [{ title: '第一条', link, content: '第一条', nickname: '作者' }] });
});

test('browser instructions queue while only one job may own an account browser', async t => {
  const f = await fixture(t), { account } = await f.ops.action('connect-browser');
  const identity = { accountId: account.id, actualProfileId: `douyin-ops:${account.browserProfileId}`, actualAccount: 'fixture-user', nickname: '测试账号', profileUrl: 'https://www.douyin.com/user/fixture', evidence: '自己的抖音号 fixture-user' };
  await f.ops.action('verify-browser-account', identity);
  const input = { accountId: account.id, targetUrl: 'https://www.douyin.com/video/1234567890', content: '锁定评论' };
  const a = await f.ops.action('comment-video', { ...input, operationKey: 'queue-a' });
  const b = await f.ops.action('comment-video', { ...input, operationKey: 'queue-b' });
  const claim = await f.ops.action('claim-browser-job', { ...identity, jobId: a.job.id });
  await assert.rejects(f.ops.action('claim-browser-job', { ...identity, jobId: b.job.id }), /上一项任务/);
  assert.equal(f.store.get('job', b.job.id).status, 'pending');
  await f.ops.action('finish-browser-job', { ...identity, jobId: a.job.id, executionToken: claim.executionToken, outcome: 'uncertain', evidence: '模拟提交后反馈中断' });
  await assert.rejects(f.ops.action('claim-browser-job', { ...identity, jobId: b.job.id }), /待核对/);
  f.ops.resolveJob({ jobId: a.job.id, outcome: 'failed', evidence: '模拟核对没有提交' });
  assert.equal((await f.ops.action('claim-browser-job', { ...identity, jobId: b.job.id })).job.status, 'running');
});
