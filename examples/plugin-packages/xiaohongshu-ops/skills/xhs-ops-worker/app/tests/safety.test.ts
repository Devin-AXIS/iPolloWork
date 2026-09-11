import assert from 'node:assert/strict'
import test from 'node:test'
import { assertGeneratedContent, classifyCommentRisk, contentHash, findBannedPhrases, normalizeTopics } from '../src/safety.js'

test('classifies sensitive comments for manual review', () => {
  assert.deepEqual(classifyCommentRisk('我要投诉，你们承诺的最低价根本不是这样'), ['complaint', 'price_promise'])
  assert.deepEqual(classifyCommentRisk('这个功能怎么使用？'), [])
})

test('detects banned phrases without case sensitivity', () => {
  assert.deepEqual(findBannedPhrases('这是 BEST Product', ['best', '绝对第一']), ['best'])
})

test('requires supplied reference ids while allowing safe reference-free drafts', () => {
  assert.doesNotThrow(() => assertGeneratedContent({ title: '产品实践', body: '基于真实资料的说明', topics: ['AI'], sourceKnowledgeIds: ['fact-1'], availableKnowledgeIds: ['fact-1'], bannedPhrases: [] }))
  assert.doesNotThrow(() => assertGeneratedContent({ title: '工作方法', body: '这是一份不包含产品事实的通用流程说明', topics: ['方法'], sourceKnowledgeIds: [], availableKnowledgeIds: [], bannedPhrases: [] }))
  assert.throws(() => assertGeneratedContent({ title: '产品实践', body: '说明', topics: ['AI'], sourceKnowledgeIds: [], availableKnowledgeIds: ['fact-1'], bannedPhrases: [] }), /没有引用/)
  assert.throws(() => assertGeneratedContent({ title: '产品实践', body: '说明', topics: ['AI'], sourceKnowledgeIds: ['unknown'], availableKnowledgeIds: ['fact-1'], bannedPhrases: [] }), /不存在/)
})

test('normalizes topics and produces a stable content hash', () => {
  assert.deepEqual(normalizeTopics(['#AI', ' AI ', '工具']), ['AI', '工具'])
  const first = contentHash({ title: 'A', body: 'B', topics: ['#AI'] })
  const second = contentHash({ title: 'A ', body: 'B ', topics: ['AI'] })
  assert.equal(first, second)
})
