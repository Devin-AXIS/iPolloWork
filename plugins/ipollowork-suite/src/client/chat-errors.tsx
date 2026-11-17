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
  ['ACCOUNT_SIGNED_OUT', 'stopped'], ['INTERRUPTED', 'interrupted'],
])

export function describeChatError(failure: { code?: string; message: string }, locale: string) {
  let code = failure.code
  // Older native turns stored missing selections as an UNKNOWN error.
  if ((!code || code === 'UNKNOWN') && /has no provider\/model: set AgentOptions\.provider and AgentOptions\.model/.test(failure.message))
    code = 'MODEL_NOT_SELECTED'
  // pi-ai can wrap the gateway's structured response in an HTTP error.
  const gateway = /^\d{3}:?\s+\{\s*(?:"error"\s*:\s*\{\s*)?"code"\s*:\s*"([A-Z_]+)"/.exec(failure.message)?.[1]
  if ((!code || code === 'SERVER' || code.startsWith('HTTP_')) && gateway && category.has(gateway)) code = gateway
  const kind = code === 'MODEL_NOT_SELECTED' ? 'noModel' : category.get(code ?? '') ??
    (code && /^HTTP_5\d\d$/.test(code) ? 'service' : 'unknown')
  return {
    message: copy[kind][locale === 'zh' ? 0 : 1],
    code: code && /^[A-Z][A-Z0-9_/-]{0,63}$/.test(code) && code !== 'INTERRUPTED' ? code : undefined,
  }
}

export function mountChatErrors(ctx: ClientContext): void {
  const readLanguage = () => language(ctx)
  const subscribe = (listener: () => void) => ctx.locale.subscribe(listener)
  function ChatError({ node, t }: ChatNodeViewProps<'turn-error'>) {
    const locale = useSyncExternalStore(subscribe, readLanguage, readLanguage)
    const { message, code } = describeChatError(node.data, locale)
    const stopped = node.data.code === 'ACCOUNT_SIGNED_OUT' || node.data.code === 'INTERRUPTED'
    return <div className="ipw-chat-error" role="status">
      <strong>{t(stopped ? 'message.taskStopped' : 'message.turnError')}</strong>
      <span>{message}</span>
      {code && <code>{code}</code>}
    </div>
  }
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'turn-error', priority: -100, locale: 'chat',
  }, ChatError))
}
