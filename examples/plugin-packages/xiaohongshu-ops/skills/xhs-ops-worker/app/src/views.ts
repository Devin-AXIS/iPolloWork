import type { AccountBinding, BrandProfile, BrowserJob, Interaction, KnowledgeItem, MediaAsset, PlatformSnapshot, ReviewItem } from './types.js'
import type { OpsDatabase } from './db.js'
import { searchSorts, type PostDraft, type StudioService } from './studio.js'

type Nav = 'publishing' | 'comments' | 'analytics'

const assetVersion = '20260911.3'

function escapeHtml(value: unknown): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function jsonScript(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

function formatDate(value: string | null): string {
  if (!value) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value))
}

function lines(values: string[]): string {
  return values.join('\n')
}

function icon(name: string, label = ''): string {
  return `<i class="ti ti-${escapeHtml(name)}"${label ? ` aria-label="${escapeHtml(label)}"` : ' aria-hidden="true"'}></i>`
}

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    setup: '待确认', healthy: '已登录', blocked: '已阻断', reauthorize: '需重新登录', offline: '离线',
    draft: '草稿', active: '已安排', paused: '草稿', completed: '已完成', planned: '待生成', generating: '生成中',
    ready: '已就绪', scheduled: '已排期', publishing: '发布中', published: '已发布', failed: '失败', missed: '已错过',
    cancelled: '已取消', queued: '排队中', dispatched: '已派发', running: '执行中', succeeded: '已完成',
    needs_reconcile: '待核对', skipped: '已跳过', pending: '待审核', approved: '已通过', rejected: '已拒绝',
    review: '需审核', organic_comment: '用户评论', managed_comment: '账号互动', reply: '回复',
  }
  return labels[value] ?? value
}

function status(value: string): string {
  return `<span class="status status-${escapeHtml(value)}">${escapeHtml(statusLabel(value))}</span>`
}

