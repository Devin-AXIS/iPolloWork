import { isSessionNotFound } from './session-error.mjs';
import { connectionHint, extractConnectionEvidence, messageDiagnosticError, runtimeDiagnosticDetails } from './connection-error.mjs';
import { createFailureReferenceId } from './delivery-failure-log.mjs';
import { diagnosticFields } from './diagnostic-details.mjs';

import { t } from './i18n.mjs';

const PROVIDER_FAILURES = Object.freeze({
  AUTH: 'MODEL_AUTH',
  MISSING_CREDENTIAL: 'MODEL_AUTH',
  INVALID_CREDENTIAL: 'MODEL_AUTH',
  QUOTA: 'MODEL_QUOTA',
  RATE_LIMIT: 'MODEL_RATE_LIMIT',
  CONTEXT_WINDOW_EXCEEDED: 'MODEL_CONTEXT_LIMIT',
  UNKNOWN_MODEL: 'MODEL_UNAVAILABLE',
  NO_ADAPTER: 'MODEL_UNAVAILABLE',
  UNSUPPORTED_OPTION: 'MODEL_CONFIG',
  UNSUPPORTED_REASONING_EFFORT: 'MODEL_CONFIG',
  TIMEOUT: 'MODEL_TIMEOUT',
  TRANSPORT: 'MODEL_TRANSPORT',
  SERVER: 'MODEL_SERVICE',
  STREAM_CLOSED: 'MODEL_STREAM',
  MALFORMED_RESPONSE: 'MODEL_STREAM',
  EMPTY_RESPONSE: 'MODEL_EMPTY_REPLY',
  CONTENT_FILTER: 'MODEL_CONTENT_REJECTED',
  UNSUPPORTED_CONTENT: 'MODEL_CONFIG',
});

// 提交超时（stage=prompt.submit 且 harness-timeout）单列文案：与「已提交、结果
// 未知」区分，明确「提交请求本身超时、是否送达未知」，避免用户误以为任务已运行。
const PROMPT_SUBMIT_UNCONFIRMED_MESSAGE =
  '消息提交请求超时，未能确认消息是否已送达 DSH。请稍后到 DSH 查看该会话状态，不要立即重复提交；若持续发生，请将参考号提供给管理员。';

