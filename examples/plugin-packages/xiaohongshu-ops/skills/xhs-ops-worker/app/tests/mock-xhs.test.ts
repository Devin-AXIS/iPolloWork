import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockXhsApp } from './fixtures/mock-xhs-server.js'

test('visible mock site requires four images and records publish, comment, and reply forms', async () => {
  const app = createMockXhsApp()
  const incomplete = new FormData()
  incomplete.set('title', '测试')
  incomplete.set('body', '测试正文')
  incomplete.set('topics', '#测试')
  incomplete.append('images', new File(['a'], 'one.png', { type: 'image/png' }))
  assert.equal((await app.request('/creator/publish?viewer=matrix_author', { method: 'POST', body: incomplete })).status, 400)

  const publish = new FormData()
  publish.set('title', '测试标题')
  publish.set('body', '测试正文')
  publish.set('topics', '#测试')
  for (let index = 1; index <= 4; index += 1) publish.append('images', new File([String(index)], `${index}.png`, { type: 'image/png' }))
  const published = await app.request('/creator/publish?viewer=matrix_author', { method: 'POST', body: publish })
  assert.equal(published.status, 303)

  const comment = new FormData()
  comment.set('body', '一条矩阵评论')
  assert.equal((await app.request('/note/note-1/comment?viewer=matrix_editor', { method: 'POST', body: comment })).status, 303)
  const reply = new FormData()
  reply.set('body', '作者回复')
  assert.equal((await app.request('/note/note-1/comment/comment-1/reply?viewer=matrix_author', { method: 'POST', body: reply })).status, 303)

  const state = await (await app.request('/state')).json() as { publishSubmissions: number; commentSubmissions: number; replySubmissions: number; posts: unknown[] }
  assert.deepEqual({ publish: state.publishSubmissions, comments: state.commentSubmissions, replies: state.replySubmissions, posts: state.posts.length }, { publish: 1, comments: 1, replies: 1, posts: 1 })
})