function shell(title: string, active: Nav, body: string, pageData?: unknown, accountId?: number, accounts: AccountBinding[] = []): string {
  const nav: Array<[Nav, string, string, string]> = [
    ['publishing', '/publishing' + (accountId === undefined ? '' : `?account=${accountId}`), 'edit', '发帖'],
    ['comments', '/comments' + (accountId === undefined ? '' : `?account=${accountId}`), 'messages', '评论'],
    ['analytics', '/analytics' + (accountId === undefined ? '' : `?account=${accountId}`), 'chart-bar', '数据'],
  ]
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="theme-color" content="#f7f8f6">
    <title>${escapeHtml(title)} | 小红书运营台</title>
    <link rel="stylesheet" href="/icons/tabler-icons.min.css?v=3.46.0">
    <link rel="stylesheet" href="/assets/app.css?v=${assetVersion}">
  </head>
  <body data-page="${active}">
    <aside class="app-sidebar">
      <a class="brand-mark" href="/publishing" aria-label="小红书运营台">小红书</a>
      <nav aria-label="主要导航">${nav.map(([id, href, iconName, label]) => `<a href="${href}" ${active === id ? 'aria-current="page"' : ''}>${icon(iconName)}<span>${label}</span></a>`).join('')}</nav>
      <a class="sidebar-profile" href="/publishing" aria-label="查看账号">d</a>
    </aside>
    <header class="app-topbar">
      <a class="app-identity" href="/publishing" aria-label="小红书运营台"><span>小红书</span><div><strong>小红书运营台</strong><small>发帖、评论与数据，在一个工作台完成</small></div></a>
      ${accountBar(accounts, active, accounts.find(item => item.id === accountId) ?? accounts[0])}
    </header>
    <main class="app-main"><p class="workbench-entry-notice" data-workbench-entry-notice role="status" hidden></p>${body}</main>
    ${accountDialogs(accounts.find(item => item.id === accountId) ?? accounts[0])}
    <div id="toast-region" class="toast-region" aria-live="polite"></div>
    ${pageData === undefined ? '' : `<script type="application/json" id="page-data">${jsonScript(pageData)}</script>`}
    <script src="/assets/app.js?v=${assetVersion}" defer></script>
  </body>
</html>`
}

function empty(title: string, detail: string, action = ''): string {
  return `<div class="empty-state">${icon('clipboard-text')}<strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p>${action}</div>`
}

function accountAvatar(account: AccountBinding): string {
  return `<span class="account-avatar" aria-hidden="true">${account.avatarUrl ? `<img data-account-avatar src="${escapeHtml(account.avatarUrl)}" alt="" referrerpolicy="no-referrer">` : ''}<span data-avatar-fallback ${account.avatarUrl ? 'hidden' : ''}>${escapeHtml(account.displayName.slice(0, 1) || account.handle.slice(0, 1) || '小')}</span></span>`
}

function accountBar(accounts: AccountBinding[], panel: Nav, primary: AccountBinding | undefined): string {
  const label = primary ? `${accountAvatar(primary)}<span><strong>${escapeHtml(primary.displayName)}</strong><small>${primary.sessionStatus === 'healthy' ? '<b></b> 已登录' : escapeHtml(statusLabel(primary.sessionStatus))}</small></span>${icon('chevron-down')}` : ''
  const accountHref = (id: number) => `/${panel}?account=${id}`
  return `<section class="account-bar" aria-label="当前账号">
    ${primary ? `<details class="account-picker"><summary class="account-switcher" aria-label="切换账号">${label}</summary><nav class="account-menu" aria-label="选择账号">${accounts.map(item => `<a href="${accountHref(item.id)}" ${item.id === primary.id ? 'aria-current="true"' : ''}>${accountAvatar(item)}<span><strong>${escapeHtml(item.displayName)}</strong><small>小红书号 ${escapeHtml(item.expectedProfileId)} · ${escapeHtml(statusLabel(item.sessionStatus))}</small></span>${item.id === primary.id ? icon('check', '当前账号') : ''}</a>`).join('')}</nav></details>` : '<span class="account-switcher is-empty">尚未添加账号</span>'}
    <button class="add-account-link" type="button" data-open-account-form aria-label="添加账号" title="添加账号">${icon('plus')}<span>添加账号</span></button>${primary ? '<button class="icon-button" type="button" data-account-settings aria-label="管理当前账号" title="管理当前账号">⋯</button>' : ''}
  </section>`
}

function accountCard(account: AccountBinding): string {
  const loggedIn = account.sessionStatus === 'healthy'
  return `<article class="account-card surface" data-account-id="${account.id}">
    <header>${accountAvatar(account)}<div><div><strong>${escapeHtml(account.displayName)}</strong>${status(account.sessionStatus)}</div><span>小红书号 ${escapeHtml(account.expectedProfileId)}</span></div><button class="icon-button" type="button" data-toggle-account-details aria-label="展开账号设置">${icon('chevron-down')}</button></header>
    <div class="account-summary-grid"><div><span>账号定位</span><strong>${escapeHtml(account.position)}</strong></div><div><span>内容栏目</span><p>${account.contentColumns.map((column) => `<b>${escapeHtml(column)}</b>`).join('') || '<b>待设置</b>'}</p></div><div><span>登录状态</span><strong class="${loggedIn ? 'is-ready' : 'is-warning'}">${loggedIn ? '登录正常' : escapeHtml(statusLabel(account.sessionStatus))}</strong></div></div>
    ${account.lastError ? `<p class="account-error">${icon('alert-circle')} ${escapeHtml(account.lastError)}</p>` : ''}
    <div class="account-actions"><a class="button button-secondary" href="https://creator.xiaohongshu.com/new/home" data-account-login ${account.browserProfileId ? `data-browser-profile-id="${escapeHtml(account.browserProfileId)}"` : ''} target="_blank" rel="noreferrer">${icon('external-link')} 打开创作台</a><button class="button button-ghost delete-account-trigger" type="button" data-delete-account="${account.id}" data-account-name="${escapeHtml(account.displayName)}">${icon('trash')} 删除绑定</button></div>
    <p class="analytics-note">${loggedIn ? '已确认此账号登录，登录状态由程序自动核对。' : '在软件内打开此账号的创作台，返回运营台后自动核对登录状态。'}</p>
    <form class="account-edit-form" data-account-edit="${account.id}">
      <div class="setting-grid"><div class="field"><label>显示名称<input name="displayName" value="${escapeHtml(account.displayName)}" required></label></div><div class="field"><label>创作台地址<input name="profileUrl" type="url" value="${escapeHtml(account.profileUrl)}" required></label></div></div>
      <div class="setting-grid"><div class="field"><label>账号定位<input name="position" value="${escapeHtml(account.position)}" required></label></div><div class="field"><label>目标受众<input name="audience" value="${escapeHtml(account.audience)}" required></label></div></div>
      <div class="field"><label>内容栏目<textarea name="contentColumns" rows="3" required>${escapeHtml(lines(account.contentColumns))}</textarea></label></div>
      <details><summary>高级设置</summary><div class="setting-grid"><div class="field"><label>笔记语气<input name="noteTone" value="${escapeHtml(account.noteTone)}" required></label></div><div class="field"><label>互动语气<input name="commentTone" value="${escapeHtml(account.commentTone)}" required></label></div></div><div class="setting-grid"><div class="field"><label>禁用主题<textarea name="bannedTopics" rows="2">${escapeHtml(lines(account.bannedTopics))}</textarea></label></div><div class="field"><label>每天最多发布<input name="dailyLimit" type="number" min="1" max="20" value="${account.dailyLimit}" required></label></div></div><input name="workerThreadId" type="hidden" value="${escapeHtml(account.workerThreadId ?? '')}"></details>
      <footer><button class="button button-primary" type="submit">保存设置</button><button class="button button-ghost" type="button" data-toggle-account="${account.id}" data-enabled="${account.enabled ? 'false' : 'true'}">${account.enabled ? '暂停账号' : '启用账号'}</button></footer>
    </form>
  </article>`
}

export function renderAnalytics(input: { accounts: AccountBinding[]; account: AccountBinding | undefined; content: ReturnType<OpsDatabase['accountContent']> | null; platform: PlatformSnapshot | null }): string {
  const { accounts, account, content, platform } = input
  const metric = (label: string, value: number | null | undefined) => `<div class="analytics-metric"><span>${label}</span><strong>${value == null ? '—' : value.toLocaleString('zh-CN')}</strong></div>`
  const heading = `<header class="simple-heading"><div><span class="eyebrow">运营数据</span><h1>账号与文章数据</h1><p>按账号查看平台表现与运营台文章记录。</p></div>${account ? `<button class="button button-primary" type="button" data-verify-account="${account.id}" data-sync-analytics>同步数据</button>` : ''}</header>`
  if (!account || !content) return shell('数据', 'analytics', `<div class="simple-page analytics-page">${heading}${empty('还没有接入账号', '请使用顶部“添加账号”完成接入，再查看对应的数据。')}</div>`, { accounts }, undefined, accounts)
  const profile = `<section class="surface panel analytics-profile">${accountAvatar(account)}<div><h2>${escapeHtml(account.displayName)} ${status(account.sessionStatus)}</h2><p>小红书号 ${escapeHtml(account.expectedProfileId)} · ${account.enabled ? '已启用' : '已暂停'}</p><p>${escapeHtml(account.position)} · ${escapeHtml(account.audience)}</p></div></section>`
  const platformView = `<section class="surface panel"><div class="section-heading"><div><h2>平台数据</h2><p>${platform ? `来源：${platform.source === 'browser' ? '浏览器可见页面' : 'CSV 导入'} · 更新于 ${formatDate(platform.importedAt)}` : '尚未同步或导入平台数据；“—”表示未知，不代表 0。'}</p></div></div><div class="analytics-metrics">${metric('粉丝数', platform?.followers)}${metric('获赞数', platform?.likes)}${metric('收藏数', platform?.collections)}${metric('已记录文章', platform ? platform.articles.length : null)}</div>
    <details class="analytics-import"><summary>导入 / 更新平台数据</summary><p>可点击“同步数据”，由当前会话读取平台可见数据；首次使用可能需要在软件内扫码。也可下载模板，按列整理你获取的平台数据；导入将替换当前账号的平台数据快照，不影响运营台文章。</p><a class="button button-secondary" href="/analytics/template.csv" download>下载 CSV 模板</a><p>“类型”填账号或文章，每行填写当前小红书号。账号行填写粉丝数、点赞数、收藏数；文章行填写标题、链接、阅读量、点赞数、收藏数、评论数。未知指标及不可见的文章链接留空，最多 200 篇文章。</p><form data-analytics-import="${account.id}"><label for="analytics-csv">选择 UTF-8 CSV 文件</label><input id="analytics-csv" name="csv" type="file" accept=".csv,text/csv" required><button class="button button-primary" type="submit">导入数据</button><p role="status" data-import-status></p></form></details>
    <p class="analytics-note">网页同步仅包含已读取页面中的文章，不代表全部历史文章；看不到的指标保留为未知。</p>${platform?.articles.length ? `<div class="analytics-table" tabindex="0" aria-label="平台文章指标，可横向滚动"><table><thead><tr><th>平台文章</th><th>阅读</th><th>点赞</th><th>收藏</th><th>评论</th></tr></thead><tbody>${platform.articles.map(item => `<tr><td>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)} ${icon('external-link')}</a>` : escapeHtml(item.title)}</td>${[item.views, item.likes, item.collections, item.comments].map(value => `<td>${value == null ? '—' : value.toLocaleString('zh-CN')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="analytics-note">暂无平台文章指标。同步或导入后可查看每篇文章的阅读、点赞、收藏和评论数。</p>'}</section>`
  const counts = content.counts
  const local = `<section class="surface panel"><div class="section-heading"><div><h2>运营台文章记录</h2><p>仅统计在本运营台创建的文章，与平台历史文章分开显示。</p></div></div><div class="analytics-metrics">${metric('全部文章', content.total)}${metric('已发布', counts.published || 0)}${metric('待发布', ['planned', 'generating', 'ready', 'scheduled', 'publishing'].reduce((sum, key) => sum + (counts[key] || 0), 0))}${metric('失败 / 错过', (counts.failed || 0) + (counts.missed || 0))}</div>
    ${content.items.length ? `<div class="analytics-articles">${content.items.map(item => `<details class="analytics-article"><summary><span>${escapeHtml(item.title || '待生成文章')}</span>${status(item.status)}<small>${formatDate(item.publishedAt || item.scheduledAt)}</small></summary><div><p class="analytics-body">${escapeHtml(item.body || '正文尚未生成。')}</p>${item.topics.length ? `<p>${item.topics.map(topic => '#' + escapeHtml(topic)).join(' ')}</p>` : ''}${item.error ? `<p class="analytics-error">${escapeHtml(item.error)}</p>` : ''}${item.resultUrl && /^https:\/\//.test(item.resultUrl) ? `<a class="button button-secondary" href="${escapeHtml(item.resultUrl)}" target="_blank" rel="noreferrer">查看已发布文章</a>` : ''}</div></details>`).join('')}</div><nav class="analytics-pagination" aria-label="文章分页">${content.page > 1 ? `<a class="button button-secondary" href="/analytics?account=${account.id}&page=${content.page - 1}">上一页</a>` : ''}<span>第 ${content.page} / ${content.pages} 页 · 共 ${content.total} 篇</span>${content.page < content.pages ? `<a class="button button-secondary" href="/analytics?account=${account.id}&page=${content.page + 1}">下一页</a>` : ''}</nav>` : empty('这个账号还没有文章记录', '通过会话生成的文章会在这里显示状态和正文。')}</section>`
  return shell('数据', 'analytics', `<div class="simple-page analytics-page">${heading}${profile}${platformView}${local}</div>`, { accounts }, account.id, accounts)
}