const FAILURE_MESSAGES = Object.freeze({
  HARNESS_INTERACTION_TIMEOUT:
    '与 DSH 的交互通道在 30 秒内未就绪，本条消息尚未提交执行。请稍后重试。',
  HARNESS_CONNECT:
    '无法连接处理服务，消息尚未提交。请确认 DeepSeek Harness 正在运行后重试。',
  HARNESS_TIMEOUT:
    '处理服务响应超时，消息尚未开始处理。请稍后重试。',
  HARNESS_RESULT_UNCERTAIN:
    '暂时无法确认任务状态，任务可能已经开始。请先等待或发送 /stop，不要立即重复提交。',
  HARNESS_ACCESS:
    '处理服务拒绝了机器人连接。请管理员检查 Harness 地址、代理或访问配置后重试。',
  HARNESS_PROTOCOL:
    '机器人与 DeepSeek Harness 的接口不兼容。请管理员检查 Harness 地址并更新相关版本。',
  HARNESS_SERVICE:
    'DeepSeek Harness 暂时无法完成请求，请稍后重试。',
  MODEL_REPLY_TIMEOUT:
    '等待模型回复超时，任务可能仍在运行。请先等待或发送 /stop，不要立即重复提交。',
  MODEL_AUTH:
    '模型凭据缺失或已失效。请管理员检查模型配置后重试。',
  MODEL_QUOTA:
    '模型额度或余额不足，本次任务未完成。请管理员补充额度或切换模型后重试。',
  MODEL_RATE_LIMIT:
    '模型服务正在限流，本次任务未完成。请稍后重试。',
  MODEL_CONTEXT_LIMIT:
    '当前会话内容超过模型上下文上限。请发送 /compact 或 /new 后重试。',
  MODEL_UNAVAILABLE:
    '当前模型不存在或不支持所选配置。请发送 /models，再用 /model <序号> 为当前聊天重新选择。若要修改后续新会话的默认模型，请到 DSH 设置 → IM机器人 → 对应机器人卡片修改。',
  MODEL_CONFIG:
    '当前模型不支持这类内容或所选配置。请调整内容、模型或推理等级后重试。',
  MODEL_TIMEOUT:
    '模型服务响应超时，本次任务未完成。请稍后重试。',
  MODEL_TRANSPORT:
    '暂时无法连接模型服务，本次任务未完成。请稍后重试。',
  MODEL_SERVICE:
    '模型服务暂时异常，本次任务未完成。请稍后重试。',
  MODEL_STREAM:
    '模型回复中断或格式异常，本次任务未完成。请重试。',
  MODEL_EMPTY_REPLY:
    '模型没有返回可显示的内容。请重试；若持续发生，请切换模型。',
  MODEL_CONTENT_REJECTED:
    '模型拒绝处理当前内容。请调整问题内容后重试。',
  MODEL_OUTPUT_LIMIT:
    '模型达到输出长度上限，但没有生成可显示的结果。请缩小任务范围后重试。',
  TURN_BLOCKED:
    '本轮处理被阻止，未能完成。请在 DSH 中查看会话状态和相关提示。',
  TURN_INTERRUPTED:
    '任务被意外中断，本次未完成。请重试。',
  SESSION_NOT_FOUND:
    '当前会话已不存在。请发送 /new 创建新会话后重试。',
  SESSION_UNREADABLE:
    '当前会话日志已损坏，无法继续读取。请先到 DSH 查看任务状态，再发送 /new 创建新会话；原会话记录会保留。',
  SESSION_ARCHIVED:
    '当前会话已归档，无法继续处理。有命令权限时可发送 /new 创建新会话；否则请联系管理员在 DSH 中取消归档，或为你开启命令权限。',
  SESSION_BUSY:
    '当前会话仍在处理上一项任务。请等待完成，或发送 /stop 后重试。',
  SESSION_STALE:
    '工作区或会话状态刚刚发生变化。请重新发送这条消息。',
  WORKSPACE_UNAVAILABLE:
    '当前工作区不存在或暂不可用。请重新选择工作区后重试。',
  PRESET_UNAVAILABLE:
    '当前 Agent Preset 无法使用。请发送 /presetlist 查看可用项，使用 /preset <序号或 ID> 重新选择，再发送 /new 创建新会话后重试。如需继续原会话，请联系管理员恢复原 Preset。',
  CHANNEL_PERMISSION:
    '回复已经生成，但机器人没有发送权限。请联系管理员检查渠道权限或重新绑定机器人。',
  CHANNEL_RATE_LIMIT:
    '回复已经生成，但当前渠道正在限流，暂时无法发送。请稍后重试。',
  CHANNEL_DELIVERY_UNCERTAIN:
    '回复发送结果未能确认。请先检查聊天内是否已经收到，不要立即重复提交。',
  CHANNEL_DELIVERY:
    '回复已经生成，但当前渠道暂时无法发送。请稍后重试。',
  INPUT_INVALID:
    '当前消息包含无法处理的图片或文件。请调整后重新发送。',
  REQUEST_TIMEOUT:
    '请求超时，当前操作结果尚未确认。请先检查任务状态或聊天记录，不要立即重复提交。',
  NETWORK_ERROR:
    '网络请求失败，当前操作结果尚未确认。请先检查任务状态或聊天记录，不要立即重复提交。',
  INTERNAL_UNKNOWN:
    '任务未完成，暂时无法确定原因。请重试；若持续发生，请将参考号提供给管理员。',
});

function providerFailureCode(error) {
  if (error?.code !== 'harness-turn-failed') return null;
  const value = error?.providerCode ?? error?.details?.providerCode;
  if (typeof value !== 'string') return null;
  return PROVIDER_FAILURES[value.trim().toUpperCase()] ?? null;
}

