import { useSyncExternalStore } from 'react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ClientContext } from './native.ts'
import { language } from './locale.ts'

const copy = {
  noModel: ['未选择模型。请在输入框底部选择模型后重新发送。', 'No model selected. Choose a model in the composer and send again.'],
  modelUnavailable: ['当前对话的模型不可用。请在输入框底部切换到可用模型后重新发送。', 'The selected model is unavailable. Choose an available model in the composer and send again.'],
  sourceChanged: ['此对话仍在使用官方模型，但服务已切换到自有密钥。请在输入框底部选择用自有密钥配置的模型，或在服务连接中恢复官方服务。', 'This conversation uses an official model, but the service now uses your own API key. Choose a model configured with your key, or restore the official service in Service connections.'],
  missingKey: ['模型缺少 API 密钥。请在模型设置中配置密钥，或切换到已配置的模型。', 'The model is missing an API key. Add one in model settings or choose a configured model.'],
  auth: ['模型服务拒绝了认证。请在模型设置中检查 API 密钥是否有效。', 'The model service rejected authentication. Check the API key in model settings.'],
  signIn: ['账号登录已失效或需要登录。请登录后重新发送。', 'Sign in to your account and send again.'],
  forbidden: ['当前账号无权使用所选模型。请选择有权限的模型，或联系服务管理员。', 'Your account does not have access to the selected model. Choose a model you can access or contact the service administrator.'],
  quota: ['模型服务的积分或用量额度已用完。请检查余额，或切换到有可用额度的模型。', 'Model credits or usage quota are exhausted. Check your balance or choose a model with available quota.'],
  rateLimit: ['模型服务请求过于频繁。请稍等片刻再发送。', 'The model service is rate limiting requests. Wait a moment and send again.'],
  context: ['当前对话超出了模型的上下文长度。请缩短消息、减少附件，或新建对话后重试。', 'This conversation exceeds the model’s context limit. Shorten the message, remove attachments, or start a new conversation.'],
  modelSwitch: ['切换模型时整理对话历史失败。请尝试上下文容量更大的模型，或新建对话后继续。', 'Could not prepare the conversation history for the new model. Try a model with a larger context window or start a new conversation.'],
  input: ['当前模型无法处理这条消息的内容或附件。请调整输入，或选择支持该内容的模型。', 'The selected model cannot process this message or its attachments. Adjust the input or choose a model that supports it.'],
  timeout: ['模型服务响应超时。请稍后重试，或切换模型。', 'The model service timed out. Try again later or choose another model.'],
  network: ['连接模型服务时网络中断。请检查网络连接后重试。', 'The connection to the model service was interrupted. Check your network and try again.'],
  service: ['模型服务暂时不可用。请稍后重试，或切换到其他可用模型。', 'The model service is temporarily unavailable. Try again later or choose another available model.'],
  draining: ['模型网关正在重启。已完成的文件会保留，请稍后点击继续生成。', 'The model gateway is restarting. Saved files are retained; try continuing later.'],
  gatewayResponse: ['模型网关返回了异常响应。已完成的文件会保留，请稍后继续。', 'The model gateway returned an invalid response. Saved files are retained; try continuing later.'],
  gatewayConnection: ['连接 iPolloWork 模型网关失败。请稍后继续。', 'Could not connect to the iPolloWork model gateway. Try continuing later.'],
  gatewayTimeout: ['等待 iPolloWork 模型网关响应超时。请稍后继续。', 'The iPolloWork model gateway did not respond in time. Try continuing later.'],
  proxyFailure: ['iPolloWork 在转发模型请求时出错。请凭请求编号联系管理员。', 'iPolloWork could not forward the model request. Share the request ID with your administrator.'],
  gatewayFailure: ['iPolloWork 模型网关处理请求时出错。请凭请求编号联系管理员。', 'The iPolloWork model gateway could not process the request. Share the request ID with your administrator.'],
  gatewayBusy: ['iPolloWork 模型网关当前繁忙。请稍后继续。', 'The iPolloWork model gateway is busy. Try continuing later.'],
  queueTimeout: ['模型请求在 iPolloWork 网关排队超时。请稍后继续。', 'The model request timed out while waiting in the iPolloWork gateway queue. Try continuing later.'],
  streamInterrupted: ['模型响应中途断开，未能接回剩余输出。可以从已完成的步骤继续。', 'The model response was interrupted and the remaining output could not be recovered. You can continue from the completed steps.'],
  replayMismatch: ['无法核对已保存的模型输出，已停止接续。可以从已完成的步骤继续。', 'The saved model output could not be verified, so recovery stopped. You can continue from the completed steps.'],
  upstreamRejected: ['模型上游拒绝了请求。请切换模型，或凭请求编号联系管理员。', 'The upstream model service rejected the request. Switch models or share the request ID with your administrator.'],
  upstreamAuth: ['模型上游未接受服务的身份验证。请联系管理员检查服务凭证，或切换模型。', 'The upstream model service did not accept authentication. Ask an administrator to check the service credentials or switch models.'],
  upstreamForbidden: ['模型上游拒绝访问。请联系管理员核对服务权限，或切换模型。', 'The upstream model service denied access. Ask an administrator to check the service permissions or switch models.'],
  upstreamMissing: ['模型上游找不到请求的资源。请联系管理员核对模型和服务地址。', 'The upstream model service could not find the requested resource. Ask an administrator to check the model and service URL.'],
  upstreamInput: ['模型上游判定请求无效。请切换模型，或凭请求编号联系管理员。', 'The upstream model service reported that the request was invalid. Switch models or share the request ID with your administrator.'],
  upstreamConnection: ['iPolloWork 模型网关未能与上游建立连接。请稍后继续，或切换模型。', 'The iPolloWork model gateway could not establish an upstream connection. Try continuing later or switch models.'],
  outcomeUnknown: ['模型服务未能确认这次调用是否完成。系统未重新提交，请先查看已完成的输出。', 'The model service could not confirm whether the call completed. It was not resubmitted. Check any completed output before continuing.'],
  callRunning: ['模型网关仍将这次调用标记为进行中。请稍后查看。', 'The model gateway still marks this call as running. Check again later.'],
  callFailed: ['模型网关已记录本次调用失败。可以从已完成的步骤继续。', 'The model gateway recorded this call as failed. You can continue from the completed steps.'],
  resultUnavailable: ['模型调用已完成，但保存的输出已无法取回。可以从已完成的步骤继续。', 'The model call completed, but its saved output is unavailable. You can continue from the completed steps.'],
  serviceUnconfigured: ['此模型服务缺少配置。请联系管理员，或切换模型。', 'This model service is missing configuration. Contact your administrator or switch models.'],
  serviceDatabase: ['模型网关的数据库暂时不可用。请稍后继续。', 'The model gateway database is temporarily unavailable. Try continuing later.'],
  stopped: ['账号已退出登录，本轮已停止。请重新登录后继续。', 'This turn stopped because you signed out. Sign in again to continue.'],
  interrupted: ['应用在本轮完成前退出。你可以重新发送消息。', 'The app closed before this turn finished. You can send your message again.'],
  unknown: ['本轮未能完成。请重新发送消息；如果仍然失败，可凭错误代码联系管理员。', 'This turn could not finish. Send your message again. If it still fails, share the error code with your administrator.'],
} as const