function accountDialogs(account: AccountBinding | undefined): string {
  const deleteDialog = `<dialog id="account-delete-dialog" aria-labelledby="delete-account-title" aria-describedby="delete-account-description"><form method="dialog"><h2 id="delete-account-title">删除账号绑定</h2><p>确定删除「<strong data-delete-account-name></strong>」的绑定？</p><p id="delete-account-description">删除后停止此账号的后续任务，历史记录保留。之后可重新接入。</p><p data-delete-account-error role="alert"></p><footer><button class="button button-secondary" value="cancel">取消</button><button class="button button-danger" type="button" data-confirm-delete-account>删除绑定</button></footer></form></dialog>`
  return `      <dialog id="account-onboarding" class="account-dialog connect-panel" aria-label="添加小红书账号">
        <header><div><span>接入新账号</span><h2>按步骤完成接入</h2></div><button class="icon-button" type="button" data-close-account-form aria-label="关闭接入表单">${icon('x')}</button></header>
        <div class="connect-step"><span>1</span><div><strong>扫码登录新账号</strong><p>使用小红书 App 扫码，无需退出已接入账号。</p><a class="button button-secondary" href="https://creator.xiaohongshu.com/login" data-account-login data-new-account-login target="_blank" rel="noreferrer">${icon('external-link')} 打开扫码登录页</a></div></div>
        <form id="account-form">
          <section class="connect-step"><span>2</span><div><strong>确认页面上的公开身份</strong><p>把创作服务平台可见的名称和小红书号填在这里，保存后会自动识别软件内已登录账号。</p><div class="setting-grid"><div class="field"><label for="account-name">页面显示名称</label><input id="account-name" name="displayName" placeholder="例如：devin&佳佳" required autocomplete="off"></div><div class="field"><label for="profile-id">小红书号</label><input id="profile-id" name="expectedProfileId" placeholder="例如：107818063" required autocomplete="off"></div></div></div></section>
          <section class="connect-step"><span>3</span><div><strong>定义这个账号做什么</strong><p>这些信息用于确定内容方向和写作边界。</p><div class="field"><label for="position">账号定位</label><input id="position" name="position" value="品牌日常与产品实践" required></div><div class="field"><label for="audience">主要受众</label><input id="audience" name="audience" value="关注产品体验和实用技巧的用户" required></div><div class="field"><label for="columns">内容栏目</label><textarea id="columns" name="contentColumns" rows="3" required>品牌日常\n产品体验\n使用技巧</textarea><small>每行一个栏目，用于确定内容方向。</small></div></div></section>
          <input name="profileUrl" type="hidden" value="https://creator.xiaohongshu.com/new/home"><input name="noteTone" type="hidden" value="真实、清楚、自然"><input name="commentTone" type="hidden" value="友好、具体、不夸张"><input name="bannedTopics" type="hidden" value="未核实承诺\n站外导流"><input name="dailyLimit" type="hidden" value="2">
          <p class="form-safety-note">${icon('shield-check')} 保存不会发布、评论或切换账号；只有身份匹配后才会显示“已连接”。</p><button class="button button-primary button-block" type="submit">保存账号</button>
        </form>
      </dialog>
    ${account ? `<dialog id="account-settings-dialog" class="account-dialog" aria-label="账号设置"><header><h2>账号设置</h2><button type="button" class="icon-button" data-close-account-settings aria-label="关闭账号设置">${icon('x')}</button></header>${accountCard(account)}</dialog>` : ''}
    ${deleteDialog}`
}