function failureCode(error, details) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const providerCode = providerFailureCode(error);
  if (providerCode) return providerCode;
  if (code === 'harness-interaction-timeout') return 'HARNESS_INTERACTION_TIMEOUT';

  const uncertain = details.submissionState === undefined
    ? ['session.prompt', 'session.history'].includes(error?.method)
    : details.submissionState !== 'not-submitted';

  if (code === 'harness-connect-failed') {
    return uncertain
      ? 'HARNESS_RESULT_UNCERTAIN'
      : 'HARNESS_CONNECT';
  }
  if (code === 'harness-timeout') {
    return uncertain
      ? 'HARNESS_RESULT_UNCERTAIN'
      : 'HARNESS_TIMEOUT';
  }
  if (code === 'harness-reply-timeout') return 'MODEL_REPLY_TIMEOUT';
  if ([
    'harness-auth-required', 'harness-proxy-auth-required',
    'harness-loopback-forbidden', 'harness-host-untrusted',
    'harness-request-forbidden',
  ].includes(code)) return 'HARNESS_ACCESS';
  if (['harness-api-not-found', 'harness-response-invalid', 'gateway/input-invalid'].includes(code)) {
    return 'HARNESS_PROTOCOL';
  }
  if (code === 'harness-turn-failed') return 'INTERNAL_UNKNOWN';
  if (['harness-http-failed', 'harness-rpc-rejected'].includes(code)) return 'HARNESS_SERVICE';
  if (code === 'model-unavailable' || code === 'session/model-unavailable') return 'MODEL_UNAVAILABLE';
  if (code === 'model-empty-response') return 'MODEL_EMPTY_REPLY';
  if (code === 'model-max-tokens') return 'MODEL_OUTPUT_LIMIT';
  if (code === 'turn-blocked') return 'TURN_BLOCKED';
  if (['turn-interrupted', 'turn-aborted'].includes(code)) return 'TURN_INTERRUPTED';
  if (isSessionNotFound(code)) return 'SESSION_NOT_FOUND';
  if (code === 'session-unreadable') return 'SESSION_UNREADABLE';
  if (code === 'session-archived') return 'SESSION_ARCHIVED';
  if (code === 'agent-busy') return 'SESSION_BUSY';
  if (code === 'workspace-session-stale') return 'SESSION_STALE';
  if (code.startsWith('workspace-')) return 'WORKSPACE_UNAVAILABLE';
  if (/^agent-preset[-/]/u.test(code)) return 'PRESET_UNAVAILABLE';
  if (code.startsWith('image-') || code.startsWith('inbound-file-')
    || code === 'attachment-error') return 'INPUT_INVALID';

  const status = Number(error?.status ?? error?.httpStatus);
  if (status === 401 || status === 403
    || [
      'channel-permission',
      'permission-required',
      'artifact-permission-required',
      'forbidden',
      'stale-token',
    ].includes(code)) {
    return 'CHANNEL_PERMISSION';
  }
  if (status === 429
    || ['channel-rate-limit', 'rate-limited', 'artifact-rate-limited'].includes(code)) {
    return 'CHANNEL_RATE_LIMIT';
  }
  if (['channel-delivery-uncertain', 'delivery-uncertain', 'artifact-delivery-uncertain']
    .includes(code) || error?.deliveryOutcome === 'unknown') {
    return 'CHANNEL_DELIVERY_UNCERTAIN';
  }
  if (code === 'channel-delivery-failed' || code.startsWith('artifact-')
    || code === 'network-error') {
    return 'CHANNEL_DELIVERY';
  }
  return 'INTERNAL_UNKNOWN';
}

// Only refine the unknown fallback, using the same allowlisted evidence as the UI.
// Mixed unrelated causes and cancellation do not establish a network diagnosis.
function transportFailureCode(error, details) {
  if (error?.name === 'AbortError' || error?.code === 'cancelled') return 'INTERNAL_UNKNOWN';
  const reasons = details.reason === 'multiple-causes' ? details.reasons : [details.reason];
  const timeout = reason => reason === 'timeout' || reason === 'ETIMEDOUT' || /_TIMEOUT$/u.test(reason);
  if (reasons?.length && reasons.every(timeout)) return 'REQUEST_TIMEOUT';
  const network = reason => timeout(reason) || [
    'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET',
    'ENETUNREACH', 'EHOSTUNREACH', 'ERR_NETWORK_ACCESS_DENIED', 'ERR_PROXY_CONNECTION_FAILED',
  ].includes(reason) || /CERT|TLS|SSL|ISSUER|SIGNATURE/u.test(reason);
  return reasons?.length && reasons.every(network) ? 'NETWORK_ERROR' : 'INTERNAL_UNKNOWN';
}

function safeReferenceId(value) {
  return typeof value === 'string' && /^[A-Z0-9-]{6,40}$/u.test(value)
    ? value
    : createFailureReferenceId();
}

function safeFailureReason(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_/-]{1,64}$/u.test(value)) return null;
  return value.toUpperCase().replace(/[-/]/gu, '_');
}

