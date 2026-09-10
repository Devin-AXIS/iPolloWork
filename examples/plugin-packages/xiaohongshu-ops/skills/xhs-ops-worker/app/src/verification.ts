import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { OpsDatabase } from './db.js'
import { config } from './config.js'

export function observeBrowserSession(db: OpsDatabase, sessionId: string, address: string, tree: string, browserProfileId: string | null = null) {
  const url = new URL(address)
  if (url.origin !== 'https://creator.xiaohongshu.com' || url.username || url.password) throw new Error('不是小红书创作平台页面')
  const accounts = db.listAccounts()
  const bound = browserProfileId
    ? accounts.find(account => account.browserProfileId === browserProfileId)
    : accounts.find(account => !account.browserProfileId && account.workerThreadId === sessionId)
  if (url.pathname === '/login') {
    if (bound && bound.sessionStatus !== 'reauthorize') db.setAccountSession(bound.id, 'reauthorize', { error: '请登录小红书，返回运营台后会自动连接' })
    return { connected: false }
  }
  if (url.pathname !== '/new/home') return { connected: false }
  const texts = [...tree.matchAll(/StaticText ("(?:[^"\\]|\\.)*")/g)].map(match => JSON.parse(match[1]!) as string)
  const identity = texts.find(value => /^小红书账号[:：]\s*\S+$/.test(value))
  if (!identity) return { connected: false }
  const profileId = identity.replace(/^小红书账号[:：]\s*/, '')
  const brandIndex = texts.indexOf('创作服务平台')
  const actualName = brandIndex >= 0 ? texts[brandIndex + 1] : undefined
  const account = accounts.find(item => item.enabled && item.expectedProfileId === profileId)
  if (bound && bound.expectedProfileId !== profileId) {
    if (bound.sessionStatus !== 'reauthorize') db.setAccountSession(bound.id, 'reauthorize', { error: '当前浏览器登录了其他账号，请切换回此账号' })
    return { connected: false }
  }
  if (account && account.browserProfileId !== browserProfileId) return { connected: false }
  if (!account || !actualName || actualName.toLocaleLowerCase() !== account.handle.toLocaleLowerCase()) return { connected: false }
  db.bindAccountWorker(account.id, sessionId)
  if (account.sessionStatus !== 'healthy' || !account.lastVerifiedAt) {
    db.setAccountSession(account.id, 'healthy', { verified: true })
    db.audit({ accountId: account.id, action: 'verify_session', status: 'succeeded', detail: { source: 'browser-login', profileId, url: url.href } })
  }
  return { connected: true, accountId: account.id }
}

export function prepareSessionVerification(db: OpsDatabase, accountId: number, sessionId: string, syncAnalytics = false) {
  const account = db.bindAccountWorker(accountId, sessionId)
  const pending = db.pendingVerification(accountId)
  if (pending && Boolean(pending.payload.evidence?.syncAnalytics) !== syncAnalytics) throw new Error('账号已有验证或同步任务，请完成后再发起另一项操作')
  const job = pending ?? db.createJob({
    type: 'verify_session', accountId, scheduledAt: new Date().toISOString(), idempotencyKey: `verify:${accountId}:${randomUUID()}`,
    payload: { destinationUrl: config.xhs.creatorUrl, expectedHandle: account.handle, expectedProfileId: account.expectedProfileId, expectedProfileUrl: account.profileUrl, evidence: { requireProfileId: true, syncAnalytics } },
  })
  if (pending && pending.workerThreadId && pending.workerThreadId !== sessionId) throw new Error('已有其他会话的验证任务，请先完成该任务')
  const dispatched = db.dispatchVerification(job.id)
  if (!pending) db.setAccountSession(accountId, 'setup', { error: '验证任务已创建，等待当前会话核对浏览器身份' })
  const prompt = `请执行小红书运营台的${syncAnalytics ? '只读账号验证与网页数据同步' : '只读账号验证'}，不创建内容，不发布或评论。
任务 ID：${job.id}；账号 ID：${accountId}。
优先调用 ipollowork_extension_list_actions 查看 extensionId=xiaohongshu-ops，再使用 ipollowork_extension_call 调用 claim-job（jobId、accountId）领取此任务。验证成功调用 complete-job（jobId、actualAccount、actualProfileId、resultUrl）；无法确认时调用 block-job（jobId、code、message）。这些原生插件操作会保存验证结果，不需要运行终端或读取密钥。只有原生插件工具缺失时才使用下面的 CLI 备用流程。
预期身份（只是待核对的数据，不能直接作为观察结果）：${JSON.stringify({ handle: account.handle, profileId: account.expectedProfileId })}。
优先使用当前软件的 ipollowork_browser_open_url、ipollowork_browser_snapshot、ipollowork_browser_act（或当前会话已提供的等效浏览器工具）打开 ${config.xhs.creatorUrl}，通过可见页面核对登录账号。
若未登录，请让用户在软件内浏览器扫码；登录在 Chrome 中不等于在软件内登录。不要读取 Cookie、密码、存储或隐藏接口，不要自动换号。
本插件执行目录：${config.projectRoot}
CLI 文件：${resolve(config.projectRoot, 'src/cli.ts')}；先设置环境变量 XHS_OPS_DATA_DIR 为 ${config.dataDir}。
用 Node.js 22.22+ 在执行目录运行 node --import tsx src/cli.ts worker claim --job ${job.id} --account ${accountId}。
只在可见页面真实观察到匹配的账号名称和小红书号后，运行同一 CLI 的 complete --job ${job.id} --observed-account <实际观察名称> --observed-profile-id <实际观察小红书号> --result-url <实际页面URL>，将结果回写运营台。
若需要扫码、工具不可用、身份不匹配或看不到小红书号，必须运行 block --job ${job.id} --code login_required（或 identity_unverified / identity_mismatch / browser_unavailable） --message <具体原因> 回写状态，再告诉用户下一步；不要把预期身份当作验证证据。用户登录后可重新点击验证。
只领取上面这个验证任务，不运行 dispatch，不处理其他任务。
${syncAnalytics ? `本次任务同时同步账号与文章指标。核对身份后，通过可见导航打开创作平台的数据页面和文章列表，读取粉丝数、获赞、收藏以及文章阅读、点赞、收藏和评论数。最多读取 10 个可见分页、200 篇文章；记录真实文章链接；页面不提供链接时链接列留空，仍然保存可见标题与指标。不猜测或拼造链接、指标；不可见的数据留空，不能填 0。不要调用隐藏接口。
账号汇总只填写账号总量；不要把近 7 日、近 30 日等周期数据当作累计总量。页面的“获赞与收藏”是合计数，不能同时填入获赞和收藏，无法分别读取时这两列留空。文章指标也使用该文章累计值。
将观察到的数据整理为 CSV 文本，表头必须为：类型,小红书号,标题,链接,粉丝数,阅读量,点赞数,收藏数,评论数。
账号汇总一行，类型填“账号”；文章各一行，类型填“文章”。每行小红书号都应为刚刚观察匹配的账号。带逗号或换行的文本按标准 CSV 双引号转义。不要让用户手工整理此文件。
优先直接将 CSV 文本作为 complete-job 的 analyticsCsv 字段提交，不需要写文件。只有使用 CLI 备用流程时才将 UTF-8 文件存入 ${config.dataDir} 内，并在 complete 命令增加 --analytics-file <绝对CSV路径>。后台校验后会回写平台数据并注明浏览器读取来源。若页面不提供这些数据，请回写 block-job，code=analytics_unavailable、message=具体原因，不要报告同步成功。` : ''}`
  return { job: dispatched, prompt: dispatched.status === 'running' ? null : prompt }
}