function interactionHistory(input: { interactions: Interaction[]; reviews: ReviewItem[]; accounts: AccountBinding[]; account: AccountBinding | undefined }): string {
  const pending = input.reviews.filter((review) => review.status === 'pending')
  const body = `<section class="interaction-layout"><div class="surface panel"><div class="section-heading"><div><h2>待人工审核</h2><p>${pending.length} 条待处理</p></div></div><div class="review-list">${pending.length ? pending.map((review) => { const account = input.accounts.find((candidate) => candidate.id === review.accountId); return `<article class="review-card"><header><span>由 ${escapeHtml(account?.displayName ?? '账号已移除')} 回复</span>${status(review.status)}</header><blockquote>${escapeHtml(review.sourceText)}</blockquote><div class="risk-list">${review.riskLabels.map((risk) => `<span>${escapeHtml(risk)}</span>`).join('')}</div><label>建议回复<textarea rows="4" data-review-text="${review.id}">${escapeHtml(review.suggestedText)}</textarea></label><footer><button class="button button-primary" data-review-action="approved" data-review-id="${review.id}">批准并排队</button><button class="button button-secondary" data-review-action="rejected" data-review-id="${review.id}">拒绝</button></footer></article>` }).join('') : empty('没有待审核内容', '敏感互动会自动暂停，不会直接发送。')}</div></div><div class="surface panel"><div class="section-heading"><div><h2>最近互动</h2><p>保留最近 100 条结果</p></div></div><div class="activity-list">${input.interactions.length ? input.interactions.map((interaction) => `<article><span class="activity-icon">${icon(interaction.kind === 'reply' ? 'corner-up-left' : 'message-circle')}</span><div><strong>${escapeHtml(statusLabel(interaction.kind))}${interaction.remoteAuthor ? ` · ${escapeHtml(interaction.remoteAuthor)}` : ''}</strong><p>${escapeHtml(interaction.body)}</p><small>${formatDate(interaction.createdAt)}</small></div>${status(interaction.status)}</article>`).join('') : empty('还没有互动记录', '任务发布后，互动结果会自动出现在这里。')}</div></div></section>`
  return body
}