export function classifyMessageFailure(error, {
  userMessage,
  reason,
  referenceId,
  at = Date.now(),
} = {}) {
  const safeReason = safeFailureReason(reason);
  const details = extractConnectionEvidence(error).details;
  const classifiedCode = failureCode(error, details);
  const businessCode = classifiedCode === 'INTERNAL_UNKNOWN'
    && safeReason
    && typeof userMessage === 'string'
    && userMessage.trim()
    ? 'INPUT_INVALID'
    : classifiedCode;
  const code = businessCode === 'INTERNAL_UNKNOWN'
    ? transportFailureCode(error, details)
    : businessCode;
  if (code === 'REQUEST_TIMEOUT' || code === 'NETWORK_ERROR') details.hint = connectionHint(details);
  if (details.stage || details.submissionState) Object.assign(details, runtimeDiagnosticDetails());
  let message = FAILURE_MESSAGES[code];
  if (code === 'HARNESS_RESULT_UNCERTAIN' && error?.code === 'harness-timeout' && details.stage === 'prompt.submit') {
    message = PROMPT_SUBMIT_UNCONFIRMED_MESSAGE;
  }
  if (['INTERNAL_UNKNOWN', 'REQUEST_TIMEOUT', 'NETWORK_ERROR'].includes(code)) {
    if (details.submissionState === 'not-submitted') {
      message = code === 'REQUEST_TIMEOUT'
        ? '消息提交前的操作超时，本条消息尚未提交执行。请稍后重试。'
        : code === 'NETWORK_ERROR'
          ? '消息提交前的网络请求失败，本条消息尚未提交执行。请检查连接后重试。'
          : '消息在提交前处理失败，尚未提交执行。请重试；若持续发生，请将参考号提供给管理员。';
    } else if (details.submissionState) {
      message = '消息已尝试提交，但任务结果尚未确认。请先到 DSH 查看状态，不要立即重复提交；若持续发生，请将参考号提供给管理员。';
    }
  }
  return Object.freeze({
    ...(code === 'INTERNAL_UNKNOWN' || details.reason !== 'unknown' || details.httpStatus || details.providerCode || details.method || details.stage || details.submissionState ? { details } : {}),
    code,
    reason: safeReason ?? safeFailureReason(error?.code) ?? code,
    message: typeof userMessage === 'string' && userMessage.trim()
      ? userMessage.trim()
      : t(message) + (code === 'SESSION_ARCHIVED' && error?.promptAccepted === true
        ? `\n${t('本条消息可能仍在会话队列中，请先到 DSH 查看状态，避免重复提交。')}` : ''),
    referenceId: safeReferenceId(referenceId),
    at: Number.isFinite(at) ? at : Date.now(),
  });
}

export function messageFailureText(failure) {
  return `${failure.message}\n\n${t('错误码：{code}；参考号：{referenceId}', failure)}`;
}

export function messageFailureDiagnostic(error, failure) {
  const evidence = extractConnectionEvidence(error);
  return { code: failure.code, reason: failure.reason, referenceId: failure.referenceId,
    details: failure.details ?? evidence.details, errors: evidence.errors, ...evidence.correlation };
}

export function setLastMessageFailure(status, error, options) {
  const failure = classifyMessageFailure(error, options);
  status.lastMessageError = failure;
  status.lastError = failure.message;
  return failure;
}

export function clearLastMessageFailure(status) {
  status.lastMessageError = null;
}

export function channelDeliveryFailure(error, { uncertain = true } = {}) {
  const wrapped = new Error('Channel message delivery failed', { cause: error });
  const status = Number(error?.status ?? error?.httpStatus);
  wrapped.code = status === 401 || status === 403
    ? 'channel-permission'
    : status === 429
      ? 'channel-rate-limit'
      : uncertain
        ? 'channel-delivery-uncertain'
        : 'channel-delivery-failed';
  if (Number.isInteger(status)) wrapped.status = status;
  return messageDiagnosticError(wrapped, { stage: 'message.send' });
}

export function publicMessageFailure(value) {
  if (!value || typeof value !== 'object'
    || typeof value.code !== 'string' || !value.code
    || typeof value.reason !== 'string' || !value.reason
    || typeof value.message !== 'string' || !value.message
    || typeof value.referenceId !== 'string' || !value.referenceId
    || !Number.isFinite(value.at)) return null;
  return {
    code: value.code.slice(0, 64),
    reason: value.reason.slice(0, 64),
    message: value.message.slice(0, 500),
    referenceId: value.referenceId.slice(0, 40),
    at: value.at,
    ...(value.details ? diagnosticFields(value) : {}),
  };
}
