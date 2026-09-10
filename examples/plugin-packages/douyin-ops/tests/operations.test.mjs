import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../service/store.mjs';
import { Operations } from '../service/operations.mjs';

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
  await assert.rejects(f.ops.action('list-videos', { accountId: account.id }), /video.list/);
  assert.equal(f.calls.length, 0);
  f.store.put('account', { ...account, expiresAt: 0 });
  f.api.refreshToken = async () => ({ access_token: 'limited', scope: 'user_info', expires_in: 3600 });
  await assert.rejects(f.ops.action('list-videos', { accountId: account.id }), /video.list/);
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
