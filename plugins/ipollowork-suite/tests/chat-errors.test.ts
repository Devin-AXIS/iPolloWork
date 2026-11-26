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

test('only confirmed diagnostics determine the cause and upstream status', () => {
  const requestId = 'dd7e905d-b9b0-405a-8e74-f54943ecaf61'
  const report = (code: string, upstreamStatus?: unknown) => describeChatError({
    code: 'SERVER', message: '503: ' + JSON.stringify({ error: { code, requestId, upstreamStatus, message: 'private secret' } }),
  }, 'zh')
  assert.match(report('IPW_MODEL_GATEWAY_CONNECTION_FAILED').message, /连接 iPolloWork 模型网关失败/)
  assert.match(report('IPW_MODEL_PROXY_FAILED').message, /转发模型请求时出错/)
  assert.match(report('IPW_MODEL_STREAM_INTERRUPTED').message, /响应中途断开/)
  assert.match(report('SERVICE_CALL_UNKNOWN').message, /未能确认/)
  const rejected = report('SERVICE_UPSTREAM_REJECTED', 401)
  assert.equal(rejected.requestId, requestId)
  assert.equal(rejected.upstreamStatus, 401)
  assert.match(rejected.message, /上游未接受服务的身份验证/)
  assert.doesNotMatch(rejected.message, /private secret/)
  assert.equal(report('SERVICE_UPSTREAM_REJECTED', '401').upstreamStatus, undefined)
  assert.match(report('SERVICE_UPSTREAM_REJECTED').message, /上游拒绝了请求/)
  assert.equal(report('IPW_MODEL_STREAM_INTERRUPTED', 401).upstreamStatus, undefined)
})

test('gateway outages and other common failures display recovery guidance without raw provider text', () => {
  const outage = describeChatError({
    code: 'SERVER', message: '503: {"code":"IPW_SERVICE_UNAVAILABLE","message":"provider diagnostics"}',
  }, 'zh')
  assert.equal(outage.code, 'IPW_SERVICE_UNAVAILABLE')
  assert.match(outage.message, /暂时不可用/)
  for(const [code,description] of [['SERVICE_DRAINING',/正在重启/],['IPW_INVALID_RESPONSE',/异常响应/]] as const){
    const result=describeChatError({code:'SERVER',message:`503: {"code":"${code}","message":"private provider diagnostic"}`},'zh')
    assert.equal(result.code,code)
    assert.match(result.message,description)
    assert.doesNotMatch(result.message,/private provider diagnostic/)
  }
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
