import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';

const required = (value, label, max = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Object.assign(new Error(`${label}无效`), { code: 'invalid_input' });
  return value.trim();
};
const fail = message => { throw Object.assign(new Error(message), { code: 'browser_state_invalid' }); };
const hash = value => createHash('sha256').update(value).digest('hex');
const writes = new Set(['publish-draft', 'reply-comment', 'comment-video']);
export const routedActions = new Set([...writes, 'list-videos', 'video-data', 'list-comments', 'search-videos']);
export const isBrowserReadJob = job => job?.transport === 'browser' && routedActions.has(job.browserAction) && !writes.has(job.browserAction);
export const canCancelReadJob = job => isBrowserReadJob(job) && ['pending', 'running', 'uncertain'].includes(job.status);
export function canUseBrowser(error) {
  return ['configuration_required', 'scope_required', 'reauthorization_required', 10008, 10010, 10013, 2190002, 2190004, 28001003, 28001008, 28001014, 28001018].includes(error?.code);
}
export function douyinUrl(value, type) {
  const url = new URL(required(value, '抖音页面地址'));
  if (url.origin !== 'https://www.douyin.com' || url.username || url.password || url.hash
    || (type === 'video' && !/^\/video\/\d+$/.test(url.pathname))
    || (type === 'user' && !/^\/user\/[\w-]+$/.test(url.pathname))) fail('请使用实际抖音作品或个人主页的完整地址');
  url.search = '';
  return url.href;
}