type StudioPage = { revision: string; accounts: AccountBinding[]; account: AccountBinding | undefined; data: ReturnType<StudioService['state']> | null }
function studioButton(kind: string, label: string, primary = false, disabled = false): string {
  return `<button type="button" class="button button-${primary ? 'primary' : 'secondary'}" data-studio-action="${kind}" ${disabled ? 'disabled' : ''}>${escapeHtml(label)}</button>`
}
function mediaPreview(asset: MediaAsset, controls = false): string {
  return asset.mimeType === 'video/mp4' ? `<video src="/media/${asset.id}" preload="metadata" ${controls ? 'controls' : ''} aria-label="${escapeHtml(asset.filename)}"></video>` : `<img src="/media/${asset.id}" alt="${escapeHtml(asset.filename)}" loading="lazy">`
}
export function renderPublishing(input: StudioPage & { draftId?: string | undefined }): string {
  const { accounts, account, data } = input
  const heading = `<header class="simple-heading"><div><span class="eyebrow">内容创作</span><h1>发帖</h1><p>从一个想法开始，让 AI 写内容、做素材，再发布到所选账号。</p></div><a class="button button-secondary" href="/publishing${account ? `?account=${account.id}&draft=new` : ''}">＋ 新建草稿</a></header>`
  if (!account || !data) return shell('发帖', 'publishing', `<div class="simple-page">${heading}${empty('请先接入并启用账号', '请使用顶部“添加账号”；每篇草稿和发布记录都属于一个明确账号。')}</div>`, { accounts }, undefined, accounts)
  const draft = data.drafts.find(item => item.id === input.draftId) ?? (input.draftId ? undefined : data.drafts[0])
  const locked = Boolean(draft?.jobId)
  const current: Partial<PostDraft> = draft ?? { mediaKind: 'image', assetIds: [], topics: [] }
  const saved = `<section class="surface studio-presets"><label for="draft-picker">草稿与预设</label><select id="draft-picker"><option value="new">新建草稿</option>${data.drafts.map(item => `<option value="${item.id}" ${item.id === draft?.id ? 'selected' : ''}>${escapeHtml(item.name)} · ${statusLabel(item.status)}</option>`).join('')}</select>${draft ? `<span>${status(draft.status)}</span><button type="button" class="button button-ghost" data-save-copy>另存一份</button>` : ''}</section>`
  const media = `<section class="studio-media"><div class="section-heading"><div><h2>帖子素材</h2><p>图片最多 9 张；视频为 1 个 MP4。勾选后随草稿保存。</p></div></div><div class="studio-toolbar">${studioButton('image', '图片工作台生成', false, locked)}${studioButton('video', '视频工作台生成', false, locked)}<label class="button button-secondary upload-label">上传素材<input data-studio-upload type="file" accept="image/png,image/jpeg,image/webp,video/mp4" multiple ${locked ? 'disabled' : ''}></label></div><div class="media-picker">${data.assets.map(asset => `<label class="media-choice"><input type="checkbox" name="assetIds" value="${asset.id}" ${current.assetIds?.includes(asset.id) ? 'checked' : ''} ${locked ? 'disabled' : ''}>${mediaPreview(asset)}<span>${escapeHtml(asset.filename)}</span></label>`).join('') || '<p class="muted-copy">还没有素材。上传文件，或让图片、视频工作台生成。</p>'}</div></section>`
  const body = `<div class="simple-page studio-page">${heading}${saved}<div class="publishing-grid"><form id="post-draft-form" class="surface panel studio-form"><fieldset ${locked ? 'disabled' : ''}><div class="setting-grid"><label class="field">预设名称<input name="name" maxlength="80" value="${escapeHtml(current.name)}" placeholder="例如：新品体验帖"></label><label class="field">帖子类型<select name="mediaKind"><option value="image" ${current.mediaKind === 'image' ? 'selected' : ''}>图文</option><option value="video" ${current.mediaKind === 'video' ? 'selected' : ''}>视频</option></select></label></div><label class="field">创作要求<textarea name="brief" rows="3" maxlength="4000" placeholder="写什么、给谁看、语气、素材画面要求…">${escapeHtml(current.brief)}</textarea></label><div class="studio-toolbar">${studioButton('draft', 'AI 写标题和描述')}</div><label class="field">标题<input name="title" maxlength="100" value="${escapeHtml(current.title)}" placeholder="一句话说清这篇帖子的亮点"></label><label class="field">描述<textarea name="body" rows="8" maxlength="10000" placeholder="输入正文，也可以让 AI 起草…">${escapeHtml(current.body)}</textarea></label><label class="field">话题（每行一个）<textarea name="topics" rows="2">${escapeHtml(lines(current.topics ?? []))}</textarea></label></fieldset>${media}<footer class="studio-footer"><span data-studio-feedback role="status">${locked ? statusLabel(draft?.status ?? '') + ' · 内容已锁定；修改请另存一份。' : '草稿尚未修改'}</span><div class="studio-toolbar"><button type="submit" class="button button-secondary" ${locked ? 'disabled' : ''}>保存草稿</button>${studioButton('publish', draft?.status === 'succeeded' ? '已发布' : locked ? '查看 / 继续执行' : '发布帖子', true, draft?.status === 'succeeded')}</div></footer></form><aside class="surface panel post-preview"><span class="eyebrow">帖子预览</span><div data-preview-media class="preview-media">${(current.assetIds ?? []).flatMap(id => data.assets.filter(asset => asset.id === id)).map(asset => mediaPreview(asset, true)).join('') || '<span>选择素材后在这里预览</span>'}</div><div class="preview-author">${accountAvatar(account)}<strong>${escapeHtml(account.displayName)}</strong></div><h2 data-preview-title>${escapeHtml(current.title || '你的帖子标题')}</h2><p data-preview-body>${escapeHtml(current.body || '在左侧填写内容，实时预览效果。')}</p><p class="preview-topics" data-preview-topics>${escapeHtml((current.topics ?? []).map(t => '#' + t.replace(/^#/, '')).join(' '))}</p><small>预览供参考，最终排版以小红书为准。</small></aside></div><p class="studio-hint">也可以在主软件对话或日程中指定账号、主题和素材要求，让 AI 完成这些步骤。</p></div>`
  return shell('发帖', 'publishing', body, { accounts, accountId: account.id, draft: draft ?? null, state: input.revision }, account.id, accounts)
}

