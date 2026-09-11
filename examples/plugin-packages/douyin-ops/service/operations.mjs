import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdir, realpath, stat, copyFile, open, unlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute, basename, extname } from 'node:path';
import { DouyinApi, ApiError, CAPABILITY_SCOPES, MAX_VIDEO_BYTES } from './api.mjs';

export { MAX_VIDEO_BYTES } from './api.mjs';
export function fail(message, code = 'invalid_input') { throw Object.assign(new Error(message), { code }); }
const text = (value, label, max = 2000, optional = false) => {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label}无效`);
  return value.trim();
};
const digest = value => createHash('sha256').update(value).digest('hex');
const scopeSet = value => [...new Set(text(value, '授权权限', 2000).split(/[\s,]+/).filter(Boolean))];

const ACCOUNT_CAPABILITIES = Object.freeze({
  publish: Object.freeze({ label: '发布视频', scopes: CAPABILITY_SCOPES.publish }),
  listVideos: Object.freeze({ label: '读取作品', scopes: CAPABILITY_SCOPES.listVideos }),
  videoData: Object.freeze({ label: '读取作品数据', scopes: CAPABILITY_SCOPES.videoData }),
  comments: Object.freeze({ label: '读取与回复评论', scopes: CAPABILITY_SCOPES.listComments }),
});

function accountCapability(account, definition, now) {
  const requiredScopes = [...definition.scopes];
  if (!account) return { available: false, status: 'account_required', source: 'account', label: definition.label,
    requiredScopes, missingScopes: requiredScopes, reason: '请先绑定并选择抖音账号。' };
  const grantedScopes = Array.isArray(account.scopes) ? account.scopes : [];
  const missingScopes = requiredScopes.filter(scope => !grantedScopes.includes(scope));
  if (missingScopes.length) return { available: false, status: 'scope_required', source: 'account', label: definition.label,
    requiredScopes, missingScopes, reason: `当前账号未授权 ${missingScopes.join('、')}。请先为应用开通对应能力，再重新授权这个账号。` };
  if (Number(account.refreshExpiresAt) <= now) return { available: false, status: 'reauthorization_required', source: 'account', label: definition.label,
    requiredScopes, missingScopes: [], reason: '当前账号授权已过期，请重新授权这个账号。' };
  return { available: true, status: 'available', source: 'account', label: definition.label,
    requiredScopes, missingScopes: [], reason: `当前账号已授权 ${requiredScopes.join('、')}。` };
}

export function accountCapabilities(account, now = Date.now()) {
  return Object.fromEntries(Object.entries(ACCOUNT_CAPABILITIES).map(([name, definition]) => [name, accountCapability(account, definition, now)]));
}

export function applicationCapabilities(settings) {
  const configured = Boolean(settings?.clientKey && settings?.secretConfigured);
  const requiredScopes = [...CAPABILITY_SCOPES.searchVideos];
  return { searchVideos: { available: configured, status: configured ? 'runtime_check' : 'configuration_required', source: 'application',
    label: '搜索公开视频', requiredScopes, missingScopes: configured ? [] : requiredScopes,
    reason: configured
      ? '应用凭据已配置；aweme.dy.video_search 是否获批会在调用时由抖音官方 API 验证。'
      : '请先配置抖音开放平台应用；搜索还需要应用获批 aweme.dy.video_search。' } };
}

export class Operations {
  constructor({ store, dataDir, workspaceRoot, api = new DouyinApi({ timeoutMs: 60_000 }) }) {
    this.store = store; this.dataDir = dataDir; this.workspaceRoot = workspaceRoot; this.api = api;
    this.refreshing = new Map(); this.clientTokenPending = null;
    // A process may have exited after an external submit but before its receipt.
    for (const job of store.list('job', null, 1000)) if (job.status === 'running') {
      store.put('job', { ...job, status: 'uncertain', message: '服务在执行期间退出，请先到抖音核对结果。' });
    }
  }
  settings() {
    return this.store.get('settings', 'application') ?? { clientKey: '', secretConfigured: false, redirectUri: '', scopes: ['user_info'] };
  }
  saveSettings(input) {
    const current = this.settings();
    const clientKey = text(input.clientKey, 'Client Key', 200);
    const clientSecret = text(input.clientSecret, 'Client Secret', 500, true);
    if (current.clientKey && current.clientKey !== clientKey && this.store.list('account').length) fail('已有账号绑定当前应用，请继续使用原 Client Key。');
    let redirect;
    try { redirect = new URL(input.redirectUri); } catch { fail('请填写开放平台登记的 HTTPS 回调地址'); }
    if (redirect.protocol !== 'https:' || redirect.search || redirect.hash || redirect.username || redirect.password) fail('回调地址必须为 HTTPS，且不能带查询参数、片段或登录凭据');
    const scopes = scopeSet(input.scopes);
    if (!scopes.includes('user_info') || scopes.some(scope => !/^[a-z][a-z0-9_.]*$/.test(scope))) fail('权限必须包含 user_info，并用英文逗号分隔');
    if (scopes.includes('aweme.dy.video_search')) fail('aweme.dy.video_search 是应用能力，不需要放入用户授权权限');
    if (!clientSecret && !current.secretConfigured) fail('请填写 Client Secret');
    return this.store.transaction(() => {
      if (clientSecret) this.store.setSecret('application', { clientSecret });
      this.store.setSecret('client-token', null);
      const settings = this.store.put('settings', { id: 'application', clientKey, redirectUri: redirect.href, scopes, secretConfigured: true });
      // An authorization initiated with a different config must not be exchanged.
      for (const pending of this.store.list('oauth')) this.store.remove('oauth', pending.id);
      return { settings };
    });
  }
  accounts() {
    return this.store.list('account', null, 50).map(account => ({ ...account, capabilities: accountCapabilities(account) }));
  }
  state() {
    const settings = this.settings();
    return { settings, capabilities: applicationCapabilities(settings), accounts: this.accounts(),
      drafts: this.store.list('draft', null, 100), assets: this.store.list('asset', null, 100), jobs: this.store.list('job', null, 100) };
  }
  account(id) { return this.store.get('account', text(id, '账号 ID', 100)) ?? fail('账号不存在', 'account_not_found'); }
  async startAuthorization() {
    const settings = this.settings();
    if (!settings.secretConfigured) fail('请先在工作台填写应用配置', 'configuration_required');
    for (const pending of this.store.list('oauth')) if (pending.expiresAt < Date.now()) this.store.remove('oauth', pending.id);
    if (this.store.list('oauth').length >= 20) fail('待完成授权过多，请完成已有授权或十分钟后重试');
    const state = randomBytes(32).toString('base64url');
    this.store.put('oauth', { id: digest(state), clientKey: settings.clientKey, redirectUri: settings.redirectUri, expiresAt: Date.now() + 600_000 });
    const url = new URL('https://open.douyin.com/platform/oauth/connect/');
    url.search = new URLSearchParams({ client_key: settings.clientKey, response_type: 'code', scope: settings.scopes.join(','), redirect_uri: settings.redirectUri, state }).toString();
    return { url: url.href };
  }
  async finishAuthorization(input) {
    let callback;
    try { callback = new URL(input.callbackUrl); } catch { fail('请粘贴授权后的完整回调地址'); }
    const state = text(callback.searchParams.get('state'), '授权 state', 200);
    const pending = this.store.get('oauth', digest(state));
    if (!pending || pending.expiresAt < Date.now()) fail('授权已过期或不属于本次连接，请重新扫码', 'oauth_state_invalid');
    const redirect = new URL(pending.redirectUri);
    if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname || callback.username || callback.password || callback.hash) fail('回调地址与登记地址不一致');
    const code = text(callback.searchParams.get('code'), '授权码', 2000);
    this.store.remove('oauth', pending.id); // One use, including failed exchanges.
    const { clientSecret } = this.store.secret('application');
    const tokens = await this.api.exchangeCode({ clientKey: pending.clientKey, clientSecret, code });
    const openId = text(tokens.open_id, '开放平台账号标识', 300);
    const accessToken = text(tokens.access_token, '访问凭证', 4000);
    const info = await this.api.userInfo({ accessToken, openId });
    if (info.open_id !== openId) fail('返回的账号身份与授权不一致', 'account_mismatch');
    if (this.settings().clientKey !== pending.clientKey || this.settings().redirectUri !== pending.redirectUri) fail('授权过程中应用配置已改变，请重新开始授权');
    const id = digest(`${pending.clientKey}:${openId}`).slice(0, 32);
    const existing = this.store.get('account', id);
    if (!existing && this.store.list('account', null, 50).length >= 50) fail('最多接入 50 个账号');
    const expiresIn = Number(tokens.expires_in), refreshExpiresIn = Number(tokens.refresh_expires_in);
    if (!(expiresIn > 0 && Number.isFinite(expiresIn)) || !(refreshExpiresIn > 0 && Number.isFinite(refreshExpiresIn))) fail('授权有效期无效');
    const account = { id, openId, nickname: text(info.nickname, '账号昵称', 200),
      browserProfileId: existing?.browserProfileId ?? randomUUID(), scopes: scopeSet(tokens.scope),
      expiresAt: Date.now() + expiresIn * 1000, refreshExpiresAt: Date.now() + refreshExpiresIn * 1000 };
    this.store.transaction(() => { this.store.setSecret(`account:${id}`, { accessToken, refreshToken: text(tokens.refresh_token, '刷新凭证', 4000) }); this.store.put('account', account); });
    return { account };
  }
  requireScope(account, ...scopes) {
    if (!scopes.some(scope => account.scopes.includes(scope))) fail(`账号尚未授权 ${scopes.join(' / ')}。请核对开放平台应用能力，再重新授权；部分历史能力已限制申请。`, 'scope_required');
  }
  async credentials(id) {
    const account = this.account(id);
    if (account.expiresAt > Date.now() + 60_000) return { ...this.store.secret(`account:${id}`), openId: account.openId };
    if (!this.refreshing.has(id)) {
      this.refreshing.set(id, this.refreshAccount(account).finally(() => this.refreshing.delete(id)));
    }
    return this.refreshing.get(id);
  }
  async refreshAccount(account) {
    if (account.refreshExpiresAt <= Date.now()) fail('账号授权已过期，请重新扫码连接', 'reauthorization_required');
    const old = this.store.secret(`account:${account.id}`);
    const result = await this.api.refreshToken({ clientKey: this.settings().clientKey, refreshToken: old.refreshToken });
    if (result.open_id && result.open_id !== account.openId) fail('刷新授权返回了不同账号', 'account_mismatch');
    const expiresIn = Number(result.expires_in);
    if (!(expiresIn > 0 && Number.isFinite(expiresIn))) fail('刷新授权返回的有效期无效');
    const credentials = { accessToken: text(result.access_token, '访问凭证', 4000), refreshToken: result.refresh_token || old.refreshToken };
    const remaining = Number(result.refresh_expires_in);
    this.store.transaction(() => {
      this.store.setSecret(`account:${account.id}`, credentials);
      this.store.put('account', { ...account, expiresAt: Date.now() + expiresIn * 1000,
        scopes: result.scope ? scopeSet(result.scope) : account.scopes,
        refreshExpiresAt: remaining > 0 ? Math.min(account.refreshExpiresAt, Date.now() + remaining * 1000) : account.refreshExpiresAt });
    });
    return { ...credentials, openId: account.openId };
  }
  async importMedia(input) {
    const root = await realpath(this.workspaceRoot);
    const source = await realpath(resolve(root, text(input.sourcePath, '素材路径', 2000)));
    const local = relative(root, source);
    if (!local || local.startsWith('..') || isAbsolute(local)) fail('只能导入当前工作区内的 MP4 文件');
    const metadata = await stat(source);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_VIDEO_BYTES || extname(source).toLowerCase() !== '.mp4') fail('请选择不超过 128 MiB 的 MP4 文件');
    const id = randomUUID(), directory = resolve(this.dataDir, 'assets');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = resolve(directory, `${id}.mp4`);
    await copyFile(source, path);
    try { return await this.registerMedia(id, basename(source)); }
    catch (error) { await unlink(path); throw error; }
  }
  async registerMedia(id, name) {
    if (!/^[a-f0-9-]{36}$/.test(id)) fail('素材 ID 无效');
    const path = resolve(this.dataDir, 'assets', `${id}.mp4`);
    const file = await open(path, 'r');
    try {
      const metadata = await file.stat(), bytes = Buffer.alloc(12);
      await file.read(bytes, 0, 12, 0);
      if (metadata.size <= 12 || metadata.size > MAX_VIDEO_BYTES || bytes.toString('ascii', 4, 8) !== 'ftyp') fail('素材不是有效的 MP4 文件或超过 128 MiB');
      return { asset: this.store.put('asset', { id, name: text(basename(name), '文件名', 300), size: metadata.size, createdAt: Date.now() }) };
    } finally { await file.close(); }
  }
  saveDraft(input) {
    const account = this.account(input.accountId);
    const existing = input.id ? this.store.get('draft', text(input.id, '草稿 ID', 100)) : null;
    if (input.id && !existing) fail('草稿不存在');
    if (existing && existing.accountId !== account.id) fail('草稿不属于当前账号', 'account_mismatch');
    if (existing && existing.status !== 'draft') fail('已提交的草稿已锁定，请先核对发布记录');
    const operationKey = text(input.runKey, '日程运行标识', 700, true) || existing?.operationKey;
    if (operationKey && !existing) {
      const reused = this.store.byOperation('draft', account.id, operationKey);
      if (reused) return { draft: reused };
    }
    const assetId = text(input.assetId, '素材 ID', 100, true);
    if (assetId && !this.store.get('asset', assetId)) fail('素材不存在，请先导入');
    if (typeof input.text === 'string' && [...input.text].length > 1000) fail('作品文案最多 1000 字');
    return { draft: this.store.put('draft', { id: existing?.id ?? randomUUID(), accountId: account.id, operationKey,
      title: text(input.title, '草稿标题', 100, true), text: text(input.text, '作品文案', 2000, true), assetId,
      status: 'draft', createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now() }) };
  }
  beginJob(accountId, kind, operationKey, payload) {
    const key = text(operationKey, '操作标识', 700), fingerprint = digest(JSON.stringify({ kind, payload }));
    return this.store.transaction(() => {
      const previous = this.store.byOperation('job', accountId, key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail('相同操作标识不能更换目标或内容', 'operation_conflict');
        return { job: previous, created: false };
      }
      if (this.store.list('job', accountId, 1000).some(job => ['running', 'uncertain'].includes(job.status))) fail('该账号有正在执行或待核对的操作，请先检查执行记录', 'account_busy');
      if (this.store.list('job', null, 1000).length >= 1000) fail('已达到本地执行记录上限（1000），请先整理记录');
      const job = this.store.put('job', { id: randomUUID(), accountId, kind, operationKey: key, payload, fingerprint, status: 'running', message: '正在提交', createdAt: Date.now() });
      return { job, created: true };
    });
  }
  async runJob(job, submit, resultField) {
    try {
      const result = await submit();
      if (!result || typeof result[resultField] !== 'string' || !result[resultField]) throw Object.assign(new Error('未收到有效回执，请到抖音核对结果'), { uncertain: true });
      return this.store.put('job', { ...job, status: 'succeeded', message: '已收到抖音提交回执，最终展示以平台审核为准', result, finishedAt: Date.now() });
    } catch (error) {
      return this.store.put('job', { ...job, status: error.uncertain === false ? 'failed' : 'uncertain',
        message: error instanceof ApiError ? error.message : '未收到确定结果，请到抖音核对后再操作。', finishedAt: Date.now() });
    }
  }
  async publishDraft(input) {
    const account = this.account(input.accountId);
    let draft = this.store.get('draft', text(input.draftId, '草稿 ID', 100));
    if (!draft || draft.accountId !== account.id) fail('草稿不属于当前账号', 'account_mismatch');
    if (draft.jobId) return { job: this.store.get('job', draft.jobId) };
    this.requireScope(account, ...CAPABILITY_SCOPES.publish);
    if (!draft.assetId || !draft.text) fail('请先保存 MP4 素材和作品文案');
    const selectedDraft = draft;
    const credentials = await this.credentials(account.id);
    this.requireScope(this.account(account.id), ...CAPABILITY_SCOPES.publish);
    draft = this.store.get('draft', draft.id);
    if (draft.jobId) return { job: this.store.get('job', draft.jobId) };
    if (draft.text !== selectedDraft.text || draft.assetId !== selectedDraft.assetId) fail('草稿在授权刷新期间被修改，请核对最新内容后重新发布', 'draft_changed');
    const { job, created } = this.beginJob(account.id, 'publish', input.operationKey, { draftId: draft.id, text: draft.text, assetId: draft.assetId });
    if (!created) return { job };
    this.store.put('draft', { ...draft, status: 'submitting', jobId: job.id });
    let uploaded;
    try {
      uploaded = await this.api.uploadVideo({ ...credentials, filePath: resolve(this.dataDir, 'assets', `${draft.assetId}.mp4`) });
      if (!uploaded.video?.video_id) fail('视频上传没有返回素材标识');
    } catch (error) {
      const result = this.store.put('job', { ...job, status: 'failed', message: `素材上传失败，尚未发起发布。${error instanceof ApiError ? error.message : '请检查素材和授权。'}`, finishedAt: Date.now() });
      this.store.put('draft', { ...draft, status: 'failed', jobId: result.id });
      return { job: result };
    }
    const videoId = uploaded.video.video_id;
    this.store.put('job', { ...job, uploadedVideoId: videoId });
    const result = await this.runJob({ ...job, uploadedVideoId: videoId }, () => this.api.createVideo({ ...credentials, videoId, text: draft.text }), 'item_id');
    this.store.put('draft', { ...draft, status: result.status, jobId: result.id });
    return { job: result };
  }
  async replyComment(input) {
    const account = this.account(input.accountId);
    this.requireScope(account, ...CAPABILITY_SCOPES.replyComment);
    const payload = { itemId: text(input.itemId, '作品 ID'), commentId: text(input.commentId, '评论 ID'), content: text(input.content, '回复内容', 300) };
    const credentials = await this.credentials(account.id);
    this.requireScope(this.account(account.id), ...CAPABILITY_SCOPES.replyComment);
    const { job, created } = this.beginJob(account.id, 'reply', input.operationKey, payload);
    return { job: created ? await this.runJob(job, () => this.api.replyComment({ ...credentials, ...payload }), 'comment_id') : job };
  }
  async readApi(action, input) {
    const account = this.account(input.accountId);
    const definitions = {
      'list-videos': ['listVideos', CAPABILITY_SCOPES.listVideos],
      'video-data': ['videoData', CAPABILITY_SCOPES.videoData],
      'list-comments': ['listComments', CAPABILITY_SCOPES.listComments],
    };
    const [method, scopes] = definitions[action];
    this.requireScope(account, ...scopes);
    const credentials = await this.credentials(account.id);
    this.requireScope(this.account(account.id), ...scopes);
    const cursor = input.cursor ?? 0, count = input.count ?? 20;
    if (!((Number.isSafeInteger(cursor) && cursor >= 0) || (typeof cursor === 'string' && /^\d{1,19}$/.test(cursor))) || !Number.isInteger(count) || count < 1 || count > 20) fail('分页参数无效，单页最多 20 条');
    const args = { ...credentials, cursor, count };
    if (action === 'list-comments') args.itemId = text(input.itemId, '作品 ID');
    if (action === 'video-data') {
      if (!Array.isArray(input.itemIds) || !input.itemIds.length || input.itemIds.length > 20) fail('请选择 1 至 20 个作品');
      args.itemIds = input.itemIds.map(id => text(id, '作品 ID'));
    }
    return this.api[method](args);
  }
  async searchVideos(input) {
    const settings = this.settings();
    if (!settings.secretConfigured) fail('请先在工作台填写应用配置', 'configuration_required');
    const deviceId = text(input.deviceId, '搜索设备标识', 20);
    if (!/^\d{1,19}$/.test(deviceId)) fail('搜索设备标识需要填写开放平台要求的十进制 device_id');
    if (!this.clientTokenPending) {
      this.clientTokenPending = (async () => {
        const cached = this.store.secret('client-token');
        if (cached?.clientKey === settings.clientKey && cached.expiresAt > Date.now() + 60_000) return cached.token;
        const { clientSecret } = this.store.secret('application');
        const result = await this.api.clientToken({ clientKey: settings.clientKey, clientSecret });
        const token = text(result.access_token, '应用访问凭证', 4000), seconds = Number(result.expires_in);
        if (!(seconds > 0 && Number.isFinite(seconds))) fail('应用令牌有效期无效');
        this.store.setSecret('client-token', { token, clientKey: settings.clientKey, expiresAt: Date.now() + seconds * 1000 });
        return token;
      })().finally(() => { this.clientTokenPending = null; });
    }
    const result = await this.api.searchVideos({ clientToken: await this.clientTokenPending,
      keyword: text(input.keyword, '搜索关键词', 100), deviceId, cursor: input.cursor ?? 0, count: input.count ?? 20, searchId: input.searchId });
    return { list: result.video_list ?? [], cursor: result.cursor, has_more: result.has_more, search_id: result.search_id };
  }
  resolveJob(input) {
    const job = this.store.get('job', text(input.jobId, '操作 ID', 100));
    if (!job || job.status !== 'uncertain') fail('只能核对状态为待核对的操作');
    if (!['succeeded', 'failed'].includes(input.outcome)) fail('请选择核对结果');
    const evidence = text(input.evidence, '在抖音核对得到的结果说明', 2000);
    const resolved = this.store.put('job', { ...job, status: input.outcome, message: `人工核对：${evidence}`, reconciledAt: Date.now() });
    if (job.kind === 'publish') {
      const draft = this.store.get('draft', job.payload.draftId);
      if (draft) this.store.put('draft', { ...draft, status: input.outcome });
    }
    return { job: resolved };
  }
  browserTarget(input) {
    const account = input.accountId ? this.account(input.accountId) : null;
    if (!['creator', 'search'].includes(input.kind)) fail('不支持的网页入口');
    return { url: input.kind === 'creator' ? 'https://creator.douyin.com/' : `https://www.douyin.com/search/${encodeURIComponent(text(input.keyword, '关键词', 100))}`,
      ...(account ? { browserProfileId: account.browserProfileId } : {}) };
  }
  async action(name, input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('参数必须为对象');
    switch (name) {
      case 'studio-state': return this.state();
      case 'list-accounts': return { accounts: this.accounts() };
      case 'start-authorization': return this.startAuthorization();
      case 'finish-authorization': return this.finishAuthorization(input);
      case 'import-media': return this.importMedia(input);
      case 'save-draft': return this.saveDraft(input);
      case 'publish-draft': return this.publishDraft(input);
      case 'reply-comment': return this.replyComment(input);
      case 'resolve-job': return this.resolveJob(input);
      case 'search-videos': return this.searchVideos(input);
      case 'browser-target': return this.browserTarget(input);
      case 'get-job': return { job: this.store.get('job', text(input.jobId, '操作 ID', 100)) ?? fail('操作不存在') };
      case 'list-videos': case 'video-data': case 'list-comments': return this.readApi(name, input);
      default: fail('不支持的插件操作', 'action_not_found');
    }
  }
}