// Browser execution belongs to the host AI session. This module owns durable
// payloads, exclusive claims and evidence; it never reads cookies or private APIs.
export class BrowserOperations {
  constructor(operations) { this.ops = operations; this.store = operations.store; }
  connect(input) {
    let account = input.accountId ? this.ops.account(input.accountId) : null;
    if (!account) {
      account = this.store.list('account', null, 50).find(item => item.connection === 'browser' && !item.webIdentity);
      if (!account) {
        if (this.store.list('account', null, 50).length >= 50) fail('最多接入 50 个账号');
        account = this.store.put('account', { id: randomUUID(), browserProfileId: randomUUID(), connection: 'browser', nickname: '等待登录', scopes: [] });
      }
    }
    return { account, url: 'https://www.douyin.com/user/self', browserProfileId: account.browserProfileId };
  }
  observe(input) {
    const account = this.store.list('account', null, 50).find(item => item.browserProfileId === input.browserProfileId);
    if (!account) return { connected: false, reason: 'profile_required' };
    const url = new URL(required(input.url, '当前页面地址'));
    if (url.origin !== 'https://www.douyin.com' || url.pathname !== '/user/self' || url.username || url.password) return { connected: false, reason: 'own_page_required' };
    const tree = required(input.tree, '可见页面', 100000);
    const entries = tree.split('\n').flatMap(line => {
      const match = line.match(/^\s*(?:\[@[^\]]+\]\s*)?(heading|StaticText|tab|button) ("(?:[^"\\]|\\.)*")(.*)$/);
      if (!match) return [];
      try { return [{ role: match[1], text: JSON.parse(match[2]), detail: match[3] }]; } catch { return []; }
    });
    const nickname = entries.find(item => item.role === 'heading' && /\blevel=1\b/.test(item.detail))?.text;
    const identityIndex = entries.findIndex(item => item.role === 'StaticText' && /^抖音号[：:]/.test(item.text));
    const identityLabel = entries[identityIndex]?.text.replace(/^抖音号[：:]\s*/, '');
    const webIdentity = identityLabel || (entries[identityIndex + 1]?.role === 'StaticText' ? entries[identityIndex + 1].text : '');
    const ownsPage = entries.some(item => item.role === 'button' && ['编辑资料', '批量管理'].includes(item.text))
      && entries.some(item => item.role === 'tab' && ['私密作品', '观看历史'].includes(item.text));
    if (identityIndex < 0 || !nickname || !/^[\w.-]{1,200}$/.test(webIdentity) || !ownsPage) return { connected: false, reason: 'identity_not_visible' };
    if (account.webIdentity && account.webIdentity !== webIdentity) return { connected: false, reason: 'account_mismatch' };
    return this.verify({ accountId: account.id, actualProfileId: `douyin-ops:${account.browserProfileId}`,
      actualAccount: webIdentity, nickname, profileUrl: account.profileUrl || url.href,
      evidence: `宿主可见的本人主页 /user/self 显示昵称 ${nickname}、抖音号 ${webIdentity}，并存在个人管理与私密作品或观看历史入口。` });
  }
  verify(input) {
    const account = this.ops.account(input.accountId);
    if (`douyin-ops:${account.browserProfileId}` !== input.actualProfileId) fail('浏览器环境与账号不一致');
    const webIdentity = required(input.actualAccount, '页面抖音号', 200);
    const evidence = required(input.evidence, '当前登录账号的页面证据', 4000);
    if (!evidence.includes(webIdentity)) fail('页面证据必须包含实际抖音号');
    const profileUrl = douyinUrl(input.profileUrl, 'user');
    if (account.webIdentity && (account.webIdentity !== webIdentity || account.profileUrl !== profileUrl)) fail('当前网页登录了其他账号，请切回原账号');
    const updated = this.store.put('account', { ...account, webIdentity, profileUrl,
      nickname: required(input.nickname, '页面昵称', 200), webVerifiedAt: Date.now() });
    return { account: updated, connected: true };
  }
  prepare(name, input, reason, previous) {
    const account = this.ops.account(input.accountId);
    let payload = {}, targetUrl = 'https://creator.douyin.com/';
    if (!writes.has(name) && input.count !== undefined && (!Number.isInteger(input.count) || input.count < 1 || input.count > 20)) fail('每次读取 1–20 条结果');
    if (name === 'search-videos') {
      const keyword = required(input.keyword, '搜索词', 100), count = input.count ?? 20;
      if (!Number.isInteger(count) || count < 1 || count > 20) fail('每次读取 1–20 条结果');
      if (input.cursor && String(input.cursor) !== '0') fail('网页搜索请重新搜索；不能接续 API 分页游标');
      payload = { keyword, count }; targetUrl = `https://www.douyin.com/search/${encodeURIComponent(keyword)}`;
    } else if (name === 'publish-draft') {
      const draft = this.store.get('draft', required(input.draftId, '草稿 ID', 100));
      if (!draft || draft.accountId !== account.id) fail('草稿不属于当前账号');
      if (draft.jobId && draft.jobId !== previous?.id) return this.response(this.store.get('job', draft.jobId));
      if (!draft.text || !draft.assetId || !this.store.get('asset', draft.assetId)) fail('请先保存 MP4 素材和作品文案');
      payload = { draftId: draft.id, title: draft.title, text: draft.text, assetId: draft.assetId };
    } else if (name === 'comment-video' || name === 'reply-comment') {
      if (name === 'comment-video' || input.targetUrl) targetUrl = douyinUrl(input.targetUrl, 'video');
      else required(input.itemId, '自己作品标识');
      payload = { targetUrl, content: required(input.content, '评论内容', 300) };
      if (name === 'reply-comment') payload = { ...payload, itemId: input.itemId || '', commentId: input.commentId || '',
        targetComment: required(input.targetComment, '原评论内容', 2000), targetAuthor: required(input.targetAuthor, '原评论作者', 200) };
    } else if (name === 'list-comments') {
      payload = { itemId: required(input.itemId, '作品标识或链接'), count: input.count ?? 20 };
      if (input.targetUrl || input.itemId.startsWith('https://')) targetUrl = douyinUrl(input.targetUrl || input.itemId, 'video');
    } else if (name === 'video-data') {
      if (!Array.isArray(input.itemIds) || !input.itemIds.length || input.itemIds.length > 20) fail('请选择 1–20 个作品');
      payload = { itemIds: input.itemIds.map(id => required(id, '作品标识')) };
      payload.itemIds = payload.itemIds.map(id => id.startsWith('https://') ? douyinUrl(id, 'video') : id);
      if (payload.itemIds.length === 1 && payload.itemIds[0].startsWith('https://')) targetUrl = payload.itemIds[0];
    } else if (name === 'list-videos') payload = { count: input.count ?? 20 };
    else fail('不支持的网页操作');
    if (writes.has(name)) {
      required(input.operationKey, '操作标识', 700);
      const existing = this.store.byOperation('job', account.id, input.operationKey);
      if (existing && existing.id !== previous?.id) {
        if (existing.browserAction !== name || JSON.stringify(existing.payload) !== JSON.stringify(payload)) fail('相同操作标识不能更换目标或内容');
        return this.response(existing);
      }
      if (this.store.list('job', account.id, 1000).some(job => job.id !== previous?.id && job.status === 'uncertain')) fail('该账号有待核对的操作，请先检查执行记录');
    }
    if (!previous && this.store.list('job', null, 1000).length >= 1000) fail('已达到执行记录上限');
    const job = this.store.put('job', { ...(previous || {}), id: previous?.id || randomUUID(), accountId: account.id,
      kind: name === 'publish-draft' ? 'publish' : name, browserAction: name, transport: 'browser',
      operationKey: previous?.operationKey || input.operationKey || randomUUID(), payload, targetUrl,
      status: 'pending', message: '等待 AI 操作浏览器', reason, createdAt: previous?.createdAt || Date.now() });
    if (name === 'publish-draft') {
      const draft = this.store.get('draft', payload.draftId);
      this.store.put('draft', { ...draft, jobId: job.id, status: 'submitting' });
    }
    return this.response(job);
  }
  response(job) {
    return {
      job: { ...job, canCancelRead: canCancelReadJob(job) },
      ...(job?.transport === 'browser' ? {
        browserTask: {
          jobId: job.id,
          action: job.browserAction,
          status: job.status,
          accountId: job.accountId,
          profileId: `douyin-ops:${this.ops.account(job.accountId).browserProfileId}`,
          targetUrl: job.targetUrl,
          nextAction: job.status === 'pending' ? 'claim-browser-job' : 'get-job',
          manualUploadRequired: false,
          instruction: '先在返回的 profileId 中打开 targetUrl，使用本轮返回的新 tabId snapshot 核对账号，不复用历史 tabId。请在当前会话领取网页任务；发布时自动使用领取结果中的 mediaPath 和 extensionId 上传生成的 MP4，不要要求用户手动上传。',
        },
      } : {}),
    };  }
  claim(input) {
    const job = this.store.get('job', required(input.jobId, '任务 ID', 100));
    if (!job || job.transport !== 'browser' || job.status !== 'pending') fail('任务已领取或已完成，请查看记录，不要重复执行');
    const account = this.ops.account(job.accountId);
    const blocker = this.store.list('job', account.id, 1000).find(other => other.id !== job.id
      && (other.status === 'running' || (writes.has(job.browserAction) && other.status === 'uncertain')));
    if (blocker) return { job, queued: true, retryAfterMs: 2000, blockedByJobId: blocker.id,
      blockedByStatus: blocker.status, requiresReconciliation: blocker.status === 'uncertain', blockedByAction: blocker.browserAction,
      canCancelRead: canCancelReadJob(blocker),
      instruction: canCancelReadJob(blocker) ? `若读取 ${blocker.id} 已中断，先 cancel-read-job 释放占用，再领取原排队任务；不能新建重复任务。` : '请先完成或核对原任务；写操作不能强制解锁。' };    if (input.actualProfileId !== `douyin-ops:${account.browserProfileId}`) fail('浏览器环境与任务账号不一致');
    if (writes.has(job.browserAction) && (!account.webIdentity || input.actualAccount !== account.webIdentity)) fail('请先从当前登录账号页面核对抖音号');
    const executionToken = randomBytes(32).toString('hex');
    this.store.setSecret(`browser-job:${job.id}`, { tokenHash: hash(executionToken) });
    const claimed = this.store.put('job', { ...job, status: 'running', message: 'AI 正在读取或操作网页', claimedAt: Date.now() });
    return { job: { ...claimed, canCancelRead: canCancelReadJob(claimed) }, account, executionToken, profileId: input.actualProfileId,
      nextAction: 'finish-browser-job',
      instruction: isBrowserReadJob(job)
        ? '按 job.payload 读取，不执行发布或评论。结束本轮前必须 finish-browser-job：成功返回实际 items，页面关闭或工具失败用 failed 及具体原因；不能遗留 running。凭证遗失且读取已停止时用 cancel-read-job。随后 get-job 核实。'
        : '先用返回的 profileId 和 job.targetUrl 打开页面、snapshot 核对当前账号，不得复用历史 tabId。按 job.payload 执行一次。提交前 Unknown or closed built-in browser tab 可重新 open_url 同一环境并用新 tabId 继续原任务（最多2次），不要直接判失败或重新领取。可能已点击发布/发送时只核对，不重发。结束前 finish-browser-job 回写：成功保留实际管理页回执和原生 publicationStatus，公开链接仅在已验证时传入；提交后验证码或无法确认用 uncertain。随后 get-job 核实。',
      ...(job.browserAction === 'publish-draft' ? { mediaPath: resolve(this.ops.dataDir, 'assets', `${job.payload.assetId}.mp4`), extensionId: 'douyin-ops' } : {}) };
  }
  cancelRead(input) {
    return this.store.transaction(() => {
      const job = this.store.get('job', required(input.jobId, '任务 ID', 100));
      if (!isBrowserReadJob(job)) fail('只能结束网页读取任务；发布、评论和 API 任务必须核对结果，不能用此操作解除锁');
      if (job.accountId !== required(input.accountId, '账号 ID', 100)) fail('读取任务不属于当前账号');
      const evidence = required(input.evidence, '结束读取的原因', 4000);
      if (job.status === 'failed' && job.errorCode === 'read_cancelled') return { job };
      if (!canCancelReadJob(job)) fail('读取任务已经结束，请查看已有结果');
      // Revoke the old executor before releasing the account; late receipts cannot overwrite this record.
      this.store.setSecret(`browser-job:${job.id}`, null);
      return { job: this.store.put('job', { ...job, status: 'failed', errorCode: 'read_cancelled',
        message: `读取任务已结束：${evidence}`, result: { ...job.result, evidence }, finishedAt: Date.now() }) };
    });
  }
  finish(input) {
    const job = this.store.get('job', required(input.jobId, '任务 ID', 100));
    if (!job || job.status !== 'running' || job.transport !== 'browser') fail('任务不是正在执行的网页任务');
    if (this.store.secret(`browser-job:${job.id}`)?.tokenHash !== hash(required(input.executionToken, '执行凭证', 100))) fail('执行凭证不匹配');
    if (!['succeeded', 'failed', 'uncertain'].includes(input.outcome)) fail('结果状态无效');
    const account = this.ops.account(job.accountId);
    if (input.actualProfileId !== `douyin-ops:${account.browserProfileId}`) fail('结果浏览器环境不一致');
    if (writes.has(job.browserAction) && input.actualAccount !== account.webIdentity) fail('结果账号不一致');
    const evidence = required(input.evidence, '页面结果证据', 4000);
    let result = { evidence };
    if (input.outcome === 'succeeded') {
      if (writes.has(job.browserAction)) {
        if (job.browserAction === 'publish-draft') {
          if (!['published', 'under_review'].includes(input.publicationStatus)) fail('请记录作品是已发布还是审核中');
          result.publicationStatus = input.publicationStatus;
          if (input.resultUrl) result.url = douyinUrl(input.resultUrl, 'video');
          // A matching row in the official creator console is a valid publish
          // receipt even when Douyin has not exposed a working public URL yet.
        } else {
          result.url = douyinUrl(input.resultUrl, 'video');
          if (job.targetUrl.startsWith('https://www.douyin.com/video/') && result.url !== job.targetUrl) fail('评论回执不属于任务目标作品');
        }
      }
      else {
        if (!Array.isArray(input.items) || input.items.length > (job.payload.count ?? 20)) fail('网页读取结果不能超过任务要求的数量（最多 20 条）');
        result.list = input.items.map(item => {
          const record = { title: required(item.title, '结果文本', 2000) };
          for (const key of ['item_id', 'comment_id', 'nickname', 'content', 'targetAuthor']) if (item[key]) record[key] = required(item[key], key, 2000);
          if (item.link) record.link = douyinUrl(item.link, 'video');
          if (job.browserAction === 'search-videos' && !record.link) fail('搜索结果必须提供实际作品链接');
          if (item.statistics) {
            record.statistics = {};
            for (const key of ['play_count', 'digg_count', 'comment_count', 'share_count']) {
              const value = item.statistics[key];
              if (value !== undefined && value !== null) record.statistics[key] = required(String(value), '可见数据', 40);
            }
          }
          return record;
        });
        result.has_more = false;
      }
    }
    const updated = this.store.put('job', { ...job, status: input.outcome, result, message: evidence, finishedAt: Date.now() });
    if (job.browserAction === 'publish-draft') {
      const draft = this.store.get('draft', job.payload.draftId);
      this.store.put('draft', { ...draft, status: input.outcome });
    }
    this.store.setSecret(`browser-job:${job.id}`, null);
    return { job: updated };
  }
}