const category = new Map<string, keyof typeof copy>([
  ['NO_ADAPTER', 'modelUnavailable'], ['UNKNOWN_MODEL', 'modelUnavailable'],
  ['MODEL_UNSUPPORTED', 'modelUnavailable'], ['IPW_OFFICIAL_MODEL_UNAVAILABLE', 'modelUnavailable'],
  ['IPW_OFFICIAL_MODEL_SOURCE_CHANGED', 'sourceChanged'],
  ['MISSING_CREDENTIAL', 'missingKey'], ['AUTH', 'auth'],
  ['INVALID_CREDENTIAL', 'auth'], ['HTTP_401', 'auth'],
  ['ACCOUNT_SIGN_IN_REQUIRED', 'signIn'], ['ACCOUNT_TOKEN_INVALID', 'signIn'],
  ['IPW_SIGN_IN_REQUIRED', 'signIn'], ['IPW_ACCOUNT_CHANGED', 'signIn'],
  ['HTTP_403', 'forbidden'], ['IPW_CLOUD_MODEL_FORBIDDEN', 'forbidden'],
  ['QUOTA', 'quota'], ['ACCOUNT_QUOTA', 'quota'], ['INSUFFICIENT_POINTS', 'quota'],
  ['RATE_LIMIT', 'rateLimit'], ['HTTP_429', 'rateLimit'],
  ['CONTEXT_WINDOW_EXCEEDED', 'context'], ['MODEL_SWITCH_COMPACTION_FAILED', 'modelSwitch'],
  ['UNSUPPORTED_CONTENT', 'input'],
  ['IPW_MODEL_REQUEST_TOO_LARGE', 'input'], ['HTTP_413', 'input'],
  ['TIMEOUT', 'timeout'], ['HTTP_408', 'timeout'], ['HTTP_504', 'timeout'],
  ['TRANSPORT', 'network'], ['STREAM_CLOSED', 'network'],
  ['SERVER', 'service'], ['EMPTY_RESPONSE', 'service'], ['MALFORMED_RESPONSE', 'service'],
  ['IPW_SERVICE_UNAVAILABLE', 'service'], ['IPW_MODEL_REGISTRATION_FAILED', 'service'],
  ['SERVICE_DRAINING', 'draining'], ['SERVICE_BUSY', 'gatewayBusy'], ['SERVICE_QUEUE_TIMEOUT', 'queueTimeout'],
  ['IPW_INVALID_RESPONSE', 'gatewayResponse'],
  ['IPW_MODEL_GATEWAY_CONNECTION_FAILED', 'gatewayConnection'], ['IPW_MODEL_GATEWAY_TIMEOUT', 'gatewayTimeout'],
  ['IPW_MODEL_PROXY_FAILED', 'proxyFailure'], ['INTERNAL_ERROR', 'gatewayFailure'],
  ['IPW_MODEL_STREAM_INTERRUPTED', 'streamInterrupted'], ['IPW_MODEL_REPLAY_MISMATCH', 'replayMismatch'],
  ['SERVICE_UPSTREAM_REJECTED', 'upstreamRejected'], ['SERVICE_UPSTREAM_CONNECTION_FAILED', 'upstreamConnection'],
  ['SERVICE_OUTCOME_UNKNOWN', 'outcomeUnknown'], ['SERVICE_CALL_UNKNOWN', 'outcomeUnknown'],
  ['SERVICE_CALL_RUNNING', 'callRunning'], ['SERVICE_CALL_FAILED', 'callFailed'], ['SERVICE_CALL_SUCCEEDED', 'resultUnavailable'],
  ['SERVICE_UNCONFIGURED', 'serviceUnconfigured'], ['DATABASE_UNAVAILABLE', 'serviceDatabase'],
  ['SERVICE_MODEL_UNAVAILABLE', 'modelUnavailable'], ['SERVICE_RATE_LIMITED', 'rateLimit'],
  ['SERVICE_PLAN_REQUIRED', 'forbidden'], ['CLOUD_MODEL_FORBIDDEN', 'forbidden'], ['SERVICE_ORGANIZATION_CONTEXT_REQUIRED', 'forbidden'],
  ['ACCOUNT_SIGNED_OUT', 'stopped'], ['INTERRUPTED', 'interrupted'],
])

