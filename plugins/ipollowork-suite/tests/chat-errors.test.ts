import assert from 'node:assert/strict'
import test from 'node:test'
import { describeChatError } from '../src/client/chat-errors.tsx'

test('missing selection and a saved model whose adapter is gone have different recovery instructions', () => {
  const missing = describeChatError({
    code: 'UNKNOWN', message: 'agent "test" has no provider/model: set AgentOptions.provider and AgentOptions.model or record a model selection',
  }, 'zh')
  const unavailable = describeChatError({
    code: 'NO_ADAPTER', message: 'no adapter registered for provider "ipollo-official-bailian"',
  }, 'zh')
  assert.equal(missing.code, 'MODEL_NOT_SELECTED')
  assert.match(missing.message, /未选择模型/)
  assert.equal(unavailable.code, 'NO_ADAPTER')
  assert.match(unavailable.message, /切换到可用模型/)
  assert.doesNotMatch(unavailable.message, /未选择模型|ipollo-official-bailian/)
})

test('gateway outages and other common failures display recovery guidance without raw provider text', () => {
  const outage = describeChatError({
    code: 'SERVER', message: '503: {"code":"IPW_SERVICE_UNAVAILABLE","message":"provider diagnostics"}',
  }, 'zh')
  assert.equal(outage.code, 'IPW_SERVICE_UNAVAILABLE')
  assert.match(outage.message, /暂时不可用/)
  for (const [code, action] of [
    ['AUTH', /API 密钥/], ['RATE_LIMIT', /稍等/], ['TIMEOUT', /超时/],
    ['CONTEXT_WINDOW_EXCEEDED', /新建对话/], ['ACCOUNT_QUOTA', /额度/],
    ['TRANSPORT', /检查网络/], ['UNKNOWN', /错误代码/],
  ] as const) {
    const result = describeChatError({ code, message: 'provider diagnostics' }, 'zh')
    assert.match(result.message, action)
    assert.doesNotMatch(result.message, /provider diagnostics/)
  }
})
