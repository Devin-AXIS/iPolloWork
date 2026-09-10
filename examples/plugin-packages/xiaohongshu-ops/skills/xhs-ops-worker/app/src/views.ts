import type { AccountBinding, BrandProfile, BrowserJob, Interaction, KnowledgeItem, MediaAsset, PlatformSnapshot, ReviewItem } from './types.js'
import type { OpsDatabase } from './db.js'

type Nav = 'accounts' | 'interactions' | 'analytics'

const assetVersion = '20260910.3'

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
    setup: '未登录', healthy: '已连接', blocked: '已阻断', reauthorize: '需重新登录', offline: '离线',
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

function shell(title: string, active: Nav, body: string, pageData?: unknown): string {
  const nav: Array<[Nav, string, string, string]> = [
    ['accounts', '/accounts', 'user-circle', '账号'],
    ['interactions', '/interactions', 'messages', '互动'],
    ['analytics', '/analytics', 'chart-bar', '数据'],
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
      <a class="brand-mark" href="/accounts" aria-label="小红书运营台">小红书</a>
      <nav aria-label="主要导航">${nav.map(([id, href, iconName, label]) => `<a href="${href}" ${active === id ? 'aria-current="page"' : ''}>${icon(iconName)}<span>${label}</span></a>`).join('')}</nav>
      <a class="sidebar-profile" href="/accounts" aria-label="查看账号">d</a>
    </aside>
    <main class="app-main">${body}</main>
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

function accountBar(accounts: AccountBinding[], selectedAccount?: AccountBinding): string {
  const primary = selectedAccount ?? accounts[0]
  const label = primary ? `${accountAvatar(primary)}<span><strong>${escapeHtml(primary.displayName)}</strong><small>${primary.sessionStatus === 'healthy' ? '<b></b> 已连接' : escapeHtml(statusLabel(primary.sessionStatus))}</small></span>${icon('chevron-down')}` : ''
  return `<section class="account-bar" aria-label="当前账号">
    ${selectedAccount ? `<form class="account-switcher" action="/analytics" method="get">${label}<select class="account-switcher-select" name="account" aria-label="切换数据账号" data-analytics-account>${accounts.map(item => `<option value="${item.id}" ${item.id === selectedAccount.id ? 'selected' : ''}>${escapeHtml(item.displayName)} · ${escapeHtml(item.expectedProfileId)}</option>`).join('')}</select></form>` : primary ? `<a class="account-switcher" href="/accounts">${label}</a>` : '<a class="account-switcher is-empty" href="/accounts">还没有账号</a>'}
    <a class="add-account-link" href="/accounts?connect=1">${icon('plus')}<span>添加账号</span></a>
  </section>`
}

function accountCard(account: AccountBinding): string {
  const ready = account.enabled && account.sessionStatus === 'healthy'
  return `<article class="account-card surface" data-account-id="${account.id}">
    <header>${accountAvatar(account)}<div><div><strong>${escapeHtml(account.displayName)}</strong>${status(account.sessionStatus)}</div><span>小红书号 ${escapeHtml(account.expectedProfileId)}</span></div><button class="icon-button" type="button" data-toggle-account-details aria-label="展开账号设置">${icon('chevron-down')}</button></header>
    <div class="account-summary-grid"><div><span>账号定位</span><strong>${escapeHtml(account.position)}</strong></div><div><span>内容栏目</span><p>${account.contentColumns.map((column) => `<b>${escapeHtml(column)}</b>`).join('') || '<b>待设置</b>'}</p></div><div><span>执行状态</span><strong class="${ready ? 'is-ready' : 'is-warning'}">${ready ? '可以安排任务' : '登录后即可安排任务'}</strong></div></div>
    ${account.lastError ? `<p class="account-error">${icon('alert-circle')} ${escapeHtml(account.lastError)}</p>` : ''}
    <div class="account-actions"><a class="button button-secondary" href="https://creator.xiaohongshu.com/new/home" data-account-login ${account.browserProfileId ? `data-browser-profile-id="${escapeHtml(account.browserProfileId)}"` : ''} target="_blank" rel="noreferrer">${icon('external-link')} 打开创作台</a><button class="button button-ghost delete-account-trigger" type="button" data-delete-account="${account.id}" data-account-name="${escapeHtml(account.displayName)}">${icon('trash')} 删除绑定</button></div>
    <p class="analytics-note">${account.workerThreadId ? '已连接专属会话；登录状态由程序自动核对，无需手动验证。' : '在软件内登录此账号，返回运营台后自动连接当前会话。'}</p>
    <form class="account-edit-form" data-account-edit="${account.id}" hidden>
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
  const heading = `<header class="simple-heading"><div><span class="eyebrow">运营数据</span><h1>账号与文章数据</h1><p>按账号查看平台表现与运营台文章记录。</p></div><a class="button button-secondary" href="/accounts">管理账号</a></header>`
  if (!account || !content) return shell('数据', 'analytics', `<div class="simple-page analytics-page">${heading}${empty('还没有接入账号', '先添加账号，再查看对应的数据。', '<a class="button button-primary" href="/accounts?connect=1">接入账号</a>')}</div>`)
  const profile = `<section class="surface panel analytics-profile">${accountAvatar(account)}<div><h2>${escapeHtml(account.displayName)} ${status(account.sessionStatus)}</h2><p>小红书号 ${escapeHtml(account.expectedProfileId)} · ${account.enabled ? '已启用' : '已暂停'}</p><p>${escapeHtml(account.position)} · ${escapeHtml(account.audience)}</p></div></section>`
  const platformView = `<section class="surface panel"><div class="section-heading"><div><h2>平台数据</h2><button class="button button-primary" type="button" data-verify-account="${account.id}" data-sync-analytics>从当前账号同步</button><p>${platform ? `来源：${platform.source === 'browser' ? '浏览器可见页面' : 'CSV 导入'} · 更新于 ${formatDate(platform.importedAt)}` : '尚未同步或导入平台数据；“—”表示未知，不代表 0。'}</p></div></div><div class="analytics-metrics">${metric('粉丝数', platform?.followers)}${metric('获赞数', platform?.likes)}${metric('收藏数', platform?.collections)}${metric('已记录文章', platform ? platform.articles.length : null)}</div>
    <details class="analytics-import"><summary>导入 / 更新平台数据</summary><p>可点击“从当前账号同步”，由当前会话读取平台可见数据；首次使用可能需要在软件内扫码。也可下载模板，按列整理你获取的平台数据；导入将替换当前账号的平台数据快照，不影响运营台文章。</p><a class="button button-secondary" href="/analytics/template.csv" download>下载 CSV 模板</a><p>“类型”填账号或文章，每行填写当前小红书号。账号行填写粉丝数、点赞数、收藏数；文章行填写标题、链接、阅读量、点赞数、收藏数、评论数。未知指标及不可见的文章链接留空，最多 200 篇文章。</p><form data-analytics-import="${account.id}"><label for="analytics-csv">选择 UTF-8 CSV 文件</label><input id="analytics-csv" name="csv" type="file" accept=".csv,text/csv" required><button class="button button-primary" type="submit">导入数据</button><p role="status" data-import-status></p></form></details>
    <p class="analytics-note">网页同步仅包含已读取页面中的文章，不代表全部历史文章；看不到的指标保留为未知。</p>${platform?.articles.length ? `<div class="analytics-table" tabindex="0" aria-label="平台文章指标，可横向滚动"><table><thead><tr><th>平台文章</th><th>阅读</th><th>点赞</th><th>收藏</th><th>评论</th></tr></thead><tbody>${platform.articles.map(item => `<tr><td>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)} ${icon('external-link')}</a>` : escapeHtml(item.title)}</td>${[item.views, item.likes, item.collections, item.comments].map(value => `<td>${value == null ? '—' : value.toLocaleString('zh-CN')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="analytics-note">暂无平台文章指标。同步或导入后可查看每篇文章的阅读、点赞、收藏和评论数。</p>'}</section>`
  const counts = content.counts
  const local = `<section class="surface panel"><div class="section-heading"><div><h2>运营台文章记录</h2><p>仅统计在本运营台创建的文章，与平台历史文章分开显示。</p></div></div><div class="analytics-metrics">${metric('全部文章', content.total)}${metric('已发布', counts.published || 0)}${metric('待发布', ['planned', 'generating', 'ready', 'scheduled', 'publishing'].reduce((sum, key) => sum + (counts[key] || 0), 0))}${metric('失败 / 错过', (counts.failed || 0) + (counts.missed || 0))}</div>
    ${content.items.length ? `<div class="analytics-articles">${content.items.map(item => `<details class="analytics-article"><summary><span>${escapeHtml(item.title || '待生成文章')}</span>${status(item.status)}<small>${formatDate(item.publishedAt || item.scheduledAt)}</small></summary><div><p class="analytics-body">${escapeHtml(item.body || '正文尚未生成。')}</p>${item.topics.length ? `<p>${item.topics.map(topic => '#' + escapeHtml(topic)).join(' ')}</p>` : ''}${item.error ? `<p class="analytics-error">${escapeHtml(item.error)}</p>` : ''}${item.resultUrl && /^https:\/\//.test(item.resultUrl) ? `<a class="button button-secondary" href="${escapeHtml(item.resultUrl)}" target="_blank" rel="noreferrer">查看已发布文章</a>` : ''}</div></details>`).join('')}</div><nav class="analytics-pagination" aria-label="文章分页">${content.page > 1 ? `<a class="button button-secondary" href="/analytics?account=${account.id}&page=${content.page - 1}">上一页</a>` : ''}<span>第 ${content.page} / ${content.pages} 页 · 共 ${content.total} 篇</span>${content.page < content.pages ? `<a class="button button-secondary" href="/analytics?account=${account.id}&page=${content.page + 1}">下一页</a>` : ''}</nav>` : empty('这个账号还没有文章记录', '通过会话生成的文章会在这里显示状态和正文。')}</section>`
  return shell('数据', 'analytics', `<div class="simple-page analytics-page">${accountBar(accounts, account)}${heading}${profile}${platformView}${local}</div>`, { accounts })
}

export function renderAccounts(accounts: AccountBinding[]): string {
  const body = `<div class="account-page">
    <header class="simple-heading"><div><span class="eyebrow">账号管理</span><h1>先接入账号，再安排内容</h1><p>扫码接入并设置账号定位，在这里管理登录状态和内容方向。</p></div><button class="button button-primary" type="button" data-open-account-form>${icon('plus')} 接入账号</button></header>
    <section class="onboarding-overview" aria-label="账号接入步骤"><div class="is-current"><span>1</span><strong>扫码登录</strong><small>在小红书页面完成</small></div><i></i><div><span>2</span><strong>确认身份</strong><small>只记录公开信息</small></div><i></i><div><span>3</span><strong>定义账号</strong><small>定位与内容栏目</small></div><i></i><div><span>4</span><strong>自动连接</strong><small>返回后自动识别</small></div></section>
    <section class="accounts-layout"><div class="account-list"><header><h2>已接入账号</h2><span>${accounts.length} 个账号</span></header>${accounts.length ? accounts.map(accountCard).join('') : empty('还没有账号', '点击“接入账号”，按照引导完成第一个账号。', '<button class="button button-primary" data-open-account-form>开始接入</button>')}</div>
      <aside id="account-onboarding" class="connect-panel surface" ${accounts.length ? 'hidden' : ''}>
        <header><div><span>接入新账号</span><h2>按步骤完成接入</h2></div><button class="icon-button" type="button" data-close-account-form aria-label="关闭接入表单">${icon('x')}</button></header>
        <div class="connect-step"><span>1</span><div><strong>扫码登录新账号</strong><p>使用小红书 App 扫码，无需退出已接入账号。</p><a class="button button-secondary" href="https://creator.xiaohongshu.com/login" data-account-login data-new-account-login target="_blank" rel="noreferrer">${icon('external-link')} 打开扫码登录页</a></div></div>
        <form id="account-form">
          <section class="connect-step"><span>2</span><div><strong>确认页面上的公开身份</strong><p>把创作服务平台可见的名称和小红书号填在这里，保存后会自动识别软件内已登录账号。</p><div class="setting-grid"><div class="field"><label for="account-name">页面显示名称</label><input id="account-name" name="displayName" placeholder="例如：devin&佳佳" required autocomplete="off"></div><div class="field"><label for="profile-id">小红书号</label><input id="profile-id" name="expectedProfileId" placeholder="例如：107818063" required autocomplete="off"></div></div></div></section>
          <section class="connect-step"><span>3</span><div><strong>定义这个账号做什么</strong><p>这些信息用于确定内容方向和写作边界。</p><div class="field"><label for="position">账号定位</label><input id="position" name="position" value="品牌日常与产品实践" required></div><div class="field"><label for="audience">主要受众</label><input id="audience" name="audience" value="关注产品体验和实用技巧的用户" required></div><div class="field"><label for="columns">内容栏目</label><textarea id="columns" name="contentColumns" rows="3" required>品牌日常\n产品体验\n使用技巧</textarea><small>每行一个栏目，用于确定内容方向。</small></div></div></section>
          <input name="profileUrl" type="hidden" value="https://creator.xiaohongshu.com/new/home"><input name="noteTone" type="hidden" value="真实、清楚、自然"><input name="commentTone" type="hidden" value="友好、具体、不夸张"><input name="bannedTopics" type="hidden" value="未核实承诺\n站外导流"><input name="dailyLimit" type="hidden" value="2">
          <p class="form-safety-note">${icon('shield-check')} 保存不会发布、评论或切换账号；只有身份匹配后才会显示“已连接”。</p><button class="button button-primary button-block" type="submit">保存账号</button>
        </form>
      </aside>
    </section>
  </div>`
  const deleteDialog = `<dialog id="account-delete-dialog" aria-labelledby="delete-account-title" aria-describedby="delete-account-description"><form method="dialog"><h2 id="delete-account-title">删除账号绑定</h2><p>确定删除「<strong data-delete-account-name></strong>」的绑定？</p><p id="delete-account-description">删除后停止此账号的后续任务，历史记录保留。之后可重新接入。</p><p data-delete-account-error role="alert"></p><footer><button class="button button-secondary" value="cancel">取消</button><button class="button button-danger" type="button" data-confirm-delete-account>删除绑定</button></footer></form></dialog>`
  return shell('账号管理', 'accounts', body + deleteDialog, { accounts })
}

export function renderInteractions(input: { interactions: Interaction[]; reviews: ReviewItem[]; accounts: AccountBinding[] }): string {
  const pending = input.reviews.filter((review) => review.status === 'pending')
  const body = `<div class="simple-page">${accountBar(input.accounts)}<header class="simple-heading"><div><span class="eyebrow">互动</span><h1>只处理需要人工判断的内容</h1><p>常规互动保留记录；投诉、隐私、价格承诺等敏感内容会停在这里等待确认。</p></div></header><section class="interaction-layout"><div class="surface panel"><div class="section-heading"><div><h2>待人工审核</h2><p>${pending.length} 条待处理</p></div></div><div class="review-list">${pending.length ? pending.map((review) => { const account = input.accounts.find((candidate) => candidate.id === review.accountId); return `<article class="review-card"><header><span>由 ${escapeHtml(account?.displayName ?? '账号已移除')} 回复</span>${status(review.status)}</header><blockquote>${escapeHtml(review.sourceText)}</blockquote><div class="risk-list">${review.riskLabels.map((risk) => `<span>${escapeHtml(risk)}</span>`).join('')}</div><label>建议回复<textarea rows="4" data-review-text="${review.id}">${escapeHtml(review.suggestedText)}</textarea></label><footer><button class="button button-primary" data-review-action="approved" data-review-id="${review.id}">批准并排队</button><button class="button button-secondary" data-review-action="rejected" data-review-id="${review.id}">拒绝</button></footer></article>` }).join('') : empty('没有待审核内容', '敏感互动会自动暂停，不会直接发送。')}</div></div><div class="surface panel"><div class="section-heading"><div><h2>最近互动</h2><p>保留最近 100 条结果</p></div></div><div class="activity-list">${input.interactions.length ? input.interactions.map((interaction) => `<article><span class="activity-icon">${icon(interaction.kind === 'reply' ? 'corner-up-left' : 'message-circle')}</span><div><strong>${escapeHtml(statusLabel(interaction.kind))}${interaction.remoteAuthor ? ` · ${escapeHtml(interaction.remoteAuthor)}` : ''}</strong><p>${escapeHtml(interaction.body)}</p><small>${formatDate(interaction.createdAt)}</small></div>${status(interaction.status)}</article>`).join('') : empty('还没有互动记录', '任务发布后，互动结果会自动出现在这里。')}</div></div></section></div>`
  return shell('互动', 'interactions', body)
}

export function renderBrand(input: { brand: BrandProfile; knowledge: KnowledgeItem[]; assets: MediaAsset[] }): string {
  const body = `<div class="simple-page"><header class="simple-heading"><div><span class="eyebrow">高级设置</span><h1>内容参考</h1><p>在这里查看内容创作所需的事实、规则与素材。</p></div><a class="button button-secondary" href="/accounts">返回账号</a></header><section class="surface panel"><h2>${escapeHtml(input.brand.name)}</h2><p class="muted-copy">${escapeHtml(input.brand.description || '暂无品牌说明')}</p><div class="reference-grid">${input.knowledge.map((item) => `<article><span>${escapeHtml(item.kind)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body)}</p></article>`).join('') || empty('没有内容参考', '没有参考资料也可以创建通用内容任务；系统不会编造产品事实。')}</div></section></div>`
  return shell('内容参考', 'accounts', body)
}

export function renderJobs(input: { jobs: BrowserJob[]; accounts: AccountBinding[]; audit: Array<Record<string, unknown>> }): string {
  const body = `<div class="simple-page"><header class="simple-heading"><div><span class="eyebrow">执行明细</span><h1>任务记录</h1><p>查看执行结果和错误信息，用于排查运行问题。</p></div><a class="button button-secondary" href="/accounts">返回账号</a></header><section class="surface panel"><div class="activity-list">${input.jobs.map((job) => { const account = input.accounts.find((item) => item.id === job.accountId); return `<article><span class="activity-icon">${icon('browser')}</span><div><strong>${escapeHtml(statusLabel(job.type))} · ${escapeHtml(account?.displayName ?? '账号已移除')}</strong><p>${escapeHtml(job.error ?? job.resultUrl ?? '等待执行')}</p><small>${formatDate(job.updatedAt)}</small></div>${status(job.status)}</article>` }).join('') || empty('还没有执行记录', '安排任务后，执行过程会记录在这里。')}</div></section></div>`
  return shell('任务记录', 'accounts', body)
}

export function renderError(title: string, message: string, statusCode: number): string {
  return shell(title, 'accounts', `<section class="error-page"><span>${statusCode}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a class="button button-primary" href="/accounts">返回账号</a></section>`)
}