export function renderComments(input: StudioPage & { searchId?: string | undefined; interactions: Interaction[]; reviews: ReviewItem[] }): string {
  const { accounts, account, data } = input
  const heading = `<header class="simple-heading"><div><span class="eyebrow">发现与交流</span><h1>评论</h1><p>找到相关帖子，为每一篇写有针对性的评论。</p></div></header>`
  if (!account || !data) return shell('评论', 'comments', `<div class="simple-page">${heading}${empty('请先接入并启用账号', '请使用顶部“添加账号”；接入后可搜索、筛选帖子和管理评论。')}</div>`, { accounts }, undefined, accounts)
  const search = data.searches.find(item => item.id === input.searchId) ?? data.searches[0]
  const metric = (n: number | null) => n === null ? '—' : n.toLocaleString('zh-CN')
  const interrupted = search && ['waiting_login', 'failed'].includes(search.status)
  // Older installed versions recorded login challenges as generic failures.
  const waitingLogin = search?.status === 'waiting_login' || (search?.status === 'failed' && /登录|扫码/.test(search.error))
  const recovery = interrupted ? `<div class="studio-toolbar result-actions" role="status"><p>${waitingLogin ? '搜索网页需要单独登录。请在刚打开的账号页面完成扫码，然后继续本次搜索。已登录时直接点击继续，无需再次扫码。' : '上次搜索未完成，可以按原关键词和排序重试。'}继续只读取帖子，不发送评论。</p>${studioButton('resume-search', waitingLogin ? '扫码完成，继续搜索' : '重试搜索', true)}</div>` : ''
  const config = `<form id="post-search-form" class="surface panel studio-form"><div class="search-query-row"><label class="field">搜索关键词<input name="query" value="${escapeHtml(search?.query)}" maxlength="100" placeholder="例如：桌面收纳、户外露营" required></label><label class="field">平台排序<select name="sort">${Object.entries(searchSorts).map(([value, label]) => `<option value="${value}" ${search?.sort === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field">最多评论<input name="limit" type="number" min="1" max="20" value="${search?.limit ?? 5}" required></label></div><div class="setting-grid"><label class="field">排除词<input name="exclude" value="${escapeHtml(search?.exclude)}" maxlength="500" placeholder="例如：广告、抽奖（逗号分隔）"></label><label class="field">评论要求<textarea name="instruction" rows="2" maxlength="3000" placeholder="例如：以交流经验为主，简短自然，结尾可提一个相关问题">${escapeHtml(search?.instruction)}</textarea></label></div><footer class="studio-footer"><p class="muted-copy">通过当前账号搜索；已评论过的帖子会自动跳过。</p><div class="studio-toolbar"><button class="button button-primary" type="submit">搜索帖子</button>${studioButton('auto-comment', 'AI 自动找帖并评论')}</div></footer></form>`
  const results = `<section class="surface panel search-results"><div class="section-heading"><div><h2>相关帖子 <span class="result-count">${search?.results.length ?? 0}</span></h2><p>${search ? search.status === 'pending' ? '搜索请求已准备，请在主软件中查看 AI 的进度。' : interrupted ? escapeHtml(search.error) : `搜索“${escapeHtml(search.query)}” · ${searchSorts[search.sort]} · ${formatDate(search.updatedAt)}` : '搜索后，候选帖子会显示在这里。'}</p></div><label class="result-sort">列表排序<select data-result-sort aria-label="候选列表排序"><option value="general">原始顺序</option><option value="newest">最新</option><option value="likes">点赞数</option><option value="comments">评论数</option><option value="collections">收藏数</option></select></label></div>${recovery}${data.searches.length ? `<label class="search-history">最近搜索<select id="search-picker">${data.searches.map(item => `<option value="${item.id}" ${item.id === search?.id ? 'selected' : ''}>${escapeHtml(item.query)} · ${formatDate(item.updatedAt)}</option>`).join('')}</select></label>` : ''}<div class="studio-toolbar result-actions">${studioButton('select', 'AI 筛选并写评论', false, !search?.results.length)}${studioButton('polish', 'AI 润色已选评论', false, !search?.results.length)}<button type="button" class="button button-ghost" data-select-posts ${!search?.results.length ? 'disabled' : ''}>选择前 ${search?.limit ?? 5} 篇</button><span data-selection-count role="status">已选 ${search?.results.filter(item => item.selected).length ?? 0} 篇</span></div><div class="candidate-list">${search?.results.map((item, index) => `<article class="candidate-card" data-post-id="${escapeHtml(item.id)}" data-order="${index}" data-likes="${item.likes ?? -1}" data-comments="${item.comments ?? -1}" data-collections="${item.collections ?? -1}" data-newest="${item.publishedAt ? Date.parse(item.publishedAt) : -1}"><div class="candidate-heading"><input type="checkbox" aria-label="选择 ${escapeHtml(item.title)}" data-post-selected ${item.selected ? 'checked' : ''} ${item.jobId ? 'disabled' : ''}><div><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer" data-account-login ${account.browserProfileId ? `data-browser-profile-id="${escapeHtml(account.browserProfileId)}"` : ''}><h3>${escapeHtml(item.title)} ${icon('external-link')}</h3></a><small>${escapeHtml(item.author || '作者未知')} · ${item.publishedAt ? formatDate(item.publishedAt) : '发布时间未知'}</small></div>${item.jobId ? status(item.status) : ''}</div><p class="candidate-excerpt">${escapeHtml(item.excerpt)}</p><div class="candidate-metrics"><span>♡ ${metric(item.likes)}</span><span>评论 ${metric(item.comments)}</span><span>收藏 ${metric(item.collections)}</span></div>${item.reason ? `<p class="candidate-reason">${escapeHtml(item.reason)}</p>` : ''}<label class="field">这篇帖子的评论<textarea data-post-comment rows="2" maxlength="1000" placeholder="输入评论，或让 AI 根据原帖起草…" ${item.jobId ? 'disabled' : ''}>${escapeHtml(item.comment)}</textarea></label></article>`).join('') || empty(waitingLogin ? '等待登录后继续搜索' : interrupted ? '搜索尚未完成' : search?.status === 'ready' ? '没有找到相关帖子' : '等待搜索结果', interrupted ? '完成上方操作后，帖子会回到这个列表。' : search?.status === 'ready' ? '换一个关键词，或调整排序再试一次。' : '正在读取搜索页面，请在对话中查看进度。')}</div><footer class="studio-footer"><span data-studio-feedback role="status">评论可逐条编辑，发送后保留执行状态。</span><div class="studio-toolbar"><button class="button button-secondary" type="button" data-save-comments ${!search?.results.length ? 'disabled' : ''}>保存评论</button>${studioButton('comment', '发送选中评论', true, !search?.results.length)}</div></footer></section>`
  return shell('评论', 'comments', `<div class="simple-page studio-page">${heading}${config}${results}<details class="comment-history"><summary>评论记录与待审核回复</summary>${interactionHistory(input)}</details></div>`, { accounts, accountId: account.id, search: search ?? null, state: input.revision }, account.id, accounts)
}

export function renderBrand(input: { accounts: AccountBinding[]; brand: BrandProfile; knowledge: KnowledgeItem[]; assets: MediaAsset[] }): string {
  const body = `<div class="simple-page"><header class="simple-heading"><div><span class="eyebrow">高级设置</span><h1>内容参考</h1><p>在这里查看内容创作所需的事实、规则与素材。</p></div><a class="button button-secondary" href="/publishing">返回发帖</a></header><section class="surface panel"><h2>${escapeHtml(input.brand.name)}</h2><p class="muted-copy">${escapeHtml(input.brand.description || '暂无品牌说明')}</p><div class="reference-grid">${input.knowledge.map((item) => `<article><span>${escapeHtml(item.kind)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body)}</p></article>`).join('') || empty('没有内容参考', '没有参考资料也可以创建通用内容任务；系统不会编造产品事实。')}</div></section></div>`
  return shell('内容参考', 'publishing', body, undefined, input.accounts[0]?.id, input.accounts)
}

