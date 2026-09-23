import { randomUUID } from 'node:crypto';
import { Media, fail } from './media.mjs';
import { Jobs } from './jobs.mjs';
import { now, text, record } from './validation.mjs';
import { officialUrl } from './validation.mjs';

export class Operations {
  constructor({ store, dataDir, workspaceRoot }) {
    this.store = store;
    this.media = new Media(store, dataDir, workspaceRoot);
    this.jobs = new Jobs(store, this.media);
  }
  state() {
    return { accounts: this.store.list('account', null, 50), drafts: this.store.list('draft'),
      assets: this.store.list('asset'), jobs: this.store.list('job'), videos: this.store.list('video'),
      comments: this.store.list('comment'), localOnly: true, limit: 100 };
  }
  saveAccount(input) {
    const prior = input.id ? record(this.store, 'account', input.id) : null;
    if (!prior && this.store.count('account') >= 50) fail('最多管理 50 个账号');
    const channelId = text(input.channelId ?? prior?.channelId ?? '', '视频号 ID', 100, false);
    if (prior?.verifiedAt && channelId !== prior.channelId) fail('已核验账号的身份不能修改，请另建账号');
    const account = { ...prior, id: prior?.id || randomUUID(), browserProfileId: prior?.browserProfileId || randomUUID(),
      name: text(input.name, '账号名称', 60), channelId,
      positioning: text(input.positioning ?? '', '账号定位', 1000, false),
      audience: text(input.audience ?? '', '目标受众', 500, false),
      tone: text(input.tone ?? '', '表达风格', 500, false),
      autoNamed: false, status: prior?.status || 'unverified', verifiedAt: prior?.verifiedAt || null,
      observedName: prior?.observedName || '', createdAt: prior?.createdAt || now(), updatedAt: now() };
    return { account: this.store.put('account', account) };
  }
  connectAccount(input) {
    const prior = input.accountId ? record(this.store, 'account', input.accountId) : null;
    if (!prior && this.store.count('account') >= 50) fail('最多管理 50 个账号');
    const account = this.store.put('account', { ...prior, id: prior?.id || randomUUID(),
      browserProfileId: prior?.browserProfileId || randomUUID(), name: prior?.name || '等待扫码连接',
      channelId: prior?.channelId || '', positioning: prior?.positioning || '', audience: prior?.audience || '',
      tone: prior?.tone || '', autoNamed: prior ? Boolean(prior.autoNamed) : true, status: 'connecting',
      verifiedAt: prior?.verifiedAt || null, observedName: prior?.observedName || '',
      connectionError: '', connectionStartedAt: now(), createdAt: prior?.createdAt || now(), updatedAt: now() });
    return { account, url: 'https://channels.weixin.qq.com/login.html', browserProfileId: account.browserProfileId };
  }
  observeBrowserSession(input, context) {
    const url = new URL(officialUrl(input.url));
    const browserProfileId = text(input.browserProfileId, '浏览器环境', 36);
    const account = this.store.list('account', null, 50).find(item => item.browserProfileId === browserProfileId);
    if (!account) return { connected: false };
    if (url.pathname === '/login.html' || url.pathname.startsWith('/platform/login')) return { connected: false, accountId: account.id };
    if (!['/platform', '/platform/', '/platform/home'].includes(url.pathname)) return { connected: false };
    const tree = text(input.tree, '页面内容', 100_000);
    const entries = [...tree.matchAll(/\b(StaticText|heading)\s+("(?:[^"\\]|\\.)*")/g)].map(match => {
      try { return { role: match[1], value: JSON.parse(match[2]) }; } catch { return null; }
    }).filter(Boolean);
    const marker = entries.findIndex(entry => /^视频号ID\s*[:：]?\s*\S*$/.test(entry.value));
    if (marker < 0) return { connected: false, accountId: account.id };
    const inline = entries[marker].value.replace(/^视频号ID\s*[:：]?\s*/, '');
    const actualChannelId = text(inline || entries[marker + 1]?.value, '页面视频号 ID', 100);
    if (/\s/.test(actualChannelId)) return { connected: false, accountId: account.id };
    const actualName = [...entries.slice(0, marker)].reverse().find(entry => entry.role === 'heading' && entry.value.trim())?.value;
    if (!actualName) return { connected: false, accountId: account.id };
    const duplicate = this.store.list('account', null, 50).find(item => item.id !== account.id && item.channelId === actualChannelId);
    if (duplicate) {
      this.store.put('account', { ...account, status: 'conflict', connectionError: '这个视频号已经添加过了', updatedAt: now() });
      return { connected: false, accountId: duplicate.id, reason: 'duplicate' };
    }
    if (account.channelId && account.channelId !== actualChannelId) {
      this.store.put('account', { ...account, status: 'mismatch', connectionError: '扫码登录的视频号与当前账号不一致', updatedAt: now() });
      return { connected: false, accountId: account.id, reason: 'identity_mismatch' };
    }
    const observedName = text(actualName, '页面账号名称', 100);
    const saved = this.store.put('account', { ...account, name: account.autoNamed ? observedName : account.name,
      autoNamed: false, channelId: actualChannelId, observedName, status: 'verified', verifiedAt: now(),
      verifiedSessionId: context.sessionId, connectionError: '', updatedAt: now() });
    return { connected: true, accountId: saved.id };
  }
  verifyAccount(input, context) {
    const account = record(this.store, 'account', input.accountId);
    if (input.profileId !== `wechat-channels-ops:${account.browserProfileId}`) fail('浏览器环境不属于当前账号');
    const channelId = text(input.actualChannelId, '页面视频号 ID', 100);
    if (account.channelId && account.channelId !== channelId) fail('页面视频号与预期账号不一致');
    text(input.evidence, '身份核验依据', 2000);
    officialUrl(input.sourceUrl);
    const observedName = text(input.actualName, '页面账号名称', 100);
    return { account: this.store.put('account', { ...account, name: account.autoNamed ? observedName : account.name,
      autoNamed: false, channelId, observedName, status: 'verified', verifiedAt: now(), connectionError: '',
      verifiedSessionId: context.sessionId, updatedAt: now() }) };
  }
  saveDraft(input) {
    const account = record(this.store, 'account', input.accountId);
    const prior = input.id ? record(this.store, 'draft', input.id, account.id) : null;
    const data = { accountId: account.id, title: text(input.title, '内部标题', 100),
      description: text(input.description ?? '', '视频描述', 2000, false),
      topics: text(input.topics ?? '', '话题', 500, false),
      assetId: text(input.assetId ?? '', '视频素材', 100, false),
      coverId: text(input.coverId ?? '', '封面素材', 100, false) };
    if (data.assetId && record(this.store, 'asset', data.assetId).kind !== 'video') fail('请选择视频素材');
    if (data.coverId && record(this.store, 'asset', data.coverId).kind !== 'image') fail('请选择图片封面');
    const operationKey = input.runKey ? text(input.runKey, '日程标识', 700) : null;
    const existing = operationKey && this.store.byOperation('draft', account.id, operationKey);
    if (existing && existing.id !== prior?.id) return { draft: existing, reused: true };
    if (!prior && this.store.count('draft') >= 1000) fail('草稿数量已达本地上限');
    const changed = !prior || Object.entries(data).some(([key, value]) => prior[key] !== value);
    const draft = { ...data, id: prior?.id || randomUUID(), revision: (prior?.revision || 0) + Number(changed),
      operationKey: prior?.operationKey || operationKey, createdAt: prior?.createdAt || now(), updatedAt: now() };
    return { draft: this.store.put('draft', draft) };
  }
  async prepareJob(input, context = {}) {
    const account = record(this.store, 'account', input.accountId);
    if (!['publish', 'sync-videos', 'sync-comments', 'reply'].includes(input.type)) fail('任务类型无效');
    const operationKey = text(input.operationKey, '操作标识', 700);
    let payload;
    if (input.type === 'publish') {
      const draft = record(this.store, 'draft', input.draftId, account.id);
      if (!draft.assetId) fail('请先为草稿选择视频');
      await this.media.path(draft.assetId);
      if (draft.coverId) await this.media.path(draft.coverId);
      payload = { draftId: draft.id, revision: draft.revision, title: draft.title, description: draft.description,
        topics: draft.topics, assetId: draft.assetId, coverId: draft.coverId };
    } else if (input.type === 'reply') {
      const comment = record(this.store, 'comment', input.commentId, account.id);
      payload = { commentId: comment.id, videoId: comment.videoId, author: comment.author,
        originalText: comment.body, body: text(input.body, '回复内容', 1000) };
    } else {
      payload = input.type === 'sync-comments' ? { videoId: record(this.store, 'video', input.videoId, account.id).id } : {};
    }
    return this.store.transaction(() => {
      const existing = this.store.byOperation('job', account.id, operationKey);
      if (existing) {
        if (existing.type !== input.type || JSON.stringify(existing.payload) !== JSON.stringify(payload)) fail('同一操作标识已绑定其他内容，请核对原任务', 'conflict');
        return { job: existing, reused: true };
      }
      const jobs = this.store.list('job', account.id, 1000);
      const duplicate = input.type === 'publish' && jobs.find(job => job.type === 'publish' &&
        job.payload.draftId === payload.draftId && job.payload.revision === payload.revision && job.status !== 'cancelled');
      if (duplicate) return { job: duplicate, reused: true };
      if (jobs.some(job => ['running', 'submitting', 'uncertain'].includes(job.status))) fail('该账号有执行中或待核对任务，请先处理');
      if (this.store.count('job') >= 1000) fail('任务数量已达本地上限');
      return { job: this.store.put('job', { id: randomUUID(), accountId: account.id, type: input.type,
        operationKey, payload, status: 'prepared', sessionId: context.sessionId || null,
        createdAt: now(), updatedAt: now(), evidence: '', resultUrl: '' }) };
    });
  }
  async action(name, input = {}, context = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('操作参数无效');
    const executorOnly = ['observe-browser-session', 'verify-account', 'claim-job', 'mark-submitting', 'report-job', 'reconcile-job'];
    if (executorOnly.includes(name) && (!context.trusted || !context.sessionId)) fail('此操作需要主软件会话执行', 'host_required');
    switch (name) {
      case 'studio-state': return this.state();
      case 'list-accounts': return { accounts: this.store.list('account', null, 50) };
      case 'save-account': return this.saveAccount(input);
      case 'connect-account': return this.connectAccount(input);
      case 'observe-browser-session': return this.observeBrowserSession(input, context);
      case 'verify-account': return this.verifyAccount(input, context);
      case 'save-draft': return this.saveDraft(input);
      case 'import-media': return { asset: await this.media.import(input.sourcePath) };
      case 'prepare-job': return this.prepareJob(input, context);
      case 'get-job': return { job: record(this.store, 'job', input.jobId) };
      case 'cancel-job': {
        const job = record(this.store, 'job', input.jobId);
        if (job.status !== 'prepared') fail('只能取消尚未执行的任务');
        return { job: this.store.put('job', { ...job, status: 'cancelled', cancelledOperationKey: job.operationKey,
          operationKey: null, updatedAt: now() }) };
      }
      case 'browser-target': {
        const account = record(this.store, 'account', input.accountId);
        return { url: 'https://channels.weixin.qq.com/', browserProfileId: account.browserProfileId,
          profileId: `wechat-channels-ops:${account.browserProfileId}`, accountId: account.id };
      }
      case 'claim-job': return this.jobs.claim(input, context);
      case 'mark-submitting': return this.jobs.markSubmitting(input, context);
      case 'report-job': return this.jobs.report(input, context);
      case 'reconcile-job': return this.jobs.reconcile(input, context);
      default: fail('没有找到此操作', 'not_found');
    }
  }
}
