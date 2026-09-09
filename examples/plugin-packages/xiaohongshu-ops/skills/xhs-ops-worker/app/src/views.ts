import type { AccountBinding, BrandProfile, BrowserJob, Campaign, ContentItem, Interaction, KnowledgeItem, MediaAsset, PlatformSnapshot, ReviewItem } from './types.js'
import type { OpsDatabase } from './db.js'

type Nav = 'tasks' | 'accounts' | 'interactions' | 'analytics'
type BoardColumn = 'draft' | 'scheduled' | 'running' | 'completed'

const assetVersion = '20260909.5'

function escapeHtml(value: unknown): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function jsonScript(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

function formatDate(value: string | null, includeTime = true): string {
  if (!value) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
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
    ['tasks', '/tasks', 'layout-kanban', '任务'],
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
      <a class="brand-mark" href="/tasks" aria-label="小红书运营台">小红书</a>
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

function accountAvatar(account: AccountBinding, className = ''): string {
  return `<span class="account-avatar ${className}" aria-hidden="true">${escapeHtml(account.displayName.slice(0, 1) || account.handle.slice(0, 1) || '小')}</span>`
}

function accountBar(accounts: AccountBinding[], selectedAccount?: AccountBinding): string {
  const primary = selectedAccount ?? accounts[0]
  const label = primary ? `${accountAvatar(primary)}<span><strong>${escapeHtml(primary.displayName)}</strong><small>${primary.sessionStatus === 'healthy' ? '<b></b> 已连接' : escapeHtml(statusLabel(primary.sessionStatus))}</small></span>${icon('chevron-down')}` : ''
  return `<section class="account-bar" aria-label="当前账号">
    ${selectedAccount ? `<form class="account-switcher" action="/analytics" method="get">${label}<select class="account-switcher-select" name="account" aria-label="切换数据账号" data-analytics-account>${accounts.map(item => `<option value="${item.id}" ${item.id === selectedAccount.id ? 'selected' : ''}>${escapeHtml(item.displayName)} · ${escapeHtml(item.expectedProfileId)}</option>`).join('')}</select></form>` : primary ? `<a class="account-switcher" href="/accounts">${label}</a>` : '<a class="account-switcher is-empty" href="/accounts">还没有账号</a>'}
    <a class="add-account-link" href="/accounts?connect=1">${icon('plus')}<span>添加账号</span></a>
  </section>`
}

function boardColumn(campaign: Campaign, content: ContentItem[], jobs: BrowserJob[]): BoardColumn {
  if (campaign.status === 'completed') return 'completed'
  if (campaign.status === 'draft' || campaign.status === 'paused') return 'draft'
  const campaignContent = content.filter((item) => item.campaignId === campaign.id)
  if (campaign.schedule.kind === 'single' && campaignContent.some((item) => item.status === 'published')) return 'completed'
  const contentIds = new Set(campaignContent.map((item) => item.id))
  const isRunning = campaignContent.some((item) => ['generating', 'publishing'].includes(item.status))
    || jobs.some((job) => job.contentItemId && contentIds.has(job.contentItemId) && ['dispatched', 'running'].includes(job.status))
  return isRunning ? 'running' : 'scheduled'
}

function campaignSchedule(campaign: Campaign): { badge: string; detail: string } {
  if (campaign.schedule.kind === 'weekly') {
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const days = campaign.schedule.weekdays.map((day) => dayNames[day]).join('、')
    return { badge: `${days} ${campaign.schedule.publishTime ?? ''}`, detail: `每周循环 · ${campaign.schedule.publishTime ?? ''}` }
  }
  const value = campaign.schedule.scheduledLocal ? new Date(`${campaign.schedule.scheduledLocal}:00+08:00`).toISOString() : null
  return { badge: value ? formatDate(value) : '未安排', detail: value ? `计划 ${formatDate(value)}` : `创建于 ${formatDate(campaign.createdAt, false)}` }
}

function taskCard(campaign: Campaign, accounts: AccountBinding[], content: ContentItem[], jobs: BrowserJob[], column: BoardColumn): string {
  const account = accounts.find((item) => campaign.accountIds.includes(item.id))
  const schedule = campaignSchedule(campaign)
  const campaignContent = content.filter((item) => item.campaignId === campaign.id)
  const failed = campaignContent.find((item) => ['failed', 'missed'].includes(item.status))
  const published = campaignContent.filter((item) => item.status === 'published').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  const running = campaignContent.find((item) => ['generating', 'publishing'].includes(item.status))
  const draggable = column === 'draft' || column === 'scheduled'
  const columnLabel: Record<BoardColumn, string> = { draft: '草稿', scheduled: '已安排', running: '执行中', completed: '已完成' }
  const meta = column === 'completed' ? `完成于 ${formatDate(published?.publishedAt ?? campaign.updatedAt, false)}`
    : column === 'running' ? (running?.status === 'generating' ? '正在生成内容' : '浏览器正在执行')
      : schedule.detail
  return `<article class="task-card${failed ? ' has-error' : ''}" data-task-card data-campaign-id="${campaign.id}" data-board-column="${column}" draggable="${draggable}">
    <header>${account ? accountAvatar(account, 'is-small') : '<span class="account-avatar is-small">?</span>'}<div><strong>${escapeHtml(campaign.name)}</strong><span>${escapeHtml(campaign.theme)}</span></div>
      <button class="icon-button task-menu-button" type="button" data-task-menu aria-label="任务操作">${icon('dots')}</button>
    </header>
    <div class="task-card-status">${column === 'completed' ? `<span class="task-pill is-success">${icon('circle-check')} 已完成</span>` : column === 'running' ? `<span class="task-pill is-running">${icon('loader-2')} 执行中</span>` : column === 'scheduled' ? `<span class="task-pill is-scheduled">${escapeHtml(schedule.badge)}</span>` : '<span class="task-pill">未安排</span>'}</div>
    ${failed ? `<p class="task-error">${icon('alert-circle')} ${escapeHtml(failed.error ?? '任务需要检查')}</p>` : ''}
    <footer><span>${escapeHtml(meta)}</span>${draggable ? `<span class="drag-hint">${icon('grip-vertical')} 拖动调整</span>` : ''}</footer>
    <div class="task-menu" hidden>
      ${column === 'draft' ? `<button type="button" data-move-campaign="active">${icon('calendar-plus')} 移到已安排</button>` : ''}
      ${column === 'scheduled' ? `<button type="button" data-move-campaign="paused">${icon('pencil')} 移回草稿</button>` : ''}
      ${column !== 'completed' ? `<button type="button" data-move-campaign="completed">${icon('circle-check')} 标记完成</button>` : ''}
      ${published?.resultUrl ? `<a href="${escapeHtml(published.resultUrl)}" target="_blank" rel="noreferrer">${icon('external-link')} 打开结果</a>` : ''}
      <span class="menu-caption">当前：${columnLabel[column]}</span>
    </div>
  </article>`
}

function weekdayChecks(): string {
  return [['1', '周一'], ['2', '周二'], ['3', '周三'], ['4', '周四'], ['5', '周五'], ['6', '周六'], ['0', '周日']]
    .map(([value, label]) => `<label class="day-check"><input type="checkbox" name="weekdays" value="${value}"><span>${label}</span></label>`).join('')
}

export function renderTasks(input: { accounts: AccountBinding[]; campaigns: Campaign[]; content: ContentItem[]; jobs: BrowserJob[]; knowledge: KnowledgeItem[]; assets: MediaAsset[] }): string {
  const grouped: Record<BoardColumn, Campaign[]> = { draft: [], scheduled: [], running: [], completed: [] }
  for (const campaign of input.campaigns) grouped[boardColumn(campaign, input.content, input.jobs)].push(campaign)
  const attention = input.campaigns.filter((campaign) => {
    const account = input.accounts.find((item) => campaign.accountIds.includes(item.id))
    return !account || account.sessionStatus !== 'healthy' || input.content.some((item) => item.campaignId === campaign.id && ['failed', 'missed'].includes(item.status))
  }).slice(0, 3)
  const columns: Array<[BoardColumn, string]> = [['draft', '草稿'], ['scheduled', '已安排'], ['running', '执行中'], ['completed', '已完成']]
  const healthyAccounts = input.accounts.filter((account) => account.enabled && account.sessionStatus === 'healthy')
  const body = `<div class="workspace-shell">
    <section class="workspace-content">
      ${accountBar(input.accounts)}
      <header class="task-heading"><div><h1>任务看板</h1><p>按状态管理和安排你的内容任务</p></div><div class="heading-actions"><button class="button button-secondary" type="button" data-toggle-filter>${icon('filter')} 筛选</button><button class="button button-primary" type="button" data-open-task-panel>${icon('plus')} 新建任务</button></div></header>
      <section class="filter-bar" hidden data-filter-bar><label>查看账号<select data-account-filter><option value="">全部账号</option>${input.accounts.map((account) => `<option value="${account.id}">${escapeHtml(account.displayName)}</option>`).join('')}</select></label><label>任务状态<select data-status-filter><option value="">全部状态</option>${columns.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><button class="button button-ghost" type="button" data-clear-filter>清除筛选</button></section>
      ${attention.length ? `<section class="attention-strip"><strong>${icon('alert-circle')} 需要处理</strong><span>${attention.length} 个任务需要内容或账号设置</span><div>${attention.map((campaign) => `<button type="button" data-focus-campaign="${campaign.id}">${escapeHtml(campaign.name)} ${icon('chevron-right')}</button>`).join('')}</div></section>` : ''}
      <section class="kanban-board" aria-label="任务看板">
        ${columns.map(([column, label]) => `<section class="kanban-column" data-drop-column="${column}"><header><strong>${label}</strong><span>${grouped[column].length}</span>${column === 'draft' || column === 'scheduled' ? `<button class="icon-button" type="button" data-open-task-panel aria-label="在${label}中新建任务">${icon('plus')}</button>` : ''}</header><div class="kanban-stack">${grouped[column].map((campaign) => taskCard(campaign, input.accounts, input.content, input.jobs, column)).join('') || empty(`还没有${label}任务`, column === 'draft' ? '新任务会先保存在这里。' : '任务状态变化后会自动出现在这里。')}</div></section>`).join('')}
      </section>
    </section>
    <aside class="task-drawer" id="task-panel" aria-labelledby="task-panel-title" aria-hidden="true">
      <header><div><h2 id="task-panel-title">新建任务</h2><p>按步骤创建并安排内容任务</p></div><button class="icon-button" type="button" data-close-task-panel aria-label="关闭新建任务">${icon('x')}</button></header>
      <form id="campaign-form" class="task-form">
        <section class="task-form-section"><div class="step-heading"><span>1</span><h3>做什么</h3></div><div class="field"><label for="campaign-name">任务名称</label><input id="campaign-name" name="name" placeholder="例如：每周产品技巧" required></div><div class="field"><label for="campaign-theme">内容说明</label><textarea id="campaign-theme" name="theme" rows="3" placeholder="写清楚这次要讲什么，系统会结合账号定位生成内容" required></textarea></div><fieldset><legend>内容方向</legend><div class="direction-grid" data-direction-grid><button type="button" data-direction="品牌日常">${icon('calendar-event')}<span>品牌日常</span></button><button type="button" data-direction="产品体验">${icon('cube')}<span>产品体验</span></button><button type="button" data-direction="使用技巧" class="is-selected">${icon('bulb')}<span>使用技巧</span></button></div><input type="hidden" name="direction" value="使用技巧"></fieldset></section>
        <section class="task-form-section"><div class="step-heading"><span>2</span><h3>哪个账号</h3></div><fieldset><legend>发布账号</legend><div class="account-choice-list">${input.accounts.map((account, index) => `<label><input type="radio" name="accountId" value="${account.id}" ${index === 0 ? 'checked' : ''}><span>${accountAvatar(account, 'is-small')}<strong>${escapeHtml(account.displayName)}</strong><small>${escapeHtml(account.position)}</small></span>${status(account.sessionStatus)}</label>`).join('') || '<a class="empty-account-link" href="/accounts?connect=1">先接入账号</a>'}</div></fieldset></section>
        <section class="task-form-section"><div class="step-heading"><span>3</span><h3>什么时候</h3></div><fieldset><legend>安排方式</legend><div class="segmented"><label><input type="radio" name="scheduleKind" value="weekly" checked><span>每周循环</span></label><label><input type="radio" name="scheduleKind" value="single"><span>单次发布</span></label></div></fieldset><div data-weekly-schedule><fieldset><legend>重复于</legend><div class="weekday-grid">${weekdayChecks()}</div></fieldset><div class="field"><label for="publish-time">发布时间</label><div class="input-with-icon">${icon('clock')}<input id="publish-time" name="publishTime" type="time" value="10:00"></div></div></div><div data-single-schedule hidden class="field"><label for="scheduled-local">发布时间</label><input id="scheduled-local" name="scheduledLocal" type="datetime-local"></div></section>
        <details class="optional-settings"><summary>素材与互动设置（可选）${icon('chevron-right')}</summary><div><p>默认不安排账号互动；需要时可选择其他已接入账号。</p><fieldset><legend>互动账号</legend><div class="compact-check-list">${input.accounts.map((account) => `<label><input type="checkbox" name="commentAccountIds" value="${account.id}"><span>${escapeHtml(account.displayName)}</span></label>`).join('') || '<span>暂无账号</span>'}</div></fieldset></div></details>
        <p class="form-safety-note">${icon('shield-check')} 创建任务不会立即发布。只有已连接的账号才会进入执行。${healthyAccounts.length ? '' : ' 当前没有已连接账号，请先保存草稿，再到账号页登录。'}</p>
        <footer><button class="button button-secondary" type="submit" name="intent" value="draft">保存草稿</button><button class="button button-primary" type="submit" name="intent" value="active" ${healthyAccounts.length ? '' : 'disabled'}>创建并安排任务</button></footer>
      </form>
    </aside>
    <button class="drawer-backdrop" type="button" data-close-task-panel aria-label="关闭新建任务" hidden></button>
  </div>`
  return shell('任务看板', 'tasks', body, { accounts: input.accounts, knowledgeIds: input.knowledge.map((item) => item.id), assetIds: input.assets.map((item) => item.id) })
}

function accountCard(account: AccountBinding): string {
  const ready = account.enabled && account.sessionStatus === 'healthy'
  return `<article class="account-card surface">
    <header>${accountAvatar(account)}<div><div><strong>${escapeHtml(account.displayName)}</strong>${status(account.sessionStatus)}</div><span>小红书号 ${escapeHtml(account.expectedProfileId)}</span></div><button class="icon-button" type="button" data-toggle-account-details aria-label="展开账号设置">${icon('chevron-down')}</button></header>
    <div class="account-summary-grid"><div><span>账号定位</span><strong>${escapeHtml(account.position)}</strong></div><div><span>内容栏目</span><p>${account.contentColumns.map((column) => `<b>${escapeHtml(column)}</b>`).join('') || '<b>待设置</b>'}</p></div><div><span>执行状态</span><strong class="${ready ? 'is-ready' : 'is-warning'}">${ready ? '可以安排任务' : '登录后即可安排任务'}</strong></div></div>
    ${account.lastError ? `<p class="account-error">${icon('alert-circle')} ${escapeHtml(account.lastError)}</p>` : ''}
    <div class="account-actions"><a class="button button-secondary" href="https://creator.xiaohongshu.com/new/home" data-account-login target="_blank" rel="noreferrer">${icon('external-link')} 打开创作台</a></div>
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
    ${content.items.length ? `<div class="analytics-articles">${content.items.map(item => `<details class="analytics-article"><summary><span>${escapeHtml(item.title || '待生成文章')}</span>${status(item.status)}<small>${formatDate(item.publishedAt || item.scheduledAt)}</small></summary><div><p class="analytics-body">${escapeHtml(item.body || '正文尚未生成。')}</p>${item.topics.length ? `<p>${item.topics.map(topic => '#' + escapeHtml(topic)).join(' ')}</p>` : ''}${item.error ? `<p class="analytics-error">${escapeHtml(item.error)}</p>` : ''}${item.resultUrl && /^https:\/\//.test(item.resultUrl) ? `<a class="button button-secondary" href="${escapeHtml(item.resultUrl)}" target="_blank" rel="noreferrer">查看已发布文章</a>` : ''}</div></details>`).join('')}</div><nav class="analytics-pagination" aria-label="文章分页">${content.page > 1 ? `<a class="button button-secondary" href="/analytics?account=${account.id}&page=${content.page - 1}">上一页</a>` : ''}<span>第 ${content.page} / ${content.pages} 页 · 共 ${content.total} 篇</span>${content.page < content.pages ? `<a class="button button-secondary" href="/analytics?account=${account.id}&page=${content.page + 1}">下一页</a>` : ''}</nav>` : empty('这个账号还没有文章记录', '在任务页创建内容后，文章状态和正文会显示在这里。', '<a class="button button-secondary" href="/tasks">查看任务</a>')}</section>`
  return shell('数据', 'analytics', `<div class="simple-page analytics-page">${accountBar(accounts, account)}${heading}${profile}${platformView}${local}</div>`, { accounts })
}

export function renderAccounts(accounts: AccountBinding[]): string {
  const body = `<div class="account-page">
    <header class="simple-heading"><div><span class="eyebrow">账号管理</span><h1>先接入账号，再安排内容</h1><p>扫码登录、确认公开身份、定义账号定位，三件事完成后就能在任务看板中使用。</p></div><button class="button button-primary" type="button" data-open-account-form>${icon('plus')} 接入账号</button></header>
    <section class="onboarding-overview" aria-label="账号接入步骤"><div class="is-current"><span>1</span><strong>扫码登录</strong><small>在小红书页面完成</small></div><i></i><div><span>2</span><strong>确认身份</strong><small>只记录公开信息</small></div><i></i><div><span>3</span><strong>定义账号</strong><small>定位与内容栏目</small></div><i></i><div><span>4</span><strong>自动连接</strong><small>返回后自动识别</small></div></section>
    <section class="accounts-layout"><div class="account-list"><header><h2>已接入账号</h2><span>${accounts.length} 个账号</span></header>${accounts.length ? accounts.map(accountCard).join('') : empty('还没有账号', '点击“接入账号”，按照引导完成第一个账号。', '<button class="button button-primary" data-open-account-form>开始接入</button>')}</div>
      <aside id="account-onboarding" class="connect-panel surface" ${accounts.length ? 'hidden' : ''}>
        <header><div><span>接入新账号</span><h2>按步骤完成接入</h2></div><button class="icon-button" type="button" data-close-account-form aria-label="关闭接入表单">${icon('x')}</button></header>
        <div class="connect-step"><span>1</span><div><strong>打开创作服务平台并扫码</strong><p>登录和验证码都在小红书页面完成，运营台不会读取 Cookie、密码或验证码。</p><a class="button button-secondary" href="https://creator.xiaohongshu.com/new/home" data-account-login target="_blank" rel="noreferrer">${icon('external-link')} 打开创作服务平台</a></div></div>
        <form id="account-form">
          <section class="connect-step"><span>2</span><div><strong>确认页面上的公开身份</strong><p>把创作服务平台可见的名称和小红书号填在这里，保存后会自动识别软件内已登录账号。</p><div class="setting-grid"><div class="field"><label for="account-name">页面显示名称</label><input id="account-name" name="displayName" placeholder="例如：devin&佳佳" required autocomplete="off"></div><div class="field"><label for="profile-id">小红书号</label><input id="profile-id" name="expectedProfileId" placeholder="例如：107818063" required autocomplete="off"></div></div></div></section>
          <section class="connect-step"><span>3</span><div><strong>定义这个账号做什么</strong><p>这些信息会成为之后新建任务时的内容目录和写作边界。</p><div class="field"><label for="position">账号定位</label><input id="position" name="position" value="品牌日常与产品实践" required></div><div class="field"><label for="audience">主要受众</label><input id="audience" name="audience" value="关注产品体验和实用技巧的用户" required></div><div class="field"><label for="columns">内容栏目</label><textarea id="columns" name="contentColumns" rows="3" required>品牌日常\n产品体验\n使用技巧</textarea><small>每行一个栏目，创建任务时可直接选择。</small></div></div></section>
          <details class="optional-settings"><summary>高级设置${icon('chevron-right')}</summary><div><input name="handle" type="hidden"><input name="profileUrl" type="hidden" value="https://creator.xiaohongshu.com/new/home"><div class="field"><label>独立 Codex 任务 ID<input name="workerThreadId"><small>若已有账号专属 Worker 可在此绑定；不填写时会在登录后自动绑定当前会话。</small></label></div><input name="noteTone" type="hidden" value="真实、清楚、自然"><input name="commentTone" type="hidden" value="友好、具体、不夸张"><input name="bannedTopics" type="hidden" value="未核实承诺\n站外导流"><input name="dailyLimit" type="hidden" value="2"></div></details>
          <p class="form-safety-note">${icon('shield-check')} 保存不会发布、评论或切换账号；只有身份匹配后才会显示“已连接”。</p><button class="button button-primary button-block" type="submit">保存账号</button>
        </form>
      </aside>
    </section>
  </div>`
  return shell('账号管理', 'accounts', body, { accounts })
}

export function renderInteractions(input: { interactions: Interaction[]; reviews: ReviewItem[]; accounts: AccountBinding[] }): string {
  const pending = input.reviews.filter((review) => review.status === 'pending')
  const body = `<div class="simple-page">${accountBar(input.accounts)}<header class="simple-heading"><div><span class="eyebrow">互动</span><h1>只处理需要人工判断的内容</h1><p>常规互动保留记录；投诉、隐私、价格承诺等敏感内容会停在这里等待确认。</p></div></header><section class="interaction-layout"><div class="surface panel"><div class="section-heading"><div><h2>待人工审核</h2><p>${pending.length} 条待处理</p></div></div><div class="review-list">${pending.length ? pending.map((review) => { const account = input.accounts.find((candidate) => candidate.id === review.accountId); return `<article class="review-card"><header><span>由 ${escapeHtml(account?.displayName ?? '账号已移除')} 回复</span>${status(review.status)}</header><blockquote>${escapeHtml(review.sourceText)}</blockquote><div class="risk-list">${review.riskLabels.map((risk) => `<span>${escapeHtml(risk)}</span>`).join('')}</div><label>建议回复<textarea rows="4" data-review-text="${review.id}">${escapeHtml(review.suggestedText)}</textarea></label><footer><button class="button button-primary" data-review-action="approved" data-review-id="${review.id}">批准并排队</button><button class="button button-secondary" data-review-action="rejected" data-review-id="${review.id}">拒绝</button></footer></article>` }).join('') : empty('没有待审核内容', '敏感互动会自动暂停，不会直接发送。')}</div></div><div class="surface panel"><div class="section-heading"><div><h2>最近互动</h2><p>保留最近 100 条结果</p></div></div><div class="activity-list">${input.interactions.length ? input.interactions.map((interaction) => `<article><span class="activity-icon">${icon(interaction.kind === 'reply' ? 'corner-up-left' : 'message-circle')}</span><div><strong>${escapeHtml(statusLabel(interaction.kind))}${interaction.remoteAuthor ? ` · ${escapeHtml(interaction.remoteAuthor)}` : ''}</strong><p>${escapeHtml(interaction.body)}</p><small>${formatDate(interaction.createdAt)}</small></div>${status(interaction.status)}</article>`).join('') : empty('还没有互动记录', '任务发布后，互动结果会自动出现在这里。')}</div></div></section></div>`
  return shell('互动', 'interactions', body)
}

export function renderDashboard(input: { counts: Record<string, number>; accounts: AccountBinding[]; campaigns: Campaign[]; content: ContentItem[]; jobs: BrowserJob[]; reviews: ReviewItem[]; runtime: { codexAvailable: boolean; wakeLockEnabled: boolean } }): string {
  return renderTasks({ accounts: input.accounts, campaigns: input.campaigns, content: input.content, jobs: input.jobs, knowledge: [], assets: [] })
}

export function renderCalendar(input: { accounts: AccountBinding[]; knowledge: KnowledgeItem[]; assets: MediaAsset[]; campaigns: Campaign[]; content: ContentItem[] }): string {
  return renderTasks({ ...input, jobs: [] })
}

export function renderBrand(input: { brand: BrandProfile; knowledge: KnowledgeItem[]; assets: MediaAsset[] }): string {
  const body = `<div class="simple-page"><header class="simple-heading"><div><span class="eyebrow">高级设置</span><h1>内容参考</h1><p>这里保留事实、规则与素材管理，但它不再是创建任务的必填步骤。</p></div><a class="button button-secondary" href="/tasks">返回任务</a></header><section class="surface panel"><h2>${escapeHtml(input.brand.name)}</h2><p class="muted-copy">${escapeHtml(input.brand.description || '暂无品牌说明')}</p><div class="reference-grid">${input.knowledge.map((item) => `<article><span>${escapeHtml(item.kind)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body)}</p></article>`).join('') || empty('没有内容参考', '没有参考资料也可以创建通用内容任务；系统不会编造产品事实。')}</div></section></div>`
  return shell('内容参考', 'tasks', body)
}

export function renderJobs(input: { jobs: BrowserJob[]; accounts: AccountBinding[]; audit: Array<Record<string, unknown>> }): string {
  const body = `<div class="simple-page"><header class="simple-heading"><div><span class="eyebrow">执行明细</span><h1>任务记录</h1><p>这是供排障使用的执行明细，普通运营只需要查看任务看板。</p></div><a class="button button-secondary" href="/tasks">返回任务</a></header><section class="surface panel"><div class="activity-list">${input.jobs.map((job) => { const account = input.accounts.find((item) => item.id === job.accountId); return `<article><span class="activity-icon">${icon('browser')}</span><div><strong>${escapeHtml(statusLabel(job.type))} · ${escapeHtml(account?.displayName ?? '账号已移除')}</strong><p>${escapeHtml(job.error ?? job.resultUrl ?? '等待执行')}</p><small>${formatDate(job.updatedAt)}</small></div>${status(job.status)}</article>` }).join('') || empty('还没有执行记录', '安排任务后，执行过程会记录在这里。')}</div></section></div>`
  return shell('任务记录', 'tasks', body)
}

export function renderError(title: string, message: string, statusCode: number): string {
  return shell(title, 'tasks', `<section class="error-page"><span>${statusCode}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a class="button button-primary" href="/tasks">返回任务</a></section>`)
}
