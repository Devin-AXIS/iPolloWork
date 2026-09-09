import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { pathToFileURL } from 'node:url'

interface MockReply { id: string; author: string; body: string }
interface MockComment { id: string; author: string; body: string; replies: MockReply[] }
interface MockPost {
  id: string
  author: string
  title: string
  body: string
  topics: string
  imageNames: string[]
  comments: MockComment[]
}

const identities = new Map([
  ['matrix_author', { handle: 'matrix_author', profileId: 'profile-author', displayName: '矩阵产品号' }],
  ['matrix_editor', { handle: 'matrix_editor', profileId: 'profile-editor', displayName: '矩阵编辑号' }],
  ['real_reader', { handle: 'real_reader', profileId: 'profile-reader', displayName: '普通读者' }],
  ['wrong_account', { handle: 'wrong_account', profileId: 'profile-wrong', displayName: '错误账号' }],
])

function escapeHtml(value: unknown): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function identity(viewer: string | undefined) {
  return identities.get(viewer ?? '') ?? identities.get('wrong_account') as { handle: string; profileId: string; displayName: string }
}

function layout(title: string, viewer: string, body: string): string {
  const current = identity(viewer)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} | 小红书可见页面模拟器</title><style>
  :root{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#171918;background:#f5f5f2}*{box-sizing:border-box}body{margin:0}header{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;background:#fff;border-bottom:1px solid #ddd}.logo{font-weight:800;color:#ef3f5b}.identity{display:flex;gap:18px;font-size:14px}.identity strong{color:#1669df}main{max-width:920px;margin:34px auto;padding:0 24px}.card{background:#fff;border:1px solid #ddd;border-radius:18px;padding:24px;margin-bottom:18px;box-shadow:0 8px 28px rgba(0,0,0,.04)}h1{margin:0 0 8px;font-size:32px}h2{font-size:20px}p{line-height:1.7}label{display:grid;gap:7px;margin:14px 0;font-weight:650}input,textarea{width:100%;border:1px solid #cfd2ce;border-radius:10px;padding:11px;font:inherit}button{border:0;border-radius:10px;padding:11px 18px;background:#286ddd;color:white;font-weight:700}.meta{color:#68706a}.images{display:flex;gap:8px;flex-wrap:wrap}.images span{padding:7px 10px;background:#eef2ec;border-radius:8px}.comment{border-top:1px solid #eee;padding:16px 0}.reply{margin:10px 0 0 24px;padding:10px;background:#f3f5f1;border-radius:10px}
  </style></head><body><header><div class="logo">小红书创作服务 · 模拟</div><div class="identity" aria-label="当前登录身份"><span>当前账号 <strong id="current-handle">@${escapeHtml(current.handle)}</strong></span><span>主页 ID <strong id="current-profile-id">${escapeHtml(current.profileId)}</strong></span><span>${escapeHtml(current.displayName)}</span></div></header><main>${body}</main></body></html>`
}

function values(value: string | File | Array<string | File> | undefined): Array<string | File> {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}

export function createMockXhsApp() {
  const app = new Hono()
  const posts: MockPost[] = []
  let publishSubmissions = 0
  let commentSubmissions = 0
  let replySubmissions = 0

  app.get('/', (c) => c.redirect(`/creator?viewer=${encodeURIComponent(c.req.query('viewer') ?? 'matrix_author')}`))

  app.get('/creator', (c) => {
    const viewer = c.req.query('viewer') ?? 'wrong_account'
    const current = identity(viewer)
    return c.html(layout('发布笔记', viewer, `<section class="card"><p class="meta">这是测试专用的可见网页，不连接真实小红书。</p><h1>发布图文笔记</h1>
      <form method="post" action="/creator/publish?viewer=${encodeURIComponent(current.handle)}" enctype="multipart/form-data">
        <label>图片素材<input id="note-images" name="images" type="file" accept="image/png,image/jpeg,image/webp" multiple required></label>
        <label>标题<input id="note-title" name="title" maxlength="120" required></label>
        <label>正文<textarea id="note-body" name="body" rows="8" required></textarea></label>
        <label>话题<input id="note-topics" name="topics" required></label>
        <button id="publish-submit" type="submit">确认发布</button>
      </form></section>`))
  })

  app.post('/creator/publish', async (c) => {
    const viewer = c.req.query('viewer') ?? 'wrong_account'
    const current = identity(viewer)
    const body = await c.req.parseBody({ all: true })
    const imageNames = values(body.images).flatMap((item) => item instanceof File ? [item.name] : [])
    const title = String(values(body.title)[0] ?? '').trim()
    const noteBody = String(values(body.body)[0] ?? '').trim()
    const topics = String(values(body.topics)[0] ?? '').trim()
    if (!title || !noteBody || !topics || imageNames.length < 4) return c.text('图文内容不完整', 400)
    publishSubmissions += 1
    const post: MockPost = { id: `note-${posts.length + 1}`, author: current.handle, title, body: noteBody, topics, imageNames, comments: [] }
    posts.push(post)
    return c.redirect(`/note/${post.id}?viewer=${encodeURIComponent(current.handle)}`, 303)
  })

  app.get('/note/:id', (c) => {
    const viewer = c.req.query('viewer') ?? 'wrong_account'
    const current = identity(viewer)
    const post = posts.find((item) => item.id === c.req.param('id'))
    if (!post) return c.text('笔记不存在', 404)
    const comments = post.comments.length ? post.comments.map((comment) => `<article class="comment" id="${escapeHtml(comment.id)}" data-comment-id="${escapeHtml(comment.id)}"><strong>@${escapeHtml(comment.author)}</strong><p>${escapeHtml(comment.body)}</p>
      ${comment.replies.map((reply) => `<div class="reply" data-reply-id="${escapeHtml(reply.id)}"><strong>@${escapeHtml(reply.author)}</strong> ${escapeHtml(reply.body)}</div>`).join('')}
      ${current.handle === post.author ? `<form method="post" action="/note/${encodeURIComponent(post.id)}/comment/${encodeURIComponent(comment.id)}/reply?viewer=${encodeURIComponent(current.handle)}"><label>回复这条评论<input name="body" required></label><button type="submit">发送回复</button></form>` : ''}</article>`).join('') : '<p id="empty-comments" class="meta">还没有评论</p>'
    return c.html(layout(post.title, viewer, `<article class="card" data-note-id="${escapeHtml(post.id)}"><p class="meta">作者 @${escapeHtml(post.author)} · 发布成功</p><h1>${escapeHtml(post.title)}</h1><p id="published-body">${escapeHtml(post.body)}</p><p id="published-topics">${escapeHtml(post.topics)}</p><div class="images" aria-label="已上传图片">${post.imageNames.map((name) => `<span>${escapeHtml(name)}</span>`).join('')}</div></article>
      <section class="card"><h2>评论</h2><div id="comment-list">${comments}</div>
      ${current.handle !== post.author ? `<form method="post" action="/note/${encodeURIComponent(post.id)}/comment?viewer=${encodeURIComponent(current.handle)}"><label>发表评论<textarea id="comment-body" name="body" rows="3" required></textarea></label><button id="comment-submit" type="submit">发送评论</button></form>` : ''}</section>`))
  })

  app.post('/note/:id/comment', async (c) => {
    const viewer = c.req.query('viewer') ?? 'wrong_account'
    const current = identity(viewer)
    const post = posts.find((item) => item.id === c.req.param('id'))
    if (!post) return c.text('笔记不存在', 404)
    const body = await c.req.parseBody()
    const text = String(body.body ?? '').trim()
    if (!text) return c.text('评论不能为空', 400)
    commentSubmissions += 1
    post.comments.push({ id: `comment-${post.comments.length + 1}`, author: current.handle, body: text, replies: [] })
    return c.redirect(`/note/${post.id}?viewer=${encodeURIComponent(current.handle)}#comment-${post.comments.length}`, 303)
  })

  app.post('/note/:id/comment/:commentId/reply', async (c) => {
    const viewer = c.req.query('viewer') ?? 'wrong_account'
    const current = identity(viewer)
    const post = posts.find((item) => item.id === c.req.param('id'))
    const comment = post?.comments.find((item) => item.id === c.req.param('commentId'))
    if (!post || !comment) return c.text('评论不存在', 404)
    const body = await c.req.parseBody()
    const text = String(body.body ?? '').trim()
    if (!text) return c.text('回复不能为空', 400)
    replySubmissions += 1
    comment.replies.push({ id: `reply-${replySubmissions}`, author: current.handle, body: text })
    return c.redirect(`/note/${post.id}?viewer=${encodeURIComponent(current.handle)}#${comment.id}`, 303)
  })

  app.get('/state', (c) => c.json({ publishSubmissions, commentSubmissions, replySubmissions, posts }))
  return app
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.MOCK_XHS_PORT ?? '4792', 10)
  const app = createMockXhsApp()
  serve({ fetch: app.fetch, hostname: '127.0.0.1', port })
  process.stdout.write(`Mock XHS visible site: http://127.0.0.1:${port}\n`)
}
