import { text, now, record, officialUrl } from './validation.mjs';
import { fail } from './media.mjs';

const ACTIVE = ['running', 'submitting', 'uncertain'];
const METRICS = ['plays', 'likes', 'comments', 'shares', 'favorites'];
export class Jobs {
  constructor(store, media) {
    Object.assign(this, { store, media });
    // Restart never repeats an external submission whose outcome is unknown.
    for (const job of store.list('job', null, 1000)) {
      if (['running', 'submitting'].includes(job.status)) store.put('job', { ...job,
        status: job.status === 'submitting' ? 'uncertain' : 'blocked',
        evidence: '执行服务中断，需核对页面后处理', updatedAt: now() });
    }
  }
  identity(account, input, context) {
    if (input.actualChannelId !== account.channelId || !account.channelId ||
      input.profileId !== `wechat-channels-ops:${account.browserProfileId}`) fail('页面身份或浏览器环境不匹配');
    if (account.verifiedSessionId !== context.sessionId || Date.now() - Date.parse(account.verifiedAt || '') > 15 * 60_000 || !account.verifiedAt) fail('请在当前会话重新核验登录身份');
  }
  async claim(input, context) {
    const job = record(this.store, 'job', input.jobId), account = record(this.store, 'account', job.accountId);
    this.identity(account, input, context);
    if (job.status !== 'prepared') fail('任务不处于待执行状态，不可重复领取');
    if (job.sessionId && job.sessionId !== context.sessionId) fail('任务已绑定其他会话');
    if (this.store.list('job', account.id, 1000).some(other => other.id !== job.id && ACTIVE.includes(other.status))) fail('该账号已有执行中或待核对任务');
    const mediaPaths = [];
    for (const id of [job.payload.assetId, job.payload.coverId].filter(Boolean)) mediaPaths.push((await this.media.path(id)).path);
    // Async media checks may yield to another claimant. Recheck atomically.
    return this.store.transaction(() => {
      if (record(this.store, 'job', job.id).status !== 'prepared' || this.store.list('job', account.id, 1000).some(other => other.id !== job.id && ACTIVE.includes(other.status))) fail('任务已被领取');
      const claimed = this.store.put('job', { ...job, status: 'running', sessionId: context.sessionId, updatedAt: now() });
      return { job: claimed, mediaPaths, profileId: input.profileId };
    });
  }
  owned(input, context) {
    const job = record(this.store, 'job', input.jobId);
    if (job.sessionId !== context.sessionId) fail('任务不属于当前执行会话');
    this.identity(record(this.store, 'account', job.accountId), input, context);
    return job;
  }
  markSubmitting(input, context) {
    const job = this.owned(input, context);
    if (!['publish', 'reply'].includes(job.type) || job.status !== 'running') fail('任务不能进入提交状态');
    return { job: this.store.put('job', { ...job, status: 'submitting', updatedAt: now() }) };
  }
  observations(job, input) {
    const key = job.type === 'sync-videos' ? 'videos' : 'comments';
    const entries = input[key];
    if (!Array.isArray(entries) || entries.length > 100) fail('每次最多同步 100 条可见记录');
    const records = entries.map(entry => {
      if (!entry || typeof entry !== 'object') fail('平台记录无效');
      const remoteId = text(entry.remoteId, '平台记录 ID', 200);
      const id = key === 'comments' ? `${job.payload.videoId}:${remoteId}` : `${job.accountId}:${remoteId}`;
      if (key === 'comments') return { id, accountId: job.accountId, remoteId,
        videoId: job.payload.videoId, author: text(entry.author, '评论作者', 200),
        body: text(entry.body, '评论正文', 4000), syncedAt: now() };
      const metrics = {};
      for (const name of METRICS) {
        const value = entry.metrics?.[name];
        if (value != null && (!Number.isSafeInteger(value) || value < 0)) fail('作品指标必须为非负整数或空值');
        metrics[name] = value ?? null;
      }
      return { id, accountId: job.accountId, remoteId, title: text(entry.title, '作品标题', 200),
        status: text(entry.status, '平台作品状态', 100), url: entry.url ? officialUrl(entry.url) : '',
        publishedAt: text(entry.publishedAt ?? '', '平台发布时间', 100, false), metrics, syncedAt: now() };
    });
    return { kind: key === 'videos' ? 'video' : 'comment', records };
  }
  report(input, context) {
    const job = record(this.store, 'job', input.jobId), evidence = text(input.evidence, '页面结果依据', 4000);
    if (job.sessionId !== context.sessionId) fail('任务不属于当前执行会话');
    // Lost login/network must still be reportable after the one permitted click.
    if (!['uncertain', 'blocked', 'failed'].includes(input.status)) this.owned(input, context);
    if (!['running', 'submitting'].includes(job.status)) fail('此任务已结束或需要核对，不可重复回写');
    const writing = ['publish', 'reply'].includes(job.type);
    const allowed = job.status === 'submitting' ? ['submitted', 'reviewing', 'published', 'replied', 'uncertain', 'failed']
      : writing ? ['blocked', 'failed'] : ['succeeded', 'blocked', 'failed'];
    if (!allowed.includes(input.status) || (input.status === 'replied' && job.type !== 'reply') ||
      (['submitted', 'reviewing', 'published'].includes(input.status) && job.type !== 'publish')) fail('任务结果与当前阶段不匹配');
    const observations = input.status === 'succeeded' ? this.observations(job, input) : null;
    const resultUrl = input.resultUrl ? officialUrl(input.resultUrl) : '';
    if (['published', 'replied'].includes(input.status) && !resultUrl) fail('成功结果需要平台页面地址');
    return this.store.transaction(() => {
      if (observations) {
        const additions = observations.records.filter(item => !this.store.get(observations.kind, item.id)).length;
        if (this.store.count(observations.kind) + additions > 1000) fail('平台记录已达到本地上限');
        for (const item of observations.records) this.store.put(observations.kind, item);
        const account = record(this.store, 'account', job.accountId);
        this.store.put('account', { ...account, [job.type === 'sync-videos' ? 'videosSyncedAt' : 'commentsSyncedAt']: now() });
      }
      return { job: this.store.put('job', { ...job, status: input.status, evidence, resultUrl,
        observedCount: observations?.records.length ?? null, updatedAt: now() }) };
    });
  }
  reconcile(input, context) {
    const job = record(this.store, 'job', input.jobId);
    this.identity(record(this.store, 'account', job.accountId), input, context);
    if (!['uncertain', 'blocked', 'submitted', 'reviewing'].includes(job.status)) fail('任务不需要核对');
    const status = text(input.status, '核对结果');
    const successes = job.type === 'publish' ? ['published', 'reviewing'] : job.type === 'reply' ? ['replied'] : [];
    if (!['failed', ...successes].includes(status)) fail('核对结果无效');
    const resultUrl = input.resultUrl ? officialUrl(input.resultUrl) : '';
    if (successes.includes(status) && !resultUrl) fail('平台结果需要页面地址');
    return { job: this.store.put('job', { ...job, status, resultUrl,
      evidence: text(input.evidence, '核对依据', 4000), reconciledBy: context.sessionId, updatedAt: now() }) };
  }
}