export function renderJobs(input: { jobs: BrowserJob[]; accounts: AccountBinding[]; audit: Array<Record<string, unknown>> }): string {
  const body = `<div class="simple-page"><header class="simple-heading"><div><span class="eyebrow">执行明细</span><h1>任务记录</h1><p>查看执行结果和错误信息，用于排查运行问题。</p></div><a class="button button-secondary" href="/publishing">返回账号</a></header><section class="surface panel"><div class="activity-list">${input.jobs.map((job) => { const account = input.accounts.find((item) => item.id === job.accountId); return `<article><span class="activity-icon">${icon('browser')}</span><div><strong>${escapeHtml(statusLabel(job.type))} · ${escapeHtml(account?.displayName ?? '账号已移除')}</strong><p>${escapeHtml(job.error ?? job.resultUrl ?? '等待执行')}</p><small>${formatDate(job.updatedAt)}</small></div>${status(job.status)}</article>` }).join('') || empty('还没有执行记录', '安排任务后，执行过程会记录在这里。')}</div></section></div>`
  return shell('任务记录', 'publishing', body, undefined, input.accounts[0]?.id, input.accounts)
}

export function renderError(title: string, message: string, statusCode: number): string {
  return shell(title, 'publishing', `<section class="error-page"><span>${statusCode}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a class="button button-primary" href="/publishing">返回账号</a></section>`)
}