function gatewayDiagnostic(message: string) {
  if (message.length > 2048 || !/^(?:\d{3}:?\s+)?\{/.test(message)) return undefined
  try {
    const body = JSON.parse(message.replace(/^\d{3}:?\s+/, '')) as Record<string, unknown> | null
    const candidate = body?.error && typeof body.error === 'object' ? body.error : body
    if (!candidate || !('code' in candidate) || typeof candidate.code !== 'string' || !category.has(candidate.code)) return undefined
    const requestId = 'requestId' in candidate && typeof candidate.requestId === 'string'
      && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(candidate.requestId) ? candidate.requestId : undefined
    const status = 'upstreamStatus' in candidate ? candidate.upstreamStatus : undefined
    const upstreamStatus = typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined
    return { code: candidate.code, requestId, upstreamStatus }
  } catch (_malformedDiagnostic) {
    return undefined // Older providers may prefix malformed or unstructured diagnostic text.
  }
}

export function describeChatError(failure: { code?: string; message: string }, locale: string) {
  let code = failure.code
  // Older native turns stored missing selections as an UNKNOWN error.
  if ((!code || code === 'UNKNOWN') && /has no provider\/model: set AgentOptions\.provider and AgentOptions\.model/.test(failure.message))
    code = 'MODEL_NOT_SELECTED'
  // pi-ai can wrap the gateway's structured response in an HTTP error.
  const gateway = gatewayDiagnostic(failure.message)
  if ((!code || code === 'SERVER' || code.startsWith('HTTP_')) && gateway) code = gateway.code
  const diagnostic = gateway?.code === code ? gateway : undefined
  const upstreamStatus = code === 'SERVICE_UPSTREAM_REJECTED' || code === 'SERVICE_OUTCOME_UNKNOWN' || code === 'SERVICE_RATE_LIMITED'
    ? diagnostic?.upstreamStatus : undefined
  let kind = code === 'MODEL_NOT_SELECTED' ? 'noModel' : category.get(code ?? '') ??
    (code && /^HTTP_5\d\d$/.test(code) ? 'service' : 'unknown')
  if (kind === 'upstreamRejected') {
    if (upstreamStatus === 401) kind = 'upstreamAuth'
    if (upstreamStatus === 403) kind = 'upstreamForbidden'
    if (upstreamStatus === 404) kind = 'upstreamMissing'
    if (upstreamStatus === 400 || upstreamStatus === 422) kind = 'upstreamInput'
  }
  return {
    message: copy[kind][locale === 'zh' ? 0 : 1],
    code: code && /^[A-Z][A-Z0-9_/-]{0,63}$/.test(code) && code !== 'INTERRUPTED' ? code : undefined,
    requestId: diagnostic?.requestId,
    upstreamStatus,
  }
}

export function mountChatErrors(ctx: ClientContext): void {
  const readLanguage = () => language(ctx)
  const subscribe = (listener: () => void) => ctx.locale.subscribe(listener)
  function ChatError({ node, t }: ChatNodeViewProps<'turn-error'>) {
    const locale = useSyncExternalStore(subscribe, readLanguage, readLanguage)
    const { message, code, requestId, upstreamStatus } = describeChatError(node.data, locale)
    const stopped = node.data.code === 'ACCOUNT_SIGNED_OUT' || node.data.code === 'INTERRUPTED'
    return <div className="ipw-chat-error" role="status">
      <strong>{t(stopped ? 'message.taskStopped' : 'message.turnError')}</strong>
      <span>{message}</span>
      {code && <code title={requestId}>{code}{upstreamStatus && ` · HTTP ${upstreamStatus}`}{requestId && ` · ${requestId.slice(0, 8)}`}</code>}
    </div>
  }
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'turn-error', priority: -100, locale: 'chat',
  }, ChatError))
}
