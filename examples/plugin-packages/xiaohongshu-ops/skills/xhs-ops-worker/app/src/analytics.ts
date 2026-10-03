import type { PlatformSnapshot } from './types.js'

export const analyticsCsvHeader = '类型,小红书号,标题,链接,粉丝数,阅读量,点赞数,收藏数,评论数'

// Accept quoted CSV fields (including commas/newlines) without changing identifiers.
export function parsePlatformCsv(csv: string, profileId: string): PlatformSnapshot {
  if (csv.length > 500_000) throw new Error('CSV 不能超过 500 KB')
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false, closed = false
  const input = csv.replace(/^\uFEFF/, '')
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++ }
      else if (char === '"') { quoted = false; closed = true }
      else field += char
    } else if (char === '"' && !field && !closed) quoted = true
    else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field.trim()); field = ''; closed = false
      if (char !== ',') {
        if (row.some(Boolean)) rows.push(row)
        row = []
        if (char === '\r' && input[i + 1] === '\n') i++
      }
    } else {
      if (closed || char === '"') throw new Error('CSV 引号格式不正确')
      field += char
    }
  }
  if (quoted) throw new Error('CSV 引号未闭合')
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row)
  if (rows.shift()?.join(',') !== analyticsCsvHeader) throw new Error('CSV 表头不匹配，请使用本页下载的模板')
  if (!rows.length || rows.length > 201) throw new Error('请导入账号数据或文章数据，每次最多 200 篇文章')
  const snapshot: PlatformSnapshot = { importedAt: new Date().toISOString(), followers: null, likes: null, collections: null, articles: [] }
  const metric = (value: string): number | null => {
    if (!value) return null
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('指标必须是非负整数；未知数据请留空')
    return Number(value)
  }
  let accountSeen = false
  const urls = new Set<string>()
  for (const cells of rows) {
    if (cells.length !== 9) throw new Error('每行必须有 9 列，请检查 CSV 格式')
    const [kind = '', id = '', title = '', address = '', followers = '', views = '', likes = '', collections = '', comments = ''] = cells
    if (id !== profileId) throw new Error('CSV 中的小红书号与当前所选账号不一致')
    if (kind === '账号') {
      if (accountSeen) throw new Error('账号汇总只能有一行')
      accountSeen = true
      snapshot.followers = metric(followers); snapshot.likes = metric(likes); snapshot.collections = metric(collections)
    } else if (kind === '文章') {
      let url: URL | null = null
      if (address) {
        try { url = new URL(address) } catch { throw new Error('文章链接无效') }
        if (url.protocol !== 'https:' || !['www.xiaohongshu.com', 'xiaohongshu.com', 'creator.xiaohongshu.com', 'xhslink.com'].includes(url.hostname) || url.username || url.password) throw new Error('文章链接必须来自小红书')
        if (urls.has(url.href)) throw new Error('CSV 中有重复文章链接')
        urls.add(url.href)
      }
      if (!title || title.length > 200 || address.length > 2000) throw new Error('请检查文章标题和链接长度')
      snapshot.articles.push({ title, url: url?.href ?? '', views: metric(views), likes: metric(likes), collections: metric(collections), comments: metric(comments) })
    } else throw new Error('类型只能填写“账号”或“文章”')
  }
  if (snapshot.articles.length > 200) throw new Error('每次最多导入 200 篇文章')
  return snapshot
}
